import { vi } from 'vitest';
import { getNativeWorldbookHash } from './worldbook_scan';

export type TestEntry = { world: string } & SillyTavern.FlattenedWorldInfoEntry;
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function simulateDepthInjections(
  history: { role: 'system' | 'user' | 'assistant'; content: string }[],
  injections: Pick<InjectionPrompt, 'id' | 'depth' | 'role' | 'content'>[],
) {
  const reversed = [...history].reverse();
  const depths = [...new Set(injections.map(injection => injection.depth))].sort((a, b) => a - b);
  const ordered = [...injections].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let inserted = 0;
  for (const depth of depths) {
    const grouped = (['system', 'user', 'assistant'] as const).flatMap(role => {
      const content = ordered
        .filter(injection => injection.depth === depth && injection.role === role)
        .map(injection => injection.content.trim())
        .filter(Boolean)
        .join('\n');
      return content ? [{ role, content }] : [];
    });
    reversed.splice(depth + inserted, 0, ...grouped);
    inserted += grouped.length;
  }
  return reversed.reverse();
}

export function entry(uid: number, content: string, values: Partial<TestEntry> = {}): TestEntry {
  return {
    world: '设定',
    uid,
    comment: `条目${uid}`,
    content,
    constant: true,
    vectorized: false,
    position: 0,
    depth: 0,
    order: uid,
    ...values,
  } as TestEntry;
}

