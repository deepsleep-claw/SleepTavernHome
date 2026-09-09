// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStoredDraft } from './stored-draft';

const mocked = vi.hoisted(() => ({ runtime: {} as Record<string, unknown> }));
vi.mock('./runtime', () => ({ useDreamCardAgent: () => ({ runtime: mocked.runtime }) }));
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose());
});

function mount(key: Ref<string>) {
  const root = document.createElement('div');
  document.body.append(root);
  let result!: ReturnType<typeof useStoredDraft<{ text: string }>>;
  const app = createApp(
    defineComponent({
      setup() {
        result = useStoredDraft(
          () => key.value,
          () => ({ text: '原文' }),
        );
        return () => h('div', result.draft.value.text);
      },
    }),
  );
  app.mount(root);
  const dispose = () => {
    app.unmount();
    root.remove();
  };
  cleanup.push(dispose);
  return { result, dispose, root };
}

describe('stored drafts', () => {
  it('切换会话保存各自草稿并恢复原文', async () => {
    mocked.runtime = { loadBrowserDraft: vi.fn(async () => undefined), saveBrowserDraft: vi.fn(async () => {}) };
    const key = ref('a');
    const { result } = mount(key);
    await nextTick();
    result.draft.value = { text: '会话 A 草稿' };
    key.value = 'b';
    await nextTick();
    result.draft.value = { text: '会话 B 草稿' };
    key.value = 'a';
    await nextTick();
    expect(result.draft.value.text).toBe('会话 A 草稿');
    expect(mocked.runtime.saveBrowserDraft).toHaveBeenCalledWith('b', { text: '会话 B 草稿' });
  });

  it('卸载界面会保存草稿，重新挂载仍保留内容', async () => {
    mocked.runtime = { loadBrowserDraft: vi.fn(async () => undefined), saveBrowserDraft: vi.fn(async () => {}) };
    const key = ref('a');
    const first = mount(key);
    await nextTick();
    first.result.draft.value = { text: '未发送' };
    first.dispose();
    cleanup.splice(0, 1);
    const second = mount(key);
    await nextTick();
    expect(second.result.draft.value.text).toBe('未发送');
    expect(mocked.runtime.saveBrowserDraft).toHaveBeenCalledWith('a', { text: '未发送' });
  });

  it('延迟读取不能覆盖用户已输入的内容', async () => {
    let resolve!: (value: { text: string }) => void;
    mocked.runtime = {
      loadBrowserDraft: () =>
        new Promise(done => {
          resolve = done;
        }),
      saveBrowserDraft: vi.fn(async () => {}),
    };
    const { result } = mount(ref('a'));
    result.draft.value = { text: '刚输入' };
    resolve({ text: '旧缓存' });
    await nextTick();
    expect(result.draft.value.text).toBe('刚输入');
  });
});
