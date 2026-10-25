// @vitest-environment happy-dom

import { createApp, nextTick, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionComposer from './SessionComposer.vue';
import type { SessionInput, SessionInputReceipt } from '../../../core/session/input-submission';

const runtimeMock = vi.hoisted(() => ({ context: undefined as unknown }));

vi.mock('../../composables/runtime', () => ({
  useDreamCardAgent: () => runtimeMock.context,
}));

let mounted: { root: HTMLElement; unmount: () => void } | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted?.root.remove();
  mounted = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SessionComposer', () => {
  it('触屏手机回车保留正文换行，发送按钮仍可提交', async () => {
    const original = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation(query => {
      const media = original(query);
      Object.defineProperty(media, 'matches', { value: query.includes('pointer: coarse') });
      return media;
    });
    const fixture = pendingComposer();
    const { input, button } = fixture.render();
    await type(input, '第一行');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(fixture.submitInput).not.toHaveBeenCalled();
    expect(input.getAttribute('enterkeyhint')).toBe('enter');
    button.click();
    await nextTick();
    expect(fixture.submitInput).toHaveBeenCalledOnce();
    fixture.accept();
    await nextTick();
  });
  it('触屏引用保留原生滚动，指令先补全再提交', async () => {
    const submitInput = vi.fn(async (input: SessionInput) => input);
    const send = vi.fn();
    runtimeMock.context = {
      action: async (work: () => Promise<unknown>) => {
        await work();
        return true;
      },
      runtime: { submitInput, send },
      state: shallowRef({
        active: {
          sessionId: 'shortcuts',
          status: 'completed',
          mode: 'normal',
          modelControls: { reasoningEffort: 'auto', webSearch: false },
          workingFiles: [{ path: '/files/note.md' }],
        },
        busy: false,
        providers: [],
        approvalMode: 'normal',
        sendWithCtrlEnter: false,
      }),
    };
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(SessionComposer);
    app.mount(root);
    mounted = { root, unmount: () => app.unmount() };
    await nextTick();
    const input = root.querySelector<HTMLTextAreaElement>('textarea')!;
    input.value = '@note';
    input.setSelectionRange(5, 5);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    const file = root.querySelector<HTMLButtonElement>('[role="option"]')!;
    const touch = new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, cancelable: true });
    file.dispatchEvent(touch);
    expect(touch.defaultPrevented).toBe(false);
    file.click();
    await nextTick();
    expect(input.value).toBe('[note.md](/files/note.md) ');
    input.value = '/';
    input.setSelectionRange(1, 1);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    [...root.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find(button => button.textContent?.includes('/compact'))!
      .click();
    await nextTick();
    expect(submitInput).not.toHaveBeenCalled();
    expect(input.value).toBe('/compact ');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(submitInput).toHaveBeenCalledOnce());
    expect(submitInput.mock.calls[0][0]).toMatchObject({ kind: 'command', sessionId: 'shortcuts', text: '/compact ' });
    expect(send).not.toHaveBeenCalled();
  });
  it('逐工具审批等待期间仍可输入引导或停止任务', () => {
    const stop = vi.fn();
    runtimeMock.context = {
      action: async () => true,
      runtime: { stop },
      state: shallowRef({
        active: {
          mode: 'normal',
          modelControls: { reasoningEffort: 'auto', webSearch: false },
          status: 'waiting-approval',
        },
        approvalMode: 'normal',
        busy: true,
        providers: [],
        sendWithCtrlEnter: false,
      }),
    };
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(SessionComposer);
    app.mount(root);
    mounted = { root, unmount: () => app.unmount() };

    expect(root.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(false);
    const button = root.querySelector<HTMLButtonElement>('.dca-send-button')!;
    expect(button.disabled).toBe(false);
    expect(button.title).toBe('停止当前任务');
    button.click();
    expect(stop).toHaveBeenCalledOnce();
  });
});

