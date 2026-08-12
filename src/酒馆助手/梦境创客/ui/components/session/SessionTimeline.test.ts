// @vitest-environment happy-dom

import { createApp, nextTick, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionTimeline from './SessionTimeline.vue';

const runtimeMock = vi.hoisted(() => ({ context: undefined as unknown }));

vi.mock('../../composables/runtime', () => ({
  useDreamCardAgent: () => runtimeMock.context,
}));

let mounted: { root: HTMLElement; unmount: () => void } | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted?.root.remove();
  mounted = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SessionTimeline', () => {
  it('没有待审批工具时允许反复展开和收起已完成的运行块', async () => {
    runtimeMock.context = {
      action: async () => true,
      runtime: {},
      state: shallowRef({
        active: {
          approval: undefined,
          events: [],
          sessionId: 'session:collapse',
          status: 'completed',
          ui: [
            {
              at: 1,
              checkpointId: 'checkpoint:collapse',
              content: '执行任务',
              id: 'user:collapse',
              kind: 'user',
            },
            {
              at: 2,
              checkpointId: 'checkpoint:collapse',
              content: '处理中',
              id: 'assistant:collapse',
              kind: 'assistant',
              status: 'completed',
            },
            {
              at: 3,
              checkpointId: 'checkpoint:collapse',
              content: '{}',
              id: 'tool:collapse',
              kind: 'tool',
              status: 'completed',
              toolCallId: 'call:collapse',
              toolName: 'list_directory',
            },
          ],
        },
        activeSessionAccess: 'live',
        busy: false,
        toolConfirmation: undefined,
      }),
    };
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(SessionTimeline);
    app.mount(root);
    mounted = { root, unmount: () => app.unmount() };

    const summary = root.querySelector<HTMLButtonElement>('.dca-run-summary')!;
    const content = root.querySelector<HTMLElement>('.dca-run-content')!;
    expect(content.style.display).toBe('none');

    summary.click();
    await nextTick();
    expect(content.style.display).not.toBe('none');

    summary.click();
    await nextTick();
    expect(content.style.display).toBe('none');
  });

  it('运行期间没有流式更新也持续刷新计时，并隐藏中途助手署名', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    runtimeMock.context = {
      action: async () => true,
      runtime: {},
      state: shallowRef({
        active: {
          approval: undefined,
          events: [],
          sessionId: 'session:clock',
          status: 'running',
          ui: [
            {
              at: 10_000,
              checkpointId: 'checkpoint:clock',
              content: '开始任务',
              id: 'user:clock',
              kind: 'user',
            },
            {
              at: 10_000,
              checkpointId: 'checkpoint:clock',
              content: '中途输出',
              id: 'assistant:clock',
              kind: 'assistant',
              status: 'running',
            },
          ],
        },
        activeSessionAccess: 'live',
        busy: false,
        toolConfirmation: undefined,
      }),
    };
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(SessionTimeline);
    app.mount(root);
    mounted = { root, unmount: () => app.unmount() };

    expect(root.querySelector('.dca-run-summary')?.textContent).toContain('正在运行 不足1秒');
    expect(root.querySelector('.dca-step-text .dca-markdown')?.textContent?.trim()).toBe('中途输出');
    expect(root.querySelector('.dca-step-text > header')).toBeNull();

    await vi.advanceTimersByTimeAsync(2_100);
    await nextTick();

    expect(root.querySelector('.dca-run-summary')?.textContent).toContain('正在运行 2秒');
  });

  it('回退后重新发送时随时间线重新增长更新贴底边界，用户上滚后停止跟随', async () => {
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
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const flushFrames = () => {
      while (frames.size > 0) {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach(callback => callback(0));
      }
    };
    const reportHeight = (height: number) =>
      resizeCallback?.([{ contentRect: { height } } as ResizeObserverEntry], {} as ResizeObserver);

    runtimeMock.context = {
      action: async () => true,
      runtime: {},
      state: shallowRef({
        active: { approval: undefined, events: [], sessionId: 'session:resend', status: 'running', ui: [] },
        activeSessionAccess: 'live',
        busy: false,
        toolConfirmation: undefined,
      }),
    };
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(SessionTimeline);
    app.mount(root);
    mounted = { root, unmount: () => app.unmount() };

    const scroller = root.querySelector<HTMLElement>('.dca-timeline')!;
    const clientHeight = 300;
    let scrollHeight = 900;
    let scrollTop = 600;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, get: () => clientHeight },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight));
        },
      },
    });
    reportHeight(900);
    flushFrames();
    scroller.dispatchEvent(new Event('scroll'));

    // 回退旧分支后高度骤减，浏览器会把 scrollTop 夹到新的底部。
    scrollHeight = 350;
    scrollTop = 50;
    reportHeight(350);
    flushFrames();
    expect(scrollTop).toBe(50);

    // 重新发送继续输出时，新的最大滚动位置必须跟随内容增长。
    scrollHeight = 850;
    reportHeight(850);
    flushFrames();
    expect(scrollTop).toBe(550);

    // 用户主动离开底部后，不应被后续流式输出强制拉回。
    scrollTop = 100;
    scroller.dispatchEvent(new Event('scroll'));
    scrollHeight = 1_200;
    reportHeight(1_200);
    flushFrames();
    expect(scrollTop).toBe(100);
  });
});