export function setupTavern() {
  const listeners = new Map<string, ((...args: any[]) => void)[]>();
  const injections = new Map<string, InjectionPrompt>();
  const data = {
    variables: {} as Record<string, any>,
    chat: [] as any[],
    chat_worldbook: '聊天书' as string | null,
    character: { avatar: 'test.png', data: { extensions: {} as Record<string, unknown> } },
    extension_settings: {} as Record<string, unknown>,
    chat_completion_settings: { continue_prefill: false },
    extension_prompts: {} as Record<
      string,
      { value: string; position: number; depth: number; role?: number; filter?: unknown }
    >,
  };
  const eventNames = [
    'GENERATION_AFTER_COMMANDS',
    'MESSAGE_SENT',
    'MESSAGE_DELETED',
    'GENERATION_ENDED',
    'GENERATION_STOPPED',
    'WORLDINFO_ENTRIES_LOADED',
    'WORLDINFO_SCAN_DONE',
    'WORLD_INFO_ACTIVATED',
    'GENERATE_AFTER_DATA',
    'CHAT_COMPLETION_SETTINGS_READY',
    'STREAM_TOKEN_RECEIVED',
    'MESSAGE_RECEIVED',
  ];
  vi.stubGlobal('tavern_events', Object.fromEntries(eventNames.map(name => [name, name])));
  const on = (name: string, callback: (...args: any[]) => void) => {
    listeners.set(name, [...(listeners.get(name) ?? []), callback]);
    return { stop: () => {} };
  };
  vi.stubGlobal('eventOn', on);
  vi.stubGlobal('eventMakeLast', on);
  vi.stubGlobal('eventMakeFirst', (name: string, callback: (...args: any[]) => void) => {
    listeners.set(name, [callback, ...(listeners.get(name) ?? [])]);
  });
  vi.stubGlobal('eventRemoveListener', (name: string, callback: (...args: any[]) => void) => {
    listeners.set(
      name,
      (listeners.get(name) ?? []).filter(value => value !== callback),
    );
  });
  vi.stubGlobal('getScriptId', () => 'squash-test');
  vi.stubGlobal('getTavernVersion', () => '1.14.0');
  vi.stubGlobal('getVariables', () => copy(data.variables));
  vi.stubGlobal(
    'replaceVariables',
    vi.fn((value: Record<string, any>) => {
      data.variables = copy(value);
    }),
  );
  vi.stubGlobal('getCharWorldbookNames', () => ({ primary: '设定', additional: ['补充'] }));
  vi.stubGlobal('getChatWorldbookName', () => data.chat_worldbook);
  vi.stubGlobal('getTavernRegexes', () => []);
  vi.stubGlobal('isCharacterTavernRegexesEnabled', () => false);
  vi.stubGlobal('formatAsTavernRegexedString', (value: string) => value);
  vi.stubGlobal('substitudeMacros', (value: string) => value);
  vi.stubGlobal('getLastMessageId', () => data.chat.length - 1);
  vi.stubGlobal('SillyTavern', {
    chat: data.chat,
    name2: '测试角色',
    getCurrentChatId: () => 'test-chat',
    characterId: 0,
    characters: [data.character],
    extensionSettings: data.extension_settings,
    mainApi: 'openai',
    chatCompletionSettings: data.chat_completion_settings,
    extensionPrompts: data.extension_prompts,
  });
  Object.assign(window, { STBaiBaiBook: undefined });
  vi.stubGlobal('injectPrompts', (prompts: InjectionPrompt[]) => prompts.forEach(p => injections.set(p.id, p)));
  vi.stubGlobal('uninjectPrompts', (ids: string[]) => ids.forEach(id => injections.delete(id)));
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
  vi.spyOn(console, 'table').mockImplementation(() => {});
  const emit = (name: string, ...args: any[]) => (listeners.get(name) ?? []).forEach(callback => callback(...args));
  const prompt = (content: string, role: 'system' | 'user' | 'assistant' = 'system') => ({ role, content });

  function scan(
    entries: TestEntry[],
    {
      activated = entries.map(e => e.uid),
      lores = {} as Record<string, TestEntry[]>,
      macros = (text: string) => text,
    } = {},
  ) {
    const loaded = { globalLore: [], characterLore: copy(entries), chatLore: [], personaLore: [], ...copy(lores) };
    emit('WORLDINFO_ENTRIES_LOADED', loaded);
    const sorted = Object.values(loaded)
      .flat()
      .map(e => ({ ...copy(e), hash: getNativeWorldbookHash(e) }));
    const active = sorted.filter(e => !e.disable && activated.includes(e.uid));
    active.forEach(e => (e.content = macros(e.content)));
    if (sorted.length)
      emit('WORLDINFO_SCAN_DONE', {
        state: { next: 0 },
        sortedEntries: sorted,
        activated: { entries: new Map(active.map(e => [`${e.world}.${e.uid}`, e])) },
      });
    const content = active
      .map(e => formatAsTavernRegexedString(e.content, 'world_info', 'prompt', { depth: e.depth }))
      .join('\n');
    return { loaded, sorted, active, content };
  }

  function generate(
    entries: TestEntry[],
    {
      activated = entries.map(e => e.uid),
      destinations = '{{压缩相邻消息::lora_constant}}|{{压缩相邻消息::lora_key}}',
      render = (text: string) => text,
      macros = (text: string) => text,
      template = (text: string) => text,
      beforeFinalize = () => {},
      replaceMessages = (messages: SillyTavern.SendingMessage[]) => messages,
      lores = {} as Record<string, TestEntry[]>,
      dryRun = false,
      type = 'normal',
      userMessage = undefined as string | undefined,
    } = {},
  ) {
    emit('GENERATION_AFTER_COMMANDS', type, {}, dryRun);
    if (!dryRun && type === 'regenerate' && data.chat.length && !data.chat.at(-1).is_user) {
      data.chat.pop();
      emit('MESSAGE_DELETED', data.chat.length);
    }
    if (!dryRun && userMessage !== undefined) {
      data.chat.push({ mes: userMessage, is_user: true });
      emit('MESSAGE_SENT', data.chat.length - 1);
    }
    const scanned = scan(entries, { activated, lores, macros });
    if (!dryRun && scanned.active.length) emit('WORLD_INFO_ACTIVATED', scanned.active);
    const core = data.chat
      .filter(message => !message.is_system)
      .map(message => prompt(message.mes, message.is_user ? 'user' : 'assistant'));
    if (type === 'swipe') core.pop();
    const continuation = type === 'continue' ? core.at(-1) : undefined;
    if (continuation && data.chat_completion_settings.continue_prefill) core.pop();
    const extensionInjections = Object.entries(data.extension_prompts)
      .filter(([, slot]) => slot.position === 1 && slot.value && typeof slot.filter !== 'function')
      .map(([id, slot]) => ({
        id,
        depth: slot.depth,
        role: (['system', 'user', 'assistant'] as const)[slot.role ?? 0],
        content: macros(slot.value),
      }));
    const chat = simulateDepthInjections(core, [...injections.values(), ...extensionInjections]);
    if (continuation) {
      const position = chat.indexOf(continuation);
      if (position >= 0) chat.splice(position, 1);
      chat.push(continuation);
    }
    const messages = [prompt(render(scanned.content)), ...chat, prompt(destinations)];
    emit('GENERATE_AFTER_DATA', { prompt: messages }, dryRun);
    if (!dryRun) {
      beforeFinalize();
      messages.forEach(message => (message.content = template(message.content)));
      const final_messages = replaceMessages(messages);
      emit('CHAT_COMPLETION_SETTINGS_READY', { messages: final_messages });
      emit('GENERATION_ENDED', data.chat.length - 1);
      return final_messages;
    }
    return messages;
  }
  return { data, generate, emit, injections, scan };
}
