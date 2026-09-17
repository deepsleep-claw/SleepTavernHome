import { assignInplace, chunkBy, getComplementString, regexFromString } from '@util/common';
import { registerAsUniqueScript } from '@util/script';
import { compare } from 'compare-versions';
import YAML from 'yaml';
import {
  GREEN_CACHE_VERSION,
  GreenCacheEntry,
  hashGreenCacheContent,
  readGreenCacheVariables,
  writeGreenCacheVariables,
} from './green_cache';
import { publishSquashDebugRecord } from './debug';
import { captureFinalPrompt } from './debug_snapshot';
import { GenerationTrace } from './generation_trace';
import { generationAnchorDepth, selectGenerationHistory, type GenerationHistory } from './generation_history';
import type { DebugGeneration } from './debug_types';
import { Settings, WorldbookExtractionPositionOrder } from './store';
import {
  applyWorldbookEntryMetadataAnalysis,
  getSafeGetwiTemplateCalls,
  hasDynamicPromptMacroOrGetwi,
  SAFE_GETWI_TEMPLATE_REGEX,
  type SplitGetwiExtractionPart,
  type WorldbookEntryMetadata,
} from './worldbook_analysis';
import {
  compileWorldbookRules,
  getWorldbookPlacements,
  hasGreenCacheRules,
  planWorldbookExtraction,
  type WorldbookExtractionPlan,
  type WorldbookRuleContext,
  type WorldbookRuleFacts,
} from './worldbook_rules';
import { type WorldbookSource } from './worldbook_settings';
import { collectWorldbookSources } from './worldbook_sources';
import { WorldbookScanLedger, type WorldbookScanSnapshot } from './worldbook_scan';
import { getBaiBaiInjections, getEntryKeywords, identifyRubyEntries, readPluginSourceContext } from './plugin_sources';
import {
  groupWorldbookExtractions,
  replaceWorldbookPlaceholders,
  sortWorldbookExtractionItems,
  type SortableWorldbookExtractionItem,
} from './worldbook_output';

const GREEN_CACHE_ANCHOR_PREFIX = '§§TH_SQUASH_GREEN_CACHE_ANCHOR';
const GREEN_CACHE_ANCHOR_REGEX = /§§TH_SQUASH_GREEN_CACHE_ANCHOR:([^§]+)§§/g;
const DEBUG_FULL_TEXT_MATCH_LIMIT = 20_000;
const prompt_content_cache = new WeakMap<SillyTavern.SendingMessage, string>();

function getPromptContent(prompt: SillyTavern.SendingMessage, settings: Settings): string {
  const cached_content = prompt_content_cache.get(prompt);
  if (cached_content !== undefined) {
    return cached_content;
  }

  let content: string;
  if (typeof prompt.content === 'string') {
    content = prompt.content;
  } else {
    content = (prompt.content ?? [])
      .filter(({ type }) => type === 'text')
      .map(({ text }: any) => text)
      .join(settings.delimiter.value);
  }
  prompt_content_cache.set(prompt, content);
  return content;
}
function updatePromptContentWith(
  prompt: SillyTavern.SendingMessage,
  updater: (prompt: { role: SillyTavern.SendingMessage['role']; content: string }) => string,
  settings: Settings,
): SillyTavern.SendingMessage {
  const content = updater({ role: prompt.role, content: getPromptContent(prompt, settings) });
  if (typeof prompt.content === 'string') {
    prompt.content = content;
  } else {
    prompt.content ??= [];
    _.remove(prompt.content, item => item.type === 'text');
    if (content) {
      prompt.content.splice(0, 0, { type: 'text', text: content });
    }
  }
  prompt_content_cache.set(prompt, content);
  return prompt;
}

export type Separators = {
  head: InjectionPrompt;
  deep: InjectionPrompt;
  tail: InjectionPrompt;
};

export function injectSeparators(settings: Settings, shouldEnable: () => boolean = () => true) {
  const separators: Readonly<Separators> = Object.freeze({
    head: {
      id: `\0${getComplementString('压缩相邻消息-聊天记录开头')}`,
      position: 'in_chat',
      depth: 9999,
      role: 'assistant',
      content: `【【压缩相邻消息-聊天记录开头】】`,
    },
    deep: {
      id: `\xff压缩相邻消息-Dx`,
      position: 'in_chat',
      depth: settings.depth_injection.threshold,
      role: 'system',
      content: `【【压缩相邻消息-Dx】】`,
    },
    tail: {
      id: `\xff压缩相邻消息-聊天记录结尾`,
      position: 'in_chat',
      depth: 0,
      role: 'system',
      content: `【【压缩相邻消息-聊天记录结尾】】`,
    },
  } as const);
  let green_anchor_prompt_ids: string[] = [];
  let generation_type = 'normal';
  let active_generation = false;
  let regenerate_target: { id: number; message: SillyTavern.ChatMessage } | undefined;
  let history = readGenerationCacheHistory();

  const injectGreenAnchors = () => {
    if (!shouldEnable()) return;
    const target_id =
      regenerate_target && SillyTavern.chat[regenerate_target.id] === regenerate_target.message
        ? regenerate_target.id
        : undefined;
    history = readGenerationCacheHistory(generation_type, target_id);
    if (green_anchor_prompt_ids.length > 0) {
      uninjectPrompts(green_anchor_prompt_ids);
    }
    const green_anchor_prompts = getGreenCacheAnchorInjectionPrompts(settings, history);
    green_anchor_prompt_ids = green_anchor_prompts.map(prompt => prompt.id);
    if (green_anchor_prompts.length > 0) {
      injectPrompts(green_anchor_prompts);
    }
  };
  const inject = (type = 'normal', options?: { depth?: number }, dry_run = false) => {
    if (!shouldEnable()) return;
    injectPrompts(Object.values(separators));
    if (dry_run) return;
    generation_type = type;
    active_generation = true;
    const last_id = SillyTavern.chat.length - 1;
    const last = SillyTavern.chat[last_id];
    regenerate_target =
      type === 'regenerate' && !options?.depth && last && !last.is_user ? { id: last_id, message: last } : undefined;
    injectGreenAnchors();
  };
  const messageSent = () => {
    if (!active_generation) {
      generation_type = 'normal';
      regenerate_target = undefined;
    }
    injectGreenAnchors();
  };
  const messageDeleted = () => {
    if (active_generation && generation_type === 'regenerate') injectGreenAnchors();
  };
  const finishGeneration = () => {
    active_generation = false;
  };
  const promptsPrepared = (_data: unknown, dry_run = false) => {
    if (!dry_run) finishGeneration();
  };
  eventOn(tavern_events.GENERATION_AFTER_COMMANDS, inject);
  eventOn(tavern_events.MESSAGE_SENT, messageSent);
  eventOn(tavern_events.MESSAGE_DELETED, messageDeleted);
  eventOn(tavern_events.GENERATE_AFTER_DATA, promptsPrepared);
  eventOn(tavern_events.GENERATION_ENDED, finishGeneration);
  eventOn(tavern_events.GENERATION_STOPPED, finishGeneration);

  return {
    separators,
    getHistory: () => history,
    uninject: () => {
      eventRemoveListener(tavern_events.GENERATION_AFTER_COMMANDS, inject);
      eventRemoveListener(tavern_events.MESSAGE_SENT, messageSent);
      eventRemoveListener(tavern_events.MESSAGE_DELETED, messageDeleted);
      eventRemoveListener(tavern_events.GENERATE_AFTER_DATA, promptsPrepared);
      eventRemoveListener(tavern_events.GENERATION_ENDED, finishGeneration);
      eventRemoveListener(tavern_events.GENERATION_STOPPED, finishGeneration);
      uninjectPrompts([...Object.values(separators).map(({ id }) => id), ...green_anchor_prompt_ids]);
      green_anchor_prompt_ids = [];
    },
  };
}

//----------------------------------------------------------------------------------------------------------------------
function seperatePrompts(
  prompts: SillyTavern.SendingMessage[],
  separators: Separators,
): SillyTavern.SendingMessage[][] | undefined {
  const head_index = prompts.findIndex(
    ({ content }) => typeof content === 'string' && content.includes(separators.head.content),
  );
  const deep_index = prompts.findIndex(
    ({ content }) => typeof content === 'string' && content.includes(separators.deep.content),
  );
  const tail_index = prompts.findIndex(
    ({ content }) => typeof content === 'string' && content.includes(separators.tail.content),
  );
  if (head_index === -1 || deep_index === -1 || tail_index === -1) {
    return undefined;
  }

  const split_with_context = (
    splitted_before: [string, string],
    before_index: number,
    current_index: number,
    splitter: string,
  ): [string, string] => {
    if (before_index !== current_index) {
      return (prompts[current_index].content as string).split(splitter) as [string, string];
    }
    const splitted = splitted_before[1].split(splitter) as [string, string];
    splitted_before[1] = '';
    return splitted;
  };

  const splitted_head = split_with_context(['', ''], -1, head_index, separators.head.content);
  const splitted_deep = split_with_context(splitted_head, head_index, deep_index, separators.deep.content);
  const splitted_tail = split_with_context(splitted_deep, deep_index, tail_index, separators.tail.content);

  return [
    [...prompts.slice(0, head_index), { role: prompts[head_index].role, content: splitted_head[0] }],
    [
      { role: prompts[head_index].role, content: splitted_head[1] },
      ...prompts.slice(head_index + 1, deep_index),
      { role: prompts[deep_index].role, content: splitted_deep[0] },
    ],
    [
      { role: prompts[deep_index].role, content: splitted_deep[1] },
      ...prompts.slice(deep_index + 1, tail_index),
      { role: prompts[tail_index].role, content: splitted_tail[0] },
    ],
    [{ role: prompts[tail_index].role, content: splitted_tail[1] }, ...prompts.slice(tail_index + 1)],
  ];
}

function trimEmptyLines(string: string): string {
  let start = 0;
  while (start < string.length) {
    const line_end = getLineEndIndex(string, start);
    if (!isBlankStringRange(string, start, line_end)) {
      break;
    }
    start = getNextLineStartIndex(string, line_end);
  }

  let end = string.length;
  while (end > start) {
    const line_start = getPreviousLineStartIndex(string, end);
    if (!isBlankStringRange(string, line_start, trimLineBreakEnd(string, end))) {
      break;
    }
    end = trimPreviousLineBreakEnd(string, line_start);
  }

  return start === 0 && end === string.length ? string : string.slice(start, end);
}

function getLineEndIndex(string: string, start: number): number {
  let index = start;
  while (index < string.length && string[index] !== '\n' && string[index] !== '\r') {
    index++;
  }
  return index;
}

function getNextLineStartIndex(string: string, line_end: number): number {
  if (string[line_end] === '\r' && string[line_end + 1] === '\n') {
    return line_end + 2;
  }
  return line_end < string.length ? line_end + 1 : line_end;
}

function trimLineBreakEnd(string: string, end: number): number {
  if (end > 0 && string[end - 1] === '\n') {
    end--;
  }
  if (end > 0 && string[end - 1] === '\r') {
    end--;
  }
  return end;
}

function trimPreviousLineBreakEnd(string: string, line_start: number): number {
  if (line_start > 0 && string[line_start - 1] === '\n') {
    line_start--;
  }
  if (line_start > 0 && string[line_start - 1] === '\r') {
    line_start--;
  }
  return line_start;
}

function getPreviousLineStartIndex(string: string, end: number): number {
  let index = trimLineBreakEnd(string, end);
  while (index > 0 && string[index - 1] !== '\n' && string[index - 1] !== '\r') {
    index--;
  }
  return index;
}

function isBlankStringRange(string: string, start: number, end: number): boolean {
  for (let index = start; index < end; index++) {
    if (string[index].trim() !== '') {
      return false;
    }
  }
  return true;
}

function rejectEmptyPrompts(prompts: SillyTavern.SendingMessage[]): SillyTavern.SendingMessage[] {
  return _.reject(prompts, ({ content }) => typeof content === 'string' && content.trim() === '');
}

function cleanupChunks(chunks: SillyTavern.SendingMessage[][], settings: Settings) {
  chunks.forEach((chunk, index) => {
    chunks[index] = rejectEmptyPrompts(chunk).map(prompt =>
      updatePromptContentWith(prompt, ({ content }) => trimEmptyLines(content), settings),
    );
  });
}

function squashAdjacentMessage(
  prompts: SillyTavern.SendingMessage[],
  settings: Settings,
): SillyTavern.SendingMessage[] {
  return chunkBy(
    prompts,
    (lhs, rhs) => lhs.role === rhs.role && typeof lhs.content === 'string' && typeof rhs.content === 'string',
  ).map(chunk => ({
    role: chunk[0].role,
    // 长度大于 1, 必然 content 为 string
    content: chunk.length === 1 ? chunk[0].content : chunk.map(({ content }) => content).join(settings.delimiter.value),
  }));
}

function squashChatHistory(prompts: SillyTavern.SendingMessage[], settings: Settings): SillyTavern.SendingMessage[] {
  // TODO: zod encode
  const substituteFloor = (content: string, floor: number) => content.replaceAll('${floor}', floor.toString());
  const prefix = {
    system: substitudeMacros(settings.chat_history.system_prefix),
    assistant: substitudeMacros(settings.chat_history.assistant_prefix),
    user: substitudeMacros(settings.chat_history.user_prefix),
  };
  const suffix = {
    system: substitudeMacros(settings.chat_history.system_suffix),
    assistant: substitudeMacros(settings.chat_history.assistant_suffix),
    user: substitudeMacros(settings.chat_history.user_suffix),
  };

  const tagContent = (prompt: SillyTavern.SendingMessage, floor: number) =>
    updatePromptContentWith(
      prompt,
      ({ role, content }) => {
        if (role === 'tool') return content;
        const prompt_prefix = substituteFloor(prefix[role], floor);
        const prompt_suffix = substituteFloor(suffix[role], floor);
        content = content.includes(prompt_prefix) ? content : prompt_prefix + content;
        content = content.includes(prompt_suffix) ? content : content + prompt_suffix;
        return content;
      },
      settings,
    );

  let floor = 0;
  return chunkBy(prompts, (lhs, rhs) => typeof lhs.content === 'string' && typeof rhs.content === 'string').map(
    chunk => {
      chunk.forEach(prompt => tagContent(prompt, ++floor));

      return {
        role: settings.chat_history.squash_role,
        content:
          chunk.length === 1 ? chunk[0].content : chunk.map(({ content }) => content).join(settings.delimiter.value),
      };
    },
  );
}

type WorldbookExtractionPosition = (typeof WorldbookExtractionPositionOrder)[number];

type ActivatedWorldbookEntry = {
  rule_context: WorldbookRuleContext;
  key: string;
  world: string;
  uid: number;
  name: string;
  index: number;
  position: WorldbookExtractionPosition;
  depth: number;
  order: number;
  content: string;
  content_candidates: string[];
  split_getwi_parts: SplitGetwiExtractionPart[];
  wrapper_id?: string;
  preconsumed_content?: string;
  content_hash: string;
  has_source_macro: boolean;
  is_selective: boolean;
  native_position: number;
  preserve_reason?: string;
  source_role?: 'system' | 'user' | 'assistant';
};

const FLATTENED_WORLDBOOK_POSITION: Record<number, WorldbookExtractionPosition> = {
  0: 'before_character_definition',
  1: 'after_character_definition',
  2: 'before_author_note',
  3: 'after_author_note',
  4: 'at_depth',
  5: 'before_example_messages',
  6: 'after_example_messages',
};

type WorldbookEntriesLoadedEvent = {
  globalLore: ({ world: string } & SillyTavern.FlattenedWorldInfoEntry)[];
  characterLore: ({ world: string } & SillyTavern.FlattenedWorldInfoEntry)[];
  chatLore: ({ world: string } & SillyTavern.FlattenedWorldInfoEntry)[];
  personaLore: ({ world: string } & SillyTavern.FlattenedWorldInfoEntry)[];
};

