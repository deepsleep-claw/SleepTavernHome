// @vitest-environment happy-dom

import { createApp, shallowRef } from 'vue';
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
        activeProfileId: undefined,
        busy: true,
        profiles: [],
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
