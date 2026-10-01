import { applyPatches, reversePatches, reportRanges, type PatchRecord } from './patch';
import { appendResults, buildTask, combinePrompts, extractOutput } from './prompts';
import { getMvuStatus, updateMvu } from './mvu';
import { SCRIPT_NAME, SettingsSchema, STATE_KEY, useRepairStore } from './settings';

type Store = ReturnType<typeof useRepairStore>;
type RepairState = {
  version: 2;
  records: PatchRecord[];
  patch_text: string;
  status: 'idle' | 'applied' | 'partially_reverted' | 'reverted';
  last_result: { action: string; success_count: number; skipped_count: number; errors: string[] };
};
type Target = {
  id: number;
  chat: string | undefined;
  object: SillyTavern.ChatMessage;
  swipe: number | undefined;
  text: string;
};

function snapshot(id: number): Target {
  const message = getChatMessages(id)[0];
  if (!message || message.role !== 'assistant') throw new Error('请选择角色回复进行修复。');
  const object = SillyTavern.chat[id];
  return { id, chat: SillyTavern.getCurrentChatId(), object, swipe: object.swipe_id, text: message.message };
}

function assertTarget(target: Target, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (
    SillyTavern.getCurrentChatId() !== target.chat ||
    SillyTavern.chat[target.id] !== target.object ||
    target.object.swipe_id !== target.swipe ||
    getChatMessages(target.id)[0]?.message !== target.text
  ) {
    throw new Error('目标消息已变化，本次操作已停止。');
  }
}

function toPrompts(messages: SillyTavern.SendingMessage[]): RolePrompt[] {
  return messages
    .map(message => ({
      role: message.role === 'tool' ? ('user' as const) : message.role,
      content:
        typeof message.content === 'string'
          ? message.content
          : (message.content ?? [])
              .filter(part => part.type === 'text')
              .map(part => part.text)
              .join('\n'),
    }))
    .filter(message => message.content.trim());
}

function bounded<T>(promise: Promise<T>, signal: AbortSignal, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = (action: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      action();
    };
    const abort = () => finish(() => reject(signal.reason ?? new DOMException('操作已停止', 'AbortError')));
    const timer = setTimeout(() => finish(() => reject(new Error('请求超时，请重试或调整超时时间。'))), milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    );
  });
}

function readState(id: number): RepairState | undefined {
  const state = getChatMessages(id)[0]?.data?.[STATE_KEY];
  return state?.version === 2 && Array.isArray(state.records) ? (state as RepairState) : undefined;
}

function statusOf(records: PatchRecord[]): RepairState['status'] {
  if (!records.length) return 'idle';
  if (records.every(record => record.reverted)) return 'reverted';
  return records.some(record => record.reverted) ? 'partially_reverted' : 'applied';
}

function relocateRecords(before: string, after: string, records: PatchRecord[]): PatchRecord[] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before.at(-suffix - 1) === after.at(-suffix - 1)
  )
    suffix++;
  const reports = reportRanges(after);
  return records.flatMap(record => {
    let index = record.index;
    if (index + record.after.length <= prefix) {
      /* 前缀位置不变。 */
    } else if (index >= before.length - suffix) index += after.length - before.length;
    else {
      const needle = record.left + record.after + record.right;
      const found = after.indexOf(needle);
      if (!needle || found < 0 || after.indexOf(needle, found + 1) >= 0) return [];
      index = found + record.left.length;
    }
    if (reports.some(range => index >= range.start && index < range.end)) return [];
    return [
      {
        ...record,
        index,
        left: after.slice(Math.max(0, index - 48), index),
        right: after.slice(index + record.after.length, index + record.after.length + 48),
      },
    ];
  });
}

