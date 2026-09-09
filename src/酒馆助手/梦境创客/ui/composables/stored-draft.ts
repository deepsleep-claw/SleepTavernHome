import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { useDreamCardAgent } from './runtime';

type DraftEntry = { value: unknown; revision: number; loaded: boolean; saving?: ReturnType<typeof setTimeout> };
const buffers = new WeakMap<object, Map<string, DraftEntry>>();

export function useStoredDraft<T>(key: () => string, initial: () => T): { draft: Ref<T>; ready: Ref<boolean> } {
  const { runtime } = useDreamCardAgent();
  let entries = buffers.get(runtime);
  if (!entries) {
    entries = new Map();
    buffers.set(runtime, entries);
  }
  const draft = ref(initial()) as Ref<T>;
  const ready = ref(false);
  let activeKey = '';
  let assigning = false;

  const persist = (id: string, entry: DraftEntry) => {
    if (entry.saving) clearTimeout(entry.saving);
    entry.saving = undefined;
    void runtime.saveBrowserDraft?.(id, entry.value).catch(error => {
      toastr.error(`草稿本地保存失败：${error instanceof Error ? error.message : String(error)}`, '梦境创客');
    });
  };

  watch(
    key,
    async id => {
      const previous = entries!.get(activeKey);
      if (previous?.saving) persist(activeKey, previous);
      activeKey = id;
      let entry = entries!.get(id);
      if (!entry) {
        entry = { value: initial(), revision: 0, loaded: false };
        entries!.set(id, entry);
      }
      assigning = true;
      draft.value = entry.value as T;
      assigning = false;
      ready.value = entry.loaded || !runtime.loadBrowserDraft;
      if (!id) return;
      const revision = entry.revision;
      try {
        const saved = await runtime.loadBrowserDraft?.<T>(id);
        if (saved !== undefined && entry.revision === revision) entry.value = saved;
        entry.loaded = true;
        if (activeKey === id && entry.revision === revision) {
          assigning = true;
          draft.value = entry.value as T;
          assigning = false;
        }
      } catch (error) {
        toastr.error(`读取本地草稿失败：${error instanceof Error ? error.message : String(error)}`, '梦境创客');
      } finally {
        if (activeKey === id) ready.value = true;
      }
    },
    { immediate: true, flush: 'sync' },
  );

  watch(
    draft,
    value => {
      if (assigning || !activeKey) return;
      const entry = entries!.get(activeKey)!;
      entry.value = value;
      entry.revision += 1;
      if (entry.saving) clearTimeout(entry.saving);
      const id = activeKey;
      entry.saving = setTimeout(() => persist(id, entry), 200);
    },
    { deep: true, flush: 'sync' },
  );

  onBeforeUnmount(() => {
    const entry = entries!.get(activeKey);
    if (entry?.saving) persist(activeKey, entry);
  });
  return { draft, ready };
}
