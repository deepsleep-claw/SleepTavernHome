// @vitest-environment happy-dom

import { createApp, nextTick, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionComposer from './SessionComposer.vue';

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
});

describe('SessionComposer', () => {
  it('触屏可点选文件补全，斜杠补全执行客户端命令而不发送给AI', async () => {
    const compactContext = vi.fn(async () => undefined);
    const send = vi.fn();
    runtimeMock.context = {
      action: async (work: () => Promise<unknown>) => {
        await work();
        return true;
      },
      runtime: { compactContext, send },
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
    expect(touch.defaultPrevented).toBe(true);
    file.click();
    await nextTick();
    expect(input.value).toBe('[note.md](/files/note.md) ');
    input.value = '/';
    input.setSelectionRange(1, 1);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    root.querySelector<HTMLButtonElement>('[role="option"]')!.click();
    await vi.waitFor(() => expect(compactContext).toHaveBeenCalledOnce());
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
