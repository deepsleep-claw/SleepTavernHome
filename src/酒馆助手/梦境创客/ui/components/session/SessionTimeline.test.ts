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
});

describe('SessionTimeline', () => {
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
    expect(root.querySelector('.dca-step-text > header')?.textContent).not.toContain('梦境创客');
    expect(root.querySelector('.dca-step-text > header > small')).not.toBeNull();

    await vi.advanceTimersByTimeAsync(2_100);
    await nextTick();

    expect(root.querySelector('.dca-run-summary')?.textContent).toContain('正在运行 2秒');
  });
});