function getWorldbookEntryKey(entry: { world: string } & Pick<SillyTavern.FlattenedWorldInfoEntry, 'uid'>): string {
  return `${entry.world}.${entry.uid}`;
}

function parseWorldbookEntryMetadata(
  entry: { world: string } & SillyTavern.FlattenedWorldInfoEntry,
  sources: WorldbookSource[],
): WorldbookEntryMetadata {
  const content = trimEmptyLines(unwrapWorldbookExtractionWrapperText(entry.content ?? ''));
  return {
    key: getWorldbookEntryKey(entry),
    rule_context: {
      world: entry.world,
      name: entry.comment ?? '',
      content,
      sources,
      trigger: entry.constant ? 'constant' : entry.vectorized ? 'vectorized' : 'selective',
      keywords: getEntryKeywords(entry.key),
    },
    world: entry.world,
    uid: entry.uid,
    name: entry.comment ?? '',
    is_constant: entry.constant,
    is_disabled: entry.disable === true,
    position: entry.position,
    depth: entry.depth,
    content,
    content_candidates: [content],
    split_getwi_parts: [],
    wrapper_id: undefined,
    content_hash: hashGreenCacheContent(content),
    has_dynamic_macro: true,
  };
}

type WorldbookWrapperPresenceDebug = {
  paired: boolean;
  start_count: number;
  end_count: number;
  paired_count: number;
};

type WorldbookExtractionFailureReason =
  | 'wrapper_missing_or_already_consumed'
  | 'wrapper_incomplete'
  | 'wrapper_present_but_not_consumed'
  | 'no_content_candidates'
  | 'no_candidate_match';

type WorldbookDebugTotalRow = {
  类型: string;
  触发: string;
  名称: string;
  来源: string;
  详细内容: string;
};

type WorldbookDebugTriggeredRow = {
  触发原因: string;
  触发类型: string;
  固定位置: string;
  提取状态: string;
  失败原因: string;
  名称: string;
  来源: string;
  详细内容: string;
};

type WorldbookDebugTriggeredRecord = {
  key: string;
  row: WorldbookDebugTriggeredRow;
};

type WorldbookDebugPromptRows = {
  prompt: SillyTavern.SendingMessage;
  rows: WorldbookDebugTotalRow[];
};

type GreenCacheInsertionSource = 'custom_anchor' | 'before_chat_history' | 'before_chat_anchor';

type ChatDebugRole = 'system' | 'assistant' | 'user';

type ChatPromptSnapshot = {
  order: number;
  anchor_key: string;
  message_id: number;
  swipe_id: number;
  role: ChatDebugRole;
  is_hidden: boolean;
  content: string;
  content_hash: string;
  content_length: number;
};
type CacheHistory = GenerationHistory<ChatPromptSnapshot>;

type GreenCacheDebugState = {
  request_history?: {
    generation_type: string;
    message_ids: number[];
    injection_message_ids: number[];
    anchor_message_ids: number[];
  };
  summary?: {
    cache_total: number;
    valid_cache_total: number;
    deduped_cache_total: number;
    injectable_cache_total: number;
    aggressive_activated_total: number;
    handled_total: number;
    new_cache_total: number;
    suppressed_total: number;
    inserted_entry_total: number;
    new_anchor_key: string;
    can_insert_new_anchor: boolean;
  };
  chat_messages: {
    order: number;
    anchor_key: string;
    message_id: number;
    swipe_id: number;
    role: ChatDebugRole;
    is_hidden: boolean;
    message_hash: string;
    message_length: number;
    in_request: boolean;
    anchor_eligible: boolean;
    anchor_depth?: number;
    prompt_chunk_index?: PromptInsertionLocation['chunk_index'];
    prompt_index?: number;
    insertion_source?: GreenCacheInsertionSource;
    insertion_chunk_index?: PromptInsertionLocation['chunk_index'];
    insertion_index?: number;
    insertion_source_anchor_key?: string;
  }[];
  cache_entries: {
    identity: string;
    world: string;
    uid: number;
    name: string;
    anchor_key: string;
    message_id: number | null;
    swipe_id: number | null;
    message_hash: string | null;
    created_at: number;
    can_insert: boolean;
    will_insert: boolean;
    suppressed: boolean;
    content_length: number;
    insertion_source?: GreenCacheInsertionSource;
    insertion_chunk_index?: PromptInsertionLocation['chunk_index'];
    insertion_index?: number;
    insertion_source_anchor_key?: string;
  }[];
  activations: {
    key: string;
    identity: string;
    world: string;
    uid: number;
    name: string;
    action:
      | 'fixed_cache_consumed'
      | 'fixed_cache_original_missing'
      | 'skip_fixed_anchor_unavailable'
      | 'new_cache_created'
      | 'skip_new_anchor_unavailable'
      | 'skip_content_not_found';
    cached_anchor_key?: string;
    cached_can_insert?: boolean;
    cached_insertion_source?: GreenCacheInsertionSource;
    cached_insertion_chunk_index?: PromptInsertionLocation['chunk_index'];
    cached_insertion_index?: number;
    consumed: boolean;
    consumed_method?: ConsumedPromptContent['method'];
    consumed_prompt_index?: number;
    consumed_content_length?: number;
    new_anchor_key: string;
  }[];
  insertions: {
    anchor_key: string;
    insertion_source: GreenCacheInsertionSource;
    chunk_index: PromptInsertionLocation['chunk_index'];
    insert_index: number;
    order?: number;
    entry_count: number;
    identities: string[];
    names: string[];
    content_lengths: number[];
    source_anchor_key?: string;
  }[];
};

function getWorldbookRegexDepth(entry: { position: number; depth?: number }): number | undefined {
  return entry.position === 4 ? (entry.depth ?? DEFAULT_WORLDBOOK_DEPTH) : undefined;
}

function formatAsWorldbookPromptRegexedContent(content: string, entry: { position: number; depth?: number }): string {
  const depth = getWorldbookRegexDepth(entry);
  return depth === undefined
    ? formatAsTavernRegexedString(content, 'world_info', 'prompt')
    : formatAsTavernRegexedString(content, 'world_info', 'prompt', { depth });
}

function isRegexDepthMatched(regex: TavernRegex, entry: { position: number; depth?: number }): boolean {
  const depth = getWorldbookRegexDepth(entry);
  if (depth === undefined) {
    return true;
  }
  if (regex.min_depth !== null && regex.min_depth >= -1 && depth < regex.min_depth) {
    return false;
  }
  if (regex.max_depth !== null && regex.max_depth >= 0 && depth > regex.max_depth) {
    return false;
  }
  return true;
}

function getWorldInfoPromptRegexes(): TavernRegex[] {
  const regexes = [
    ...getTavernRegexes({ type: 'global' }),
    ...getTavernRegexes({ type: 'preset', name: 'in_use' }),
    ...(isCharacterTavernRegexesEnabled() ? getTavernRegexes({ type: 'character', name: 'current' }) : []),
  ];
  return regexes.filter(regex => regex.enabled && regex.source.world_info && regex.destination.prompt);
}

