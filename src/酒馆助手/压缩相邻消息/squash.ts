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
import { Settings, WorldbookExtractionPositionOrder } from './store';

const GREEN_CACHE_ANCHOR_PREFIX = '<<<TH_SQUASH_GREEN_CACHE_ANCHOR';
const GREEN_CACHE_ANCHOR_REGEX = /<<<TH_SQUASH_GREEN_CACHE_ANCHOR:([^>]+)>>>/g;

function getPromptContent(prompt: SillyTavern.SendingMessage, settings: Settings): string {
  if (typeof prompt.content === 'string') {
    return prompt.content;
  }
  return prompt.content
    .filter(({ type }) => type === 'text')
    .map(({ text }: any) => text)
    .join(settings.delimiter.value);
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

  const inject = () => {
    if (green_anchor_prompt_ids.length > 0) {
      uninjectPrompts(green_anchor_prompt_ids);
    }
    const green_anchor_prompts = getGreenCacheAnchorInjectionPrompts(settings);
    green_anchor_prompt_ids = green_anchor_prompts.map(prompt => prompt.id);
    injectPrompts([...Object.values(separators), ...green_anchor_prompts]);
  };
  eventOn(tavern_events.GENERATION_AFTER_COMMANDS, inject);

  return {
    separators,
    uninject: () => {
      eventRemoveListener(tavern_events.GENERATION_AFTER_COMMANDS, inject);
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
  return _(string)
    .split('\n')
    .dropWhile(line => !line.trim())
    .dropRightWhile(line => !line.trim())
    .join('\n');
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

type WorldbookSortedExtractionDebugItem = {
  sort_order: number;
  consume_order: number;
  placeholder: string;
  trigger_type: ActivatedWorldbookEntry['trigger_type'];
  key: string;
  part_index?: number;
  target_key?: string;
  target_name?: string;
  position: WorldbookExtractionPosition;
  depth: number;
  entry_order: number;
  activated_index: number;
  wrapper_id?: string;
  candidate_lengths: number[];
  candidate_has_dynamic_macro: boolean[];
};

type PromptContentDebugItem = {
  stage: string;
  chunk?: 'head' | 'above_chat_history' | 'below_chat_history' | 'tail';
  index: number;
  role: SillyTavern.SendingMessage['role'];
  name?: string;
  length: number;
  has_lora_constant_placeholder: boolean;
  has_lora_key_placeholder: boolean;
  wrapper_pairs: number;
  wrapper_orphans: number;
  content_lines: string[];
};

type WorldbookWrapperPresenceDebug = {
  paired: boolean;
  start_count: number;
  end_count: number;
  paired_count: number;
};

type WorldbookCandidateMatchDebugItem = {
  index: number;
  length: number;
  has_dynamic_macro: boolean;
  regex_available: boolean;
  exact_prompt_indexes: number[];
  regex_prompt_indexes: number[];
  normalized_prompt_indexes: number[];
  candidate_lines: string[];
};

type WorldbookExtractionFailureReason =
  | 'wrapper_missing_or_already_consumed'
  | 'wrapper_incomplete'
  | 'wrapper_present_but_not_consumed'
  | 'no_content_candidates'
  | 'no_candidate_match'
  | 'candidate_match_detected_but_not_consumed';

type GreenCacheInsertionSource =
  | 'custom_anchor'
  | 'before_chat_history'
  | 'before_chat_anchor';

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
    role: ChatMessage['role'];
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

const DYNAMIC_PROMPT_MACRO_REGEX = /\{\{[\s\S]*?\}\}|<%(?:[-_=#_%])?[\s\S]*?(?:[-_]?%>)/g;
const WORLDBOOK_EXTRACTION_WRAPPER_PREFIX = '<<<TH_SQUASH_WI';
const WORLDBOOK_EXTRACTION_WRAPPER_REGEX =
  /<<<TH_SQUASH_WI:([0-9a-z]+):START>>>([\s\S]*?)<<<TH_SQUASH_WI:\1:END>>>/g;
const ORPHAN_WORLDBOOK_EXTRACTION_WRAPPER_REGEX = /<<<TH_SQUASH_WI:[0-9a-z]+:(?:START|END)>>>/g;

type WorldbookExtractionDebugState = {
  loaded: {
    total: number;
    constant_with_getwi: number;
    dynamic: number;
    split: number;
    wrapped: number;
    split_wrapped_parts: number;
  };
  activated: {
    key: string;
    name: string;
    trigger_type: ActivatedWorldbookEntry['trigger_type'];
    has_source_macro: boolean;
    split_parts: number;
    wrapper_id?: string;
    part_wrapper_ids: string[];
    part_targets: string[];
  }[];
  extraction: {
    placeholder: string;
    trigger_type: ActivatedWorldbookEntry['trigger_type'];
    key: string;
    part_index?: number;
    target_key?: string;
    target_name?: string;
    wrapper_id?: string;
    wrapper_present_before_consume?: boolean;
    wrapper_presence_before_consume?: WorldbookWrapperPresenceDebug;
    candidate_count: number;
    candidate_regex_available_count: number;
    candidate_exact_match_count: number;
    candidate_regex_match_count: number;
    candidate_normalized_match_count: number;
    candidate_match_debug: WorldbookCandidateMatchDebugItem[];
    failure_reason?: WorldbookExtractionFailureReason;
    consumed: boolean;
    method?: ConsumedPromptContent['method'];
    content_length?: number;
  }[];
  sorted_extraction: WorldbookSortedExtractionDebugItem[];
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
    activated: [],
    extraction: [],
    sorted_extraction: [],
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
  state.activated.length = 0;
  state.extraction.length = 0;
  state.sorted_extraction.length = 0;
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
  return prompts.reduce(
    (stats, prompt) => {
      const content = getPromptContent(prompt, settings);
      const paired = [...content.matchAll(WORLDBOOK_EXTRACTION_WRAPPER_REGEX)].length;
      const content_without_pairs = content.replace(WORLDBOOK_EXTRACTION_WRAPPER_REGEX, '');
      const orphan = [...content_without_pairs.matchAll(ORPHAN_WORLDBOOK_EXTRACTION_WRAPPER_REGEX)].length;
      stats.paired += paired;
      stats.orphan += orphan;
      return stats;
    },
    { paired: 0, orphan: 0 },
  );
}

function printGreenCacheDebugState(state: GreenCacheDebugState) {
  if (
    !state.summary &&
    state.chat_messages.length === 0 &&
    state.cache_entries.length === 0 &&
    state.activations.length === 0 &&
    state.insertions.length === 0
  ) {
    return;
  }

  const title = `[压缩相邻消息] 绿灯缓存调试: 缓存 ${state.summary?.deduped_cache_total ?? 0}, 激活 ${state.summary?.aggressive_activated_total ?? 0}, 插入 ${state.summary?.inserted_entry_total ?? 0}`;
  if (typeof console.groupCollapsed === 'function') {
    console.groupCollapsed(title);
    if (state.summary) {
      console.info(state.summary);
    }
    if (state.chat_messages.length > 0) {
      console.table(state.chat_messages);
    }
    if (state.cache_entries.length > 0) {
      console.table(state.cache_entries);
    }
    if (state.activations.length > 0) {
      console.table(state.activations);
    }
    if (state.insertions.length > 0) {
      console.table(state.insertions);
    }
    console.dir({ green_cache: state }, { depth: null });
    console.groupEnd();
  } else {
    console.info(title, state);
  }
}

function printWorldbookExtractionDebugState(state: WorldbookExtractionDebugState) {
  if (state.total_activated === 0 && state.total_extraction === 0 && state.loaded.total === 0) {
    return;
  }

  const failed = state.total_extraction - state.total_consumed;
  const failed_extractions = state.extraction.filter(entry => !entry.consumed);
  const title = `[压缩相邻消息] 世界书提取调试: 激活 ${state.total_activated}, 尝试 ${state.total_extraction}, 成功 ${state.total_consumed}, 失败 ${failed}, 残留包裹 ${state.wrapper_before_unwrap.paired}/${state.wrapper_before_unwrap.orphan}`;
  const summary = {
    loaded: state.loaded,
    activated_total: state.total_activated,
    extraction_total: state.total_extraction,
    consumed_total: state.total_consumed,
    failed_total: failed,
    wrapper_before_unwrap: state.wrapper_before_unwrap,
    log_limit: 'unlimited',
  };

  if (typeof console.groupCollapsed === 'function') {
    console.groupCollapsed(title);
    console.info(summary);
    if (state.activated.length > 0) {
      console.table(state.activated);
    }
    if (state.extraction.length > 0) {
      console.table(state.extraction);
    }
    if (failed_extractions.length > 0) {
      console.table(failed_extractions);
      console.dir({ failed_extractions }, { depth: null });
    }
    printGreenCacheDebugState(state.green_cache);
    console.groupEnd();
  } else {
    console.info(title, {
      summary,
      activated: state.activated,
      extraction: state.extraction,
      failed_extractions,
      green_cache: state.green_cache,
    });
  }
}

function getPromptContentDebugItem(
  prompt: SillyTavern.SendingMessage,
  stage: string,
  index: number,
  settings: Settings,
  chunk?: PromptContentDebugItem['chunk'],
): PromptContentDebugItem {
  const content = getPromptContent(prompt, settings);
  const content_without_pairs = content.replace(WORLDBOOK_EXTRACTION_WRAPPER_REGEX, '');
  const { constant, keyed } = settings.entry_processing.worldbook;
  return {
    stage,
    chunk,
    index,
    role: prompt.role,
    name: _.get(prompt, 'name'),
    length: content.length,
    has_lora_constant_placeholder: content.includes(constant.placeholder),
    has_lora_key_placeholder: content.includes(keyed.placeholder),
    wrapper_pairs: [...content.matchAll(WORLDBOOK_EXTRACTION_WRAPPER_REGEX)].length,
    wrapper_orphans: [...content_without_pairs.matchAll(ORPHAN_WORLDBOOK_EXTRACTION_WRAPPER_REGEX)].length,
    content_lines: content.split('\n'),
  };
}

function getChunkPromptContentDebugItems(
  chunks: SillyTavern.SendingMessage[][],
  stage: string,
  settings: Settings,
): PromptContentDebugItem[] {
  const chunk_names: PromptContentDebugItem['chunk'][] = [
    'head',
    'above_chat_history',
    'below_chat_history',
    'tail',
  ];
  return chunks.flatMap((chunk, chunk_index) =>
    chunk.map((prompt, index) => getPromptContentDebugItem(prompt, stage, index, settings, chunk_names[chunk_index])),
  );
}

function getPromptContentDebugItems(
  prompts: SillyTavern.SendingMessage[],
  stage: string,
  settings: Settings,
): PromptContentDebugItem[] {
  return prompts.map((prompt, index) => getPromptContentDebugItem(prompt, stage, index, settings));
}

function printWorldbookSortedContentDebugState(
  state: WorldbookExtractionDebugState,
  prompt_stages: { stage: string; prompts: PromptContentDebugItem[] }[],
) {
  const prompts = prompt_stages.flatMap(({ prompts }) => prompts);
  if (state.sorted_extraction.length === 0 && prompts.length === 0) {
    return;
  }

  const title = `[压缩相邻消息] 世界书排序内容调试: 提取项 ${state.sorted_extraction.length}, prompt ${prompts.length}`;
  const prompt_summary = prompts.map(({ content_lines, ...summary }) => summary);

  if (typeof console.groupCollapsed === 'function') {
    console.groupCollapsed(title);
    if (state.sorted_extraction.length > 0) {
      console.table(state.sorted_extraction);
    }
    if (prompt_summary.length > 0) {
      console.table(prompt_summary);
    }
    console.dir(
      {
        sorted_extraction: state.sorted_extraction,
        prompt_stages,
      },
      { depth: null },
    );
    console.groupEnd();
  } else {
    console.info(title, {
      sorted_extraction: state.sorted_extraction,
      prompt_stages,
    });
  }
}

function getWorldbookExtractionWrapperStart(wrapper_id: string): string {
  return `${WORLDBOOK_EXTRACTION_WRAPPER_PREFIX}:${wrapper_id}:START>>>`;
}

function getWorldbookExtractionWrapperEnd(wrapper_id: string): string {
  return `${WORLDBOOK_EXTRACTION_WRAPPER_PREFIX}:${wrapper_id}:END>>>`;
}

function wrapWorldbookExtractionContent(wrapper_id: string, content: string): string {
  return `${getWorldbookExtractionWrapperStart(wrapper_id)}${content}${getWorldbookExtractionWrapperEnd(wrapper_id)}`;
}

function unwrapWorldbookExtractionWrapperText(content: string): string {
  return content
    .replace(WORLDBOOK_EXTRACTION_WRAPPER_REGEX, (_match, _wrapper_id: string, inner_content: string) => inner_content)
    .replace(ORPHAN_WORLDBOOK_EXTRACTION_WRAPPER_REGEX, '');
}

function getDynamicPromptMacroContentRegex(content: string): RegExp | undefined {
  const macro_matches = [...content.matchAll(DYNAMIC_PROMPT_MACRO_REGEX)];
  if (macro_matches.length === 0) {
    return undefined;
  }

  let static_character_count = 0;
  let last_index = 0;
  let pattern = '';
  for (const match of macro_matches) {
    const index = match.index ?? 0;
    const static_content = content.slice(last_index, index);
    static_character_count += static_content.replace(/\s/g, '').length;
    pattern += _.escapeRegExp(static_content) + String.raw`[\s\S]*?`;
    last_index = index + match[0].length;
  }

  const trailing_static_content = content.slice(last_index);
  static_character_count += trailing_static_content.replace(/\s/g, '').length;
  pattern += _.escapeRegExp(trailing_static_content);

  if (static_character_count < 12) {
    return undefined;
  }
  return new RegExp(pattern);
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
) {
  const content = unwrapWorldbookExtractionWrapperText(source_entry.content);
  if (!metadata.is_constant) {
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

function hasPlaceholder(prompts: SillyTavern.SendingMessage[], placeholder: string, settings: Settings): boolean {
  return prompts.some(prompt => getPromptContent(prompt, settings).includes(placeholder));
}

function replacePlaceholder(
  prompts: SillyTavern.SendingMessage[],
  placeholder: string,
  replacement: string,
  settings: Settings,
) {
  prompts
    .filter(prompt => getPromptContent(prompt, settings).includes(placeholder))
    .forEach(prompt => {
      updatePromptContentWith(prompt, ({ content }) => content.replaceAll(placeholder, replacement), settings);
    });
}

type ConsumedPromptContent = {
  prompt: SillyTavern.SendingMessage;
  index: number;
  content: string;
  method: 'exact' | 'regex' | 'wrapper' | 'normalized';
};

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
  for (const [prompt_index, prompt] of prompts.entries()) {
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

function consumePromptContentByRegex(
  prompts: SillyTavern.SendingMessage[],
  target_regex: RegExp,
  settings: Settings,
): ConsumedPromptContent | undefined {
  for (const [prompt_index, prompt] of prompts.entries()) {
    const content = getPromptContent(prompt, settings);
    const match = content.match(target_regex);
    if (!match || match.index === undefined || match[0] === '') {
      continue;
    }

    updatePromptContentWith(
      prompt,
      ({ content }) => content.slice(0, match.index!) + content.slice(match.index! + match[0].length),
      settings,
    );
    return { prompt, index: prompt_index, content: match[0], method: 'regex' };
  }
  return undefined;
}

function getNonWhitespaceContentIndex(content: string): { normalized: string; indexes: number[] } {
  let normalized = '';
  const indexes: number[] = [];
  for (let index = 0; index < content.length; index++) {
    if (!/\s/.test(content[index])) {
      normalized += content[index];
      indexes.push(index);
    }
  }
  return { normalized, indexes };
}

function findPromptContentByNormalizedWhitespace(content: string, target: string): { start: number; end: number } | undefined {
  const normalized_target = target.replace(/\s/g, '');
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
  while (start > 0 && /[ \t]/.test(content[start - 1])) {
    start--;
  }
  while (end < content.length && /[ \t]/.test(content[end])) {
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
): ConsumedPromptContent | undefined {
  const wrapper_start = getWorldbookExtractionWrapperStart(wrapper_id);
  const wrapper_end = getWorldbookExtractionWrapperEnd(wrapper_id);

  for (const [prompt_index, prompt] of prompts.entries()) {
    const content = getPromptContent(prompt, settings);
    const start_index = content.indexOf(wrapper_start);
    if (start_index === -1) {
      continue;
    }

    const inner_start_index = start_index + wrapper_start.length;
    const end_index = content.indexOf(wrapper_end, inner_start_index);
    if (end_index === -1) {
      continue;
    }

    const inner_content = content.slice(inner_start_index, end_index);
    updatePromptContentWith(
      prompt,
      ({ content }) => content.slice(0, start_index) + content.slice(end_index + wrapper_end.length),
      settings,
    );
    return { prompt, index: prompt_index, content: inner_content, method: 'wrapper' };
  }
  return undefined;
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
  const paired_regex = new RegExp(`${_.escapeRegExp(wrapper_start)}[\\s\\S]*?${_.escapeRegExp(wrapper_end)}`, 'g');

  return prompts.reduce(
    (presence, prompt) => {
      const content = getPromptContent(prompt, settings);
      presence.start_count += countStringOccurrences(content, wrapper_start);
      presence.end_count += countStringOccurrences(content, wrapper_end);
      presence.paired_count += [...content.matchAll(paired_regex)].length;
      presence.paired ||= presence.paired_count > 0;
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

function hasWrappedPromptContent(
  prompts: SillyTavern.SendingMessage[],
  wrapper_id: string,
  settings: Settings,
): boolean {
  return getWorldbookWrapperPresence(prompts, wrapper_id, settings).paired;
}

function getWorldbookCandidateMatchDebug(
  prompts: SillyTavern.SendingMessage[],
  candidates: string[],
  settings: Settings,
): WorldbookCandidateMatchDebugItem[] {
  return candidates.map((candidate, index) => {
    const target_regex = getDynamicPromptMacroContentRegex(candidate);
    const exact_prompt_indexes: number[] = [];
    const regex_prompt_indexes: number[] = [];
    const normalized_prompt_indexes: number[] = [];

    prompts.forEach((prompt, prompt_index) => {
      const content = getPromptContent(prompt, settings);
      if (content.includes(candidate)) {
        exact_prompt_indexes.push(prompt_index);
      }
      if (target_regex && content.match(target_regex)) {
        regex_prompt_indexes.push(prompt_index);
      }
      if (findPromptContentByNormalizedWhitespace(content, candidate)) {
        normalized_prompt_indexes.push(prompt_index);
      }
    });

    return {
      index,
      length: candidate.length,
      has_dynamic_macro: hasDynamicPromptMacroOrGetwi(candidate),
      regex_available: !!target_regex,
      exact_prompt_indexes,
      regex_prompt_indexes,
      normalized_prompt_indexes,
      candidate_lines: candidate.split('\n'),
    };
  });
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

  const target_regex = getDynamicPromptMacroContentRegex(target);
  const regex_consumed = target_regex ? consumePromptContentByRegex(prompts, target_regex, settings) : undefined;
  return regex_consumed ?? consumePromptContentByNormalizedWhitespace(prompts, target, settings);
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

function isAggressiveGreenEntry(entry: ActivatedWorldbookEntry): boolean {
  return entry.is_selective && !entry.has_source_macro;
}

function normalizeContentForMatch(content: string): string {
  return trimEmptyLines(content).replace(/\r\n?/g, '\n');
}

function readChatMessagesByHideState(hide_state: 'all' | 'hidden' | 'unhidden'): ChatMessage[] {
  try {
    return getChatMessages('0-{{lastMessageId}}', { hide_state });
  } catch {
    return [];
  }
}

function readUnhiddenChatMessages(): ChatMessage[] {
  return readChatMessagesByHideState('unhidden');
}

function readAllChatMessages(): ChatMessage[] {
  return readChatMessagesByHideState('all');
}

function getChatMessageAnchorKey(message: ChatMessage): string {
  return getAnchorKey({
    message_id: message.message_id,
    swipe_id: _.get(message, 'swipe_id') ?? 0,
    message_hash: null,
  });
}

function getLatestUnhiddenChatAnchor(): GreenCacheAnchor {
  const messages = readUnhiddenChatMessages();
  const latest = _.last(messages);
  if (!latest) {
    return { ...BEFORE_CHAT_GREEN_CACHE_ANCHOR };
  }
  return {
    message_id: latest.message_id,
    swipe_id: _.get(latest, 'swipe_id') ?? 0,
    message_hash: hashGreenCacheContent(normalizeContentForMatch(latest.message)),
  };
}

function getGreenCacheAnchorDepth(anchor: GreenCacheAnchor): number | undefined {
  if (anchor.message_id === null || !cacheAnchorExists(anchor)) {
    return undefined;
  }
  return Math.max(0, getLastMessageId() - anchor.message_id);
}

function getGreenCacheAnchorContent(anchor_key: string): string {
  return `${GREEN_CACHE_ANCHOR_PREFIX}:${anchor_key}>>>`;
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
  if (latest_anchor.message_id !== null && cacheAnchorExists(latest_anchor)) {
    anchors.set(getAnchorKey(latest_anchor), latest_anchor);
  }

  return [...anchors.entries()]
    .map(([anchor_key, anchor]) => {
      const depth = getGreenCacheAnchorDepth(anchor);
      if (depth === undefined) {
        return undefined;
      }
      return {
        id: getGreenCacheAnchorPromptId(anchor_key),
        position: 'in_chat',
        depth,
        role: 'system',
        content: getGreenCacheAnchorContent(anchor_key),
        should_scan: false,
      } satisfies InjectionPrompt;
    })
    .filter((prompt): prompt is InjectionPrompt => Boolean(prompt));
}

function cacheAnchorExists(anchor: GreenCacheAnchor): boolean {
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

  if (anchor.message_hash === null) {
    return true;
  }
  return (
    typeof message_content === 'string' &&
    hashGreenCacheContent(normalizeContentForMatch(message_content)) === anchor.message_hash
  );
}

function buildGreenCacheInsertionLocationMap(
  chunks: SillyTavern.SendingMessage[][],
  settings: Settings,
  debug_state?: GreenCacheDebugState,
): Map<string, PromptInsertionLocation> {
  const insertion_locations = new Map<string, PromptInsertionLocation>();
  const all_messages = readAllChatMessages();
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
      const swipe_id = _.get(message, 'swipe_id') ?? 0;
      pushDebugLogItem(debug_state.chat_messages, {
        order,
        anchor_key,
        message_id: message.message_id,
        swipe_id,
        role: message.role,
        is_hidden: message.is_hidden,
        message_hash: hashGreenCacheContent(normalizeContentForMatch(message.message)),
        message_length: message.message.length,
        anchor_depth: getGreenCacheAnchorDepth({
          message_id: message.message_id,
          swipe_id,
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
): ConsumedPromptContent | undefined {
  if (entry.wrapper_id) {
    const consumed = consumeWrappedPromptContent(prompts, entry.wrapper_id, settings);
    if (consumed) {
      return consumed;
    }
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
  debug_state?: GreenCacheDebugState,
) {
  const grouped_entries = _(entries)
    .sortBy(entry => entry.created_at)
    .groupBy(entry => getAnchorKey(entry.fixed_at))
    .value();

  const before_chat_entries = grouped_entries[getAnchorKey(BEFORE_CHAT_GREEN_CACHE_ANCHOR)];
  if (before_chat_entries?.length) {
    if (debug_state) {
      pushDebugLogItem(debug_state.insertions, {
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
    chunks[1].unshift({
      role: 'system',
      content: before_chat_entries.map(entry => entry.content_snapshot).join(settings.delimiter.value),
    });
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
    if (debug_state) {
      pushDebugLogItem(debug_state.insertions, {
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
    chunks[chunk_index].splice(insert_index, 0, {
      role: 'system',
      content: entries.map(entry => entry.content_snapshot).join(settings.delimiter.value),
    });
  });
}

function processAggressiveGreenCache(
  chunks: SillyTavern.SendingMessage[][],
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
  const flattened_chunks = _.flatten(chunks);
  const new_cache_entries: GreenCacheEntry[] = [];
  const suppressed_cache_identities = new Set<string>();
  const aggressive_entries = sortActivatedWorldbookEntries(
    activated_entries.filter(entry => isAggressiveGreenEntry(entry)),
    settings,
  );

  aggressive_entries.forEach(entry => {
    const identity = getGreenCacheIdentity(entry);
    const cached_entry = fixed_cache_identities.get(identity);
    if (cached_entry) {
      const cached_anchor_key = getAnchorKey(cached_entry.fixed_at);
      const cached_location = insertion_locations.get(cached_anchor_key);
      const cached_can_insert = canInsertGreenCacheAnchor(cached_entry.fixed_at, insertion_locations);
      if (!cached_can_insert) {
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
      const consumed = consumeWorldbookEntryContent(flattened_chunks, entry, settings);
      handled_entry_keys.add(entry.key);
      if (!consumed) {
        suppressed_cache_identities.add(identity);
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

    const consumed = consumeWorldbookEntryContent(flattened_chunks, entry, settings);
    if (!consumed) {
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
  insertGreenCacheEntries(chunks, entries_to_insert, insertion_locations, settings, green_cache_debug);
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
  trigger_type: ActivatedWorldbookEntry['trigger_type'];
  content_candidates: string[];
  wrapper_id?: string;
  target_key?: string;
  target_name?: string;
};

function getWorldbookExtractionItems(entry: ActivatedWorldbookEntry): WorldbookExtractionItem[] {
  if (entry.split_getwi_parts.length > 0) {
    return entry.split_getwi_parts.map((part, part_index) => ({
      key: `${entry.key}.getwi.${part_index}`,
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
      trigger_type: entry.trigger_type,
      position: entry.position,
      depth: entry.depth,
      order: entry.order,
      index: entry.index,
      content_candidates: getWorldbookEntryContentCandidates(entry),
      wrapper_id: entry.wrapper_id,
      target_key: entry.key,
      target_name: entry.name,
    },
  ];
}

function consumeWorldbookExtractionItem(
  prompts: SillyTavern.SendingMessage[],
  entry: WorldbookExtractionItem,
  settings: Settings,
): ConsumedPromptContent | undefined {
  if (entry.wrapper_id) {
    const consumed = consumeWrappedPromptContent(prompts, entry.wrapper_id, settings);
    if (consumed) {
      return consumed;
    }
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
  candidate_match_debug: WorldbookCandidateMatchDebugItem[],
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

  if (
    candidate_match_debug.some(
      candidate =>
        candidate.exact_prompt_indexes.length ||
        candidate.regex_prompt_indexes.length ||
        candidate.normalized_prompt_indexes.length,
    )
  ) {
    return 'candidate_match_detected_but_not_consumed';
  }

  return 'no_candidate_match';
}

function extractWorldbookEntriesToPlaceholders(
  chunks: SillyTavern.SendingMessage[][],
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

    if (!hasPlaceholder(_.flatten(chunks), placeholder, settings)) {
      return;
    }

    const entries = sortWorldbookExtractionItems(
      sortActivatedWorldbookEntries(activated_entries, settings)
        .flatMap(getWorldbookExtractionItems)
        .filter(entry => entry.trigger_type === trigger_type),
      settings,
    );
    const flattened_chunks = _.flatten(chunks);
    const consumed_entry_contents = new Map<string, string>();
    const consuming_entries = [...entries].sort(
      (lhs, rhs) =>
        _.max(rhs.content_candidates.map(content => content.length))! -
        _.max(lhs.content_candidates.map(content => content.length))!,
    );
    if (debug_state) {
      const consuming_order = new Map(consuming_entries.map((entry, index) => [entry, index]));
      entries.forEach((entry, index) => {
        pushDebugLogItem(debug_state.sorted_extraction, {
          sort_order: index,
          consume_order: consuming_order.get(entry)!,
          placeholder,
          trigger_type,
          key: entry.key,
          part_index: entry.part_index,
          target_key: entry.target_key,
          target_name: entry.target_name,
          position: entry.position,
          depth: entry.depth,
          entry_order: entry.order,
          activated_index: entry.index,
          wrapper_id: entry.wrapper_id,
          candidate_lengths: entry.content_candidates.map(content => content.length),
          candidate_has_dynamic_macro: entry.content_candidates.map(content => hasDynamicPromptMacroOrGetwi(content)),
        });
      });
    }
    consuming_entries.forEach(entry => {
      const wrapper_presence_before_consume = entry.wrapper_id
        ? getWorldbookWrapperPresence(flattened_chunks, entry.wrapper_id, settings)
        : undefined;
      const candidate_match_debug = getWorldbookCandidateMatchDebug(
        flattened_chunks,
        entry.content_candidates,
        settings,
      );
      const consumed = consumeWorldbookExtractionItem(flattened_chunks, entry, settings);
      if (debug_state) {
        debug_state.total_extraction++;
        if (consumed) {
          debug_state.total_consumed++;
        }
        pushDebugLogItem(debug_state.extraction, {
          placeholder,
          trigger_type,
          key: entry.key,
          part_index: entry.part_index,
          target_key: entry.target_key,
          target_name: entry.target_name,
          wrapper_id: entry.wrapper_id,
          wrapper_present_before_consume: wrapper_presence_before_consume?.paired,
          wrapper_presence_before_consume,
          candidate_count: entry.content_candidates.length,
          candidate_regex_available_count: candidate_match_debug.filter(candidate => candidate.regex_available).length,
          candidate_exact_match_count: candidate_match_debug.filter(
            candidate => candidate.exact_prompt_indexes.length > 0,
          ).length,
          candidate_regex_match_count: candidate_match_debug.filter(
            candidate => candidate.regex_prompt_indexes.length > 0,
          ).length,
          candidate_normalized_match_count: candidate_match_debug.filter(
            candidate => candidate.normalized_prompt_indexes.length > 0,
          ).length,
          candidate_match_debug: consumed ? [] : candidate_match_debug,
          failure_reason: getWorldbookExtractionFailureReason(
            entry,
            consumed,
            wrapper_presence_before_consume,
            candidate_match_debug,
          ),
          consumed: !!consumed,
          method: consumed?.method,
          content_length: consumed?.content.length,
        });
      }
      if (consumed) {
        if (['before_example_messages', 'after_example_messages'].includes(entry.position)) {
          cleanupDialogueExampleSeparatorAfterConsumption(flattened_chunks, consumed, settings);
        }
        consumed_entry_contents.set(entry.key, consumed.content);
      }
    });

    const placeholder_content = entries
      .filter(entry => consumed_entry_contents.has(entry.key))
      .map(entry => consumed_entry_contents.get(entry.key)!)
      .join(settings.delimiter.value);
    replacePlaceholder(_.flatten(chunks), placeholder, placeholder_content, settings);
  };

  applyExtraction(constant.enabled, constant.placeholder, 'constant');
  applyExtraction(keyed.enabled, keyed.placeholder, 'keyed');
}

function listenEvent(settings: Settings, separators: Separators, shouldEnable: () => boolean) {
  const activated_worldbook_entries = new Map<string, ActivatedWorldbookEntry>();
  const worldbook_entry_metadata = new Map<string, WorldbookEntryMetadata>();
  const loaded_worldbook_names = new Set<string>();
  const worldbook_extraction_debug = createWorldbookExtractionDebugState();
  let worldbook_extraction_wrapper_counter = 0;

  const nextWorldbookExtractionWrapperId = () => (worldbook_extraction_wrapper_counter++).toString(36);

  const resetActivatedWorldbookEntries = () => {
    activated_worldbook_entries.clear();
    worldbook_entry_metadata.clear();
    loaded_worldbook_names.clear();
    resetWorldbookExtractionDebugState(worldbook_extraction_debug);
    worldbook_extraction_wrapper_counter = 0;
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

  const handleWorldInfoActivated = (entries: ({ world: string } & SillyTavern.FlattenedWorldInfoEntry)[]) => {
    if (!shouldEnable() || settings.entry_processing.mode !== 'worldbook') {
      return;
    }

    const start_index = activated_worldbook_entries.size;
    entries.forEach((entry, index) => {
      const key = getWorldbookEntryKey(entry);
      const parsed_entry = parseActivatedWorldbookEntry(
        entry,
        start_index + index,
        worldbook_entry_metadata.get(key),
      );
      if (!parsed_entry || activated_worldbook_entries.has(parsed_entry.key)) {
        return;
      }
      wrapActivatedWorldbookEntrySourceContent(entry, parsed_entry, nextWorldbookExtractionWrapperId);
      activated_worldbook_entries.set(parsed_entry.key, parsed_entry);
      worldbook_extraction_debug.total_activated++;
      pushDebugLogItem(worldbook_extraction_debug.activated, {
        key: parsed_entry.key,
        name: parsed_entry.name,
        trigger_type: parsed_entry.trigger_type,
        has_source_macro: parsed_entry.has_source_macro,
        split_parts: parsed_entry.split_getwi_parts.length,
        wrapper_id: parsed_entry.wrapper_id,
        part_wrapper_ids: parsed_entry.split_getwi_parts
          .map(part => part.wrapper_id)
          .filter((wrapper_id): wrapper_id is string => !!wrapper_id),
        part_targets: parsed_entry.split_getwi_parts.map(part => part.target_name ?? part.target_key ?? part.source ?? ''),
      });
    });
  };
  eventOn(tavern_events.WORLD_INFO_ACTIVATED, handleWorldInfoActivated);

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
    let worldbook_prompt_debug_before_extraction: PromptContentDebugItem[] = [];
    let worldbook_prompt_debug_after_extraction: PromptContentDebugItem[] = [];
    if (settings.entry_processing.mode === 'worldbook') {
      worldbook_prompt_debug_before_extraction = getChunkPromptContentDebugItems(chunks, 'before_worldbook', settings);
      const activated_entries = [...activated_worldbook_entries.values()];
      const handled_entry_keys = processAggressiveGreenCache(
        chunks,
        activated_entries,
        settings,
        worldbook_entry_metadata,
        loaded_worldbook_names,
        worldbook_extraction_debug,
      );
      extractWorldbookEntriesToPlaceholders(
        chunks,
        activated_entries.filter(entry => !handled_entry_keys.has(entry.key)),
        settings,
        worldbook_extraction_debug,
      );
      worldbook_prompt_debug_after_extraction = getChunkPromptContentDebugItems(chunks, 'after_worldbook', settings);
    }

    if (settings.entry_processing.mode === 'worldbook') {
      worldbook_extraction_debug.wrapper_before_unwrap = getWorldbookExtractionWrapperStats(_.flatten(chunks), settings);
    }
    unwrapRemainingWorldbookExtractionWrappers(_.flatten(chunks), settings);
    if (settings.entry_processing.mode === 'worldbook') {
      printWorldbookExtractionDebugState(worldbook_extraction_debug);
    }
    cleanupChunks(chunks, settings);

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

    if (settings.entry_processing.mode === 'worldbook') {
      printWorldbookSortedContentDebugState(worldbook_extraction_debug, [
        { stage: 'before_worldbook', prompts: worldbook_prompt_debug_before_extraction },
        { stage: 'after_worldbook', prompts: worldbook_prompt_debug_after_extraction },
        { stage: 'final_result', prompts: getPromptContentDebugItems(result, 'final_result', settings) },
      ]);
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
