import { computed, effectScope, ref, toRaw, watch, type Ref } from 'vue';
import { createSettingsDraft } from './settings-draft';

function createEntry<T extends { id: string }>(value: T) {
  // 编辑状态归工作台持有，设置分区卸载不会终止草稿和在途保存。
  const scope = effectScope(true);
  const editor = scope.run(() => createSettingsDraft(structuredClone(toRaw(value))))!;
  return {
    editor,
    saving: ref(false),
    feedback: ref(''),
    dispose: () => {
      editor.dispose();
      scope.stop();
    },
  };
}
type Entry<T extends { id: string }> = ReturnType<typeof createEntry<T>>;
export function createResourceDrafts() {
  const entries = new Map<string, { dispose: () => void }>();
  const selections = new Map<string, Ref<string>>();
  return {
    selection(kind: string, initial: string) {
      if (!selections.has(kind)) selections.set(kind, ref(initial));
      return selections.get(kind)!;
    },
    get<T extends { id: string }>(kind: string, value: T): Entry<T> {
      const key = `${kind}:${value.id}`;
      if (!entries.has(key)) entries.set(key, createEntry(value));
      return entries.get(key) as Entry<T>;
    },
    dispose() {
      entries.forEach(entry => entry.dispose());
      entries.clear();
      selections.clear();
    },
  };
}
export type ResourceDrafts = ReturnType<typeof createResourceDrafts>;

export function useResourceEditor<T extends { id: string }>(
  bank: ResourceDrafts,
  kind: string,
  source: () => T[],
  initial: () => string,
) {
  const selectedId = bank.selection(kind, initial());
  const current = computed(() => {
    const item = source().find(value => value.id === selectedId.value);
    return item ? bank.get(kind, item) : undefined;
  });
  watch(
    [source, selectedId],
    ([values]) => {
      if (!values.some(value => value.id === selectedId.value))
        selectedId.value = values.find(value => value.id === initial())?.id ?? values[0]?.id ?? '';
      const value = values.find(item => item.id === selectedId.value);
      if (value) bank.get(kind, value).editor.sync(value);
    },
    { immediate: true },
  );
  const draft = computed(() => current.value?.editor.form);
  const dirty = computed(() => Boolean(current.value?.editor.dirty.size));
  const saving = computed(() => current.value?.saving.value ?? false);
  const feedback = computed(() => current.value?.feedback.value ?? '');
  function discard() {
    const value = source().find(item => item.id === selectedId.value);
    if (value && current.value && !saving.value) {
      current.value.editor.reset(structuredClone(toRaw(value)));
      current.value.feedback.value = '';
    }
  }
  async function save(persist: (value: T) => Promise<T>): Promise<T | undefined> {
    const entry = current.value;
    if (!entry || entry.saving.value) return;
    const receipt = entry.editor.capture();
    const input = structuredClone(toRaw(entry.editor.form));
    entry.saving.value = true;
    entry.feedback.value = '正在保存…';
    try {
      const saved = await persist(input);
      entry.editor.apply(structuredClone(toRaw(saved)), receipt);
      entry.editor.acknowledge(receipt);
      entry.feedback.value = entry.editor.dirty.size ? '已保存提交内容，仍有新修改待保存' : '已保存';
      return saved;
    } catch (error) {
      entry.feedback.value = `保存失败：${error instanceof Error ? error.message : String(error)}`;
      throw error;
    } finally {
      entry.saving.value = false;
    }
  }
  return { draft, selectedId, dirty, saving, feedback, discard, save };
}