function parseTavernRegex(pattern: string): RegExp | undefined {
  try {
    if (pattern.startsWith('/')) {
      const last_slash_index = pattern.lastIndexOf('/');
      if (last_slash_index > 0) {
        const flags = pattern.slice(last_slash_index + 1).replace(/g/g, '');
        return new RegExp(pattern.slice(1, last_slash_index), flags);
      }
    }
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

function hasUnstableTavernMacro(content: string): boolean {
  return [...content.matchAll(/\{\{([\s\S]*?)\}\}/g)].some(match => !/^(user|char|match)$/i.test(match[1].trim()));
}

function hasUnstableWorldInfoPromptRegex(
  content: string,
  entry: { position: number; depth?: number },
  for_cache = false,
): boolean {
  let previous_may_change = false;
  for (const regex of getWorldInfoPromptRegexes().filter(regex => isRegexDepthMatched(regex, entry))) {
    if (hasUnstableTavernMacro(regex.find_regex)) return true;
    const pattern = parseTavernRegex(substitudeMacros(regex.find_regex));
    const matches = !!pattern?.test(content);
    const dynamic_replacement =
      hasUnstableTavernMacro(regex.replace_string) ||
      (regex.trim_strings ?? []).some(hasUnstableTavernMacro) ||
      (for_cache && hasDynamicPromptMacroOrGetwi(regex.replace_string.replace(/\{\{match\}\}/gi, '')));
    if (dynamic_replacement && (matches || previous_may_change)) return true;
    previous_may_change ||= matches;
  }
  return false;
}

const WORLDBOOK_EXTRACTION_WRAPPER_PREFIX = '§§TH_SQUASH_WI';
const WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX = '§§';
const DEFAULT_WORLDBOOK_DEPTH = 4;
const WORLDBOOK_PLACEHOLDER_SEPARATOR = '\n';

type WorldInfoScanDoneEvent = {
  state: {
    next: number;
  };
  activated: {
    entries: Map<string, SillyTavern.FlattenedWorldInfoEntry>;
  };
  sortedEntries?: SillyTavern.FlattenedWorldInfoEntry[];
};

type WorldbookExtractionDebugState = {
  loaded: {
    total: number;
    constant_with_getwi: number;
    dynamic: number;
    split: number;
    wrapped: number;
    split_wrapped_parts: number;
  };
  total_rows: WorldbookDebugTotalRow[];
  triggered_rows: WorldbookDebugTriggeredRecord[];
  prompt_rows: WorldbookDebugPromptRows[];
  error_logs: string[];
  green_cache: GreenCacheDebugState;
  wrapper_before_unwrap: {
    paired: number;
    orphan: number;
  };
  total_activated: number;
  total_extraction: number;
  total_consumed: number;
};

function createWorldbookExtractionDebugState(): WorldbookExtractionDebugState {
  return {
    loaded: {
      total: 0,
      constant_with_getwi: 0,
      dynamic: 0,
      split: 0,
      wrapped: 0,
      split_wrapped_parts: 0,
    },
    total_rows: [],
    triggered_rows: [],
    prompt_rows: [],
    error_logs: [],
    green_cache: {
      chat_messages: [],
      cache_entries: [],
      activations: [],
      insertions: [],
    },
    wrapper_before_unwrap: {
      paired: 0,
      orphan: 0,
    },
    total_activated: 0,
    total_extraction: 0,
    total_consumed: 0,
  };
}

function pushDebugLogItem<T>(items: T[], item: T) {
  items.push(item);
}

function getWorldbookExtractionWrapperStats(
  prompts: SillyTavern.SendingMessage[],
  settings: Settings,
): { paired: number; orphan: number } {
  let paired = 0;
  let marker_count = 0;
  prompts.forEach(prompt => {
    const content = getPromptContent(prompt, settings);
    let index = 0;
    while ((index = content.indexOf(`${WORLDBOOK_EXTRACTION_WRAPPER_PREFIX}:`, index)) !== -1) {
      const marker_end = content.indexOf(WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX, index + 1);
      if (marker_end === -1) {
        break;
      }

      const marker = content.slice(index, marker_end + WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX.length);
      marker_count++;
      if (marker.endsWith(`:START${WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX}`)) {
        const wrapper_id = marker.slice(
          WORLDBOOK_EXTRACTION_WRAPPER_PREFIX.length + 1,
          -`:START${WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX}`.length,
        );
        if (
          content.indexOf(
            getWorldbookExtractionWrapperEnd(wrapper_id),
            marker_end + WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX.length,
          ) !== -1
        ) {
          paired++;
        }
      }
      index = marker_end + WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX.length;
    }
  });
  return { paired, orphan: Math.max(0, marker_count - paired * 2) };
}

function isWorldbookDebugStateEmpty(state: WorldbookExtractionDebugState): boolean {
  return (
    state.total_rows.length === 0 &&
    state.triggered_rows.length === 0 &&
    state.error_logs.length === 0 &&
    state.loaded.total === 0
  );
}

function getWorldbookDebugTitle(state: WorldbookExtractionDebugState): string {
  const failed = state.total_extraction - state.total_consumed;
  return `[压缩相邻消息] Debug: 总排序 ${state.total_rows.length}, 触发 ${state.triggered_rows.length}, 失败 ${failed}, 残留包裹 ${state.wrapper_before_unwrap.paired}/${state.wrapper_before_unwrap.orphan}`;
}

function getConsoleDebugRowPreview<T extends { 详细内容?: string }>(row: T): T {
  return typeof row.详细内容 === 'string' ? { ...row, 详细内容: getDebugContentPreview(row.详细内容) } : row;
}

function printWorldbookDebugState(state: WorldbookExtractionDebugState) {
  if (isWorldbookDebugStateEmpty(state)) {
    return;
  }

  const title = getWorldbookDebugTitle(state);
  if (typeof console.groupCollapsed === 'function') {
    console.groupCollapsed(title);
    console.groupCollapsed('1. 总排序');
    console.table(state.total_rows.map(getConsoleDebugRowPreview));
    console.groupEnd();
    console.groupCollapsed('2. 触发的蓝灯和绿灯');
    console.table(state.triggered_rows.map(record => getConsoleDebugRowPreview(record.row)));
    console.groupEnd();
    if (state.error_logs.length > 0) {
      console.info(`3. 出错内容日志\n${state.error_logs.join('\n\n')}`);
    }
    console.groupEnd();
  } else {
    console.info(title, {
      total_rows: state.total_rows.map(getConsoleDebugRowPreview),
      triggered_rows: state.triggered_rows.map(record => getConsoleDebugRowPreview(record.row)),
      error_logs: state.error_logs,
    });
  }
}

function getWorldbookExtractionWrapperStart(wrapper_id: string): string {
  return `${WORLDBOOK_EXTRACTION_WRAPPER_PREFIX}:${wrapper_id}:START${WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX}`;
}

function getWorldbookExtractionWrapperEnd(wrapper_id: string): string {
  return `${WORLDBOOK_EXTRACTION_WRAPPER_PREFIX}:${wrapper_id}:END${WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX}`;
}

function wrapWorldbookExtractionContent(wrapper_id: string, content: string): string {
  return `${getWorldbookExtractionWrapperStart(wrapper_id)}${content}${getWorldbookExtractionWrapperEnd(wrapper_id)}`;
}

function unwrapWorldbookExtractionWrapperText(content: string): string {
  let result = '';
  let index = 0;
  while (true) {
    const marker_start = content.indexOf(`${WORLDBOOK_EXTRACTION_WRAPPER_PREFIX}:`, index);
    if (marker_start === -1) {
      result += content.slice(index);
      return result;
    }

    result += content.slice(index, marker_start);
    const marker_end = content.indexOf(WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX, marker_start + 1);
    if (marker_end === -1) {
      result += content.slice(marker_start);
      return result;
    }

    const marker = content.slice(marker_start, marker_end + WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX.length);
    if (!marker.endsWith(`:START${WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX}`)) {
      index = marker_end + WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX.length;
      continue;
    }

    const wrapper_id = marker.slice(
      WORLDBOOK_EXTRACTION_WRAPPER_PREFIX.length + 1,
      -`:START${WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX}`.length,
    );
    const wrapper_end = getWorldbookExtractionWrapperEnd(wrapper_id);
    const inner_start = marker_end + WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX.length;
    const end_index = content.indexOf(wrapper_end, inner_start);
    if (end_index === -1) {
      index = inner_start;
      continue;
    }

    result += content.slice(inner_start, end_index);
    index = end_index + wrapper_end.length;
  }
}

type MacroLikeVariableType = 'message' | 'chat' | 'character' | 'preset' | 'global';

function getLastMessageVariableId(): number {
  return SillyTavern.chat.findLastIndex(message => _.isObject(message.variables?.[message.swipe_id ?? 0]));
}

function getMacroLikeVariables(type: MacroLikeVariableType): Record<string, any> {
  return getVariables(
    type === 'message'
      ? {
          type,
          message_id: getLastMessageVariableId(),
        }
      : { type },
  );
}

function omitVariableMetadata(value: any): any {
  if (_.isArray(value)) {
    return value.map(omitVariableMetadata);
  }
  if (_.isPlainObject(value)) {
    return _(value)
      .omitBy((_item, key) => key.startsWith('$'))
      .mapValues(omitVariableMetadata)
      .value();
  }
  return value;
}

function getMacroLikeVariableValue(type: MacroLikeVariableType, path: string): any {
  return omitVariableMetadata(_.get(getMacroLikeVariables(type), _.unescape(path), null));
}

const FORMAT_VARIABLE_REPLACE_REGEX = /^(.*)\{\{format_(message|chat|character|preset|global)_variable::(.*?)\}\}/gim;
const FORMAT_VARIABLE_PREFIX_REGEX = /^(.*)\{\{format_(message|chat|character|preset|global)_variable::(.*?)\}\}/im;
const GET_VARIABLE_REPLACE_REGEX = /\{\{get_(message|chat|character|preset|global)_variable::(.*?)\}\}/gi;

function applyFormatVariable(_substring: string, prefix: string, type: MacroLikeVariableType, path: string): string {
  const match = prefix.match(FORMAT_VARIABLE_PREFIX_REGEX);
  if (match) {
    prefix =
      applyFormatVariable('', match[1], match[2] as MacroLikeVariableType, match[3]) + prefix.slice(match[0].length);
  }

  const value = getMacroLikeVariableValue(type, path);
  const formatted_value =
    typeof value === 'string' ? value : YAML.stringify(value, { blockQuote: 'literal' }).trimEnd();
  return prefix + formatted_value.replaceAll('\n', '\n' + ' '.repeat(prefix.length));
}

function applyTavernHelperVariableMacros(content: string): string {
  let result = content.replace(
    GET_VARIABLE_REPLACE_REGEX,
    (_substring: string, type: MacroLikeVariableType, path: string) => {
      const value = getMacroLikeVariableValue(type, path);
      return typeof value === 'string' ? value : JSON.stringify(value);
    },
  );

  result = result.replace(
    FORMAT_VARIABLE_REPLACE_REGEX,
    (_substring: string, prefix: string, type: MacroLikeVariableType, path: string) =>
      applyFormatVariable(_substring, prefix, type, path),
  );
  return result;
}

function getContentCandidates(contents: string[]): string[] {
  const candidates = _.uniq(contents.filter(content => content));
  for (const content of [...candidates]) {
    const macro_like_content = applyTavernHelperVariableMacros(content);
    if (macro_like_content !== content) {
      candidates.push(macro_like_content);
    }
  }
  return _.uniq(candidates);
}

function getWorldbookEntryContentCandidates(entry: ActivatedWorldbookEntry): string[] {
  return getContentCandidates([entry.content, ...entry.content_candidates]);
}

function parseActivatedWorldbookEntry(
  entry: { world: string } & SillyTavern.FlattenedWorldInfoEntry,
  index: number,
  metadata: WorldbookEntryMetadata | undefined,
): ActivatedWorldbookEntry | undefined {
  const content = trimEmptyLines(unwrapWorldbookExtractionWrapperText(entry.content ?? ''));
  if (!content || entry.disable) {
    return undefined;
  }

  const has_source_macro = metadata?.has_dynamic_macro ?? true;
  if (!entry.constant && entry.vectorized) {
    return undefined;
  }

  return {
    key: getWorldbookEntryKey(entry),
    rule_context: metadata?.rule_context ?? {
      world: entry.world,
      name: entry.comment ?? '',
      content,
      sources: [],
      trigger: entry.constant ? 'constant' : entry.vectorized ? 'vectorized' : 'selective',
    },
    world: entry.world,
    uid: entry.uid,
    name: metadata?.name ?? entry.comment ?? '',
    index,
    position: FLATTENED_WORLDBOOK_POSITION[entry.position] ?? 'at_depth',
    depth: entry.depth ?? 0,
    order: entry.order ?? 0,
    content,
    content_candidates: [...(metadata?.content_candidates ?? [content])],
    split_getwi_parts:
      metadata?.split_getwi_parts.map(part => ({
        ...part,
        content_candidates: [...part.content_candidates],
      })) ?? [],
    wrapper_id: metadata?.wrapper_id,
    content_hash: metadata?.content_hash ?? hashGreenCacheContent(content),
    has_source_macro,
    is_selective: !entry.constant && !entry.vectorized,
    native_position: entry.position,
    preserve_reason: metadata ? undefined : '扫描原文无法关联',
  };
}

function prepareRequestWorldbookEntries(
  prompts: SillyTavern.SendingMessage[],
  entries: ActivatedWorldbookEntry[],
  settings: Settings,
  debug: WorldbookExtractionDebugState,
) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  let serial = 0;
  const nextId = () => nonce + (serial++).toString(36);
  const replacements = new Map<string, string>();
  const preserve = (entry: ActivatedWorldbookEntry, reason: string) => {
    entry.preserve_reason = reason;
    updateWorldbookTriggeredRecord(debug, entry.key, { 提取状态: '保留原位', 失败原因: reason });
  };
  try {
    // 较长正文先定位；已定位块临时占位，避免其他同文条目再次匹配它。
    for (const entry of [...entries].sort((a, b) => b.content.length - a.content.length || a.index - b.index)) {
      if (entry.preserve_reason) {
        preserve(entry, entry.preserve_reason);
        continue;
      }
      const native = { position: entry.native_position, depth: entry.depth };
      const extension = entry.rule_context.trigger === 'extension';
      if (!extension && hasUnstableWorldInfoPromptRegex(entry.content, native)) {
        preserve(entry, '动态正则结果无法安全定位');
        continue;
      }
      const candidate = extension ? entry.content : formatAsWorldbookPromptRegexedContent(entry.content, native);
      if (!candidate) {
        preserve(entry, '正文经过正则处理后为空');
        continue;
      }
      const calls = getSafeGetwiTemplateCalls(candidate);
      if (entry.split_getwi_parts.length && calls.length !== entry.split_getwi_parts.length) {
        preserve(entry, '聚合正文无法安全拆分');
        continue;
      }
      const candidates = entry.source_role ? prompts.filter(prompt => prompt.role === entry.source_role) : prompts;
      if (extension) {
        const count = candidates.reduce(
          (total, prompt) =>
            total +
            countStringOccurrences(
              getNormalizedTargetContent(getPromptContent(prompt, settings)),
              getNormalizedTargetContent(candidate),
            ),
          0,
        );
        if (count !== 1) {
          preserve(entry, '插件注入未能唯一定位');
          continue;
        }
      }
      const consumed = candidate.includes('<%')
        ? consumePromptContent(candidates, candidate, settings)
        : consumePromptContentCandidate(candidates, candidate, settings);
      if (!consumed) {
        preserve(entry, '未在本次请求中定位到完整正文');
        continue;
      }
      const token = '§§TH_SQUASH_PENDING:' + nextId() + '§§';
      let wrapped: string;
      if (entry.split_getwi_parts.length) {
        let index = 0;
        wrapped = consumed.content.replace(SAFE_GETWI_TEMPLATE_REGEX, template => {
          const part = entry.split_getwi_parts[index++];
          part.wrapper_id = nextId();
          part.content_candidates = [template];
          return wrapWorldbookExtractionContent(part.wrapper_id, template);
        });
        debug.loaded.split_wrapped_parts += entry.split_getwi_parts.length;
      } else {
        entry.wrapper_id = nextId();
        wrapped = wrapWorldbookExtractionContent(entry.wrapper_id, consumed.content);
      }
      replacements.set(token, wrapped);
      updatePromptContentWith(
        consumed.prompt,
        () => consumed.original_content.replace(consumed.content, () => token),
        settings,
      );
      entry.content = consumed.content;
      entry.content_candidates = [consumed.content];
      entry.has_source_macro ||= hasDynamicPromptMacroOrGetwi(consumed.content);
      debug.loaded.wrapped++;
    }
  } finally {
    for (const prompt of prompts) {
      updatePromptContentWith(prompt, ({ content }) => replaceWorldbookPlaceholders(content, replacements), settings);
    }
  }
}

type ConsumedPromptContent = {
  original_content: string;
  prompt: SillyTavern.SendingMessage;
  index: number;
  content: string;
  method: 'exact' | 'wrapper' | 'normalized';
};
const normalized_target_cache = new Map<string, string>();
type WrapperPromptIndex = Map<string, number[]>;

function clearPromptContent(prompt: SillyTavern.SendingMessage, settings: Settings) {
  updatePromptContentWith(prompt, () => '', settings);
}

const DIALOGUE_EXAMPLE_NAMES = new Set(['example_user', 'example_assistant']);

function isDialogueExamplePrompt(prompt: SillyTavern.SendingMessage): boolean {
  const name = _.get(prompt, 'name');
  return typeof name === 'string' && DIALOGUE_EXAMPLE_NAMES.has(name);
}

function cleanupDialogueExampleSeparatorAfterConsumption(
  prompts: SillyTavern.SendingMessage[],
  consumed: ConsumedPromptContent,
  settings: Settings,
) {
  if (!isDialogueExamplePrompt(consumed.prompt)) {
    return;
  }

  let block_start = consumed.index;
  while (block_start > 0 && isDialogueExamplePrompt(prompts[block_start - 1])) {
    block_start--;
  }

  const separator_index = block_start - 1;
  if (separator_index < 0 || prompts[separator_index].role !== 'system') {
    return;
  }

  let block_end = consumed.index;
  while (block_end < prompts.length - 1 && isDialogueExamplePrompt(prompts[block_end + 1])) {
    block_end++;
  }

  const has_remaining_example_content = prompts
    .slice(block_start, block_end + 1)
    .some(prompt => getPromptContent(prompt, settings).trim());
  if (!has_remaining_example_content) {
    clearPromptContent(prompts[separator_index], settings);
  }
}

function consumePromptContent(
  prompts: SillyTavern.SendingMessage[],
  target: string,
  settings: Settings,
): ConsumedPromptContent | undefined {
  for (let prompt_index = 0; prompt_index < prompts.length; prompt_index++) {
    const prompt = prompts[prompt_index];
    const content = getPromptContent(prompt, settings);
    const content_index = content.indexOf(target);
    if (content_index === -1) {
      continue;
    }

    updatePromptContentWith(
      prompt,
      ({ content }) => content.slice(0, content_index) + content.slice(content_index + target.length),
      settings,
    );
    return { prompt, index: prompt_index, content: target, original_content: content, method: 'exact' };
  }
  return undefined;
}

function getNonWhitespaceContentIndex(content: string): { normalized: string; indexes: number[] } {
  const normalized_chars: string[] = [];
  const indexes: number[] = [];
  for (let index = 0; index < content.length; index++) {
    if (!isWhitespaceCharacter(content[index])) {
      normalized_chars.push(content[index]);
      indexes.push(index);
    }
  }
  return { normalized: normalized_chars.join(''), indexes };
}

function isWhitespaceCharacter(character: string): boolean {
  return character.trim() === '';
}

function removeWhitespaceCharacters(content: string): string {
  const result: string[] = [];
  for (const character of content) {
    if (!isWhitespaceCharacter(character)) {
      result.push(character);
    }
  }
  return result.join('');
}

function getNormalizedTargetContent(target: string): string {
  const cached = normalized_target_cache.get(target);
  if (cached !== undefined) {
    return cached;
  }
  const normalized = removeWhitespaceCharacters(target);
  normalized_target_cache.set(target, normalized);
  return normalized;
}

function findPromptContentByNormalizedWhitespace(
  content: string,
  target: string,
): { start: number; end: number } | undefined {
  const normalized_target = getNormalizedTargetContent(target);
  if (!normalized_target) {
    return undefined;
  }

  const normalized_content = getNonWhitespaceContentIndex(content);
  const normalized_index = normalized_content.normalized.indexOf(normalized_target);
  if (normalized_index === -1) {
    return undefined;
  }

  let start = normalized_content.indexes[normalized_index];
  let end = normalized_content.indexes[normalized_index + normalized_target.length - 1] + 1;
  while (start > 0 && (content[start - 1] === ' ' || content[start - 1] === '\t')) {
    start--;
  }
  while (end < content.length && (content[end] === ' ' || content[end] === '\t')) {
    end++;
  }
  return { start, end };
}

function consumePromptContentByNormalizedWhitespace(
  prompts: SillyTavern.SendingMessage[],
  target: string,
  settings: Settings,
): ConsumedPromptContent | undefined {
  for (const [prompt_index, prompt] of prompts.entries()) {
    const content = getPromptContent(prompt, settings);
    const match = findPromptContentByNormalizedWhitespace(content, target);
    if (!match) {
      continue;
    }

    const consumed_content = content.slice(match.start, match.end);
    updatePromptContentWith(
      prompt,
      ({ content }) => content.slice(0, match.start) + content.slice(match.end),
      settings,
    );
    return { prompt, index: prompt_index, content: consumed_content, original_content: content, method: 'normalized' };
  }
  return undefined;
}

function consumeWrappedPromptContent(
  prompts: SillyTavern.SendingMessage[],
  wrapper_id: string,
  settings: Settings,
  wrapper_prompt_index?: WrapperPromptIndex,
): ConsumedPromptContent | undefined {
  const wrapper_start = getWorldbookExtractionWrapperStart(wrapper_id);
  const wrapper_end = getWorldbookExtractionWrapperEnd(wrapper_id);
  const preferred_prompt_indexes = wrapper_prompt_index?.get(wrapper_id);
  if (preferred_prompt_indexes) {
    for (const prompt_index of preferred_prompt_indexes) {
      const consumed = consumeWrappedPromptContentInPrompt(prompts, prompt_index, wrapper_start, wrapper_end, settings);
      if (consumed) {
        return consumed;
      }
    }
  }

  for (let prompt_index = 0; prompt_index < prompts.length; prompt_index++) {
    if (preferred_prompt_indexes?.includes(prompt_index)) {
      continue;
    }
    const consumed = consumeWrappedPromptContentInPrompt(prompts, prompt_index, wrapper_start, wrapper_end, settings);
    if (consumed) {
      return consumed;
    }
  }
  return undefined;
}

function consumeWrappedPromptContentInPrompt(
  prompts: SillyTavern.SendingMessage[],
  prompt_index: number,
  wrapper_start: string,
  wrapper_end: string,
  settings: Settings,
): ConsumedPromptContent | undefined {
  const prompt = prompts[prompt_index];
  if (!prompt) {
    return undefined;
  }

  const content = getPromptContent(prompt, settings);
  const start_index = content.indexOf(wrapper_start);
  if (start_index === -1) {
    return undefined;
  }

  const inner_start_index = start_index + wrapper_start.length;
  const end_index = content.indexOf(wrapper_end, inner_start_index);
  if (end_index === -1) {
    return undefined;
  }

  const inner_content = content.slice(inner_start_index, end_index);
  let before = content.slice(0, start_index);
  const after = content.slice(end_index + wrapper_end.length);
  if (!after.trim()) before = before.replace(/\r?\n$/, '');
  updatePromptContentWith(prompt, () => before + after, settings);
  return { prompt, index: prompt_index, content: inner_content, original_content: content, method: 'wrapper' };
}

function buildWorldbookWrapperPromptIndex(
  prompts: SillyTavern.SendingMessage[],
  settings: Settings,
): WrapperPromptIndex {
  const index = new Map<string, number[]>();
  prompts.forEach((prompt, prompt_index) => {
    const content = getPromptContent(prompt, settings);
    let marker_start = 0;
    while ((marker_start = content.indexOf(`${WORLDBOOK_EXTRACTION_WRAPPER_PREFIX}:`, marker_start)) !== -1) {
      const marker_end = content.indexOf(WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX, marker_start + 1);
      if (marker_end === -1) {
        break;
      }

      const marker = content.slice(marker_start, marker_end + WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX.length);
      if (marker.endsWith(`:START${WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX}`)) {
        const wrapper_id = marker.slice(
          WORLDBOOK_EXTRACTION_WRAPPER_PREFIX.length + 1,
          -`:START${WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX}`.length,
        );
        const prompt_indexes = index.get(wrapper_id) ?? [];
        prompt_indexes.push(prompt_index);
        index.set(wrapper_id, prompt_indexes);
      }
      marker_start = marker_end + WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX.length;
    }
  });
  return index;
}

function countStringOccurrences(content: string, target: string): number {
  if (!target) return 0;
  let count = 0;
  let index = 0;
  while ((index = content.indexOf(target, index)) !== -1) {
    count++;
    index += target.length;
  }
  return count;
}

function getWorldbookWrapperPresence(
  prompts: SillyTavern.SendingMessage[],
  wrapper_id: string,
  settings: Settings,
): WorldbookWrapperPresenceDebug {
  const wrapper_start = getWorldbookExtractionWrapperStart(wrapper_id);
  const wrapper_end = getWorldbookExtractionWrapperEnd(wrapper_id);

  return prompts.reduce<WorldbookWrapperPresenceDebug>(
    (presence, prompt) => {
      const content = getPromptContent(prompt, settings);
      presence.start_count += countStringOccurrences(content, wrapper_start);
      presence.end_count += countStringOccurrences(content, wrapper_end);
      let start_index = 0;
      while ((start_index = content.indexOf(wrapper_start, start_index)) !== -1) {
        const end_index = content.indexOf(wrapper_end, start_index + wrapper_start.length);
        if (end_index === -1) {
          break;
        }
        presence.paired_count++;
        start_index = end_index + wrapper_end.length;
      }
      presence.paired = presence.paired_count > 0;
      return presence;
    },
    {
      paired: false,
      start_count: 0,
      end_count: 0,
      paired_count: 0,
    },
  );
}

function consumePromptContentCandidate(
  prompts: SillyTavern.SendingMessage[],
  target: string,
  settings: Settings,
): ConsumedPromptContent | undefined {
  const exact_consumed = consumePromptContent(prompts, target, settings);
  if (exact_consumed) {
    return exact_consumed;
  }

  return consumePromptContentByNormalizedWhitespace(prompts, target, settings);
}

function unwrapRemainingWorldbookExtractionWrappers(prompts: SillyTavern.SendingMessage[], settings: Settings) {
  prompts.forEach(prompt => {
    updatePromptContentWith(prompt, ({ content }) => unwrapWorldbookExtractionWrapperText(content), settings);
  });
}

type GreenCacheAnchor = GreenCacheEntry['fixed_at'];

const BEFORE_CHAT_GREEN_CACHE_ANCHOR: GreenCacheAnchor = {
  message_id: null,
  swipe_id: null,
  message_hash: null,
};

type PromptInsertionLocation = {
  chunk_index: 1 | 2;
  insert_index: number;
  order: number;
  source: GreenCacheInsertionSource;
  source_anchor_key?: string;
};

function getGreenCacheIdentity(entry: Pick<GreenCacheEntry, 'world' | 'uid' | 'content_hash'>): string {
  return `${entry.world}.${entry.uid}.${entry.content_hash}`;
}

function getAnchorKey(anchor: GreenCacheAnchor): string {
  return `${anchor.message_id ?? 'before'}.${anchor.swipe_id ?? 'none'}`;
}

function getGreenCacheFixedTrigger(anchor: GreenCacheAnchor): string {
  return anchor.message_id === null ? '绿灯固定所有消息前' : `绿灯固定第 ${anchor.message_id} 层`;
}

function isAggressiveGreenEntry(entry: ActivatedWorldbookEntry): boolean {
  return entry.is_selective && !entry.has_source_macro && !entry.preserve_reason && !entry.rule_context.plugin;
}

function normalizeContentForMatch(content: string): string {
  return trimEmptyLines(content).replace(/\r\n?/g, '\n');
}

function getWorldbookDebugType(is_selective: boolean): string {
  return is_selective ? '世界书绿灯' : '世界书蓝灯';
}

function getActivatedWorldbookDebugTrigger(entry: ActivatedWorldbookEntry): string {
  if (entry.rule_context.plugin === 'ruby') return 'RUBY分析输出';
  if (entry.rule_context.trigger === 'extension') return '插件注入';
  if (entry.is_selective) {
    return '绿灯非固定';
  }
  return entry.has_source_macro ? '蓝灯非固定' : '蓝灯固定';
}

function getWorldbookPositionLabel(entry: Pick<ActivatedWorldbookEntry, 'position' | 'depth'>): string {
  return entry.position === 'at_depth' ? `D${entry.depth}` : entry.position;
}

function getWorldbookTriggeredRecord(
  state: WorldbookExtractionDebugState,
  key: string,
): WorldbookDebugTriggeredRecord | undefined {
  return state.triggered_rows.find(record => record.key === key);
}

function upsertWorldbookTriggeredRecord(
  state: WorldbookExtractionDebugState,
  key: string,
  row: WorldbookDebugTriggeredRow,
) {
  const record = getWorldbookTriggeredRecord(state, key);
  if (record) {
    Object.assign(record.row, row);
    return;
  }
  state.triggered_rows.push({ key, row });
}

function updateWorldbookTriggeredRecord(
  state: WorldbookExtractionDebugState | undefined,
  key: string,
  patch: Partial<WorldbookDebugTriggeredRow>,
) {
  if (!state) {
    return;
  }
  const record = getWorldbookTriggeredRecord(state, key);
  if (record) {
    Object.assign(record.row, patch);
  }
}

function recordActivatedWorldbookDebug(state: WorldbookExtractionDebugState, entry: ActivatedWorldbookEntry) {
  upsertWorldbookTriggeredRecord(state, entry.key, {
    触发原因: entry.rule_context.trigger === 'extension' ? '扩展注入' : entry.is_selective ? '关键词触发' : '常驻触发',
    触发类型: getActivatedWorldbookDebugTrigger(entry),
    固定位置: getWorldbookPositionLabel(entry),
    提取状态: '等待处理',
    失败原因: '',
    名称: entry.name,
    来源: entry.world,
    详细内容: entry.content,
  });
}

function recordInsertedGreenCacheDebug(state: WorldbookExtractionDebugState | undefined, entry: GreenCacheEntry) {
  if (!state) {
    return;
  }
  upsertWorldbookTriggeredRecord(state, `${entry.world}.${entry.uid}`, {
    触发原因: '绿灯缓存固定注入',
    触发类型: getGreenCacheFixedTrigger(entry.fixed_at),
    固定位置: getAnchorKey(entry.fixed_at),
    提取状态: '成功',
    失败原因: '',
    名称: entry.name,
    来源: entry.world,
    详细内容: entry.content_snapshot,
  });
}

function addWorldbookErrorLog(
  state: WorldbookExtractionDebugState | undefined,
  title: string,
  details: Record<string, string | number | boolean | undefined>,
  content: string,
) {
  if (!state) {
    return;
  }
  const detail_lines = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${value}`);
  state.error_logs.push([`[${title}]`, ...detail_lines, '内容:', getDebugContentPreview(content)].join('\n'));
}

function getDebugContentPreview(content: string): string {
  const preview_length = 50;
  if (content.length <= preview_length * 2) {
    return content;
  }
  return `${content.slice(0, preview_length)}\n...省略 ${content.length - preview_length * 2} 字...\n${content.slice(-preview_length)}`;
}

function createWorldbookTotalRow(
  is_selective: boolean,
  trigger: string,
  name: string,
  source: string,
  content: string,
): WorldbookDebugTotalRow {
  return {
    类型: getWorldbookDebugType(is_selective),
    触发: trigger,
    名称: name,
    来源: source,
    详细内容: content,
  };
}

function getRoleDebugName(role: SillyTavern.SendingMessage['role']): string {
  switch (role) {
    case 'user':
      return '用户输入';
    case 'assistant':
      return '助手输出';
    case 'system':
      return '系统信息';
    default:
      return String(role);
  }
}

function getHistoryDebugType(role: SillyTavern.SendingMessage['role']): string {
  return `历史信息${getRoleDebugName(role)}`;
}

function getPresetDebugType(role: SillyTavern.SendingMessage['role']): string {
  return `预设${getRoleDebugName(role)}`;
}

function getRawChatMessageRole(message: any): ChatDebugRole {
  if (message.role === 'user' || message.role === 'assistant' || message.role === 'system') {
    return message.role;
  }
  if (message.extra?.type === 'narrator') {
    return 'system';
  }
  return message.is_user ? 'user' : 'assistant';
}

function getRawChatMessageSwipeId(message: any): number {
  return _.get(message, 'swipe_id') ?? 0;
}

function getRawChatMessageContent(message: any): string {
  const swipe_id = getRawChatMessageSwipeId(message);
  if (_.isArray(message.swipes)) {
    const swipe_content = message.swipes[swipe_id];
    return typeof swipe_content === 'string' ? swipe_content : '';
  }
  return typeof message.mes === 'string' ? message.mes : '';
}

function getRawChatMessageIsHidden(message: any): boolean {
  return message.is_system === true;
}

function readChatPromptSnapshots(
  hide_state: 'all' | 'hidden' | 'unhidden',
  include_hash = false,
): ChatPromptSnapshot[] {
  const snapshots: ChatPromptSnapshot[] = [];
  SillyTavern.chat.forEach((message: any, message_id) => {
    const is_hidden = getRawChatMessageIsHidden(message);
    if (hide_state !== 'all' && (hide_state === 'hidden') !== is_hidden) {
      return;
    }

    const swipe_id = getRawChatMessageSwipeId(message);
    const content = getRawChatMessageContent(message);
    const anchor_key = getAnchorKey({
      message_id,
      swipe_id,
      message_hash: null,
    });
    snapshots.push({
      order: snapshots.length,
      anchor_key,
      message_id,
      swipe_id,
      role: getRawChatMessageRole(message),
      is_hidden,
      content,
      content_hash: include_hash ? hashGreenCacheContent(content) : '',
      content_length: content.length,
    });
  });
  return snapshots;
}

function getPromptDirectMessageId(prompt: SillyTavern.SendingMessage): number | undefined {
  const direct_message_id = _.get(prompt, 'message_id') ?? _.get(prompt, 'extra.message_id');
  return typeof direct_message_id === 'number' ? direct_message_id : undefined;
}

function getPromptDebugNormalizedContent(content: string): string {
  return normalizeContentForMatch(content).replace(/\s+/g, ' ').trim();
}

function getCommonPrefixLength(lhs: string, rhs: string): number {
  const length = Math.min(lhs.length, rhs.length);
  let index = 0;
  while (index < length && lhs[index] === rhs[index]) {
    index++;
  }
  return index;
}

function getCommonSuffixLength(lhs: string, rhs: string, prefix_length: number): number {
  const length = Math.min(lhs.length, rhs.length) - prefix_length;
  let offset = 0;
  while (offset < length && lhs[lhs.length - 1 - offset] === rhs[rhs.length - 1 - offset]) {
    offset++;
  }
  return offset;
}

function isPromptLikelySameAsChatMessage(prompt_content: string, chat_content: string): boolean {
  if (prompt_content.length > DEBUG_FULL_TEXT_MATCH_LIMIT || chat_content.length > DEBUG_FULL_TEXT_MATCH_LIMIT) {
    return isPromptLikelySameAsLargeChatMessage(prompt_content, chat_content);
  }

  const prompt_normalized = getPromptDebugNormalizedContent(prompt_content);
  const chat_normalized = getPromptDebugNormalizedContent(chat_content);
  if (!prompt_normalized || !chat_normalized) {
    return false;
  }
  if (prompt_normalized === chat_normalized) {
    return true;
  }
  const shorter_length = Math.min(prompt_normalized.length, chat_normalized.length);
  if (
    shorter_length >= 40 &&
    (prompt_normalized.includes(chat_normalized) || chat_normalized.includes(prompt_normalized))
  ) {
    return true;
  }
  const prefix_length = getCommonPrefixLength(prompt_normalized, chat_normalized);
  const suffix_length = getCommonSuffixLength(prompt_normalized, chat_normalized, prefix_length);
  return shorter_length >= 80 && (prefix_length + suffix_length) / shorter_length >= 0.35;
}

function isPromptLikelySameAsLargeChatMessage(prompt_content: string, chat_content: string): boolean {
  const shorter_length = Math.min(prompt_content.length, chat_content.length);
  if (shorter_length < 200) {
    return false;
  }
  const length_ratio = shorter_length / Math.max(prompt_content.length, chat_content.length);
  if (length_ratio < 0.8) {
    return false;
  }
  return (
    prompt_content.slice(0, 80) === chat_content.slice(0, 80) || prompt_content.slice(-80) === chat_content.slice(-80)
  );
}

function findPromptDirectChatSnapshotIndex(
  prompt: SillyTavern.SendingMessage,
  chat_messages: ChatPromptSnapshot[],
  used_chat_indexes: Set<number>,
): number | undefined {
  const direct_message_id = getPromptDirectMessageId(prompt);
  if (direct_message_id !== undefined) {
    const direct_index = chat_messages.findIndex(
      (message, index) => !used_chat_indexes.has(index) && message.message_id === direct_message_id,
    );
    if (direct_index !== -1) {
      return direct_index;
    }
  }
  return undefined;
}

function findPromptContentChatSnapshotIndex(
  content: string,
  chat_messages: ChatPromptSnapshot[],
  used_chat_indexes: Set<number>,
): number | undefined {
  const exact_index = chat_messages.findIndex(
    (message, index) =>
      !used_chat_indexes.has(index) &&
      content.length <= DEBUG_FULL_TEXT_MATCH_LIMIT &&
      message.content.length <= DEBUG_FULL_TEXT_MATCH_LIMIT &&
      normalizeContentForMatch(message.content) === normalizeContentForMatch(content),
  );
  if (exact_index !== -1) {
    return exact_index;
  }

  const fuzzy_index = chat_messages.findIndex(
    (message, index) => !used_chat_indexes.has(index) && isPromptLikelySameAsChatMessage(content, message.content),
  );
  return fuzzy_index === -1 ? undefined : fuzzy_index;
}

function findNextPromptChatSnapshotIndex(
  prompt: SillyTavern.SendingMessage,
  chat_messages: ChatPromptSnapshot[],
  used_chat_indexes: Set<number>,
  start_index: number,
): number | undefined {
  const prompt_role = prompt.role as ChatDebugRole;
  for (let index = start_index; index < chat_messages.length; index++) {
    if (!used_chat_indexes.has(index) && chat_messages[index].role === prompt_role) {
      return index;
    }
  }
  return undefined;
}

function captureWorldbookDebugTotalRows(
  chunks: SillyTavern.SendingMessage[][],
  state: WorldbookExtractionDebugState,
  settings: Settings,
  history: CacheHistory,
) {
  const prompt_rows = new Map<SillyTavern.SendingMessage, WorldbookDebugTotalRow[]>();
  state.prompt_rows.forEach(({ prompt, rows }) => {
    prompt_rows.set(prompt, [...(prompt_rows.get(prompt) ?? []), ...rows]);
  });
  const chat_messages = history.messages;
  const used_chat_indexes = new Set<number>();
  let chat_cursor = 0;
  let preset_index = 0;
  state.total_rows = chunks.flatMap((chunk, chunk_index) =>
    chunk.flatMap(prompt => {
      const rows = prompt_rows.get(prompt);
      if (rows) {
        return rows;
      }

      const content = getPromptContent(prompt, settings);
      if (!content.trim()) {
        return [];
      }

      let chat_index = findPromptDirectChatSnapshotIndex(prompt, chat_messages, used_chat_indexes);
      if (chat_index === undefined && (chunk_index === 1 || chunk_index === 2)) {
        chat_index = findNextPromptChatSnapshotIndex(prompt, chat_messages, used_chat_indexes, chat_cursor);
      }
      if (chat_index === undefined) {
        chat_index = findPromptContentChatSnapshotIndex(content, chat_messages, used_chat_indexes);
      }
      if (chat_index !== undefined) {
        const chat_message = chat_messages[chat_index];
        used_chat_indexes.add(chat_index);
        chat_cursor = Math.max(chat_cursor, chat_index + 1);
        return [
          {
            类型: getHistoryDebugType(prompt.role),
            触发: '固有',
            名称: `第${chat_message.message_id}层`,
            来源: '历史信息',
            详细内容: content,
          },
        ];
      }

      const row: WorldbookDebugTotalRow = {
        类型: getPresetDebugType(prompt.role),
        触发: '固有',
        名称: `预设#${preset_index}`,
        来源: '预设',
        详细内容: content,
      };
      preset_index++;
      return [row];
    }),
  );
}

