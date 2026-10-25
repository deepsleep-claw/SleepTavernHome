// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SearchableCombobox from './SearchableCombobox.vue';

let dispose = () => {};
afterEach(() => dispose());

function mount() {
  const change = vi.fn();
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp(SearchableCombobox, {
    modelValue: '',
    options: [
      { label: '模型甲', value: 'a' },
      { label: '模型乙', value: 'b' },
    ],
    'onUpdate:modelValue': change,
  });
  app.mount(root);
  dispose = () => {
    app.unmount();
    root.remove();
  };
  const input = root.querySelector('input')!;
  input.dispatchEvent(new Event('focus'));
  return { root, input, change };
}

describe('SearchableCombobox 输入法', () => {
  it.each(['Enter', 'ArrowDown', 'ArrowUp', 'Escape'])('组合输入中的 %s 保留输入法默认行为', async key => {
    const { input, change } = mount();
    await nextTick();
    const event = new KeyboardEvent('keydown', { key, isComposing: true, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(change).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('composition 事件期间忽略缺少 isComposing 的 Enter，结束后恢复键盘选择', async () => {
    const { input, change } = mount();
    await nextTick();
    input.dispatchEvent(new Event('compositionstart'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(change).not.toHaveBeenCalled();
    input.dispatchEvent(new Event('compositionend'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(change).toHaveBeenCalledExactlyOnceWith('b');
  });
});
