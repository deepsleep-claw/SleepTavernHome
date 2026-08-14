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

  it('宽度不足时只在外层保留模型、审批与发送，并用加号收纳附件入口', async () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        disconnect() {}
        observe() {}
        unobserve() {}
      },
    );
    runtimeMock.context = {
      action: async () => true,
      runtime: {},
      state: shallowRef({
        active: {
          mode: 'normal',
          modelControls: { reasoningEffort: 'auto', webSearch: false },
          status: 'completed',
        },
        approvalMode: 'normal',
        busy: false,
        providers: [],
        sendWithCtrlEnter: false,
      }),
    };
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(SessionComposer);
    app.mount(root);
    mounted = { root, unmount: () => app.unmount() };

    resizeCallback?.([{ contentRect: { width: 420 } } as ResizeObserverEntry], {} as ResizeObserver);
    await nextTick();

    expect(root.querySelector('.dca-composer-control-strip')?.textContent).toContain('未选择模型');
    expect(root.querySelector('.dca-composer-control-strip')?.textContent).toContain('审批：手动');
    expect(root.querySelector('.dca-composer-footer')).toBeNull();
    expect(root.querySelector('.dca-compact-input-row .dca-send-button')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('.dca-plus-wrap > button')?.click();
    await nextTick();
    expect(root.querySelector('.dca-plus-menu')?.textContent).toContain('添加文件');
    expect(root.querySelector('.dca-plus-menu')?.textContent).toContain('添加图片');
    expect(root.querySelector('.dca-plus-menu')?.textContent).toContain('模型与推理');
    expect(root.querySelector('.dca-plus-menu')?.textContent).toContain('审批模式');
  });
});