function readGenerationCacheHistory(type = 'normal', regenerate_target_id?: number): CacheHistory {
  return selectGenerationHistory(readChatPromptSnapshots('all', true), {
    type,
    regenerate_target_id,
    continue_prefill: SillyTavern.mainApi === 'openai' && SillyTavern.chatCompletionSettings?.continue_prefill === true,
  });
}

function getChatMessageAnchorKey(message: Pick<ChatPromptSnapshot, 'message_id' | 'swipe_id'>): string {
  return getAnchorKey({
    message_id: message.message_id,
    swipe_id: message.swipe_id,
    message_hash: null,
  });
}

function getChatMessageContentForAnchor(anchor: Pick<GreenCacheAnchor, 'message_id' | 'swipe_id'>): string | undefined {
  if (anchor.message_id === null) {
    return undefined;
  }

  const message = SillyTavern.chat[anchor.message_id];
  if (!message) {
    return undefined;
  }

  const swipe_id = anchor.swipe_id ?? 0;
  if (_.isArray(message.swipes)) {
    return swipe_id >= 0 && swipe_id < message.swipes.length ? message.swipes[swipe_id] : undefined;
  }
  return swipe_id === 0 ? message.mes : undefined;
}

function getLatestGenerationChatAnchor(history: CacheHistory): GreenCacheAnchor {
  const latest = _.last(history.anchors);
  if (!latest) {
    return { ...BEFORE_CHAT_GREEN_CACHE_ANCHOR };
  }
  const anchor = {
    message_id: latest.message_id,
    swipe_id: _.get(latest, 'swipe_id') ?? 0,
  };
  return {
    ...anchor,
    message_hash: hashGreenCacheContent(normalizeContentForMatch(latest.content)),
  };
}

