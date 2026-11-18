import {
  answerTokens,
  parseRpgMessage,
  settleAnswers,
  STATE_KEY,
  upsertDraft,
  type DreamRpgApi,
  type RollCache,
  type RpgRegistry,
  type RpgTheme,
} from './protocol';
import { useRpgStore } from './settings';

interface FloorState {
  version: 1;
  kind: 'options' | 'answers';
  registry?: RpgRegistry;
  rolls: RollCache;
  records?: Array<ReturnType<typeof settleAnswers>['records'][number] & { source_message_id?: number }>;
}

export function createRpgRuntime(store: ReturnType<typeof useRpgStore>, openSettings: () => void) {
  const processing = new Set<number>();
  const listeners: EventOnReturn[] = [];
  const draftSources = new Map<string, number>();
  let alive = true;
  const active = () => alive && store.settings.enabled;
  const readState = (id: number): FloorState | undefined => {
    const state = getVariables({ type: 'message', message_id: id })[STATE_KEY];
    return state?.version === 1 && typeof state.rolls === 'object' && state.rolls !== null ? state : undefined;
  };
  const writeState = (id: number, state: FloorState) => {
    const scope = { type: 'message' as const, message_id: id };
    if (JSON.stringify(getVariables(scope)[STATE_KEY]) !== JSON.stringify(state)) {
      replaceVariables({ ...getVariables(scope), [STATE_KEY]: state }, scope);
    }
  };
  const syncOptions = (message: ChatMessage): FloorState => {
    const old = readState(message.message_id);
    const source = [...message.message.matchAll(/<dream_rpg\b[^>]*>([\s\S]*?)<\/dream_rpg\s*>/gi)]
      .map(match => match[1])
      .join('\n');
    if (old?.kind === 'options' && old.registry?.source === source) return old;
    const state: FloorState = {
      version: 1,
      kind: 'options',
      registry: parseRpgMessage(message.message),
      rolls: old?.rolls ?? {},
    };
    if (source || old) writeState(message.message_id, state);
    return state;
  };
  const sourceBefore = (id: number) =>
    id <= 0
      ? undefined
      : getChatMessages(`0-${id - 1}`, { role: 'assistant' }).findLast(message =>
          /<dream_rpg\b/i.test(message.message),
        );
  const theme = (): RpgTheme => {
    if (store.settings.theme !== 'auto') return store.settings.theme;
    const parent = window.parent;
    const color = parent.getComputedStyle(parent.document.documentElement).getPropertyValue('--SmartThemeBodyColor');
    const channels = color
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    if (channels?.length === 3)
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 145 ? 'dark' : 'light';
    return parent.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  const input = () => {
    const target = window.parent.document.querySelector<HTMLTextAreaElement>('#send_textarea');
    if (!target) throw new Error('未找到酒馆消息输入框。');
    return target;
  };
  const api: DreamRpgApi = {
    version: 1,
    get active() {
      return active();
    },
    snapshot(id) {
      id = Number(id);
      const message = getChatMessages(id)[0];
      if (!message || message.role !== 'assistant') throw new Error('当前楼层没有 RPG 选项。');
      const selected: Record<string, string> = Object.create(null);
      const target = window.parent.document.querySelector<HTMLTextAreaElement>('#send_textarea');
      for (const token of answerTokens(target?.value ?? '')) {
        const source = draftSources.get(token.attributes.id);
        if (token.attributes.id && (source === undefined || source === id)) selected[token.attributes.id] = token.text;
      }
      return {
        registry: syncOptions(message).registry!,
        theme: theme(),
        interactive: active(),
        selected,
        settings: {
          enabled: store.settings.enabled,
          reuse_rolls: store.settings.reuse_rolls,
          preview_results: store.settings.preview_results,
          allow_secret_reveal: store.settings.allow_secret_reveal,
          theme: store.settings.theme,
        },
      };
    },
    choose(id, entryId, select, text) {
      id = Number(id);
      if (!active()) throw new Error('梦境RPG脚本尚未启用。');
      const entry = api.snapshot(id).registry.entries.find(item => item.id === entryId && !item.error);
      if (!entry) throw new Error('当前行动已更新，请重新选择。');
      const option = entry.options[select ?? 0];
      const value = select === -1 ? text?.trim() : option?.error ? undefined : option?.text;
      if (!value) throw new Error('请填写有效的行动内容。');
      const target = input();
      target.value = upsertDraft(target.value, entryId, entry.kind === 'inline' ? undefined : select, value);
      draftSources.set(entryId, id);
      target.focus();
      target.setSelectionRange(target.value.length, target.value.length);
      const EventClass = target.ownerDocument.defaultView!.Event;
      target.dispatchEvent(new EventClass('input', { bubbles: true }));
      target.dispatchEvent(new EventClass('change', { bubbles: true }));
    },
    openSettings,
    updateSettings(settings) {
      if (!alive) throw new Error('梦境RPG脚本尚未就绪。');
      store.updateSettings(settings);
    },
  };
  const settle = async (id: number): Promise<void> => {
    if (!active() || processing.has(id)) return;
    const message = getChatMessages(id)[0];
    if (!message) return;
    if (message.role === 'assistant') {
      syncOptions(message);
      return;
    }
    if (message.role !== 'user' || !/<rpg_ans\b/i.test(message.message)) return;
    processing.add(id);
    try {
      const old = readState(id);
      const rolls = { ...old?.rolls };
      const records: NonNullable<FloorState['records']> = [];
      const sources = new Map<number, FloorState>();
      let output = '';
      let offset = 0;
      for (const token of answerTokens(message.message)) {
        const previous =
          old?.records?.find(record => record.q === token.attributes.q && record.text === token.text) ??
          old?.records?.find(record => record.q === token.attributes.q);
        const bound = token.attributes.id ? draftSources.get(token.attributes.id) : previous?.source_message_id;
        const candidate = bound !== undefined && bound < id ? getChatMessages(bound)[0] : undefined;
        const source =
          candidate?.role === 'assistant' && /<dream_rpg\b/i.test(candidate.message) ? candidate : sourceBefore(id);
        const options = source ? (sources.get(source.message_id) ?? syncOptions(source)) : undefined;
        const prefix = `${source?.message_id ?? 'manual'}:`;
        const saved = Object.fromEntries(
          Object.entries(rolls)
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => [key.slice(prefix.length), value]),
        );
        const result = settleAnswers(
          token.raw,
          options?.registry,
          { ...options?.rolls, ...saved },
          store.settings.reuse_rolls,
        );
        for (const [key, value] of Object.entries(result.rolls)) rolls[prefix + key] = value;
        records.push(
          ...result.records.map(record => ({ ...record, ...(source && { source_message_id: source.message_id }) })),
        );
        if (source && options) sources.set(source.message_id, { ...options, rolls: result.rolls });
        output += message.message.slice(offset, token.start) + result.message;
        offset = token.start + token.raw.length;
      }
      output += message.message.slice(offset);
      writeState(id, { version: 1, kind: 'answers', rolls, records });
      for (const [sourceId, state] of sources) writeState(sourceId, state);
      if (output !== message.message) {
        await setChatMessages([{ message_id: id, message: output }], { refresh: 'affected' });
      }
      store.error = '';
    } finally {
      processing.delete(id);
    }
  };
  const safely = async (id: number) => {
    try {
      await settle(id);
    } catch (error) {
      store.error = error instanceof Error ? error.message : String(error);
      console.warn('[梦境RPG]', error);
      toastr.error(store.error, '梦境RPG');
    }
  };
  for (const event of [
    tavern_events.MESSAGE_SENT,
    tavern_events.MESSAGE_EDITED,
    tavern_events.MESSAGE_UPDATED,
    tavern_events.MESSAGE_RECEIVED,
    tavern_events.MESSAGE_SWIPED,
    tavern_events.USER_MESSAGE_RENDERED,
    tavern_events.CHARACTER_MESSAGE_RENDERED,
  ]) {
    listeners.push(eventMakeFirst(event, safely));
  }
  listeners.push(
    eventMakeFirst(tavern_events.GENERATION_AFTER_COMMANDS, async (_type, _options, dryRun) => {
      if (!dryRun) await safely(getLastMessageId());
    }),
  );
  // 最后的提示词事件兼容先构造消息副本、后触发楼层回调的发送路径。
  listeners.push(
    eventMakeFirst(tavern_events.CHAT_COMPLETION_PROMPT_READY, async ({ chat, dryRun }) => {
      if (!active() || dryRun) return;
      const user = getChatMessages(-1)[0];
      if (user?.role !== 'user' || !/<rpg_ans\b/i.test(user.message)) return;
      const before = user.message;
      await safely(user.message_id);
      const after = getChatMessages(user.message_id)[0]?.message;
      if (!after || before === after) return;
      for (const sending of chat) {
        if (sending.role !== 'user') continue;
        if (typeof sending.content === 'string') sending.content = sending.content.replace(before, () => after);
        else
          sending.content?.forEach(part => {
            if (part.type === 'text') part.text = part.text.replace(before, () => after);
          });
      }
    }),
  );
  const refresh = () => {
    if (!active()) return;
    getChatMessages('0-{{lastMessageId}}', { role: 'assistant' }).forEach(syncOptions);
  };
  listeners.push(
    eventOn(tavern_events.CHAT_CHANGED, () => {
      draftSources.clear();
      refresh();
    }),
  );
  refresh();
  return {
    api,
    refresh,
    theme,
    destroy() {
      alive = false;
      listeners.forEach(listener => listener.stop());
    },
  };
}