export function createRepairController(store: Store) {
  let controller: AbortController | undefined;
  let request_id = '';
  let extracting = false;
  let requesting = false;
  let main_generating = false;
  let main_stopped = false;
  let stopping = false;
  let captured: { chat: string | undefined; prompts: RolePrompt[] } | undefined;
  let generation = 0;
  const processed = new WeakMap<object, Map<number, number>>();
  const listeners: EventOnReturn[] = [];
  const host = window.parent.document;

  function stop() {
    if (stopping) return;
    stopping = true;
    try {
      controller?.abort(new DOMException('操作已停止', 'AbortError'));
      if (request_id) stopGenerationById(request_id);
      if (extracting || store.stage === 'MVU 关联更新') SillyTavern.stopGeneration();
    } finally {
      stopping = false;
    }
  }

  async function write(target: Target, message: string, state?: RepairState) {
    assertTarget(target, controller?.signal);
    const data = getChatMessages(target.id)[0].data;
    await setChatMessages(
      [{ message_id: target.id, message, ...(state ? { data: { ...data, [STATE_KEY]: state } } : {}) }],
      { refresh: 'affected' },
    );
    target.text = message;
  }

  async function capturePrompt(signal: AbortSignal): Promise<RolePrompt[]> {
    if (SillyTavern.mainApi !== 'openai') throw new Error('提示词捕获需要酒馆使用聊天补全 API。');
    if (SillyTavern.onlineStatus === 'no_connection') throw new Error('请先连接聊天补全 API，再捕获预设请求。');
    extracting = true;
    const chat = SillyTavern.getCurrentChatId();
    const input = host.querySelector<HTMLTextAreaElement>('#send_textarea');
    const draft = input?.value ?? '';
    const read_only = input?.readOnly ?? false;
    if (input) {
      input.value = '';
      input.readOnly = true;
    }
    let listener: EventOnReturn | undefined;
    try {
      return await bounded(
        new Promise<RolePrompt[]>((resolve, reject) => {
          let prompts: RolePrompt[] | undefined;
          listener = eventMakeLast(
            tavern_events.CHAT_COMPLETION_SETTINGS_READY,
            (completion: { messages: SillyTavern.SendingMessage[] }) => {
              prompts = toPrompts(completion.messages);
              listener?.stop();
              SillyTavern.stopGeneration();
            },
          );
          // 等捕获用请求完成清理后再发起修复；主动中止产生的异常不影响已捕获的提示词。
          Promise.resolve(SillyTavern.generate('normal')).then(
            () => (prompts ? resolve(prompts) : reject(new Error('未能捕获预设提示词，请检查当前连接。'))),
            error => (prompts ? resolve(prompts) : reject(error)),
          );
        }),
        signal,
        30_000,
      );
    } catch (error) {
      SillyTavern.stopGeneration();
      throw error;
    } finally {
      listener?.stop();
      if (signal.aborted) SillyTavern.stopGeneration();
      extracting = false;
      if (input) {
        input.readOnly = read_only;
        if (SillyTavern.getCurrentChatId() === chat && !input.value) {
          input.value = draft;
          input.dispatchEvent(new host.defaultView!.Event('input', { bubbles: true }));
        }
      }
    }
  }

  async function run(message_id = getLastMessageId(), automatic = false) {
    if (!store.enabled) return;
    if (store.busy) throw new Error('正文修复正在运行。');
    if (!automatic && main_generating) throw new Error('请等待主模型输出完成。');
    const settings = SettingsSchema.parse(JSON.parse(JSON.stringify(store.settings)));
    if (!settings.format && !settings.review) throw new Error('请至少启用一个修复模块。');
    const target = snapshot(message_id);
    if (message_id !== getLastMessageId()) throw new Error('生成修复目前面向最后一条角色回复。');
    const mvu = getMvuStatus();
    if (mvu.available && mvu.version < 1) throw new Error('当前 MVU 缺少联动接口，请加载配套 MVU 脚本后运行。');
    if (mvu.busy) throw new Error('MVU 正在解析，请等待解析结束后再修复。');
    if (settings.source === 'custom' && (!settings.apiurl.trim() || !settings.model.trim()))
      throw new Error('请填写自定义 API 地址和模型名称。');
    controller = new AbortController();
    const signal = controller.signal;
    store.busy = true;
    store.error = '';
    store.result = '';
    store.stream_text = '';
    try {
      store.stage = '准备预设提示词';
      const prompts = captured && captured.chat === target.chat ? captured.prompts : await capturePrompt(signal);
      assertTarget(target, signal);
      const task = buildTask(settings, target.text, mvu);
      const ordered_prompts = combinePrompts(prompts, task, settings);
      store.stage = '生成补全与修复结果';
      request_id = `dream-repair-v2-${SillyTavern.uuidv4()}`;
      requesting = true;
      const token_listener = eventOn(iframe_events.STREAM_TOKEN_RECEIVED_FULLY, (text: string, id: string) => {
        if (id === request_id) store.stream_text = text;
      });
      let output: string;
      try {
        const generated = await bounded(
          generateRaw({
            ordered_prompts,
            generation_id: request_id,
            should_stream: settings.stream,
            should_silence: false,
            tools: [],
            ...(settings.source === 'custom'
              ? {
                  custom_api: {
                    apiurl: settings.apiurl,
                    key: settings.key,
                    model: settings.model,
                    temperature: settings.temperature,
                    max_tokens: settings.max_tokens,
                  },
                }
              : {}),
          }),
          signal,
          settings.timeout_seconds * 1000,
        );
        output = typeof generated === 'string' ? generated : generated.content;
      } catch (error) {
        if (request_id) stopGenerationById(request_id);
        throw error;
      } finally {
        token_listener.stop();
        requesting = false;
        request_id = '';
      }
      assertTarget(target, signal);
      const generated = extractOutput(output, settings);
      const original = target.text;
      const applied = applyPatches(original, generated.patch);
      store.stage = '追加结果并应用补丁';
      const appended = appendResults(original, generated.append, generated.review, settings, mvu);
      await write(target, appended);
      assertTarget(target, signal);
      const final_message = appendResults(applied.message, generated.append, generated.review, settings, mvu);
      const previous = readState(message_id);
      const records =
        applied.success_count > 0
          ? relocateRecords(applied.message, final_message, applied.records)
          : relocateRecords(original, final_message, previous?.records ?? []);
      const state: RepairState = {
        version: 2,
        records,
        patch_text: applied.success_count > 0 ? generated.patch : (previous?.patch_text ?? generated.patch),
        status: statusOf(records),
        last_result: {
          action: automatic ? 'auto' : 'manual',
          success_count: applied.success_count,
          skipped_count: applied.skipped_count,
          errors: applied.errors,
        },
      };
      await write(target, final_message, state);
      const swipes = processed.get(target.object) ?? new Map<number, number>();
      swipes.set(target.swipe ?? 0, generation);
      processed.set(target.object, swipes);
      store.result = `已应用 ${applied.success_count} 处修复${applied.skipped_count ? `，${applied.skipped_count} 项未应用` : ''}。`;
      if (applied.errors.length) store.result += '\n' + applied.errors.join('\n');
      if (!automatic && settings.link_mvu && mvu.enabled) {
        assertTarget(target, signal);
        store.stage = 'MVU 关联更新';
        await updateMvu(message_id);
        store.result += '\nMVU 关联处理完成。';
      }
      store.stage = automatic && mvu.enabled ? '修复完成，进入 MVU 处理' : '修复完成';
      console.info(`[${SCRIPT_NAME}] 第 ${message_id} 楼完成 ${applied.success_count} 处修复。`);
    } catch (error) {
      store.stage = signal.aborted ? '已停止' : '修复失败';
      store.error = signal.aborted ? '本次操作已停止。' : error instanceof Error ? error.message : String(error);
      if (!signal.aborted) toastr.error(store.error, SCRIPT_NAME);
    } finally {
      requesting = false;
      extracting = false;
      controller = undefined;
      store.busy = false;
    }
  }

  async function patchAction(id: number, action: 'repatch' | 'reverse', patch_text?: string) {
    if (store.busy || main_generating || getMvuStatus().busy) throw new Error('请等待当前生成或变量更新完成。');
    const target = snapshot(id);
    const previous = readState(id);
    if (action === 'reverse' && !previous?.records.length) throw new Error('该楼层没有可还原的 V2 修复记录。');
    const text = patch_text ?? previous?.patch_text ?? '';
    if (action === 'repatch' && previous?.patch_text === text && previous.records.some(record => !record.reverted))
      throw new Error('本组补丁已经应用，可先还原后重新执行。');
    store.busy = true;
    try {
      const result =
        action === 'reverse' ? reversePatches(target.text, previous!.records) : applyPatches(target.text, text);
      const state: RepairState = {
        version: 2,
        records: result.records,
        patch_text: text,
        status: statusOf(result.records),
        last_result: {
          action,
          success_count: result.success_count,
          skipped_count: result.skipped_count,
          errors: result.errors,
        },
      };
      await write(target, result.message, state);
      if (id === getLastMessageId() && store.settings.link_mvu && getMvuStatus().enabled) {
        store.stage = 'MVU 关联更新';
        await updateMvu(id);
      }
      store.result =
        `${action === 'reverse' ? '已还原' : '已应用'} ${result.success_count} 处。` +
        (result.errors.length ? '\n' + result.errors.join('\n') : '');
      return state;
    } finally {
      store.busy = false;
      store.stage = '就绪';
    }
  }

  function summarize(id: number) {
    const state = readState(id);
    return state
      ? {
          status: state.status,
          active_count: state.records.filter(record => !record.reverted).length,
          last_result: state.last_result,
        }
      : undefined;
  }
  function emit(name: string, detail: unknown) {
    const EventConstructor = host.defaultView!.CustomEvent;
    host.dispatchEvent(new EventConstructor(name, { detail }));
  }
  const onState = (event: Event) => {
    if (!store.enabled) return;
    const detail = (event as CustomEvent).detail;
    if (!Number.isInteger(detail?.message_id)) return;
    emit('dream-self-repair:state', { ...detail, state: summarize(detail.message_id) });
  };
  const onAction = (event: Event) => {
    if (!store.enabled) return;
    const detail = (event as CustomEvent).detail;
    if (!Number.isInteger(detail?.message_id) || !['repatch', 'reverse'].includes(detail?.action)) return;
    void patchAction(detail.message_id, detail.action, detail.patch_text)
      .then(() => {
        emit('dream-self-repair:result', { ...detail, ok: true, state: summarize(detail.message_id) });
      })
      .catch(error => emit('dream-self-repair:result', { ...detail, ok: false, message: String(error) }));
  };
  host.addEventListener('dream-self-repair:action', onAction);
  host.addEventListener('dream-self-repair:state-request', onState);

  listeners.push(
    eventOn(tavern_events.GENERATION_STARTED, (_type: string, _options: unknown, dry_run: boolean) => {
      if (extracting || dry_run) return;
      if (store.busy) stop();
      main_generating = true;
      generation++;
      main_stopped = false;
      captured = undefined;
    }),
  );
  listeners.push(
    eventMakeLast(
      tavern_events.CHAT_COMPLETION_SETTINGS_READY,
      (completion: { messages: SillyTavern.SendingMessage[] }) => {
        if (extracting || !Array.isArray(completion.messages)) return;
        if (requesting)
          store.actual_request = toPrompts(completion.messages)
            .map(prompt => `[${prompt.role}]\n${prompt.content}`)
            .join('\n\n');
        else if (main_generating)
          captured = { chat: SillyTavern.getCurrentChatId(), prompts: toPrompts(completion.messages) };
      },
    ),
  );
  listeners.push(
    eventOn(tavern_events.GENERATION_STOPPED, () => {
      if (extracting) return;
      if (store.busy) stop();
      else main_stopped = true;
      main_generating = false;
    }),
  );
  listeners.push(
    eventOn(tavern_events.GENERATION_ENDED, () => {
      main_generating = false;
    }),
  );
  listeners.push(
    eventOn(tavern_events.CHAT_CHANGED, () => {
      stop();
      captured = undefined;
      main_generating = false;
      store.actual_request = '';
    }),
  );
  listeners.push(
    eventMakeFirst(tavern_events.MESSAGE_RECEIVED, async (id: number, type: string) => {
      main_generating = false;
      if (
        !store.enabled ||
        !store.settings.auto ||
        (!store.settings.format && !store.settings.review) ||
        main_stopped ||
        extracting ||
        store.busy ||
        id === 0 ||
        type === 'first_message'
      )
        return;
      const message = getChatMessages(id)[0];
      const object = SillyTavern.chat[id];
      if (!message || message.role !== 'assistant' || message.message.trim().length < 5 || id !== getLastMessageId())
        return;
      if (processed.get(object)?.get(object.swipe_id ?? 0) === generation) return;
      try {
        await run(id, true);
      } catch (error) {
        store.error = error instanceof Error ? error.message : String(error);
        toastr.error(store.error, SCRIPT_NAME);
      }
    }),
  );

  return {
    run,
    stop,
    patchAction,
    preview() {
      const message = getChatMessages(-1)[0]?.message ?? '（当前没有待修复消息）';
      return buildTask(store.settings, message, getMvuStatus());
    },
    destroy() {
      stop();
      listeners.forEach(listener => listener.stop());
      host.removeEventListener('dream-self-repair:action', onAction);
      host.removeEventListener('dream-self-repair:state-request', onState);
    },
  };
}

export type RepairController = ReturnType<typeof createRepairController>;
