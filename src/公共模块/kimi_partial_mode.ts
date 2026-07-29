export const KIMI_PARTIAL_EFFECT_ID = 'kimi_partial_mode';
export const KIMI_PARTIAL_GLOBAL_KEY = '__dream_whale_kimi_partial_mode_api__';

export type KimiPartialModeApi = {
  version: 1;
  getEnabled: () => boolean;
  setEnabled: (enabled: boolean) => void;
  subscribe: (callback: (enabled: boolean) => void) => { stop: () => void };
};

type KimiPartialHostWindow = Window & Partial<Record<typeof KIMI_PARTIAL_GLOBAL_KEY, KimiPartialModeApi>>;

export function getKimiPartialHostWindow(): KimiPartialHostWindow {
  return (window.parent ?? window) as KimiPartialHostWindow;
}

export function getKimiPartialModeApi(): KimiPartialModeApi | undefined {
  const api = getKimiPartialHostWindow()[KIMI_PARTIAL_GLOBAL_KEY];
  if (
    api?.version !== 1 ||
    typeof api.getEnabled !== 'function' ||
    typeof api.setEnabled !== 'function' ||
    typeof api.subscribe !== 'function'
  ) {
    return undefined;
  }
  return api;
}