function getGreenCacheAnchorDepth(anchor: GreenCacheAnchor, history: CacheHistory): number | undefined {
  if (anchor.message_id === null || !cacheAnchorMessageExists(anchor)) {
    return undefined;
  }
  return generationAnchorDepth(history, anchor);
}

function getGreenCacheAnchorContent(anchor_key: string): string {
  return `${GREEN_CACHE_ANCHOR_PREFIX}:${anchor_key}§§`;
}

function getGreenCacheAnchorPromptId(anchor_key: string): string {
  return `\xff压缩相邻消息-green-anchor-${anchor_key}`;
}

function getGreenCacheAnchorInjectionPrompts(settings: Settings, history: CacheHistory): InjectionPrompt[] {
  if (
    settings.entry_processing.mode !== 'worldbook' ||
    !hasGreenCacheRules(settings.entry_processing.worldbook.rules)
  ) {
    return [];
  }

  const anchors = new Map<string, GreenCacheAnchor>();
  chooseFirstGreenCacheEntries(readGreenCacheVariables().entries)
    .map(entry => entry.fixed_at)
    .filter(anchor => anchor.message_id !== null && cacheAnchorExists(anchor))
    .sort((lhs, rhs) => lhs.message_id! - rhs.message_id! || (lhs.swipe_id ?? 0) - (rhs.swipe_id ?? 0))
    .forEach(anchor => {
      anchors.set(getAnchorKey(anchor), anchor);
    });
  const latest_anchor = getLatestGenerationChatAnchor(history);
  if (latest_anchor.message_id !== null && cacheAnchorMessageExists(latest_anchor)) {
    anchors.set(getAnchorKey(latest_anchor), latest_anchor);
  }

  const prompts: InjectionPrompt[] = [];
  [...anchors.entries()].forEach(([anchor_key, anchor]) => {
    const depth = getGreenCacheAnchorDepth(anchor, history);
    if (depth === undefined) {
      return;
    }
    prompts.push({
      id: getGreenCacheAnchorPromptId(anchor_key),
      position: 'in_chat',
      depth,
      role: 'system',
      content: getGreenCacheAnchorContent(anchor_key),
      should_scan: false,
    });
  });
  return prompts;
}

function cacheAnchorExists(anchor: GreenCacheAnchor): boolean {
  if (!cacheAnchorMessageExists(anchor)) {
    return false;
  }
  if (anchor.message_hash === null) {
    return true;
  }
  const message_content = getChatMessageContentForAnchor(anchor);
  return (
    typeof message_content === 'string' &&
    hashGreenCacheContent(normalizeContentForMatch(message_content)) === anchor.message_hash
  );
}

function cacheAnchorMessageExists(anchor: Pick<GreenCacheAnchor, 'message_id' | 'swipe_id'>): boolean {
  if (anchor.message_id === null) {
    return true;
  }

  const message = SillyTavern.chat[anchor.message_id];
  if (!message) {
    return false;
  }

  const swipe_id = anchor.swipe_id ?? 0;
  const message_content = _.isArray(message.swipes) ? message.swipes[swipe_id] : message.mes;
  if (_.isArray(message.swipes)) {
    if (swipe_id < 0 || swipe_id >= message.swipes.length) {
      return false;
    }
  } else if (swipe_id !== 0) {
    return false;
  }

  return typeof message_content === 'string';
}

function buildGreenCacheInsertionLocationMap(
  chunks: SillyTavern.SendingMessage[][],
  settings: Settings,
  history: CacheHistory,
  debug_state?: GreenCacheDebugState,
): Map<string, PromptInsertionLocation> {
  const insertion_locations = new Map<string, PromptInsertionLocation>();
  const all_messages = history.all;
  const eligible_anchors = new Set(history.anchors.map(getChatMessageAnchorKey));
  const request_ids = new Set(history.messages.map(message => message.message_id));
  if (debug_state)
    debug_state.request_history = {
      generation_type: history.type,
      message_ids: history.messages.map(message => message.message_id),
      injection_message_ids: history.injection_messages.map(message => message.message_id),
      anchor_message_ids: history.anchors.map(message => message.message_id),
    };
  ([1, 2] as const).forEach(chunk_index => {
    chunks[chunk_index].forEach((prompt, prompt_index) => {
      const content = getPromptContent(prompt, settings);
      for (const match of content.matchAll(GREEN_CACHE_ANCHOR_REGEX)) {
        const anchor_key = match[1];
        if (!eligible_anchors.has(anchor_key)) continue;
        insertion_locations.set(anchor_key, {
          chunk_index,
          insert_index: prompt_index,
          order: Number(anchor_key.split('.')[0]),
          source: 'custom_anchor',
        });
      }
    });
  });

  if (debug_state) {
    all_messages.forEach((message, order) => {
      const anchor_key = getChatMessageAnchorKey(message);
      const insertion_location = insertion_locations.get(anchor_key);
      pushDebugLogItem(debug_state.chat_messages, {
        order,
        anchor_key,
        message_id: message.message_id,
        swipe_id: message.swipe_id,
        role: message.role,
        is_hidden: message.is_hidden,
        message_hash: message.content_hash,
        message_length: message.content_length,
        in_request: request_ids.has(message.message_id),
        anchor_eligible: eligible_anchors.has(anchor_key),
        anchor_depth: getGreenCacheAnchorDepth(
          {
            message_id: message.message_id,
            swipe_id: message.swipe_id,
            message_hash: null,
          },
          history,
        ),
        prompt_chunk_index: insertion_location?.chunk_index,
        prompt_index: insertion_location?.insert_index,
        insertion_source: insertion_location?.source,
        insertion_chunk_index: insertion_location?.chunk_index,
        insertion_index: insertion_location?.insert_index,
        insertion_source_anchor_key: insertion_location?.source_anchor_key,
      });
    });
  }
  return insertion_locations;
}

function cleanupGreenCacheAnchorMarkers(prompts: SillyTavern.SendingMessage[], settings: Settings) {
  prompts.forEach(prompt => {
    updatePromptContentWith(prompt, ({ content }) => content.replace(GREEN_CACHE_ANCHOR_REGEX, ''), settings);
  });
}

function consumeWorldbookEntryContent(
  prompts: SillyTavern.SendingMessage[],
  entry: ActivatedWorldbookEntry,
  settings: Settings,
  wrapper_prompt_index?: WrapperPromptIndex,
): ConsumedPromptContent | undefined {
  if (entry.wrapper_id) {
    return consumeWrappedPromptContent(prompts, entry.wrapper_id, settings, wrapper_prompt_index);
  }

  for (const content of getWorldbookEntryContentCandidates(entry).sort((lhs, rhs) => rhs.length - lhs.length)) {
    const consumed = consumePromptContentCandidate(prompts, content, settings);
    if (consumed) {
      return consumed;
    }
  }
  return undefined;
}

function getValidGreenCacheEntries(
  entries: GreenCacheEntry[],
  worldbook_entry_metadata: Map<string, WorldbookEntryMetadata>,
  loaded_worldbook_names: Set<string>,
): { entries: GreenCacheEntry[]; injectable_entries: GreenCacheEntry[]; changed: boolean } {
  let changed = false;
  const kept_entries: GreenCacheEntry[] = [];
  const injectable_entries: GreenCacheEntry[] = [];

  for (const entry of entries) {
    if (!cacheAnchorExists(entry.fixed_at)) {
      changed = true;
      continue;
    }

    const metadata = worldbook_entry_metadata.get(`${entry.world}.${entry.uid}`);
    if (!metadata) {
      if (loaded_worldbook_names.has(entry.world)) {
        const fallback_entries = [...worldbook_entry_metadata.values()].filter(
          metadata =>
            metadata.world === entry.world &&
            metadata.name === entry.name &&
            metadata.content_hash === entry.content_hash,
        );
        if (fallback_entries.length !== 1) {
          changed = true;
          continue;
        }

        const updated_entry = { ...entry, uid: fallback_entries[0].uid };
        changed = true;
        kept_entries.push(updated_entry);
        if (!fallback_entries[0].is_disabled) injectable_entries.push(updated_entry);
        continue;
      }
      kept_entries.push(entry);
      continue;
    }

    if (metadata.content_hash !== entry.content_hash) {
      changed = true;
      continue;
    }

    kept_entries.push(entry);
    if (!metadata.is_disabled) injectable_entries.push(entry);
  }

  return { entries: kept_entries, injectable_entries, changed };
}

function chooseFirstGreenCacheEntries(entries: GreenCacheEntry[]): GreenCacheEntry[] {
  const selected = new Map<string, GreenCacheEntry>();
  [...entries]
    .sort((lhs, rhs) => lhs.created_at - rhs.created_at)
    .forEach(entry => {
      const identity = getGreenCacheIdentity(entry);
      if (!selected.has(identity)) {
        selected.set(identity, entry);
      }
    });
  return [...selected.values()];
}

function canInsertGreenCacheAnchor(anchor: GreenCacheAnchor, locations: Map<string, PromptInsertionLocation>): boolean {
  return anchor.message_id === null || locations.has(getAnchorKey(anchor));
}

function insertGreenCacheEntries(
  chunks: SillyTavern.SendingMessage[][],
  entries: GreenCacheEntry[],
  locations: Map<string, PromptInsertionLocation>,
  settings: Settings,
  debug_state?: WorldbookExtractionDebugState,
) {
  const green_cache_debug = debug_state?.green_cache;
  const grouped_entries = _(entries)
    .sortBy(entry => entry.created_at)
    .groupBy(entry => getAnchorKey(entry.fixed_at))
    .value();

  const before_chat_entries = grouped_entries[getAnchorKey(BEFORE_CHAT_GREEN_CACHE_ANCHOR)];
  if (before_chat_entries?.length) {
    if (green_cache_debug) {
      pushDebugLogItem(green_cache_debug.insertions, {
        anchor_key: getAnchorKey(BEFORE_CHAT_GREEN_CACHE_ANCHOR),
        insertion_source: 'before_chat_anchor',
        chunk_index: 1,
        insert_index: 0,
        entry_count: before_chat_entries.length,
        identities: before_chat_entries.map(getGreenCacheIdentity),
        names: before_chat_entries.map(entry => entry.name),
        content_lengths: before_chat_entries.map(entry => entry.content_snapshot.length),
      });
    }
    const prompt = {
      role: 'system',
      content: before_chat_entries.map(entry => entry.content_snapshot).join(settings.delimiter.value),
    } as SillyTavern.SendingMessage;
    debug_state?.prompt_rows.push({
      prompt,
      rows: before_chat_entries.map(entry =>
        createWorldbookTotalRow(
          true,
          getGreenCacheFixedTrigger(entry.fixed_at),
          entry.name,
          entry.world,
          entry.content_snapshot,
        ),
      ),
    });
    before_chat_entries.forEach(entry => recordInsertedGreenCacheDebug(debug_state, entry));
    chunks[1].unshift(prompt);
  }

  const insertions = Object.entries(grouped_entries)
    .filter(([anchor_key]) => anchor_key !== getAnchorKey(BEFORE_CHAT_GREEN_CACHE_ANCHOR))
    .flatMap(([anchor_key, entries]) => {
      const location = locations.get(anchor_key);
      return location ? [{ ...location, entries }] : [];
    })
    .sort(
      (lhs, rhs) => rhs.chunk_index - lhs.chunk_index || rhs.insert_index - lhs.insert_index || rhs.order - lhs.order,
    );

  insertions.forEach(({ chunk_index, insert_index, entries }) => {
    const anchor_key = getAnchorKey(entries[0].fixed_at);
    const location = locations.get(anchor_key);
    if (green_cache_debug) {
      pushDebugLogItem(green_cache_debug.insertions, {
        anchor_key,
        insertion_source: location?.source ?? 'before_chat_history',
        chunk_index,
        insert_index,
        order: location?.order,
        entry_count: entries.length,
        identities: entries.map(getGreenCacheIdentity),
        names: entries.map(entry => entry.name),
        content_lengths: entries.map(entry => entry.content_snapshot.length),
        source_anchor_key: location?.source_anchor_key,
      });
    }
    const prompt = {
      role: 'system',
      content: entries.map(entry => entry.content_snapshot).join(settings.delimiter.value),
    } as SillyTavern.SendingMessage;
    debug_state?.prompt_rows.push({
      prompt,
      rows: entries.map(entry =>
        createWorldbookTotalRow(
          true,
          getGreenCacheFixedTrigger(entry.fixed_at),
          entry.name,
          entry.world,
          entry.content_snapshot,
        ),
      ),
    });
    entries.forEach(entry => recordInsertedGreenCacheDebug(debug_state, entry));
    chunks[chunk_index].splice(insert_index, 0, prompt);
  });
}

