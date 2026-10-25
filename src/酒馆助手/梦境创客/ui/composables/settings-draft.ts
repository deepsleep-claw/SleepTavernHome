import { onBeforeUnmount, reactive, shallowReactive, toRaw, watch } from 'vue';

export function useSettingsDraft<T extends object>(initial: T) {
  const editor = createSettingsDraft(initial);
  onBeforeUnmount(editor.dispose);
  return editor;
}

export function createSettingsDraft<T extends object>(initial: T) {
  const form = reactive(initial) as T;
  const dirty = shallowReactive(new Set<keyof T>());
  const versions = new Map<keyof T, number>();
  let generation = 0;
  let revision = 0;
  let applying = false;
  let disposed = false;
  let previous = structuredClone(initial);

  const stop = watch(
    form,
    () => {
      const next = structuredClone(toRaw(form));
      if (!applying) {
        for (const key of Object.keys(next) as Array<keyof T>) {
          if (JSON.stringify(next[key]) === JSON.stringify(previous[key])) continue;
          versions.set(key, ++revision);
          dirty.add(key);
        }
      }
      previous = next;
    },
    { deep: true, flush: 'sync' },
  );

  function assign(values: Partial<T>) {
    applying = true;
    try {
      Object.assign(form, values);
    } finally {
      applying = false;
    }
  }

  function capture() {
    const scope = generation;
    const savedVersions = new Map(versions);
    const isCurrent = () => !disposed && scope === generation;
    return {
      editedKeys: [...dirty],
      isCurrent,
      unchanged: (key: keyof T) => isCurrent() && versions.get(key) === savedVersions.get(key),
    };
  }

  function reset(values: T) {
    generation += 1;
    assign(values);
    versions.clear();
    dirty.clear();
    return capture();
  }

  function apply(values: Partial<T>, receipt: ReturnType<typeof capture>) {
    const allowed: Partial<T> = {};
    for (const key of Object.keys(values) as Array<keyof T>) {
      if (receipt.unchanged(key)) allowed[key] = values[key];
    }
    assign(allowed);
  }

  function acknowledge(receipt: ReturnType<typeof capture>) {
    for (const key of receipt.editedKeys) {
      if (receipt.unchanged(key)) dirty.delete(key);
    }
  }

  function sync(values: T) {
    const clean: Partial<T> = {};
    for (const key of Object.keys(values) as Array<keyof T>) {
      if (!dirty.has(key) && JSON.stringify(values[key]) !== JSON.stringify(previous[key])) clean[key] = values[key];
    }
    assign(structuredClone(toRaw(clean)));
  }
  function dispose() {
    disposed = true;
    stop();
  }
  return { form, dirty, capture, reset, apply, acknowledge, sync, dispose };
}
