import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { useDreamCardAgent } from './runtime';
import { notify } from './notifications';

type DraftEntry = {
  value: unknown;
  revision: number;
  loaded: boolean;
  loading?: Promise<void>;
  listeners: Set<() => void>;
};
const buffers = new WeakMap<object, Map<string, DraftEntry>>();

export function useStoredDraft<T>(
  key: () => string,
  initial: () => T,
): {
  draft: Ref<T>;
  ready: Ref<boolean>;
  capture: () => (next: T) => boolean;
} {
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
  let unsubscribe = () => {};

  const persist = (id: string, entry: DraftEntry) => {
    void runtime.saveBrowserDraft?.(id, entry.value).catch(error => {
      notify.error(`草稿本地保存失败：${error instanceof Error ? error.message : String(error)}`, '梦境创客');
    });
  };

  watch(
    key,
    id => {
      const previous = entries!.get(activeKey);
      if (previous && previous.revision > 0) persist(activeKey, previous);
      unsubscribe();
      activeKey = id;
      let entry = entries!.get(id);
      if (!entry) {
        entry = { value: initial(), revision: 0, loaded: !runtime.loadBrowserDraft || !id, listeners: new Set() };
        entries!.set(id, entry);
      }
      const sync = () => {
        assigning = true;
        draft.value = entry.value as T;
        assigning = false;
        ready.value = entry.loaded;
      };
      entry.listeners.add(sync);
      unsubscribe = () => entry.listeners.delete(sync);
      sync();
      if (!id || entry.loaded || entry.loading) return;
      const revision = entry.revision;
      entry.loading = (async () => {
        try {
          const saved = await runtime.loadBrowserDraft?.<T>(id);
          if (saved !== undefined && entry.revision === revision) entry.value = saved;
        } catch (error) {
          notify.error(`读取本地草稿失败：${error instanceof Error ? error.message : String(error)}`, '梦境创客');
        } finally {
          entry.loaded = true;
          entry.loading = undefined;
          entry.listeners.forEach(listener => listener());
        }
      })();
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
      const id = activeKey;
      persist(id, entry);
      entry.listeners.forEach(listener => listener());
    },
    { deep: true, flush: 'sync' },
  );

  onBeforeUnmount(() => {
    unsubscribe();
    const entry = entries!.get(activeKey);
    if (entry && entry.revision > 0) persist(activeKey, entry);
  });
  function capture(): (next: T) => boolean {
    const id = activeKey;
    const entry = entries!.get(id);
    const revision = entry?.revision;
    return next => {
      if (!id || !entry || entry.revision !== revision || entries!.get(id) !== entry) return false;
      // 接收回执只消费提交时的草稿版本，页面卸载或切换会话不改变这份归属。
      entry.value = next;
      entry.revision += 1;
      persist(id, entry);
      entry.listeners.forEach(listener => listener());
      return true;
    };
  }
  return { draft, ready, capture };
}
