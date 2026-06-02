import { assignInplace, chunkBy, getComplementString, regexFromString } from '@util/common';
import { registerAsUniqueScript } from '@util/script';
import { compare } from 'compare-versions';
import YAML from 'yaml';
import { Settings, WorldbookExtractionPositionOrder } from './store';

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

  const inject = () => {
    injectPrompts(Object.values(separators));
  };
  eventOn(tavern_events.GENERATION_AFTER_COMMANDS, inject);

  return {
    separators,
    uninject: () => {
      eventRemoveListener(tavern_events.GENERATION_AFTER_COMMANDS, inject);
      uninjectPrompts(Object.values(separators).map(({ id }) => id));
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

type ActivatedWorldbookEntry = {
  key: string;
  index: number;
  trigger_type: 'constant' | 'keyed';
  position: WorldbookExtractionPosition;
  depth: number;
  order: number;
  content: string;
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

function removeStableIdentityMacros(content: string): string {
  return content
    .replace(/<USER>/gi, '')
    .replace(/<BOT>/gi, '')
    .replace(/<CHAR>/gi, '')
    .replace(/\{\{\s*user\s*\}\}/gi, '')
    .replace(/\{\{\s*char\s*\}\}/gi, '');
}

function hasDynamicPromptMacro(content: string): boolean {
  const checked_content = removeStableIdentityMacros(content);
  return /\{\{[\s\S]*?\}\}/.test(checked_content) || /<%(?:[-_=#_%])?[\s\S]*?(?:[-_]?%>)/.test(checked_content);
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

function getWorldbookEntryContentCandidates(entry: ActivatedWorldbookEntry): string[] {
  const candidates = [entry.content];
  const macro_like_content = applyTavernHelperVariableMacros(entry.content);
  if (macro_like_content !== entry.content) {
    candidates.push(macro_like_content);
  }
  return candidates;
}

function parseActivatedWorldbookEntry(
  entry: { world: string } & SillyTavern.FlattenedWorldInfoEntry,
  index: number,
  has_source_macro: boolean,
): ActivatedWorldbookEntry | undefined {
  const content = trimEmptyLines(entry.content ?? '');
  if (!content) {
    return undefined;
  }

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
    index,
    trigger_type,
    position: FLATTENED_WORLDBOOK_POSITION[entry.position] ?? 'at_depth',
    depth: entry.depth ?? 0,
    order: entry.order ?? 0,
    content,
  };
}

function sortActivatedWorldbookEntries(
  entries: ActivatedWorldbookEntry[],
  settings: Settings,
): ActivatedWorldbookEntry[] {
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

    return lhs.index - rhs.index;
  });
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
    return { prompt, index: prompt_index, content: target };
  }
  return undefined;
}

function extractWorldbookEntriesToPlaceholders(
  chunks: SillyTavern.SendingMessage[][],
  activated_entries: ActivatedWorldbookEntry[],
  settings: Settings,
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

    const entries = sortActivatedWorldbookEntries(
      activated_entries.filter(entry => entry.trigger_type === trigger_type),
      settings,
    );
    const flattened_chunks = _.flatten(chunks);
    const consumed_entry_contents = new Map<string, string>();
    const entry_content_candidates = new Map(
      entries.map(entry => [entry.key, getWorldbookEntryContentCandidates(entry)] as const),
    );
    [...entries]
      .sort(
        (lhs, rhs) =>
          _.max(entry_content_candidates.get(rhs.key)!.map(content => content.length))! -
          _.max(entry_content_candidates.get(lhs.key)!.map(content => content.length))!,
      )
      .forEach(entry => {
        let consumed: ConsumedPromptContent | undefined;
        for (const content of entry_content_candidates.get(entry.key)!.sort((lhs, rhs) => rhs.length - lhs.length)) {
          consumed = consumePromptContent(flattened_chunks, content, settings);
          if (consumed) {
            break;
          }
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
  const raw_worldbook_entry_has_macro = new Map<string, boolean>();

  const resetActivatedWorldbookEntries = () => {
    activated_worldbook_entries.clear();
    raw_worldbook_entry_has_macro.clear();
  };
  eventOn(tavern_events.GENERATION_AFTER_COMMANDS, resetActivatedWorldbookEntries);

  const handleWorldInfoEntriesLoaded = (lores: WorldbookEntriesLoadedEvent) => {
    if (!shouldEnable() || settings.entry_processing.mode !== 'worldbook') {
      return;
    }

    raw_worldbook_entry_has_macro.clear();
    [lores.globalLore, lores.characterLore, lores.chatLore, lores.personaLore].flat().forEach(entry => {
      raw_worldbook_entry_has_macro.set(getWorldbookEntryKey(entry), hasDynamicPromptMacro(entry.content ?? ''));
    });
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
        raw_worldbook_entry_has_macro.get(key) ?? true,
      );
      if (!parsed_entry || activated_worldbook_entries.has(parsed_entry.key)) {
        return;
      }
      activated_worldbook_entries.set(parsed_entry.key, parsed_entry);
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
    if (settings.entry_processing.mode === 'worldbook') {
      extractWorldbookEntriesToPlaceholders(chunks, [...activated_worldbook_entries.values()], settings);
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
