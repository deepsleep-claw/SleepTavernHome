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
import { Settings, WorldbookExtractionPositionOrder } from './store';

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
    content = prompt.content
      .filter(({ type }) => type === 'text')
      .map(({ text }: any) => text)
      .join(settings.delimiter.value);
  }
  prompt_content_cache.set(prompt, content);
  return content;
}
function updatePromptContentWith(
  prompt: SillyTavern.SendingMessage,
  updater: (prompt: { role: 'system' | 'assistant' | 'user'; content: string }) => string,
  settings: Settings,
): SillyTavern.SendingMessage {
  const content = updater({ role: prompt.role, content: getPromptContent(prompt, settings) });
  if (typeof prompt.content === 'string') {
    prompt.content = content;
  } else {
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

export function injectSeparators(settings: Settings) {
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

  const injectGreenAnchors = () => {
    if (green_anchor_prompt_ids.length > 0) {
      uninjectPrompts(green_anchor_prompt_ids);
    }
    const green_anchor_prompts = getGreenCacheAnchorInjectionPrompts(settings);
    green_anchor_prompt_ids = green_anchor_prompts.map(prompt => prompt.id);
    if (green_anchor_prompts.length > 0) {
      injectPrompts(green_anchor_prompts);
    }
  };
  const inject = () => {
    injectPrompts(Object.values(separators));
    injectGreenAnchors();
  };
  eventOn(tavern_events.GENERATION_AFTER_COMMANDS, inject);
  eventOn(tavern_events.MESSAGE_SENT, injectGreenAnchors);

  return {
    separators,
    uninject: () => {
      eventRemoveListener(tavern_events.GENERATION_AFTER_COMMANDS, inject);
      eventRemoveListener(tavern_events.MESSAGE_SENT, injectGreenAnchors);
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

  const tagContent = (prompt: SillyTavern.SendingMessage) =>
    updatePromptContentWith(
      prompt,
      ({ role, content }) => {
        content = content.includes(prefix[role]) ? content : prefix[role] + content;
        content = content.includes(suffix[role]) ? content : content + suffix[role];
        return content;
      },
      settings,
    );

  return chunkBy(prompts, (lhs, rhs) => typeof lhs.content === 'string' && typeof rhs.content === 'string').map(
    chunk => {
      chunk.forEach(tagContent);

      return {
        role: settings.chat_history.squash_role,
        content:
          chunk.length === 1 ? chunk[0].content : chunk.map(({ content }) => content).join(settings.delimiter.value),
      };
    },
  );
}

type WorldbookExtractionPosition = (typeof WorldbookExtractionPositionOrder)[number];

type SplitGetwiExtractionPart = {
  trigger_type: 'constant' | 'keyed';
  content_candidates: string[];
  wrapper_id?: string;
  source?: string;
  target_key?: string;
  target_name?: string;
};

type ActivatedWorldbookEntry = {
  key: string;
  world: string;
  uid: number;
  name: string;
  index: number;
  trigger_type: 'constant' | 'keyed';
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

type WorldbookEntryMetadata = {
  key: string;
  world: string;
  uid: number;
  name: string;
  is_constant: boolean;
  content: string;
  content_candidates: string[];
  split_getwi_parts: SplitGetwiExtractionPart[];
  wrapper_id?: string;
  content_hash: string;
  has_dynamic_macro: boolean;
};

function parseWorldbookEntryMetadata(entry: { world: string } & SillyTavern.FlattenedWorldInfoEntry): WorldbookEntryMetadata {
  const content = trimEmptyLines(unwrapWorldbookExtractionWrapperText(entry.content ?? ''));
  return {
    key: getWorldbookEntryKey(entry),
    world: entry.world,
    uid: entry.uid,
    name: entry.comment ?? '',
    is_constant: entry.constant,
    content,
    content_candidates: [content],
    split_getwi_parts: [],
    wrapper_id: undefined,
    content_hash: hashGreenCacheContent(content),
    has_dynamic_macro: true,
  };
}

function removeStableIdentityMacros(content: string): string {
  return content
    .replace(/<USER>/gi, '')
    .replace(/<BOT>/gi, '')
    .replace(/<CHAR>/gi, '')
    .replace(/\{\{\s*user\s*\}\}/gi, '')
    .replace(/\{\{\s*char\s*\}\}/gi, '');
}

const MAX_GETWI_RECURSION_DEPTH = 3;
const SAFE_GETWI_ARGUMENT = String.raw`(null|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?)`;
const SAFE_GETWI_TEMPLATE_REGEX = new RegExp(
  String.raw`<%[-=]\s*await\s+(?:getwi|getWorldInfo)\s*\(\s*${SAFE_GETWI_ARGUMENT}(?:\s*,\s*${SAFE_GETWI_ARGUMENT})?\s*\)\s*[-_]?%>`,
  'g',
);

type SafeGetwiArgument = string | number | null;

type SafeGetwiTemplateCall = {
  raw: string;
  first_argument: SafeGetwiArgument;
  second_argument: SafeGetwiArgument | undefined;
};

type AnalyzedGetwiCall = {
  has_dynamic_macro: boolean;
  content_candidates: string[];
  source?: string;
  target_key?: string;
  target_name?: string;
};

type WorldbookContentAnalysis = {
  has_dynamic_macro: boolean;
  content_candidates: string[];
  is_pure_getwi: boolean;
  getwi_calls: AnalyzedGetwiCall[];
};

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

type GreenCacheInsertionSource =
  | 'custom_anchor'
  | 'before_chat_history'
  | 'before_chat_anchor';

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

type GreenCacheDebugState = {
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

function removeSafeGetwiTemplateMacros(content: string): string {
  return content.replace(SAFE_GETWI_TEMPLATE_REGEX, '');
}

function parseSafeGetwiArgument(argument: string): SafeGetwiArgument {
  const trimmed = argument.trim();
  if (trimmed === 'null') {
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed
    .slice(1, -1)
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function getSafeGetwiTemplateCalls(content: string): SafeGetwiTemplateCall[] {
  return [...content.matchAll(SAFE_GETWI_TEMPLATE_REGEX)].map(match => ({
    raw: match[0],
    first_argument: parseSafeGetwiArgument(match[1]),
    second_argument: match[2] === undefined ? undefined : parseSafeGetwiArgument(match[2]),
  }));
}

function hasDynamicPromptMacro(content: string): boolean {
  const checked_content = removeSafeGetwiTemplateMacros(removeStableIdentityMacros(content));
  return /\{\{[\s\S]*?\}\}/.test(checked_content) || /<%(?:[-_=#_%])?[\s\S]*?(?:[-_]?%>)/.test(checked_content);
}

function getWorldbookRegexDepth(entry: Pick<SillyTavern.FlattenedWorldInfoEntry, 'position' | 'depth'>): number | undefined {
  return entry.position === 4 ? entry.depth ?? DEFAULT_WORLDBOOK_DEPTH : undefined;
}

function formatAsWorldbookPromptRegexedContent(
  content: string,
  entry: Pick<SillyTavern.FlattenedWorldInfoEntry, 'position' | 'depth'>,
): string {
  const depth = getWorldbookRegexDepth(entry);
  return depth === undefined
    ? formatAsTavernRegexedString(content, 'world_info', 'prompt')
    : formatAsTavernRegexedString(content, 'world_info', 'prompt', { depth });
}

function isRegexDepthMatched(
  regex: TavernRegex,
  entry: Pick<SillyTavern.FlattenedWorldInfoEntry, 'position' | 'depth'>,
): boolean {
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
    ...(isCharacterTavernRegexesEnabled() ? getTavernRegexes({ type: 'character', name: 'current' }) : []),
    ...getTavernRegexes({ type: 'preset', name: 'in_use' }),
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

function doesRegexMatchContent(regex: TavernRegex, content: string): boolean {
  const parsed_regex = parseTavernRegex(substitudeMacros(regex.find_regex));
  return !!parsed_regex && parsed_regex.test(content);
}

function hasDynamicWorldInfoPromptRegexReplacement(
  original_content: string,
  regexed_content: string,
  entry: Pick<SillyTavern.FlattenedWorldInfoEntry, 'position' | 'depth'>,
): boolean {
  const dynamic_regexes = getWorldInfoPromptRegexes().filter(
    regex => isRegexDepthMatched(regex, entry) && hasDynamicPromptMacro(regex.replace_string),
  );
  if (dynamic_regexes.length === 0) {
    return false;
  }

  if (
    dynamic_regexes.some(
      regex => doesRegexMatchContent(regex, original_content) || doesRegexMatchContent(regex, regexed_content),
    )
  ) {
    return true;
  }

  // 若动态正则依赖前序静态正则的改写结果，直接匹配原文/终文可能会漏判；保守归入 lora_key。
  return original_content !== regexed_content;
}

const WORLDBOOK_EXTRACTION_WRAPPER_PREFIX = '§§TH_SQUASH_WI';
const WORLDBOOK_EXTRACTION_WRAPPER_SUFFIX = '§§';
const REGEXED_WORLDBOOK_MARKER_PREFIX = '§§TH_SQUASH_REGEXED_WI';
const REGEXED_WORLDBOOK_MARKER_REGEX = /§§TH_SQUASH_REGEXED_WI:([0-9a-z]+)§§/g;
const DEFAULT_WORLDBOOK_DEPTH = 4;
const WORLDBOOK_PLACEHOLDER_SEPARATOR = '\n';

type RegexedWorldbookIntercept = {
  key: string;
  marker: string;
  original_content: string;
  regexed_content: string;
  trigger_type: ActivatedWorldbookEntry['trigger_type'];
};

type WorldInfoScanDoneEvent = {
  state: {
    next: number;
  };
  activated: {
    entries: Map<string, SillyTavern.FlattenedWorldInfoEntry>;
  };
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

function resetWorldbookExtractionDebugState(state: WorldbookExtractionDebugState) {
  state.loaded = {
    total: 0,
    constant_with_getwi: 0,
    dynamic: 0,
    split: 0,
    wrapped: 0,
    split_wrapped_parts: 0,
  };
  state.total_rows.length = 0;
  state.triggered_rows.length = 0;
  state.prompt_rows.length = 0;
  state.error_logs.length = 0;
  state.green_cache.summary = undefined;
  state.green_cache.chat_messages.length = 0;
  state.green_cache.cache_entries.length = 0;
  state.green_cache.activations.length = 0;
  state.green_cache.insertions.length = 0;
  state.wrapper_before_unwrap = {
    paired: 0,
    orphan: 0,
  };
  state.total_activated = 0;
  state.total_extraction = 0;
  state.total_consumed = 0;
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

function hasDynamicPromptMacroOrGetwi(content: string): boolean {
  return hasDynamicPromptMacro(content) || getSafeGetwiTemplateCalls(content).length > 0;
}

function isPureGetwiAggregation(content: string): boolean {
  return getSafeGetwiTemplateCalls(content).length > 0 && removeSafeGetwiTemplateMacros(content).trim() === '';
}

function resolveSafeGetwiTarget(
  call: SafeGetwiTemplateCall,
  worldbook_entry_metadata: Map<string, WorldbookEntryMetadata>,
  loaded_worldbook_names: Set<string>,
): WorldbookEntryMetadata | undefined {
  let target_world: string | undefined;
  let target_identifier: string | number | null | undefined;

  if (call.second_argument === undefined) {
    target_identifier = call.first_argument;
  } else {
    if (call.first_argument !== null && typeof call.first_argument !== 'string') {
      return undefined;
    }
    target_world = call.first_argument ?? undefined;
    target_identifier = call.second_argument;
  }

  if (target_identifier === null || target_identifier === undefined) {
    return undefined;
  }
  if (target_world !== undefined && !loaded_worldbook_names.has(target_world)) {
    return undefined;
  }

  const candidates = [...worldbook_entry_metadata.values()].filter(metadata => {
    if (target_world !== undefined && metadata.world !== target_world) {
      return false;
    }
    return typeof target_identifier === 'number'
      ? metadata.uid === target_identifier
      : metadata.name === target_identifier;
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function getKnownExpandedContent(content: string, analyzed_calls: AnalyzedGetwiCall[]): string {
  let call_index = 0;
  return content.replace(SAFE_GETWI_TEMPLATE_REGEX, () => analyzed_calls[call_index++]?.content_candidates[0] ?? '');
}

function analyzeWorldbookContent(
  content: string,
  worldbook_entry_metadata: Map<string, WorldbookEntryMetadata>,
  loaded_worldbook_names: Set<string>,
  depth: number,
  visiting_entry_keys: Set<string>,
): WorldbookContentAnalysis {
  const getwi_calls = getSafeGetwiTemplateCalls(content);
  const has_other_dynamic_macro = hasDynamicPromptMacro(content);
  const is_pure_getwi = isPureGetwiAggregation(content);

  if (getwi_calls.length === 0) {
    return {
      has_dynamic_macro: has_other_dynamic_macro,
      content_candidates: [content],
      is_pure_getwi,
      getwi_calls: [],
    };
  }

  if (depth >= MAX_GETWI_RECURSION_DEPTH) {
    return {
      has_dynamic_macro: true,
      content_candidates: [content],
      is_pure_getwi,
      getwi_calls: getwi_calls.map(call => ({
        has_dynamic_macro: true,
        content_candidates: [call.raw],
        source: call.raw,
      })),
    };
  }

  const analyzed_calls = getwi_calls.map(call => {
    const target = resolveSafeGetwiTarget(call, worldbook_entry_metadata, loaded_worldbook_names);
    if (!target || visiting_entry_keys.has(target.key)) {
      return {
        has_dynamic_macro: true,
        content_candidates: [call.raw],
        source: call.raw,
      };
    }

    const nested_visiting_entry_keys = new Set(visiting_entry_keys).add(target.key);
    const target_analysis = analyzeWorldbookContent(
      target.content,
      worldbook_entry_metadata,
      loaded_worldbook_names,
      depth + 1,
      nested_visiting_entry_keys,
    );
    return {
      has_dynamic_macro: target_analysis.has_dynamic_macro,
      content_candidates: target_analysis.content_candidates,
      source: call.raw,
      target_key: target.key,
      target_name: target.name,
    };
  });

  const has_dynamic_getwi = analyzed_calls.some(call => call.has_dynamic_macro);
  const has_dynamic_macro = has_other_dynamic_macro || has_dynamic_getwi;
  const content_candidates =
    !has_dynamic_macro || (is_pure_getwi && getwi_calls.length === 1)
      ? [getKnownExpandedContent(content, analyzed_calls)]
      : [content];

  return {
    has_dynamic_macro,
    content_candidates,
    is_pure_getwi,
    getwi_calls: analyzed_calls,
  };
}

function applyWorldbookEntryMetadataAnalysis(
  metadata: WorldbookEntryMetadata,
  worldbook_entry_metadata: Map<string, WorldbookEntryMetadata>,
  loaded_worldbook_names: Set<string>,
) {
  if (!metadata.is_constant) {
    metadata.has_dynamic_macro = hasDynamicPromptMacroOrGetwi(metadata.content);
    metadata.content_candidates = [metadata.content];
    metadata.split_getwi_parts = [];
    return;
  }

  const analysis = analyzeWorldbookContent(
    metadata.content,
    worldbook_entry_metadata,
    loaded_worldbook_names,
    0,
    new Set([metadata.key]),
  );
  metadata.has_dynamic_macro = analysis.has_dynamic_macro;
  metadata.content_candidates = _.uniq([metadata.content, ...analysis.content_candidates]);
  metadata.split_getwi_parts =
    analysis.is_pure_getwi && analysis.getwi_calls.length > 1 && analysis.has_dynamic_macro
      ? analysis.getwi_calls.map(call => ({
          trigger_type: call.has_dynamic_macro ? 'keyed' : 'constant',
          content_candidates: call.content_candidates,
          source: call.source,
          target_key: call.target_key,
          target_name: call.target_name,
        }))
      : [];
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

function applyFormatVariable(
  _substring: string,
  prefix: string,
  type: MacroLikeVariableType,
  path: string,
): string {
  const match = prefix.match(FORMAT_VARIABLE_PREFIX_REGEX);
  if (match) {
    prefix =
      applyFormatVariable('', match[1], match[2] as MacroLikeVariableType, match[3]) + prefix.slice(match[0].length);
  }

  const value = getMacroLikeVariableValue(type, path);
  const formatted_value = typeof value === 'string' ? value : YAML.stringify(value, { blockQuote: 'literal' }).trimEnd();
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
  if (!content) {
    return undefined;
  }

  const has_source_macro = metadata?.has_dynamic_macro ?? hasDynamicPromptMacroOrGetwi(entry.content ?? '');
  const trigger_type = entry.constant
    ? has_source_macro
      ? 'keyed'
      : 'constant'
    : entry.vectorized
      ? undefined
      : 'keyed';
  if (!trigger_type) {
    return undefined;
  }

  return {
    key: getWorldbookEntryKey(entry),
    world: entry.world,
    uid: entry.uid,
    name: metadata?.name ?? entry.comment ?? '',
    index,
    trigger_type,
    position: FLATTENED_WORLDBOOK_POSITION[entry.position] ?? 'at_depth',
    depth: entry.depth ?? 0,
    order: entry.order ?? 0,
    content,
    content_candidates: [...(metadata?.content_candidates ?? [content])],
    split_getwi_parts: metadata?.split_getwi_parts.map(part => ({
      ...part,
      content_candidates: [...part.content_candidates],
    })) ?? [],
    wrapper_id: metadata?.wrapper_id,
    content_hash: metadata?.content_hash ?? hashGreenCacheContent(content),
    has_source_macro,
    is_selective: !entry.constant && !entry.vectorized,
  };
}

function wrapActivatedWorldbookEntrySourceContent(
  source_entry: SillyTavern.FlattenedWorldInfoEntry,
  activated_entry: ActivatedWorldbookEntry,
  next_wrapper_id: () => string,
) {
  const content = unwrapWorldbookExtractionWrapperText(source_entry.content);
  if (activated_entry.split_getwi_parts.length > 0) {
    let part_index = 0;
    source_entry.content = content.replace(SAFE_GETWI_TEMPLATE_REGEX, template => {
      const part = activated_entry.split_getwi_parts[part_index++];
      if (!part) {
        return template;
      }

      const wrapper_id = part.wrapper_id ?? next_wrapper_id();
      part.wrapper_id = wrapper_id;
      return wrapWorldbookExtractionContent(wrapper_id, template);
    });
    return;
  }

  if (activated_entry.trigger_type !== 'keyed' || !activated_entry.has_source_macro) {
    return;
  }

  const wrapper_id = activated_entry.wrapper_id ?? next_wrapper_id();
  activated_entry.wrapper_id = wrapper_id;
  source_entry.content = wrapWorldbookExtractionContent(wrapper_id, content);
}

function wrapWorldbookEntryMetadataSourceContent(
  source_entry: { content: string },
  metadata: WorldbookEntryMetadata,
  next_wrapper_id: () => string,
  { allow_non_constant = false }: { allow_non_constant?: boolean } = {},
) {
  const content = unwrapWorldbookExtractionWrapperText(source_entry.content);
  if (!allow_non_constant && !metadata.is_constant) {
    source_entry.content = content;
    return;
  }

  if (metadata.split_getwi_parts.length > 0) {
    let part_index = 0;
    source_entry.content = content.replace(SAFE_GETWI_TEMPLATE_REGEX, template => {
      const part = metadata.split_getwi_parts[part_index++];
      if (!part) {
        return template;
      }

      const wrapper_id = part.wrapper_id ?? next_wrapper_id();
      part.wrapper_id = wrapper_id;
      return wrapWorldbookExtractionContent(wrapper_id, template);
    });
    return;
  }

  if (!metadata.has_dynamic_macro) {
    return;
  }

  const wrapper_id = metadata.wrapper_id ?? next_wrapper_id();
  metadata.wrapper_id = wrapper_id;
  source_entry.content = wrapWorldbookExtractionContent(wrapper_id, content);
}

type SortableWorldbookExtractionItem = Pick<
  ActivatedWorldbookEntry,
  'position' | 'depth' | 'order' | 'index'
> & {
  part_index?: number;
};

function sortWorldbookExtractionItems<T extends SortableWorldbookExtractionItem>(entries: T[], settings: Settings): T[] {
  const position_order = settings.entry_processing.worldbook.position_order;
  const position_index = (position: WorldbookExtractionPosition) => {
    const index = position_order.indexOf(position);
    return index === -1 ? WorldbookExtractionPositionOrder.indexOf(position) : index;
  };

  return [...entries].sort((lhs, rhs) => {
    const position_difference = position_index(lhs.position) - position_index(rhs.position);
    if (position_difference !== 0) {
      return position_difference;
    }

    if (lhs.position === 'at_depth' && rhs.position === 'at_depth' && lhs.depth !== rhs.depth) {
      return rhs.depth - lhs.depth;
    }

    if (lhs.order !== rhs.order) {
      return lhs.order - rhs.order;
    }

    if (lhs.index !== rhs.index) {
      return lhs.index - rhs.index;
    }

    return (lhs.part_index ?? 0) - (rhs.part_index ?? 0);
  });
}

function sortActivatedWorldbookEntries(
  entries: ActivatedWorldbookEntry[],
  settings: Settings,
): ActivatedWorldbookEntry[] {
  return sortWorldbookExtractionItems(entries, settings);
}

function getPromptsWithPlaceholder(
  prompts: SillyTavern.SendingMessage[],
  placeholder: string,
  settings: Settings,
): SillyTavern.SendingMessage[] {
  return prompts.filter(prompt => getPromptContent(prompt, settings).includes(placeholder));
}

function replacePlaceholderInPrompts(
  prompts: SillyTavern.SendingMessage[],
  placeholder: string,
  replacement: string,
  settings: Settings,
) {
  prompts.forEach(prompt => {
    updatePromptContentWith(prompt, ({ content }) => content.replaceAll(placeholder, replacement), settings);
  });
}

function restoreUnconsumedRegexedWorldbookMarkers(
  prompts: SillyTavern.SendingMessage[],
  intercepts: Map<string, RegexedWorldbookIntercept>,
  settings: Settings,
) {
  if (intercepts.size === 0) {
    return;
  }

  const intercepts_by_marker = new Map([...intercepts.values()].map(intercept => [intercept.marker, intercept]));
  prompts.forEach(prompt => {
    updatePromptContentWith(
      prompt,
      ({ content }) =>
        content.replace(REGEXED_WORLDBOOK_MARKER_REGEX, marker => {
          const intercept = intercepts_by_marker.get(marker);
          return intercept?.regexed_content ?? marker;
        }),
      settings,
    );
  });
}

type ConsumedPromptContent = {
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
    return { prompt, index: prompt_index, content: target, method: 'exact' };
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

function findPromptContentByNormalizedWhitespace(content: string, target: string): { start: number; end: number } | undefined {
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
    return { prompt, index: prompt_index, content: consumed_content, method: 'normalized' };
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
  updatePromptContentWith(
    prompt,
    ({ content }) => content.slice(0, start_index) + content.slice(end_index + wrapper_end.length),
    settings,
  );
  return { prompt, index: prompt_index, content: inner_content, method: 'wrapper' };
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
  return entry.is_selective && !entry.has_source_macro;
}

function normalizeContentForMatch(content: string): string {
  return trimEmptyLines(content).replace(/\r\n?/g, '\n');
}

function getWorldbookDebugType(is_selective: boolean): string {
  return is_selective ? '世界书绿灯' : '世界书蓝灯';
}

function getActivatedWorldbookDebugTrigger(entry: ActivatedWorldbookEntry): string {
  if (entry.is_selective) {
    return '绿灯非固定';
  }
  return entry.trigger_type === 'constant' ? '蓝灯固定' : '蓝灯非固定';
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
    触发原因: entry.is_selective ? '关键词触发' : '常驻触发',
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
  return message.is_hidden === true;
}

function readChatPromptSnapshots(hide_state: 'all' | 'hidden' | 'unhidden', include_hash = false): ChatPromptSnapshot[] {
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
    prompt_content.slice(0, 80) === chat_content.slice(0, 80) ||
    prompt_content.slice(-80) === chat_content.slice(-80)
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
) {
  const prompt_rows = new Map<SillyTavern.SendingMessage, WorldbookDebugTotalRow[]>();
  state.prompt_rows.forEach(({ prompt, rows }) => {
    prompt_rows.set(prompt, [...(prompt_rows.get(prompt) ?? []), ...rows]);
  });
  const chat_messages = readUnhiddenChatMessages();
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

function readUnhiddenChatMessages(): ChatPromptSnapshot[] {
  return readChatPromptSnapshots('unhidden');
}

function readAllChatMessages(include_hash = false): ChatPromptSnapshot[] {
  return readChatPromptSnapshots('all', include_hash);
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

function getChatMessageHashForAnchor(anchor: Pick<GreenCacheAnchor, 'message_id' | 'swipe_id'>): string | null {
  const content = getChatMessageContentForAnchor(anchor);
  return typeof content === 'string' ? hashGreenCacheContent(normalizeContentForMatch(content)) : null;
}

function getLatestUnhiddenChatAnchor(): GreenCacheAnchor {
  const messages = readUnhiddenChatMessages();
  const latest = _.last(messages);
  if (!latest) {
    return { ...BEFORE_CHAT_GREEN_CACHE_ANCHOR };
  }
  const anchor = {
    message_id: latest.message_id,
    swipe_id: _.get(latest, 'swipe_id') ?? 0,
  };
  return {
    ...anchor,
    message_hash: getChatMessageHashForAnchor(anchor),
  };
}

function getGreenCacheAnchorDepth(anchor: GreenCacheAnchor): number | undefined {
  if (anchor.message_id === null || !cacheAnchorMessageExists(anchor)) {
    return undefined;
  }
  const unhidden_messages = readUnhiddenChatMessages();
  const message_index = unhidden_messages.findIndex(
    message => message.message_id === anchor.message_id && message.swipe_id === (anchor.swipe_id ?? 0),
  );
  if (message_index === -1) {
    return undefined;
  }
  return Math.max(0, unhidden_messages.length - message_index - 1);
}

function getGreenCacheAnchorContent(anchor_key: string): string {
  return `${GREEN_CACHE_ANCHOR_PREFIX}:${anchor_key}§§`;
}

function getGreenCacheAnchorPromptId(anchor_key: string): string {
  return `\xff压缩相邻消息-green-anchor-${anchor_key}`;
}

function getGreenCacheAnchorInjectionPrompts(settings: Settings): InjectionPrompt[] {
  if (
    settings.entry_processing.mode !== 'worldbook' ||
    !settings.entry_processing.worldbook.aggressive_green_cache.enabled
  ) {
    return [];
  }

  const anchors = new Map<string, GreenCacheAnchor>();
  chooseFirstGreenCacheEntries(readGreenCacheVariables().entries)
    .map(entry => entry.fixed_at)
    .filter(anchor => anchor.message_id !== null && cacheAnchorExists(anchor))
    .sort((lhs, rhs) => (lhs.message_id! - rhs.message_id!) || ((lhs.swipe_id ?? 0) - (rhs.swipe_id ?? 0)))
    .forEach(anchor => {
      anchors.set(getAnchorKey(anchor), anchor);
  });
  const latest_anchor = getLatestUnhiddenChatAnchor();
  if (latest_anchor.message_id !== null && cacheAnchorMessageExists(latest_anchor)) {
    anchors.set(getAnchorKey(latest_anchor), latest_anchor);
  }

  const prompts: InjectionPrompt[] = [];
  [...anchors.entries()].forEach(([anchor_key, anchor]) => {
    const depth = getGreenCacheAnchorDepth(anchor);
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
  debug_state?: GreenCacheDebugState,
): Map<string, PromptInsertionLocation> {
  const insertion_locations = new Map<string, PromptInsertionLocation>();
  const all_messages = readAllChatMessages(!!debug_state);
  ([1, 2] as const).forEach(chunk_index => {
    chunks[chunk_index].forEach((prompt, prompt_index) => {
      const content = getPromptContent(prompt, settings);
      for (const match of content.matchAll(GREEN_CACHE_ANCHOR_REGEX)) {
        const anchor_key = match[1];
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
        anchor_depth: getGreenCacheAnchorDepth({
          message_id: message.message_id,
          swipe_id: message.swipe_id,
          message_hash: null,
        }),
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
        injectable_entries.push(updated_entry);
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
    injectable_entries.push(entry);
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

function canInsertGreenCacheAnchor(
  anchor: GreenCacheAnchor,
  locations: Map<string, PromptInsertionLocation>,
): boolean {
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
      (lhs, rhs) =>
        rhs.chunk_index - lhs.chunk_index || rhs.insert_index - lhs.insert_index || rhs.order - lhs.order,
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
  debug_state?: WorldbookExtractionDebugState,
): Set<string> {
  const handled_entry_keys = new Set<string>();
  if (!settings.entry_processing.worldbook.aggressive_green_cache.enabled) {
    return handled_entry_keys;
  }
  const green_cache_debug = debug_state?.green_cache;

  const cache = readGreenCacheVariables();
  const valid_cache = getValidGreenCacheEntries(cache.entries, worldbook_entry_metadata, loaded_worldbook_names);
  const valid_cache_entries = chooseFirstGreenCacheEntries(valid_cache.entries);
  const valid_cache_changed = valid_cache.changed || valid_cache.entries.length !== valid_cache_entries.length;
  const insertion_locations = buildGreenCacheInsertionLocationMap(chunks, settings, green_cache_debug);
  const injectable_cache_entries = valid_cache_entries.filter(entry =>
    canInsertGreenCacheAnchor(entry.fixed_at, insertion_locations),
  );
  const fixed_cache_identities = new Map(valid_cache_entries.map(entry => [getGreenCacheIdentity(entry), entry] as const));
  const new_anchor = getLatestUnhiddenChatAnchor();
  const can_insert_new_anchor = canInsertGreenCacheAnchor(new_anchor, insertion_locations);
  const new_cache_entries: GreenCacheEntry[] = [];
  const suppressed_cache_identities = new Set<string>();
  const aggressive_entries = sortActivatedWorldbookEntries(
    activated_entries.filter(entry => isAggressiveGreenEntry(entry)),
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
  key: string;
  world: string;
  name: string;
  is_selective: boolean;
  trigger_type: ActivatedWorldbookEntry['trigger_type'];
  content_candidates: string[];
  wrapper_id?: string;
  preconsumed_content?: string;
  target_key?: string;
  target_name?: string;
};

function getWorldbookExtractionItems(entry: ActivatedWorldbookEntry): WorldbookExtractionItem[] {
  if (entry.split_getwi_parts.length > 0) {
    return entry.split_getwi_parts.map((part, part_index) => ({
      key: `${entry.key}.getwi.${part_index}`,
      world: entry.world,
      name: part.target_name ?? entry.name,
      is_selective: entry.is_selective,
      trigger_type: part.trigger_type,
      position: entry.position,
      depth: entry.depth,
      order: entry.order,
      index: entry.index,
      part_index,
      content_candidates: getContentCandidates(part.content_candidates),
      wrapper_id: part.wrapper_id,
      target_key: part.target_key,
      target_name: part.target_name,
    }));
  }

  return [
    {
      key: entry.key,
      world: entry.world,
      name: entry.name,
      is_selective: entry.is_selective,
      trigger_type: entry.trigger_type,
      position: entry.position,
      depth: entry.depth,
      order: entry.order,
      index: entry.index,
      content_candidates: getWorldbookEntryContentCandidates(entry),
      wrapper_id: entry.wrapper_id,
      preconsumed_content: entry.preconsumed_content,
      target_key: entry.key,
      target_name: entry.name,
    },
  ];
}

function getWorldbookExtractionItemTrigger(entry: WorldbookExtractionItem): string {
  if (entry.is_selective) {
    return '绿灯非固定';
  }
  return entry.trigger_type === 'constant' ? '蓝灯固定' : '蓝灯非固定';
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
  return createWorldbookTotalRow(
    entry.is_selective,
    getWorldbookExtractionItemTrigger(entry),
    entry.target_name ?? entry.name,
    entry.world,
    content,
  );
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
  activated_entries: ActivatedWorldbookEntry[],
  settings: Settings,
  debug_state?: WorldbookExtractionDebugState,
) {
  const { constant, keyed } = settings.entry_processing.worldbook;

  const applyExtraction = (
    enabled: boolean,
    placeholder: string,
    trigger_type: ActivatedWorldbookEntry['trigger_type'],
  ) => {
    if (!enabled) {
      return;
    }

    const placeholder_prompts = getPromptsWithPlaceholder(flattened_chunks, placeholder, settings);
    if (placeholder_prompts.length === 0) {
      return;
    }

    const entries = sortWorldbookExtractionItems(
      sortActivatedWorldbookEntries(activated_entries, settings)
        .flatMap(getWorldbookExtractionItems)
        .filter(entry => entry.trigger_type === trigger_type),
      settings,
    );
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
      const consumed = consumeWorldbookExtractionItem(flattened_chunks, entry, settings, wrapper_prompt_index);
      const wrapper_presence_before_consume =
        !consumed && entry.wrapper_id ? getWorldbookWrapperPresence(flattened_chunks, entry.wrapper_id, settings) : undefined;
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
        if (['before_example_messages', 'after_example_messages'].includes(entry.position)) {
          cleanupDialogueExampleSeparatorAfterConsumption(flattened_chunks, consumed, settings);
        }
        consumed_entry_contents.set(entry.key, entry.preconsumed_content ?? consumed.content);
      }
    });

    const replacement_prompts = getPromptsWithPlaceholder(placeholder_prompts, placeholder, settings);
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
    replacePlaceholderInPrompts(replacement_prompts, placeholder, placeholder_content, settings);
  };

  applyExtraction(constant.enabled, constant.placeholder, 'constant');
  applyExtraction(keyed.enabled, keyed.placeholder, 'keyed');
}

function listenEvent(settings: Settings, separators: Separators, shouldEnable: () => boolean) {
  const activated_worldbook_entries = new Map<string, ActivatedWorldbookEntry>();
  const worldbook_entry_metadata = new Map<string, WorldbookEntryMetadata>();
  const loaded_worldbook_names = new Set<string>();
  const regexed_worldbook_intercepts = new Map<string, RegexedWorldbookIntercept>();
  const worldbook_extraction_debug = createWorldbookExtractionDebugState();
  let worldbook_extraction_wrapper_counter = 0;
  let regexed_worldbook_marker_counter = 0;

  const nextWorldbookExtractionWrapperId = () => (worldbook_extraction_wrapper_counter++).toString(36);
  const nextRegexedWorldbookMarker = () =>
    `${REGEXED_WORLDBOOK_MARKER_PREFIX}:${(regexed_worldbook_marker_counter++).toString(36)}§§`;

  const resetActivatedWorldbookEntries = () => {
    activated_worldbook_entries.clear();
    worldbook_entry_metadata.clear();
    loaded_worldbook_names.clear();
    regexed_worldbook_intercepts.clear();
    resetWorldbookExtractionDebugState(worldbook_extraction_debug);
    worldbook_extraction_wrapper_counter = 0;
    regexed_worldbook_marker_counter = 0;
    normalized_target_cache.clear();
  };
  eventOn(tavern_events.GENERATION_AFTER_COMMANDS, resetActivatedWorldbookEntries);

  const handleWorldInfoEntriesLoaded = (lores: WorldbookEntriesLoadedEvent) => {
    if (!shouldEnable() || settings.entry_processing.mode !== 'worldbook') {
      return;
    }

    worldbook_entry_metadata.clear();
    loaded_worldbook_names.clear();
    const loaded_entries = [lores.globalLore, lores.characterLore, lores.chatLore, lores.personaLore].flat();
    loaded_entries.forEach(entry => {
      const metadata = parseWorldbookEntryMetadata(entry);
      loaded_worldbook_names.add(metadata.world);
      worldbook_entry_metadata.set(metadata.key, metadata);
    });
    worldbook_entry_metadata.forEach(metadata => {
      applyWorldbookEntryMetadataAnalysis(metadata, worldbook_entry_metadata, loaded_worldbook_names);
    });
    loaded_entries.forEach(entry => {
      const metadata = worldbook_entry_metadata.get(getWorldbookEntryKey(entry));
      if (metadata) {
        wrapWorldbookEntryMetadataSourceContent(entry, metadata, nextWorldbookExtractionWrapperId);
      }
    });
    const metadata_entries = [...worldbook_entry_metadata.values()];
    worldbook_extraction_debug.loaded = {
      total: metadata_entries.length,
      constant_with_getwi: metadata_entries.filter(
        metadata => metadata.is_constant && getSafeGetwiTemplateCalls(metadata.content).length > 0,
      ).length,
      dynamic: metadata_entries.filter(metadata => metadata.has_dynamic_macro).length,
      split: metadata_entries.filter(metadata => metadata.split_getwi_parts.length > 0).length,
      wrapped: metadata_entries.filter(
        metadata => metadata.wrapper_id || metadata.split_getwi_parts.some(part => part.wrapper_id),
      ).length,
      split_wrapped_parts: metadata_entries.reduce(
        (count, metadata) => count + metadata.split_getwi_parts.filter(part => part.wrapper_id).length,
        0,
      ),
    };
  };
  eventOn(tavern_events.WORLDINFO_ENTRIES_LOADED, handleWorldInfoEntriesLoaded);

  const shouldInterceptRegexedConstantEntry = (
    entry: SillyTavern.FlattenedWorldInfoEntry,
    metadata: WorldbookEntryMetadata | undefined,
  ): metadata is WorldbookEntryMetadata =>
    !!metadata &&
    entry.constant &&
    metadata.is_constant &&
    !entry.vectorized &&
    !metadata.has_dynamic_macro &&
    metadata.split_getwi_parts.length === 0;

  const handleWorldInfoScanDone = (event_data: WorldInfoScanDoneEvent) => {
    if (!shouldEnable() || settings.entry_processing.mode !== 'worldbook' || event_data.state.next) {
      return;
    }

    event_data.activated.entries.forEach((entry, key) => {
      const metadata = worldbook_entry_metadata.get(key);
      if (!metadata || entry.vectorized) {
        return;
      }
      wrapWorldbookEntryMetadataSourceContent(entry, metadata, nextWorldbookExtractionWrapperId, {
        allow_non_constant: true,
      });
    });

    event_data.activated.entries.forEach((entry, key) => {
      if (regexed_worldbook_intercepts.has(key)) {
        return;
      }

      const metadata = worldbook_entry_metadata.get(key);
      if (!shouldInterceptRegexedConstantEntry(entry, metadata)) {
        return;
      }

      const original_content = entry.content ?? '';
      const regexed_content = formatAsWorldbookPromptRegexedContent(original_content, entry);
      if (!regexed_content || regexed_content === original_content) {
        return;
      }

      const trigger_type = hasDynamicWorldInfoPromptRegexReplacement(original_content, regexed_content, entry)
        ? 'keyed'
        : 'constant';
      const marker = nextRegexedWorldbookMarker();
      regexed_worldbook_intercepts.set(key, {
        key,
        marker,
        original_content,
        regexed_content,
        trigger_type,
      });
      entry.content = marker;
    });
  };
  eventMakeLast(tavern_events.WORLDINFO_SCAN_DONE, handleWorldInfoScanDone);

  const handleWorldInfoActivated = (entries: ({ world: string } & SillyTavern.FlattenedWorldInfoEntry)[]) => {
    if (!shouldEnable() || settings.entry_processing.mode !== 'worldbook') {
      return;
    }

    const start_index = activated_worldbook_entries.size;
    entries.forEach((entry, index) => {
      const key = getWorldbookEntryKey(entry);
      const regexed_intercept = regexed_worldbook_intercepts.get(key);
      const should_restore_regexed_marker = !!regexed_intercept && entry.content === regexed_intercept.marker;
      if (should_restore_regexed_marker) {
        entry.content = regexed_intercept.original_content;
      }
      const parsed_entry = parseActivatedWorldbookEntry(
        entry,
        start_index + index,
        worldbook_entry_metadata.get(key),
      );
      if (should_restore_regexed_marker) {
        entry.content = regexed_intercept.marker;
      }
      if (!parsed_entry || activated_worldbook_entries.has(parsed_entry.key)) {
        return;
      }
      if (regexed_intercept) {
        parsed_entry.trigger_type = regexed_intercept.trigger_type;
        parsed_entry.content = regexed_intercept.marker;
        parsed_entry.content_candidates = [regexed_intercept.marker];
        parsed_entry.preconsumed_content = regexed_intercept.regexed_content;
        parsed_entry.has_source_macro ||= regexed_intercept.trigger_type === 'keyed';
        parsed_entry.wrapper_id = undefined;
        parsed_entry.split_getwi_parts = [];
      } else {
        wrapActivatedWorldbookEntrySourceContent(entry, parsed_entry, nextWorldbookExtractionWrapperId);
      }
      activated_worldbook_entries.set(parsed_entry.key, parsed_entry);
      worldbook_extraction_debug.total_activated++;
      if (parsed_entry.split_getwi_parts.length === 0) {
        recordActivatedWorldbookDebug(worldbook_extraction_debug, parsed_entry);
      }
    });
  };
  eventMakeFirst(tavern_events.WORLD_INFO_ACTIVATED, handleWorldInfoActivated);

  const handlePrompts = ({ prompt }: { prompt: SillyTavern.SendingMessage[] }) => {
    if (!shouldEnable()) {
      return;
    }

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
    if (settings.entry_processing.mode === 'worldbook') {
      const activated_entries = [...activated_worldbook_entries.values()];
      const flattened_chunks_before_worldbook = _.flatten(chunks);
      const handled_entry_keys = processAggressiveGreenCache(
        chunks,
        flattened_chunks_before_worldbook,
        activated_entries,
        settings,
        worldbook_entry_metadata,
        loaded_worldbook_names,
        worldbook_extraction_debug,
      );
      extractWorldbookEntriesToPlaceholders(
        flattened_chunks_before_worldbook,
        activated_entries.filter(entry => !handled_entry_keys.has(entry.key)),
        settings,
        worldbook_extraction_debug,
      );
      restoreUnconsumedRegexedWorldbookMarkers(flattened_chunks_before_worldbook, regexed_worldbook_intercepts, settings);
    }

    const flattened_chunks_after_worldbook = _.flatten(chunks);
    if (settings.entry_processing.mode === 'worldbook') {
      worldbook_extraction_debug.wrapper_before_unwrap = getWorldbookExtractionWrapperStats(
        flattened_chunks_after_worldbook,
        settings,
      );
    }
    unwrapRemainingWorldbookExtractionWrappers(flattened_chunks_after_worldbook, settings);
    cleanupChunks(chunks, settings);
    if (settings.entry_processing.mode === 'worldbook') {
      captureWorldbookDebugTotalRows(chunks, worldbook_extraction_debug, settings);
      printWorldbookDebugState(worldbook_extraction_debug);
      if (!isWorldbookDebugStateEmpty(worldbook_extraction_debug)) {
        publishSquashDebugRecord(getWorldbookDebugTitle(worldbook_extraction_debug), worldbook_extraction_debug);
      }
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
  };
  const handlePrompts2 = ({ messages }: { messages: SillyTavern.SendingMessage[] }) => {
    handlePrompts({ prompt: messages });
  };

  if (compare(getTavernVersion(), '1.13.4', '>')) {
    eventOn(tavern_events.GENERATE_AFTER_DATA, handlePrompts);
  } else {
    eventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, handlePrompts2);
  }

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
      eventRemoveListener(tavern_events.GENERATE_AFTER_DATA, handlePrompts);
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
  const { separators, uninject } = injectSeparators(settings);
  const { unlisten } = listenEvent(settings, separators, () => getPreferredScriptId() === getScriptId());
  return {
    destroy: () => {
      unregister();
      unlisten();
      uninject();
    },
  };
}
