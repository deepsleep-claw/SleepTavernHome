export const GEMINI_TOOL_OUTPUT_EFFECT_ID = 'gemini_tool_output_mode';
export const GEMINI_TOOL_OUTPUT_GLOBAL_KEY = '__dream_whale_gemini_tool_output_mode_api__';

export type GeminiToolOutputModeApi = {
  version: 1;
  getEnabled: () => boolean;
  setEnabled: (enabled: boolean) => void;
  subscribe: (callback: (enabled: boolean) => void) => { stop: () => void };
};

type GeminiToolOutputHostWindow = Window &
  Partial<Record<typeof GEMINI_TOOL_OUTPUT_GLOBAL_KEY, GeminiToolOutputModeApi>>;

export function getGeminiToolOutputHostWindow(): GeminiToolOutputHostWindow {
  return (window.parent ?? window) as GeminiToolOutputHostWindow;
}

export function getGeminiToolOutputModeApi(): GeminiToolOutputModeApi | undefined {
  const api = getGeminiToolOutputHostWindow()[GEMINI_TOOL_OUTPUT_GLOBAL_KEY];
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
