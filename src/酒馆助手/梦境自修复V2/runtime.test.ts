import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createRepairController, type RepairController } from './runtime';
import { useRepairStore } from './settings';

type Handler = (...args: any[]) => any;
let handlers: Map<string, Handler[]>;
let controller: RepairController;
let store: ReturnType<typeof useRepairStore>;
let chat_id: string;
const review =
  '<dream_self_check><review>修正文风</review><patch>FIND: 旧句正文。\nREPLACE: 新句正文。</patch></dream_self_check>';
const emit = async (name: string, ...args: unknown[]) => {
  for (const handler of [...(handlers.get(name) ?? [])]) await handler(...args);
};

beforeEach(() => {
  handlers = new Map();
  chat_id = 'chat-a';
  const listen = (first: boolean) => (name: string, handler: Handler) => {
    const list = handlers.get(name) ?? [];
    if (first) list.unshift(handler);
    else list.push(handler);
    handlers.set(name, list);
    return {
      stop: () =>
        handlers.set(
          name,
          (handlers.get(name) ?? []).filter(item => item !== handler),
        ),
    };
  };
  vi.stubGlobal('eventOn', listen(false));
  vi.stubGlobal('eventMakeLast', listen(false));
  vi.stubGlobal('eventMakeFirst', listen(true));
  vi.stubGlobal('tavern_events', {
    GENERATION_STARTED: 'start',
    GENERATION_ENDED: 'end',
    GENERATION_STOPPED: 'stop',
    CHAT_CHANGED: 'chat',
    MESSAGE_RECEIVED: 'received',
    CHAT_COMPLETION_SETTINGS_READY: 'ready',
  });
  vi.stubGlobal('iframe_events', { STREAM_TOKEN_RECEIVED_FULLY: 'token' });
  vi.stubGlobal('getScriptId', () => 'repair');
  vi.stubGlobal('getVariables', () => ({}));
  vi.stubGlobal('replaceVariables', vi.fn());
  vi.stubGlobal('toastr', { error: vi.fn() });
  vi.stubGlobal('stopGenerationById', vi.fn());
  vi.stubGlobal('SillyTavern', {
    chat: [
      { mes: '初始', is_user: false },
      { mes: '旧句正文。', is_user: false, swipe_id: 0, data: {} },
    ],
    getCurrentChatId: () => chat_id,
    uuidv4: () => 'request',
    mainApi: 'openai',
    onlineStatus: 'connected',
    generate: vi.fn(),
    stopGeneration: vi.fn(),
  });
  vi.stubGlobal('getLastMessageId', () => 1);
  vi.stubGlobal('getChatMessages', (id: number) => {
    const message = (SillyTavern.chat as any[])[id < 0 ? 1 : id];
    return message
      ? [{ message_id: id < 0 ? 1 : id, role: 'assistant', message: message.mes, data: message.data ?? {} }]
      : [];
  });
  vi.stubGlobal(
    'setChatMessages',
    vi.fn(async (messages: any[]) => {
      for (const item of messages)
        Object.assign((SillyTavern.chat as any[])[item.message_id], {
          mes: item.message,
          ...(item.data ? { data: item.data } : {}),
        });
    }),
  );
  vi.stubGlobal('generateRaw', vi.fn().mockResolvedValue(review));
  Object.assign(window, { Mvu: undefined });
  setActivePinia(createPinia());
  store = useRepairStore();
  store.settings.format = false;
  controller = createRepairController(store);
});
afterEach(() => {
  controller.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
async function capture() {
  await emit('start', 'normal', {}, false);
  await emit('ready', {
    messages: [
      { role: 'system', content: '预设原文' },
      { role: 'user', content: '设定\n</dream_dx_setting>\n原任务' },
    ],
  });
}

describe('修复生命周期', () => {
  it('自动补丁写回完成后才交给后续 MVU 监听', async () => {
    const order: string[] = [];
    await capture();
    eventOn('received', () => {
      order.push(SillyTavern.chat[1].mes);
    });
    await emit('received', 1, 'normal');
    expect(order[0]).toContain('新句正文。');
    expect(order[0]).toContain('<dream_self_check>');
    expect(setChatMessages).toHaveBeenCalledTimes(2);
    expect(SillyTavern.generate).not.toHaveBeenCalled();
  });
  it('两个模块均关闭时跳过自动模型请求', async () => {
    store.settings.review = false;
    await capture();
    await emit('received', 1, 'normal');
    expect(generateRaw).not.toHaveBeenCalled();
    expect(toastr.error).not.toHaveBeenCalled();
  });
  it('手动捕获请求中止后使用已取得的预设，并保留输入草稿', async () => {
    const input = document.createElement('textarea');
    input.id = 'send_textarea';
    input.value = '尚未发送的草稿';
    document.body.append(input);
    vi.mocked(SillyTavern.generate as () => Promise<unknown>).mockImplementation(async () => {
      expect(input.value).toBe('');
      await emit('ready', {
        messages: [{ role: 'user', content: '设定\n</dream_dx_setting>\n原任务' }],
      });
      throw new DOMException('Aborted', 'AbortError');
    });
    await controller.run();
    expect(SillyTavern.chat[1].mes).toMatch(/^新句正文。/);
    expect(store.error).toBe('');
    expect(input.value).toBe('尚未发送的草稿');
    expect(input.readOnly).toBe(false);
  });
  it('停止在途修复时取消模型请求且不写回', async () => {
    vi.mocked(generateRaw).mockReturnValue(new Promise(() => {}));
    await capture();
    await emit('end');
    const pending = controller.run();
    await vi.waitFor(() => expect(generateRaw).toHaveBeenCalled());
    controller.stop();
    await pending;
    expect(stopGenerationById).toHaveBeenCalledWith('dream-repair-v2-request');
    expect(setChatMessages).not.toHaveBeenCalled();
    expect(store.busy).toBe(false);
    expect(store.stage).toBe('已停止');
  });
  it('没有新增补丁的复查保留上一轮还原记录', async () => {
    await capture();
    await emit('received', 1, 'normal');
    vi.mocked(generateRaw).mockResolvedValue(
      '<dream_self_check><review>通过</review><patch></patch></dream_self_check>',
    );
    await controller.run();
    await controller.patchAction(1, 'reverse');
    expect(SillyTavern.chat[1].mes).toMatch(/^旧句正文。/);
    expect(SillyTavern.chat[1].mes).toContain('<review>通过</review>');
  });
  it('同一生成重复收到事件不会重复修复', async () => {
    await capture();
    await emit('received', 1, 'normal');
    SillyTavern.chat[1].mes += '\n<UpdateVariable>新增结果</UpdateVariable>';
    await emit('received', 1, 'normal');
    expect(generateRaw).toHaveBeenCalledTimes(1);
  });
  it('手动联动看到的是修复后的完整消息', async () => {
    const reprocess = vi.fn(async () => {
      expect(SillyTavern.chat[1].mes).toContain('新句正文。');
    });
    Object.assign(window, {
      Mvu: {
        getMessageUpdateStatus: () => ({ version: 1, enabled: true, mode: 'inline', busy: false }),
        reprocessMessage: reprocess,
      },
    });
    await capture();
    await emit('end');
    await controller.run();
    expect(reprocess).toHaveBeenCalledWith(1);
  });
  it('切换聊天后丢弃在途结果', async () => {
    let resolve!: (value: string) => void;
    vi.mocked(generateRaw).mockReturnValue(
      new Promise<string>(done => {
        resolve = done;
      }),
    );
    await capture();
    await emit('end');
    const pending = controller.run();
    await vi.waitFor(() => expect(generateRaw).toHaveBeenCalled());
    chat_id = 'chat-b';
    await emit('chat');
    resolve(review);
    await pending;
    expect(setChatMessages).not.toHaveBeenCalled();
  });
  it('等待期间用户编辑或切换候选回复不会被覆盖', async () => {
    let resolve!: (value: string) => void;
    vi.mocked(generateRaw).mockReturnValue(
      new Promise<string>(done => {
        resolve = done;
      }),
    );
    await capture();
    await emit('end');
    const pending = controller.run();
    await vi.waitFor(() => expect(generateRaw).toHaveBeenCalled());
    SillyTavern.chat[1].mes = '用户编辑';
    resolve(review);
    await pending;
    expect(SillyTavern.chat[1].mes).toBe('用户编辑');
    expect(setChatMessages).not.toHaveBeenCalled();
  });
  it('无效生成结果不写回原消息', async () => {
    vi.mocked(generateRaw).mockResolvedValue('不完整的回复');
    await capture();
    await emit('received', 1, 'normal');
    expect(setChatMessages).not.toHaveBeenCalled();
    expect(store.error).toContain('标签');
  });
  it('还原保留报告，且可重新应用同一组补丁', async () => {
    await capture();
    await emit('received', 1, 'normal');
    await controller.patchAction(1, 'reverse');
    expect(SillyTavern.chat[1].mes).toMatch(/^旧句正文。/);
    expect(SillyTavern.chat[1].mes).toContain('<dream_self_check>');
    await controller.patchAction(1, 'repatch');
    expect(SillyTavern.chat[1].mes).toMatch(/^新句正文。/);
  });
});