function processAggressiveGreenCache(
  chunks: SillyTavern.SendingMessage[][],
  flattened_chunks: SillyTavern.SendingMessage[],
  activated_entries: ActivatedWorldbookEntry[],
  settings: Settings,
  worldbook_entry_metadata: Map<string, WorldbookEntryMetadata>,
  loaded_worldbook_names: Set<string>,
  plan: WorldbookExtractionPlan,
  history: CacheHistory,
  debug_state?: WorldbookExtractionDebugState,
): Set<string> {
  const handled_entry_keys = new Set<string>();
  if (!hasGreenCacheRules(settings.entry_processing.worldbook.rules)) {
    return handled_entry_keys;
  }
  const green_cache_debug = debug_state?.green_cache;

  const cache = readGreenCacheVariables();
  const valid_cache = getValidGreenCacheEntries(cache.entries, worldbook_entry_metadata, loaded_worldbook_names);
  const valid_cache_entries = chooseFirstGreenCacheEntries(valid_cache.entries);
  const valid_cache_changed = valid_cache.changed || valid_cache.entries.length !== valid_cache_entries.length;
  const insertion_locations = buildGreenCacheInsertionLocationMap(chunks, settings, history, green_cache_debug);
  const active_by_key = new Map(activated_entries.map(entry => [entry.key, entry]));
  const suppressed_cache_identities = new Set(
    valid_cache_entries
      .filter(entry => {
        const metadata = worldbook_entry_metadata.get(`${entry.world}.${entry.uid}`);
        if (
          !metadata ||
          metadata.is_disabled ||
          hasUnstableWorldInfoPromptRegex(
            metadata.content,
            { position: metadata.position ?? 0, depth: metadata.depth ?? 0 },
            true,
          )
        )
          return true;
        const active = active_by_key.get(metadata.key);
        if (active && !isAggressiveGreenEntry(active)) return true;
        const placements = getWorldbookPlacements(
          {
            ...metadata.rule_context,
            has_dynamic_content: metadata.has_dynamic_macro,
            can_cache: metadata.rule_context.trigger === 'selective' && !metadata.has_dynamic_macro,
          },
          plan.compiled,
          plan.available_placeholders,
        );
        return placements[0]?.kind !== 'cache';
      })
      .map(getGreenCacheIdentity),
  );
  const injectable_cache_entries = valid_cache_entries.filter(
    entry =>
      !suppressed_cache_identities.has(getGreenCacheIdentity(entry)) &&
      canInsertGreenCacheAnchor(entry.fixed_at, insertion_locations),
  );
  const fixed_cache_identities = new Map(
    valid_cache_entries.map(entry => [getGreenCacheIdentity(entry), entry] as const),
  );
  const new_anchor = getLatestGenerationChatAnchor(history);
  const can_insert_new_anchor =
    canInsertGreenCacheAnchor(new_anchor, insertion_locations) && cacheAnchorExists(new_anchor);
  const new_cache_entries: GreenCacheEntry[] = [];
  const aggressive_entries = sortWorldbookExtractionItems(
    activated_entries.filter(
      entry => isAggressiveGreenEntry(entry) && plan.placements.get(entry.key)?.[0]?.kind === 'cache',
    ),
    settings,
  );
  const wrapper_prompt_index = aggressive_entries.some(entry => entry.wrapper_id)
    ? buildWorldbookWrapperPromptIndex(flattened_chunks, settings)
    : undefined;

  aggressive_entries.forEach(entry => {
    const identity = getGreenCacheIdentity(entry);
    const cached_entry = fixed_cache_identities.get(identity);
    if (cached_entry) {
      const cached_anchor_key = getAnchorKey(cached_entry.fixed_at);
      const cached_location = insertion_locations.get(cached_anchor_key);
      const cached_can_insert = canInsertGreenCacheAnchor(cached_entry.fixed_at, insertion_locations);
      if (!cached_can_insert) {
        updateWorldbookTriggeredRecord(debug_state, entry.key, {
          触发类型: getGreenCacheFixedTrigger(cached_entry.fixed_at),
          固定位置: cached_anchor_key,
          提取状态: '失败',
          失败原因: 'skip_fixed_anchor_unavailable',
        });
        addWorldbookErrorLog(
          debug_state,
          '绿灯缓存锚点不可用',
          { key: entry.key, name: entry.name, world: entry.world, anchor: cached_anchor_key },
          entry.content,
        );
        if (green_cache_debug) {
          pushDebugLogItem(green_cache_debug.activations, {
            key: entry.key,
            identity,
            world: entry.world,
            uid: entry.uid,
            name: entry.name,
            action: 'skip_fixed_anchor_unavailable',
            cached_anchor_key,
            cached_can_insert,
            cached_insertion_source: cached_location?.source,
            cached_insertion_chunk_index: cached_location?.chunk_index,
            cached_insertion_index: cached_location?.insert_index,
            consumed: false,
            new_anchor_key: getAnchorKey(new_anchor),
          });
        }
        return;
      }
      const consumed = consumeWorldbookEntryContent(flattened_chunks, entry, settings, wrapper_prompt_index);
      handled_entry_keys.add(entry.key);
      if (!consumed) {
        suppressed_cache_identities.add(identity);
      }
      updateWorldbookTriggeredRecord(debug_state, entry.key, {
        触发类型: getGreenCacheFixedTrigger(cached_entry.fixed_at),
        固定位置: cached_anchor_key,
        提取状态: consumed ? '成功' : '失败',
        失败原因: consumed ? '' : 'fixed_cache_original_missing',
      });
      if (!consumed) {
        addWorldbookErrorLog(
          debug_state,
          '绿灯缓存原位置内容未找到',
          { key: entry.key, name: entry.name, world: entry.world, anchor: cached_anchor_key },
          entry.content,
        );
      }
      if (green_cache_debug) {
        pushDebugLogItem(green_cache_debug.activations, {
          key: entry.key,
          identity,
          world: entry.world,
          uid: entry.uid,
          name: entry.name,
          action: consumed ? 'fixed_cache_consumed' : 'fixed_cache_original_missing',
          cached_anchor_key,
          cached_can_insert,
          cached_insertion_source: cached_location?.source,
          cached_insertion_chunk_index: cached_location?.chunk_index,
          cached_insertion_index: cached_location?.insert_index,
          consumed: !!consumed,
          consumed_method: consumed?.method,
          consumed_prompt_index: consumed?.index,
          consumed_content_length: consumed?.content.length,
          new_anchor_key: getAnchorKey(new_anchor),
        });
      }
      return;
    }

    if (!can_insert_new_anchor) {
      updateWorldbookTriggeredRecord(debug_state, entry.key, {
        触发类型: '绿灯非固定',
        固定位置: getAnchorKey(new_anchor),
        提取状态: '失败',
        失败原因: 'skip_new_anchor_unavailable',
      });
      addWorldbookErrorLog(
        debug_state,
        '绿灯新锚点不可用',
        { key: entry.key, name: entry.name, world: entry.world, anchor: getAnchorKey(new_anchor) },
        entry.content,
      );
      if (green_cache_debug) {
        pushDebugLogItem(green_cache_debug.activations, {
          key: entry.key,
          identity,
          world: entry.world,
          uid: entry.uid,
          name: entry.name,
          action: 'skip_new_anchor_unavailable',
          consumed: false,
          new_anchor_key: getAnchorKey(new_anchor),
        });
      }
      return;
    }

    const consumed = consumeWorldbookEntryContent(flattened_chunks, entry, settings, wrapper_prompt_index);
    if (!consumed) {
      updateWorldbookTriggeredRecord(debug_state, entry.key, {
        触发类型: '绿灯非固定',
        固定位置: getAnchorKey(new_anchor),
        提取状态: '失败',
        失败原因: 'skip_content_not_found',
      });
      addWorldbookErrorLog(
        debug_state,
        '绿灯原文未找到',
        { key: entry.key, name: entry.name, world: entry.world, anchor: getAnchorKey(new_anchor) },
        entry.content,
      );
      if (green_cache_debug) {
        pushDebugLogItem(green_cache_debug.activations, {
          key: entry.key,
          identity,
          world: entry.world,
          uid: entry.uid,
          name: entry.name,
          action: 'skip_content_not_found',
          consumed: false,
          new_anchor_key: getAnchorKey(new_anchor),
        });
      }
      return;
    }

    const new_cache_entry = {
      world: entry.world,
      uid: entry.uid,
      name: entry.name,
      content_hash: entry.content_hash,
      content_snapshot: consumed.content,
      fixed_at: { ...new_anchor },
      created_at: Date.now() + new_cache_entries.length,
    };
    new_cache_entries.push(new_cache_entry);
    handled_entry_keys.add(entry.key);
    updateWorldbookTriggeredRecord(debug_state, entry.key, {
      触发类型: getGreenCacheFixedTrigger(new_anchor),
      固定位置: getAnchorKey(new_anchor),
      提取状态: '成功',
      失败原因: '',
    });
    if (green_cache_debug) {
      const new_location = insertion_locations.get(getAnchorKey(new_cache_entry.fixed_at));
      pushDebugLogItem(green_cache_debug.activations, {
        key: entry.key,
        identity,
        world: entry.world,
        uid: entry.uid,
        name: entry.name,
        action: 'new_cache_created',
        cached_anchor_key: getAnchorKey(new_cache_entry.fixed_at),
        cached_can_insert: canInsertGreenCacheAnchor(new_cache_entry.fixed_at, insertion_locations),
        cached_insertion_source: new_location?.source,
        cached_insertion_chunk_index: new_location?.chunk_index,
        cached_insertion_index: new_location?.insert_index,
        consumed: true,
        consumed_method: consumed.method,
        consumed_prompt_index: consumed.index,
        consumed_content_length: consumed.content.length,
        new_anchor_key: getAnchorKey(new_anchor),
      });
    }
  });

  const entries_to_insert = chooseFirstGreenCacheEntries([
    ...injectable_cache_entries.filter(entry => !suppressed_cache_identities.has(getGreenCacheIdentity(entry))),
    ...new_cache_entries,
  ]);
  if (green_cache_debug) {
    const insert_identities = new Set(entries_to_insert.map(getGreenCacheIdentity));
    [...valid_cache_entries, ...new_cache_entries].forEach(entry => {
      const anchor_key = getAnchorKey(entry.fixed_at);
      const insertion_location = insertion_locations.get(anchor_key);
      const identity = getGreenCacheIdentity(entry);
      pushDebugLogItem(green_cache_debug.cache_entries, {
        identity,
        world: entry.world,
        uid: entry.uid,
        name: entry.name,
        anchor_key,
        message_id: entry.fixed_at.message_id,
        swipe_id: entry.fixed_at.swipe_id,
        message_hash: entry.fixed_at.message_hash,
        created_at: entry.created_at,
        can_insert: canInsertGreenCacheAnchor(entry.fixed_at, insertion_locations),
        will_insert: insert_identities.has(identity),
        suppressed: suppressed_cache_identities.has(identity),
        content_length: entry.content_snapshot.length,
        insertion_source: insertion_location?.source,
        insertion_chunk_index: insertion_location?.chunk_index,
        insertion_index: insertion_location?.insert_index,
        insertion_source_anchor_key: insertion_location?.source_anchor_key,
      });
    });
  }
  insertGreenCacheEntries(chunks, entries_to_insert, insertion_locations, settings, debug_state);
  cleanupGreenCacheAnchorMarkers(flattened_chunks, settings);

  const next_cache_entries = chooseFirstGreenCacheEntries([...valid_cache_entries, ...new_cache_entries]);
  if (valid_cache_changed || new_cache_entries.length > 0 || cache.entries.length !== next_cache_entries.length) {
    writeGreenCacheVariables({
      version: GREEN_CACHE_VERSION,
      entries: next_cache_entries,
    });
  }
  if (green_cache_debug) {
    green_cache_debug.summary = {
      cache_total: cache.entries.length,
      valid_cache_total: valid_cache.entries.length,
      deduped_cache_total: valid_cache_entries.length,
      injectable_cache_total: injectable_cache_entries.length,
      aggressive_activated_total: aggressive_entries.length,
      handled_total: handled_entry_keys.size,
      new_cache_total: new_cache_entries.length,
      suppressed_total: suppressed_cache_identities.size,
      inserted_entry_total: entries_to_insert.length,
      new_anchor_key: getAnchorKey(new_anchor),
      can_insert_new_anchor,
    };
  }

  return handled_entry_keys;
}

type WorldbookExtractionItem = SortableWorldbookExtractionItem & {
  facts: WorldbookRuleFacts;
  key: string;
  world: string;
  name: string;
  is_selective: boolean;
  content_candidates: string[];
  wrapper_id?: string;
  preconsumed_content?: string;
  target_key?: string;
  target_name?: string;
};

function getWorldbookExtractionItems(entry: ActivatedWorldbookEntry): WorldbookExtractionItem[] {
  if (entry.preserve_reason) return [];
  if (entry.split_getwi_parts.length > 0) {
    return entry.split_getwi_parts.map((part, part_index) => ({
      key: `${entry.key}.getwi.${part_index}`,
      facts: { ...entry.rule_context, has_dynamic_content: part.has_dynamic_content, can_cache: false },
      world: entry.world,
      name: part.target_name ?? entry.name,
      is_selective: entry.is_selective,
      position: entry.position,
      depth: entry.depth,
      order: entry.order,
      index: entry.index,
      part_index,
      stable_key: `${entry.key}.getwi.${part_index}`,
      content_candidates: getContentCandidates(part.content_candidates),
      wrapper_id: part.wrapper_id,
      target_key: part.target_key,
      target_name: part.target_name,
    }));
  }

  return [
    {
      key: entry.key,
      facts: {
        ...entry.rule_context,
        has_dynamic_content: entry.has_source_macro,
        can_cache: isAggressiveGreenEntry(entry),
      },
      world: entry.world,
      name: entry.name,
      is_selective: entry.is_selective,
      position: entry.position,
      depth: entry.depth,
      order: entry.order,
      index: entry.index,
      stable_key: entry.key,
      content_candidates: getWorldbookEntryContentCandidates(entry),
      wrapper_id: entry.wrapper_id,
      preconsumed_content: entry.preconsumed_content,
      target_key: entry.key,
      target_name: entry.name,
    },
  ];
}

function getWorldbookExtractionItemTrigger(entry: WorldbookExtractionItem): string {
  if (entry.facts.plugin === 'ruby') return 'RUBY分析输出';
  if (entry.facts.trigger === 'extension') return '插件注入';
  if (entry.is_selective) {
    return '绿灯非固定';
  }
  return entry.facts.has_dynamic_content ? '蓝灯非固定' : '蓝灯固定';
}

function recordWorldbookExtractionItemDebug(state: WorldbookExtractionDebugState, entry: WorldbookExtractionItem) {
  upsertWorldbookTriggeredRecord(state, entry.key, {
    触发原因: entry.is_selective ? '关键词触发' : '常驻触发',
    触发类型: getWorldbookExtractionItemTrigger(entry),
    固定位置: entry.position === 'at_depth' ? `D${entry.depth}` : entry.position,
    提取状态: '等待处理',
    失败原因: '',
    名称: entry.target_name ?? entry.name,
    来源: entry.world,
    详细内容: entry.content_candidates[0] ?? '',
  });
}

function createWorldbookExtractionTotalRow(entry: WorldbookExtractionItem, content: string): WorldbookDebugTotalRow {
  const row = createWorldbookTotalRow(
    entry.is_selective,
    getWorldbookExtractionItemTrigger(entry),
    entry.target_name ?? entry.name,
    entry.world,
    content,
  );
  if (entry.facts.trigger === 'extension') row.类型 = '插件注入';
  else if (entry.facts.plugin === 'ruby') row.类型 = 'RUBY分析输出';
  return row;
}

function consumeWorldbookExtractionItem(
  prompts: SillyTavern.SendingMessage[],
  entry: WorldbookExtractionItem,
  settings: Settings,
  wrapper_prompt_index?: WrapperPromptIndex,
): ConsumedPromptContent | undefined {
  if (entry.wrapper_id) {
    return consumeWrappedPromptContent(prompts, entry.wrapper_id, settings, wrapper_prompt_index);
  }

  for (const content of entry.content_candidates.sort((lhs, rhs) => rhs.length - lhs.length)) {
    const consumed = consumePromptContentCandidate(prompts, content, settings);
    if (consumed) {
      return consumed;
    }
  }
  return undefined;
}

function getWorldbookExtractionFailureReason(
  entry: WorldbookExtractionItem,
  consumed: ConsumedPromptContent | undefined,
  wrapper_presence: WorldbookWrapperPresenceDebug | undefined,
): WorldbookExtractionFailureReason | undefined {
  if (consumed) {
    return undefined;
  }

  if (entry.wrapper_id) {
    if (wrapper_presence?.paired) {
      return 'wrapper_present_but_not_consumed';
    }
    if ((wrapper_presence?.start_count ?? 0) > 0 || (wrapper_presence?.end_count ?? 0) > 0) {
      return 'wrapper_incomplete';
    }
    return 'wrapper_missing_or_already_consumed';
  }

  if (entry.content_candidates.length === 0) {
    return 'no_content_candidates';
  }

  return 'no_candidate_match';
}

