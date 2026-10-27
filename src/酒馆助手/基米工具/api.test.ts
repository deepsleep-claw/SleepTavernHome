import { createPinia } from 'pinia';
import { afterEach, expect, it, vi } from 'vitest';
import {
  GEMINI_TOOL_OUTPUT_GLOBAL_KEY,
  getGeminiToolOutputHostWindow,
  getGeminiToolOutputModeApi,
} from '../../公共模块/gemini_tool_output_mode';
import { initializeGeminiToolOutputModeApi } from './api';
import { SETTINGS_KEY, SettingsSchema } from './config';
import { useJimiStore } from './settings';
import { installVariables } from './test-helpers';

afterEach(() => {
  delete getGeminiToolOutputHostWindow()[GEMINI_TOOL_OUTPUT_GLOBAL_KEY];
  vi.unstubAllGlobals();
});

it('外部开关写入最新脚本配置并与设置面板同步', () => {
  const variables = installVariables({ unrelated: { keep: true }, [SETTINGS_KEY]: SettingsSchema.parse({}) });
  const store = useJimiStore(createPinia());
  const lifetime = initializeGeminiToolOutputModeApi(store);
  const api = getGeminiToolOutputModeApi()!;
  const changed = vi.fn();
  const subscription = api.subscribe(changed);
  const latest = SettingsSchema.parse({ modelNameIncludes: 'MyGemini', promptMode: 'user', promptDepth: -1 });
  variables.set({ ...variables.get(), [SETTINGS_KEY]: latest });
  try {
    api.setEnabled(true);
    expect(variables.get()).toEqual({ unrelated: { keep: true }, [SETTINGS_KEY]: { ...latest, enabled: true } });
    expect(store.settings.enabled).toBe(true);
    expect(api.getEnabled()).toBe(true);
    expect(changed).toHaveBeenLastCalledWith(true);

    store.save({ ...store.settings, enabled: false });
    expect(api.getEnabled()).toBe(false);
    expect(changed).toHaveBeenLastCalledWith(false);
    subscription.stop();
    api.setEnabled(true);
    expect(changed).toHaveBeenCalledTimes(2);
  } finally {
    lifetime.destroy();
  }
});

it('读取即时脚本变量并在卸载时停止订阅', () => {
  const variables = installVariables({ [SETTINGS_KEY]: SettingsSchema.parse({}) });
  const store = useJimiStore(createPinia());
  const lifetime = initializeGeminiToolOutputModeApi(store);
  const api = getGeminiToolOutputModeApi()!;
  const changed = vi.fn();
  api.subscribe(changed);
  variables.set({ [SETTINGS_KEY]: { ...variables.get()[SETTINGS_KEY], enabled: true } });
  expect(api.getEnabled()).toBe(true);
  lifetime.destroy();
  expect(getGeminiToolOutputModeApi()).toBeUndefined();
  store.save({ ...store.settings, enabled: true });
  expect(changed).not.toHaveBeenCalled();
});

it('旧实例卸载时保留新实例的接口', () => {
  installVariables({ [SETTINGS_KEY]: SettingsSchema.parse({}) });
  const first = initializeGeminiToolOutputModeApi(useJimiStore(createPinia()));
  const second = initializeGeminiToolOutputModeApi(useJimiStore(createPinia()));
  const api = getGeminiToolOutputModeApi();
  first.destroy();
  expect(getGeminiToolOutputModeApi()).toBe(api);
  second.destroy();
  expect(getGeminiToolOutputModeApi()).toBeUndefined();
});
