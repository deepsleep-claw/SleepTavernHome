// @vitest-environment happy-dom

import { createApp, h, nextTick, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUiItem } from '../../../../core/session/types';
import ReasoningBlock from './ReasoningBlock.vue';

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe('ReasoningBlock', () => {
  it('流式思考更新预览文本时不写入内部滚动位置', async () => {
    const item = shallowRef<SessionUiItem>({
      id: 'reasoning',
      at: 1,
      kind: 'reasoning',
      status: 'running',
      content: '开始分析',
    });
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp({ render: () => h(ReasoningBlock, { item: item.value }) });
    app.mount(root);
    cleanup = () => {
      app.unmount();
      root.remove();
    };
    const preview = root.querySelector<HTMLElement>('.dca-reasoning-preview')!;
    const scroll = vi.fn();
    Object.defineProperty(preview, 'scrollTop', { get: () => 0, set: scroll });
    item.value = { ...item.value, content: '开始分析\n新的思考内容' };
    await nextTick();
    await nextTick();
    expect(preview.textContent).toContain('新的思考内容');
    expect(scroll).not.toHaveBeenCalled();
    item.value = { ...item.value, content: '很长的思考\n'.repeat(20000) + '最后一句新的思考内容' };
    await nextTick();
    expect(preview.textContent!.length).toBeLessThanOrEqual(600);
    expect(preview.textContent).toContain('最后一句新的思考内容');
    expect(root.querySelector('pre')).toBeNull();

    const details = root.querySelector('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await nextTick();
    expect(root.querySelector('.dca-reasoning-preview')).toBeNull();
    expect(root.querySelector('pre')?.textContent).toContain('新的思考内容');
    expect(root.querySelector('pre')?.textContent).toBe(item.value.content);
    item.value = { ...item.value, status: 'completed' };
    await nextTick();
    expect(details.open).toBe(true);
  });
});
