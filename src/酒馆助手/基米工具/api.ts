import { watch } from 'vue';
import {
  GEMINI_TOOL_OUTPUT_GLOBAL_KEY,
  getGeminiToolOutputHostWindow,
  type GeminiToolOutputModeApi,
} from '../../公共模块/gemini_tool_output_mode';
import { SettingsSchema } from './config';
import { readSettings, type useJimiStore } from './settings';

export function initializeGeminiToolOutputModeApi(store: ReturnType<typeof useJimiStore>): { destroy: () => void } {
  const host = getGeminiToolOutputHostWindow();
  const subscriptions = new Set<() => void>();
  const api: GeminiToolOutputModeApi = {
    version: 1,
    getEnabled: () => readSettings().enabled,
    // 读取最新配置，以保留其他入口刚保存的工具设置。
    setEnabled: enabled => store.save({ ...readSettings(), enabled }),
    selectTool: (name, disabled_name) => {
      const settings = readSettings();
      const selected = settings.tools.find(tool => tool.name === name);
      if (
        settings.forceMode === 'named' &&
        settings.forcedTool === name &&
        selected?.enabled &&
        !settings.tools.some(tool => tool.name === disabled_name && tool.enabled)
      )
        return;

      // 已有工具保留参数定义；首次使用的正文工具采用默认文本结构。
      if (!selected) settings.tools.push({ ...SettingsSchema.parse({}).tools[0], name });
      settings.tools.forEach(tool => {
        if (tool.name === name) tool.enabled = true;
        if (tool.name === disabled_name) tool.enabled = false;
      });
      store.save({ ...settings, forceMode: 'named', forcedTool: name });
    },
    subscribe: callback => {
      const stopWatch = watch(
        () => store.settings.enabled,
        enabled => callback(enabled),
        { flush: 'sync' },
      );
      const stop = () => {
        stopWatch();
        subscriptions.delete(stop);
      };
      subscriptions.add(stop);
      return { stop };
    },
  };
  host[GEMINI_TOOL_OUTPUT_GLOBAL_KEY] = api;

  return {
    destroy() {
      subscriptions.forEach(stop => stop());
      if (host[GEMINI_TOOL_OUTPUT_GLOBAL_KEY] === api) delete host[GEMINI_TOOL_OUTPUT_GLOBAL_KEY];
    },
  };
}
