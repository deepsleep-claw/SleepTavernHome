// @vitest-environment happy-dom
import { createApp, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUiItem } from '../../../../core/session/types';
import TimelineMessage from './TimelineMessage.vue';

const mock = vi.hoisted(() => ({ context: undefined as unknown }));
vi.mock('../../../composables/runtime', () => ({ useDreamCardAgent: () => mock.context }));
vi.mock('./RenderRichText.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./ManualChangeCard.vue', () => ({ default: { template: '<div />' } }));
let mounted: { root: HTMLElement; unmount: () => void } | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted?.root.remove();
  mounted = undefined;
});

function mountMessage(status: string, messageStatus: SessionUiItem['status']) {
  const fork = vi.fn();
  mock.context = {
    state: shallowRef({ activeSessionAccess: 'live', active: { status, ui: [] }, busy: false }),
    forkSessionFromMessage: fork,
  };
  const root = document.createElement('div');
  const props: { item: SessionUiItem } = {
    item: { at: 0, id: 'output', kind: 'assistant', content: '输出内容', status: messageStatus },
  };
  const app = createApp(TimelineMessage, props);
  app.mount(root);
  mounted = { root, unmount: () => app.unmount() };
  return { button: root.querySelector<HTMLButtonElement>('[aria-label="从此处分叉新会话"]')!, fork };
}

describe('消息分叉入口', () => {
  it.each(['running', 'waiting-approval', 'failed', 'stopped', 'abnormal', 'completed'])(
    '%s会话的已完成输出可以分叉',
    status => {
      const { button, fork } = mountMessage(status, 'completed');
      expect(button.disabled).toBe(false);
      button.click();
      expect(fork).toHaveBeenCalledWith('output');
    },
  );

  it.each(['running', 'waiting-approval'])('%s会话中仍在生成的输出暂不能分叉', status => {
    expect(mountMessage(status, 'running').button.disabled).toBe(true);
  });
});