function extractWorldbookEntriesToPlaceholders(
  flattened_chunks: SillyTavern.SendingMessage[],
  extraction_items: WorldbookExtractionItem[],
  settings: Settings,
  plan: WorldbookExtractionPlan,
  debug_state?: WorldbookExtractionDebugState,
) {
  const replacements = new Map<string, string>();
  const required_destinations = new Set<string>();
  const execution_plan = { ...plan, placements: new Map(plan.placements) };
  extraction_items.forEach(entry => {
    const candidates = plan.placements.get(entry.key) ?? [];
    const aliases = candidates.flatMap(candidate => plan.compiled.placeholders.get(candidate.placeholder) ?? []);
    const sources = [entry.facts.content, entry.preconsumed_content ?? '', ...entry.content_candidates];
    if (!aliases.some(alias => sources.some(content => content.includes(alias)))) return;
    const probe = consumeWorldbookExtractionItem(flattened_chunks, entry, settings);
    if (!probe) return;
    // 占位符需要位于来源正文之外；探测后立即还原，再选择可用的后续规则。
    try {
      execution_plan.placements.set(
        entry.key,
        candidates.filter(
          candidate =>
            candidate.kind === 'cache' ||
            candidate.kind === 'keep' ||
            (plan.compiled.placeholders.get(candidate.placeholder) ?? []).some(alias =>
              flattened_chunks.some(prompt => getPromptContent(prompt, settings).includes(alias)),
            ),
        ),
      );
    } finally {
      updatePromptContentWith(probe.prompt, () => probe.original_content, settings);
    }
  });

  for (const entry of extraction_items) {
    if (execution_plan.placements.get(entry.key)?.[0]?.kind !== 'keep' || !debug_state) continue;
    recordWorldbookExtractionItemDebug(debug_state, entry);
    const probe = consumeWorldbookExtractionItem(flattened_chunks, entry, settings);
    updateWorldbookTriggeredRecord(debug_state, entry.key, {
      提取状态: '保留原位',
      详细内容: probe?.content ?? entry.content_candidates[0] ?? '',
    });
    if (probe) updatePromptContentWith(probe.prompt, () => probe.original_content, settings);
  }

  const applyExtraction = (
    placeholder: string,
    extraction_entries: WorldbookExtractionItem[],
    trigger_type: string,
  ) => {
    const aliases = plan.compiled.placeholders.get(placeholder) ?? [placeholder];
    const placeholder_prompts = flattened_chunks.filter(prompt =>
      aliases.some(alias => getPromptContent(prompt, settings).includes(alias)),
    );
    if (placeholder_prompts.length === 0) {
      return;
    }

    const entries = sortWorldbookExtractionItems(extraction_entries, settings);
    const wrapper_prompt_index = entries.some(entry => entry.wrapper_id)
      ? buildWorldbookWrapperPromptIndex(flattened_chunks, settings)
      : undefined;
    const consumed_entry_contents = new Map<string, string>();
    const consuming_entries = [...entries].sort(
      (lhs, rhs) =>
        _.max(rhs.content_candidates.map(content => content.length))! -
        _.max(lhs.content_candidates.map(content => content.length))!,
    );
    if (debug_state) {
      entries.forEach(entry => recordWorldbookExtractionItemDebug(debug_state, entry));
    }
    consuming_entries.forEach(entry => {
      let consumed = consumeWorldbookExtractionItem(flattened_chunks, entry, settings, wrapper_prompt_index);
      if (consumed) {
        const destination_removed = [...required_destinations, placeholder].some(target => {
          const target_aliases = plan.compiled.placeholders.get(target) ?? [target];
          return (
            target_aliases.some(alias => consumed!.original_content.includes(alias)) &&
            !flattened_chunks.some(prompt =>
              target_aliases.some(alias => getPromptContent(prompt, settings).includes(alias)),
            )
          );
        });
        if (destination_removed) {
          const original_content = consumed.original_content;
          updatePromptContentWith(consumed.prompt, () => original_content, settings);
          consumed = undefined;
        }
      }
      const wrapper_presence_before_consume =
        !consumed && entry.wrapper_id
          ? getWorldbookWrapperPresence(flattened_chunks, entry.wrapper_id, settings)
          : undefined;
      const failure_reason = getWorldbookExtractionFailureReason(entry, consumed, wrapper_presence_before_consume);
      if (debug_state) {
        debug_state.total_extraction++;
        if (consumed) {
          debug_state.total_consumed++;
        }
        updateWorldbookTriggeredRecord(debug_state, entry.key, {
          提取状态: consumed ? `成功 (${consumed.method})` : '失败',
          失败原因: failure_reason ?? '',
          详细内容: consumed ? (entry.preconsumed_content ?? consumed.content) : (entry.content_candidates[0] ?? ''),
        });
        if (!consumed) {
          addWorldbookErrorLog(
            debug_state,
            '世界书提取失败',
            {
              placeholder,
              trigger_type,
              key: entry.key,
              name: entry.target_name ?? entry.name,
              world: entry.world,
              part_index: entry.part_index,
              wrapper_id: entry.wrapper_id,
              wrapper_paired: wrapper_presence_before_consume?.paired,
              failure_reason,
            },
            entry.content_candidates.join('\n\n--- candidate ---\n\n'),
          );
        }
      }
      if (consumed) {
        required_destinations.add(placeholder);
        if (['before_example_messages', 'after_example_messages'].includes(entry.position)) {
          cleanupDialogueExampleSeparatorAfterConsumption(flattened_chunks, consumed, settings);
        }
        consumed_entry_contents.set(entry.key, entry.preconsumed_content ?? consumed.content);
      }
    });

    const replacement_prompts = placeholder_prompts.filter(prompt =>
      aliases.some(alias => getPromptContent(prompt, settings).includes(alias)),
    );
    const placeholder_content = entries
      .filter(entry => consumed_entry_contents.has(entry.key))
      .map(entry => consumed_entry_contents.get(entry.key)!)
      .join(WORLDBOOK_PLACEHOLDER_SEPARATOR);
    if (debug_state) {
      const replacement_rows = entries
        .filter(entry => consumed_entry_contents.has(entry.key))
        .map(entry => createWorldbookExtractionTotalRow(entry, consumed_entry_contents.get(entry.key)!));
      replacement_prompts.forEach(prompt => {
        debug_state.prompt_rows.push({ prompt, rows: replacement_rows });
      });
    }
    aliases.forEach(alias => replacements.set(alias, placeholder_content));
  };

  groupWorldbookExtractions(extraction_items, execution_plan).forEach((items, placeholder) =>
    applyExtraction(placeholder, items, 'rule'),
  );
  const empty_placeholders = new Map(
    [...plan.compiled.placeholders.values()].flat().map(placeholder => [placeholder, '']),
  );
  // 所有正文消费结束后统一回填，避免回填结果再次成为其他规则的消费候选。
  flattened_chunks.forEach(prompt => {
    updatePromptContentWith(
      prompt,
      ({ content }) =>
        replaceWorldbookPlaceholders(replaceWorldbookPlaceholders(content, replacements), empty_placeholders),
      settings,
    );
  });
}

