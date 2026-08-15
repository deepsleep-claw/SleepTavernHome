// @vitest-environment happy-dom

import { createApp, nextTick, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUiItem } from '../../../../core/session/types';
import TimelineMessage from './TimelineMessage.vue';

const runtimeMock = vi.hoisted(() => ({ context: undefined as unknown }));

vi.mock('../../../composables/runtime', () => ({
  useDreamCardAgent: () => runtimeMock.context,
}));

let mounted: { root: HTMLElement; unmount: () => void } | undefined;

function mountMessage(item: SessionUiItem): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp(TimelineMessage, { item });
  app.mount(root);
  mounted = { root, unmount: () => app.unmount() };
  return root;
}

afterEach(() => {
  mounted?.unmount();
  mounted?.root.remove();
  mounted = undefined;
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.unstubAllGlobals();
});

describe('TimelineMessage', () => {
  it('编辑用户消息时使用最大消息宽度、至少四行并随内容自动增高', async () => {
    const item: SessionUiItem = {
      at: 1,
      checkpointId: 'checkpoint:edit',
      content: '第一行\n第二行\n第三行\n第四行\n第五行',
      id: 'user:edit',
      kind: 'user',
    };
    runtimeMock.context = {
      action: async () => true,
      forkSessionFromMessage: vi.fn(),
      runtime: {
        editUserMessage: vi.fn(),
        resend: vi.fn(),
        undoToUserMessage: vi.fn(),
      },
      state: shallowRef({
        active: {
          sessionId: 'session:edit',
          status: 'completed',
          ui: [item],
        },
        activeSessionAccess: 'live',
        busy: false,
      }),
    };

    const root = mountMessage(item);

    root.querySelector<HTMLButtonElement>('[title="编辑并可重新发送"]')?.click();
    await nextTick();
    await nextTick();

    const article = root.querySelector<HTMLElement>('.dca-message')!;
    const editor = root.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(article.classList.contains('dca-message-editing')).toBe(true);
    expect(editor.getAttribute('rows')).toBe('4');
    expect(document.activeElement).toBe(editor);

    Object.defineProperty(editor, 'scrollHeight', { configurable: true, value: 420 });
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    expect(editor.style.height).toBe('420px');
  });

  it('在最终输出下提供复制与分叉操作', async () => {
    const item: SessionUiItem = {
      at: 2,
      checkpointId: 'checkpoint:output',
      content: '# 本轮输出\n\n正文',
      id: 'assistant:output',
      kind: 'assistant',
      status: 'completed',
    };
    const forkSessionFromMessage = vi.fn(async () => undefined);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    vi.stubGlobal('toastr', { error: vi.fn(), success: vi.fn() });
    runtimeMock.context = {
      action: async () => true,
      forkSessionFromMessage,
      runtime: {},
      state: shallowRef({
        active: {
          sessionId: 'session:output',
          status: 'completed',
          ui: [item],
        },
        activeSessionAccess: 'live',
        busy: false,
      }),
    };

    const root = mountMessage(item);

    root.querySelector<HTMLButtonElement>('[aria-label="复制输出"]')?.click();
    root.querySelector<HTMLButtonElement>('[aria-label="从此处分叉新会话"]')?.click();
    await nextTick();

    expect(writeText).toHaveBeenCalledWith(item.content);
    expect(forkSessionFromMessage).toHaveBeenCalledWith(item.id);
  });
});