function pendingComposer(status = 'running') {
  let accept!: (receipt: SessionInputReceipt) => void;
  let reject!: (error: Error) => void;
  const receipt = new Promise<SessionInputReceipt>((done, fail) => {
    accept = done;
    reject = fail;
  });
  const submitInput = vi.fn((_input: SessionInput) => receipt);
  const state = shallowRef({
    active: {
      sessionId: 'a',
      status,
      mode: 'normal',
      ui: [],
      workingFiles: [],
      modelControls: { reasoningEffort: 'auto', webSearch: false },
    },
    busy: false,
    providers: [],
    approvalMode: 'normal',
    sendWithCtrlEnter: false,
  });
  const saveBrowserDraft = vi.fn(async () => {});
  runtimeMock.context = {
    runtime: { submitInput, saveBrowserDraft },
    state,
    action: async (work: () => Promise<unknown>) => {
      await work();
      return true;
    },
  };
  const render = () => {
    const root = document.createElement('div');
    root.className = 'dca-app';
    document.body.append(root);
    const app = createApp(SessionComposer);
    app.mount(root);
    mounted = { root, unmount: () => app.unmount() };
    return {
      root,
      input: root.querySelector<HTMLTextAreaElement>('textarea')!,
      button: root.querySelector<HTMLButtonElement>('.dca-send-button')!,
    };
  };
  return { accept: () => accept(submitInput.mock.calls[0][0]), reject, render, submitInput, state, saveBrowserDraft };
}

async function type(input: HTMLTextAreaElement, text: string) {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}

describe('SessionComposer 提交结算', () => {
  it.each(['running', 'completed'])('%s 会话的提交在途时，重复点击与 Enter 只提交一次', async status => {
    const fixture = pendingComposer(status);
    const { input, button } = fixture.render();
    await type(input, '修改语气');
    button.click();
    button.click();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextTick();
    expect(fixture.submitInput).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    fixture.accept();
    await nextTick();
    await nextTick();
    await vi.waitFor(() => expect(input.value).toBe(''));
  });

  it('提交失败保留原文并恢复发送能力', async () => {
    const error = vi.fn();
    vi.stubGlobal('toastr', { error });
    const fixture = pendingComposer();
    const { input, button } = fixture.render();
    await type(input, '重试内容');
    button.click();
    fixture.reject(new Error('保存失败'));
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(input.value).toBe('重试内容');
    expect(button.disabled).toBe(false);
  });

  it('会话切换后的回执只清理原会话草稿', async () => {
    const fixture = pendingComposer();
    const { input, button } = fixture.render();
    await type(input, '会话 A 内容');
    button.click();
    fixture.state.value = { ...fixture.state.value, active: { ...fixture.state.value.active, sessionId: 'b' } };
    await nextTick();
    await type(input, '会话 B 内容');
    fixture.accept();
    await nextTick();
    await nextTick();
    expect(input.value).toBe('会话 B 内容');
    fixture.state.value = { ...fixture.state.value, active: { ...fixture.state.value.active, sessionId: 'a' } };
    await nextTick();
    expect(input.value).toBe('');
    expect(fixture.saveBrowserDraft).toHaveBeenCalledWith('composer:a', { message: '', attachments: [] });
  });

  it('卸载重挂载共享提交锁，回执清理新组件中的原草稿', async () => {
    const fixture = pendingComposer();
    const first = fixture.render();
    await type(first.input, '提交后关闭窗口');
    first.button.click();
    mounted!.unmount();
    mounted!.root.remove();
    const second = fixture.render();
    await nextTick();
    expect(second.input.value).toBe('提交后关闭窗口');
    expect(second.button.disabled).toBe(true);
    second.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fixture.submitInput).toHaveBeenCalledTimes(1);
    fixture.accept();
    await nextTick();
    await nextTick();
    await vi.waitFor(() => expect(second.input.value).toBe(''));
  });

  it('等待回执期间改写又恢复相同文字，仍保留新草稿版本', async () => {
    const fixture = pendingComposer();
    const { input, button } = fixture.render();
    await type(input, '原文');
    button.click();
    await type(input, '新的要求');
    await type(input, '原文');
    fixture.accept();
    await nextTick();
    await nextTick();
    expect(input.value).toBe('原文');
  });

  it('输入法组合期间不提交消息，完成后可提交', async () => {
    const fixture = pendingComposer();
    const { input } = fixture.render();
    await type(input, '中文要求');
    input.dispatchEvent(new Event('compositionstart'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fixture.submitInput).not.toHaveBeenCalled();
    input.dispatchEvent(new Event('compositionend'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fixture.submitInput).toHaveBeenCalledTimes(1);
    fixture.accept();
    await nextTick();
  });
});
