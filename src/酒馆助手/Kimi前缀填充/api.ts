import {
  getKimiPartialHostWindow,
  KIMI_PARTIAL_GLOBAL_KEY,
  type KimiPartialModeApi,
} from '../../公共模块/kimi_partial_mode';
import type { useKimiPartialModeStore } from './store';

type KimiPartialModeStore = ReturnType<typeof useKimiPartialModeStore>;

export function initializeKimiPartialModeApi(store: KimiPartialModeStore): { destroy: () => void } {
  const host_window = getKimiPartialHostWindow();
  const api: KimiPartialModeApi = {
    version: 1,
    getEnabled: () => store.enabled,
    setEnabled: enabled => store.setEnabled(enabled),
    subscribe: callback => store.subscribe(callback),
  };

  const syncApi = () => {
    if (store.should_enable) {
      host_window[KIMI_PARTIAL_GLOBAL_KEY] = api;
    } else if (host_window[KIMI_PARTIAL_GLOBAL_KEY] === api) {
      delete host_window[KIMI_PARTIAL_GLOBAL_KEY];
    }
  };
  const stop_watch = watch(() => store.should_enable, syncApi, { immediate: true });

  return {
    destroy: () => {
      stop_watch();
      if (host_window[KIMI_PARTIAL_GLOBAL_KEY] === api) {
        delete host_window[KIMI_PARTIAL_GLOBAL_KEY];
      }
    },
  };
}