function listenEvent(
  settings: Settings,
  separators: Separators,
  shouldEnable: () => boolean,
  getHistory: () => CacheHistory,
) {
  const generation_trace = new GenerationTrace();
  const getGenerationContext = () => ({
    chat_id: SillyTavern.getCurrentChatId() ?? '',
    character_name: SillyTavern.name2 ?? '',
    script_id: getScriptId(),
  });
  const compiled_rules = compileWorldbookRules(settings.entry_processing.worldbook.rules);
  const plugin_providers = new Set(
    compiled_rules.rules.map(({ rule }) => rule.provider).filter(provider => provider !== 'worldbook'),
  );
  compiled_rules.errors.forEach(error => console.warn('[压缩相邻消息] 世界书规则无效', error));
  const activated_worldbook_entries = new Map<string, ActivatedWorldbookEntry>();
  const worldbook_entry_metadata = new Map<string, WorldbookEntryMetadata>();
  const loaded_worldbook_names = new Set<string>();
  const scans = new WorldbookScanLedger();
  let worldbook_extraction_debug = createWorldbookExtractionDebugState();
  let confirmed_scan = false;

  const collectPluginEntries = (entries: ActivatedWorldbookEntry[]) => {
    if (!plugin_providers.size) return entries;
    let context;
    try {
      context = readPluginSourceContext();
    } catch {
      return entries;
    }
    if (plugin_providers.has('ruby')) {
      identifyRubyEntries(worldbook_entry_metadata, context);
      for (const entry of entries) {
        const metadata = worldbook_entry_metadata.get(entry.key);
        if (metadata) entry.rule_context = structuredClone(metadata.rule_context);
        if (entry.rule_context.plugin === 'ruby') recordActivatedWorldbookDebug(worldbook_extraction_debug, entry);
      }
    }
    const injections: ActivatedWorldbookEntry[] = getBaiBaiInjections(context, plugin_providers).map(
      (injection, index) => ({
        key: 'extension:' + injection.id,
        world: '柏宝书',
        uid: -1 - index,
        name: injection.name,
        index: entries.length + index,
        position: 'at_depth',
        native_position: -1,
        depth: injection.depth,
        order: 100,
        source_role: injection.role,
        content: injection.content,
        content_candidates: [injection.content],
        content_hash: hashGreenCacheContent(injection.content),
        split_getwi_parts: [],
        has_source_macro:
          injection.provider !== 'baibai_instructions' || hasDynamicPromptMacroOrGetwi(injection.content),
        is_selective: false,
        rule_context: {
          world: '柏宝书',
          name: injection.name,
          content: injection.content,
          sources: [],
          trigger: 'extension',
          plugin: injection.provider,
        },
      }),
    );
    for (const entry of injections) {
      recordActivatedWorldbookDebug(worldbook_extraction_debug, entry);
      worldbook_extraction_debug.total_activated++;
    }
    return [...entries, ...injections];
  };

  const applySnapshot = (snapshot: WorldbookScanSnapshot) => {
    worldbook_entry_metadata.clear();
    loaded_worldbook_names.clear();
    snapshot.metadata.forEach((metadata, key) => worldbook_entry_metadata.set(key, metadata));
    snapshot.worlds.forEach(world => loaded_worldbook_names.add(world));
    const metadata_entries = [...snapshot.metadata.values()];
    worldbook_extraction_debug.loaded = {
      total: metadata_entries.length,
      constant_with_getwi: metadata_entries.filter(
        metadata => metadata.is_constant && getSafeGetwiTemplateCalls(metadata.content).length > 0,
      ).length,
      dynamic: metadata_entries.filter(metadata => metadata.has_dynamic_macro).length,
      split: metadata_entries.filter(metadata => metadata.split_getwi_parts.length > 0).length,
      wrapped: 0,
      split_wrapped_parts: 0,
    };
  };

  const resetActivatedWorldbookEntries = (type = 'normal', _options?: unknown, dry_run = false) => {
    generation_trace.begin(type, dry_run, getGenerationContext());
    if (dry_run) return;
    scans.begin();
    confirmed_scan = false;
    activated_worldbook_entries.clear();
    worldbook_entry_metadata.clear();
    loaded_worldbook_names.clear();
    worldbook_extraction_debug = createWorldbookExtractionDebugState();
    normalized_target_cache.clear();
  };
  eventOn(tavern_events.GENERATION_AFTER_COMMANDS, resetActivatedWorldbookEntries);

  const handleWorldInfoEntriesLoaded = (lores: WorldbookEntriesLoadedEvent) => {
    if (!shouldEnable() || settings.entry_processing.mode !== 'worldbook') return;
    const loaded_entries = [lores.globalLore, lores.characterLore, lores.chatLore, lores.personaLore].flat();
    let bindings: CharWorldbooks = { primary: null, additional: [] };
    try {
      bindings = getCharWorldbookNames('current');
    } catch {
      // 欢迎页没有当前角色，但仍可能存在全局世界书。
    }
    let chat: string | null = null;
    try {
      chat = getChatWorldbookName('current');
    } catch {
      /* 当前聊天尚未就绪。 */
    }
    const entry_sources = collectWorldbookSources(lores, { ...bindings, chat });
    const metadata = new Map(
      loaded_entries.map(entry => {
        const value = parseWorldbookEntryMetadata(entry, entry_sources.get(getWorldbookEntryKey(entry)) ?? []);
        return [value.key, value] as const;
      }),
    );
    const worlds = new Set(loaded_entries.map(entry => entry.world));
    metadata.forEach(value => applyWorldbookEntryMetadataAnalysis(value, metadata, worlds));
    scans.loaded(loaded_entries, metadata);
  };
  eventMakeLast(tavern_events.WORLDINFO_ENTRIES_LOADED, handleWorldInfoEntriesLoaded);

  const handleWorldInfoScanDone = (data: WorldInfoScanDoneEvent) => {
    if (!shouldEnable() || settings.entry_processing.mode !== 'worldbook' || data.state.next) return;
    const activated = [...data.activated.entries.values()];
    const hasWorld = (
      entry: SillyTavern.FlattenedWorldInfoEntry,
    ): entry is { world: string } & SillyTavern.FlattenedWorldInfoEntry => typeof _.get(entry, 'world') === 'string';
    scans.scanned((data.sortedEntries ?? activated).filter(hasWorld), activated.filter(hasWorld));
  };
  eventMakeLast(tavern_events.WORLDINFO_SCAN_DONE, handleWorldInfoScanDone);

  const handleWorldInfoActivated = (entries: ({ world: string } & SillyTavern.FlattenedWorldInfoEntry)[]) => {
    if (!shouldEnable() || settings.entry_processing.mode !== 'worldbook') return;
    const snapshot = scans.activated(entries);
    confirmed_scan = true;
    activated_worldbook_entries.clear();
    worldbook_extraction_debug = createWorldbookExtractionDebugState();
    applySnapshot(snapshot ?? { metadata: new Map(), worlds: new Set() });
    entries.forEach((entry, index) => {
      const parsed = parseActivatedWorldbookEntry(
        entry,
        index,
        worldbook_entry_metadata.get(getWorldbookEntryKey(entry)),
      );
      if (!parsed || activated_worldbook_entries.has(parsed.key)) return;
      activated_worldbook_entries.set(parsed.key, parsed);
      worldbook_extraction_debug.total_activated++;
      if (!parsed.split_getwi_parts.length) recordActivatedWorldbookDebug(worldbook_extraction_debug, parsed);
    });
  };
  eventMakeFirst(tavern_events.WORLD_INFO_ACTIVATED, handleWorldInfoActivated);

  const handlePrompts = (
    { prompt }: { prompt: SillyTavern.SendingMessage[] },
    dry_run?: boolean,
    source_event = 'generate_after_data',
    prepared_generation?: DebugGeneration,
    request?: { messages?: unknown; [key: string]: unknown },
    request_history = getHistory(),
  ) => {
    if (!shouldEnable()) {
      return;
    }
    prompt.forEach(message => prompt_content_cache.delete(message));
    const generation =
      prepared_generation ?? generation_trace.accept(prompt, dry_run, source_event, getGenerationContext());
    if (!generation) return;
    const process_worldbook = settings.entry_processing.mode === 'worldbook' && !generation.dry_run;

    const chunks = seperatePrompts(prompt, separators)?.map(chunk =>
      rejectEmptyPrompts(chunk).map(prompt =>
        updatePromptContentWith(prompt, ({ content }) => trimEmptyLines(content), settings),
      ),
    );
    if (!chunks) {
      return;
    }

    const { above, below } = settings.depth_injection;

    const applyInjection = (injection_settings: typeof above, from: number, to: number) => {
      if (!injection_settings.enabled) {
        return;
      }

      const isSystemWithoutPlaceholder = (p: SillyTavern.SendingMessage): boolean =>
        p.role === 'system' &&
        !(above.enabled && above.type === 'placeholder' && getPromptContent(p, settings).includes(above.placeholder)) &&
        !(below.enabled && below.type === 'placeholder' && getPromptContent(p, settings).includes(below.placeholder));

      const placeholder_content =
        injection_settings.type === 'placeholder'
          ? chunks[from]
              .filter(isSystemWithoutPlaceholder)
              // 没有把图片、多媒体也作为内容, 但无所谓, 世界书里不能设置图片或多媒体
              .map(p => getPromptContent(p, settings))
              .join(settings.delimiter.value)
          : '';

      if (
        injection_settings.type === 'placeholder' &&
        _(chunks)
          .flatten()
          .some(p => getPromptContent(p, settings).includes(injection_settings.placeholder))
      ) {
        _.remove(chunks[from], isSystemWithoutPlaceholder);
      } else {
        const exclude_chunk = _.remove(chunks[from], p => p.role === 'system');
        chunks[to] = to < from ? _.concat(chunks[to], exclude_chunk) : _.concat(exclude_chunk, chunks[to]);
      }
      _(chunks)
        .flatten()
        .filter(p => getPromptContent(p, settings).includes(injection_settings.placeholder))
        .forEach(p => {
          updatePromptContentWith(
            p,
            ({ content }) => content.replaceAll(injection_settings.placeholder, placeholder_content),
            settings,
          );
        });
    };
    if (settings.entry_processing.mode === 'depth') {
      applyInjection(above, 1, 0);
      applyInjection(below, 2, 3);
    }
    if (process_worldbook) {
      const activated_entries = [...activated_worldbook_entries.values()];
      const flattened_chunks_before_worldbook = _.flatten(chunks);
      const extraction_items = activated_entries.flatMap(getWorldbookExtractionItems);
      const plan = planWorldbookExtraction(
        extraction_items,
        compiled_rules,
        flattened_chunks_before_worldbook.map(prompt => getPromptContent(prompt, settings)),
      );
      const handled_entry_keys =
        generation.chat_id === (SillyTavern.getCurrentChatId() ?? '')
          ? processAggressiveGreenCache(
              chunks,
              flattened_chunks_before_worldbook,
              activated_entries,
              settings,
              worldbook_entry_metadata,
              loaded_worldbook_names,
              plan,
              request_history,
              worldbook_extraction_debug,
            )
          : new Set<string>();
      extractWorldbookEntriesToPlaceholders(
        flattened_chunks_before_worldbook,
        extraction_items.filter(entry => !handled_entry_keys.has(entry.key)),
        settings,
        plan,
        worldbook_extraction_debug,
      );
    }

    const flattened_chunks_after_worldbook = _.flatten(chunks);
    if (process_worldbook) {
      worldbook_extraction_debug.wrapper_before_unwrap = getWorldbookExtractionWrapperStats(
        flattened_chunks_after_worldbook,
        settings,
      );
    }
    unwrapRemainingWorldbookExtractionWrappers(flattened_chunks_after_worldbook, settings);
    cleanupGreenCacheAnchorMarkers(flattened_chunks_after_worldbook, settings);
    if (settings.entry_processing.mode === 'worldbook') {
      flattened_chunks_after_worldbook.forEach(prompt =>
        updatePromptContentWith(
          prompt,
          ({ content }) => content.replace(/\{\{压缩相邻消息::[^{}]*\}\}/g, ''),
          settings,
        ),
      );
    }
    if (generation.dry_run && settings.entry_processing.mode === 'worldbook') {
      const placeholders = new Map([...compiled_rules.placeholders.values()].flat().map(value => [value, '']));
      flattened_chunks_after_worldbook.forEach(prompt =>
        updatePromptContentWith(prompt, ({ content }) => replaceWorldbookPlaceholders(content, placeholders), settings),
      );
    }
    cleanupChunks(chunks, settings);
    if (process_worldbook) {
      captureWorldbookDebugTotalRows(chunks, worldbook_extraction_debug, settings, request_history);
    }

    const [head, above_chat_history, below_chat_history, tail] = chunks;

    let result: SillyTavern.SendingMessage[];
    switch (settings.chat_history.type) {
      case 'squash_nearby':
        result = squashAdjacentMessage(_.concat(head, above_chat_history, below_chat_history, tail), settings);
        break;
      case 'squash_into_one':
        result = squashAdjacentMessage(
          _.concat(head, squashChatHistory(_.concat(above_chat_history, below_chat_history), settings), tail),
          settings,
        );
        break;
    }

    assignInplace(prompt, result);
    if (generation.dry_run) {
      console.debug('[压缩相邻消息] 提示词预演完成', { type: generation.type, dry_run: true, recorded: false });
    } else if (process_worldbook && !isWorldbookDebugStateEmpty(worldbook_extraction_debug)) {
      printWorldbookDebugState(worldbook_extraction_debug);
      publishSquashDebugRecord(
        getWorldbookDebugTitle(worldbook_extraction_debug),
        {
          ...worldbook_extraction_debug,
          final_prompt: captureFinalPrompt(result),
        },
        generation,
        prompt,
        request,
      );
    }
    if (!generation.dry_run) {
      activated_worldbook_entries.clear();
      confirmed_scan = false;
      scans.begin();
    }
  };
  type PreparedRequest = {
    generation: DebugGeneration;
    history: CacheHistory;
    snapshot: WorldbookScanSnapshot;
    entries: ActivatedWorldbookEntry[];
    debug: WorldbookExtractionDebugState;
    token: string;
    sources: Set<SillyTavern.SendingMessage[]>;
    consumed: boolean;
    created_at: number;
  };
  const prepared_requests = new Map<string, PreparedRequest>();
  const prepared_arrays = new WeakMap<object, PreparedRequest>();
  const request_prefix = '§§TH_SQUASH_REQUEST_' + getScriptId().replace(/\W/g, '') + ':';
  const request_pattern = new RegExp(_.escapeRegExp(request_prefix) + '([0-9a-f]+)§§', 'g');
  const use_preparation = compare(getTavernVersion(), '1.13.4', '>');

  const preparePrompts = ({ prompt }: { prompt: SillyTavern.SendingMessage[] }, dry_run?: boolean) => {
    if (!shouldEnable() || !Array.isArray(prompt)) return;
    prompt.forEach(message => prompt_content_cache.delete(message));
    const existing_tokens = _.uniq(
      prompt.flatMap(message => getPromptContent(message, settings).match(request_pattern) ?? []),
    );
    if (existing_tokens.length === 1) {
      const existing = prepared_requests.get(existing_tokens[0]);
      if (existing && !existing.consumed) {
        existing.sources.add(prompt);
        prepared_arrays.set(prompt, existing);
        return;
      }
    }
    const generation = generation_trace.accept(prompt, dry_run, 'generate_after_data', getGenerationContext());
    if (!generation) return;
    if (generation.dry_run) {
      handlePrompts({ prompt }, true, 'generate_after_data', generation);
      return;
    }
    if (!seperatePrompts(prompt, separators)) return;
    if (!confirmed_scan) applySnapshot(scans.cacheSnapshot());
    let entries = collectPluginEntries([...activated_worldbook_entries.values()].map(entry => structuredClone(entry)));
    let preparation_failed = false;
    if (settings.entry_processing.mode === 'worldbook') {
      const original = _.cloneDeep(prompt);
      try {
        prepareRequestWorldbookEntries(prompt, entries, settings, worldbook_extraction_debug);
      } catch (error) {
        assignInplace(prompt, original);
        prompt.forEach(message => prompt_content_cache.delete(message));
        entries = [];
        preparation_failed = true;
        worldbook_extraction_debug.error_logs.push('条目预处理失败，正文保留原位。');
        console.warn('[压缩相邻消息] 条目预处理失败', error);
      }
    }
    const marker_prompt = prompt.find(message => getPromptContent(message, settings).includes(separators.head.content));
    if (!marker_prompt) return;
    const token = request_prefix + crypto.randomUUID().replaceAll('-', '') + '§§';
    const prepared: PreparedRequest = {
      generation,
      history: getHistory(),
      snapshot: preparation_failed
        ? { metadata: new Map(), worlds: new Set() }
        : structuredClone({ metadata: worldbook_entry_metadata, worlds: loaded_worldbook_names }),
      entries,
      debug: structuredClone(worldbook_extraction_debug),
      token,
      sources: new Set([prompt]),
      consumed: false,
      created_at: Date.now(),
    };
    updatePromptContentWith(
      marker_prompt,
      ({ content }) => content.replace(separators.head.content, () => separators.head.content + token),
      settings,
    );
    prepared_requests.set(token, prepared);
    prepared_arrays.set(prompt, prepared);
    for (const [key, item] of prepared_requests) {
      if (Date.now() - item.created_at > 300_000 || prepared_requests.size > 32) prepared_requests.delete(key);
    }
    activated_worldbook_entries.clear();
    confirmed_scan = false;
  };

  const handlePrompts2 = (request: { messages: SillyTavern.SendingMessage[]; [key: string]: unknown }) => {
    const prompt = request.messages;
    if (!shouldEnable() || !Array.isArray(prompt)) return;
    prompt.forEach(message => prompt_content_cache.delete(message));
    const tokens = _.uniq(prompt.flatMap(message => getPromptContent(message, settings).match(request_pattern) ?? []));
    let prepared = prepared_arrays.get(prompt);
    if (!prepared && tokens.length === 1) prepared = prepared_requests.get(tokens[0]);
    if (prepared?.consumed && !tokens.length) return;
    if (prepared?.consumed) prepared = undefined;
    if (!prepared && !tokens.length && use_preparation) return;
    if (!prepared && !tokens.length && !seperatePrompts(prompt, separators)) return;

    const original = _.cloneDeep(prompt);
    try {
      if (!prepared && !tokens.length && !use_preparation) {
        const generation = generation_trace.accept(
          prompt,
          false,
          'chat_completion_settings_ready',
          getGenerationContext(),
        );
        if (!generation) return;
        if (!confirmed_scan) applySnapshot(scans.cacheSnapshot());
        if (settings.entry_processing.mode === 'worldbook') {
          const entries = collectPluginEntries([...activated_worldbook_entries.values()]);
          activated_worldbook_entries.clear();
          entries.forEach(entry => activated_worldbook_entries.set(entry.key, entry));
          prepareRequestWorldbookEntries(
            prompt,
            [...activated_worldbook_entries.values()],
            settings,
            worldbook_extraction_debug,
          );
        }
        handlePrompts({ prompt }, false, 'chat_completion_settings_ready', generation, request);
        return;
      }

      // 请求内标记用于跨模板插件的数组替换关联，最终发送前统一移除。
      for (const message of prompt)
        updatePromptContentWith(message, ({ content }) => content.replace(request_pattern, ''), settings);
      if (prepared) {
        prepared.consumed = true;
        prepared_requests.delete(prepared.token);
        applySnapshot(prepared.snapshot);
        worldbook_extraction_debug = prepared.debug;
        activated_worldbook_entries.clear();
        prepared.entries.forEach(entry => activated_worldbook_entries.set(entry.key, entry));
        handlePrompts(
          { prompt },
          false,
          'chat_completion_settings_ready',
          { ...prepared.generation, event: 'chat_completion_settings_ready' },
          request,
          prepared.history,
        );
      } else {
        // 设置重载或过期请求保持正文，仅清理临时边界。
        activated_worldbook_entries.clear();
        applySnapshot({ metadata: new Map(), worlds: new Set() });
        worldbook_extraction_debug = createWorldbookExtractionDebugState();
        handlePrompts({ prompt }, false, 'chat_completion_settings_ready', undefined, request);
      }
    } catch (error) {
      assignInplace(prompt, original);
      if (prepared) {
        prepared.consumed = true;
        prepared_requests.delete(prepared.token);
      }
      console.warn('[压缩相邻消息] 请求整理失败，保留原始正文', error);
    } finally {
      for (const target of new Set([prompt, ...(prepared?.sources ?? [])])) {
        target.forEach(message => prompt_content_cache.delete(message));
        for (const message of target) {
          updatePromptContentWith(
            message,
            ({ content }) => {
              let result = unwrapWorldbookExtractionWrapperText(content.replace(request_pattern, ''));
              for (const separator of Object.values(separators)) result = result.replaceAll(separator.content, '');
              return settings.entry_processing.mode === 'worldbook'
                ? result.replace(/\{\{压缩相邻消息::[^{}]*\}\}/g, '')
                : result;
            },
            settings,
          );
        }
        cleanupGreenCacheAnchorMarkers(target, settings);
        assignInplace(target, rejectEmptyPrompts(target));
      }
    }
  };
  if (use_preparation) eventOn(tavern_events.GENERATE_AFTER_DATA, preparePrompts);
  eventMakeLast(tavern_events.CHAT_COMPLETION_SETTINGS_READY, handlePrompts2);

  const handleStopStringOnStream = (text: string) => {
    if (!settings.stop_string || !shouldEnable()) {
      return;
    }
    const regex = regexFromString(settings.stop_string, true);
    if (!regex) {
      return;
    }
    // slice(1) 来避免 AI 在开头匹配到停止字符串的情况
    if (regex.test(text.trimStart().slice(1))) {
      SillyTavern.stopGeneration();
    }
  };
  eventMakeFirst(tavern_events.STREAM_TOKEN_RECEIVED, handleStopStringOnStream);

  const handleStopStringOnReceived = async (message_id: number | string) => {
    if (!settings.stop_string || !shouldEnable()) {
      return;
    }

    const chat_message = SillyTavern.chat[Number(message_id)];

    const first_non_space_index = chat_message.mes.search(/\S/);
    if (first_non_space_index === -1) {
      return;
    }

    const regex = regexFromString(settings.stop_string, true);
    if (!regex) {
      return;
    }

    // slice(first_non_space_index + 1) 来避免 AI 在开头匹配到停止字符串的情况
    const searched_index = chat_message.mes.slice(first_non_space_index + 1).search(regex);
    if (searched_index === -1) {
      return;
    }

    chat_message.mes = chat_message.mes.slice(0, first_non_space_index + searched_index + 1);
    if (chat_message.swipes) {
      _.set(chat_message, ['swipes', chat_message.swipe_id!], chat_message.mes);
    }
    // 与 https://gitgud.io/Monblant/noass 采用相同逻辑而不使用 setChatMessages, 因为 CHARACTER_MESSAGE_RENDERED 将会随后自然触发
    SillyTavern.updateMessageBlock(Number(message_id), chat_message);
    await SillyTavern.saveChat();
  };
  eventMakeFirst(tavern_events.MESSAGE_RECEIVED, handleStopStringOnReceived);

  return {
    unlisten: () => {
      eventRemoveListener(tavern_events.GENERATE_AFTER_DATA, preparePrompts);
      eventRemoveListener(tavern_events.CHAT_COMPLETION_SETTINGS_READY, handlePrompts2);
      eventRemoveListener(tavern_events.GENERATION_AFTER_COMMANDS, resetActivatedWorldbookEntries);
      eventRemoveListener(tavern_events.WORLDINFO_ENTRIES_LOADED, handleWorldInfoEntriesLoaded);
      eventRemoveListener(tavern_events.WORLDINFO_SCAN_DONE, handleWorldInfoScanDone);
      eventRemoveListener(tavern_events.WORLD_INFO_ACTIVATED, handleWorldInfoActivated);
      eventRemoveListener(tavern_events.STREAM_TOKEN_RECEIVED, handleStopStringOnStream);
      eventRemoveListener(tavern_events.MESSAGE_RECEIVED, handleStopStringOnReceived);
    },
  };
}

export function initSquashWithoutPanel(settings: Settings) {
  const { unregister, getPreferredScriptId } = registerAsUniqueScript('压缩相邻消息');
  const shouldEnable = () => getPreferredScriptId() === getScriptId();
  const { separators, uninject, getHistory } = injectSeparators(settings, shouldEnable);
  const { unlisten } = listenEvent(settings, separators, shouldEnable, getHistory);
  return {
    destroy: () => {
      unregister();
      unlisten();
      uninject();
    },
  };
}
