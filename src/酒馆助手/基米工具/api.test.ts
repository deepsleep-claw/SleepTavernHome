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

it('正文工具切换保留工具定义和其他设置，并指定启用工具', () => {
  const initial = SettingsSchema.parse({
    enabled: true,
    keepOriginalText: true,
    promptMode: 'user',
    promptDepth: -1,
    tools: [
      {
        ...SettingsSchema.parse({}).tools[0],
        outputPath: 'story',
        parameters: {
          type: 'object',
          properties: { story: { type: 'string' } },
          required: ['story'],
        },
      },
      { ...SettingsSchema.parse({}).tools[0], name: 'publish_story_content', enabled: false },
      { ...SettingsSchema.parse({}).tools[0], name: 'other_tool' },
    ],
  });
  const variables = installVariables({ unrelated: 123, [SETTINGS_KEY]: initial });
  const lifetime = initializeGeminiToolOutputModeApi(useJimiStore(createPinia()));
  const api = getGeminiToolOutputModeApi()!;
  try {
    api.selectTool!('publish_story_content', 'publish_story');
    const selected = variables.get()[SETTINGS_KEY];
    expect(selected.forceMode).toBe('named');
    expect(selected.forcedTool).toBe('publish_story_content');
    expect(selected.tools.map((tool: { enabled: boolean }) => tool.enabled)).toEqual([false, true, true]);
    expect(selected.tools[0].parameters).toEqual(initial.tools[0].parameters);
    expect(selected.tools[0].outputPath).toBe('story');
    expect(selected.promptMode).toBe('user');
    expect(selected.keepOriginalText).toBe(true);
    expect(variables.get().unrelated).toBe(123);
    const scope_count = variables.scopes.length;
    api.selectTool!('publish_story_content', 'publish_story');
    expect(variables.scopes).toHaveLength(scope_count + 1);
    api.selectTool!('publish_story', 'publish_story_content');
    expect(variables.get()[SETTINGS_KEY].forcedTool).toBe('publish_story');
    expect(variables.get()[SETTINGS_KEY].tools.map((tool: { enabled: boolean }) => tool.enabled)).toEqual([
      true,
      false,
      true,
    ]);
  } finally {
    lifetime.destroy();
  }
});

it('默认配置首次切换正文工具时创建文本工具', () => {
  const variables = installVariables({ [SETTINGS_KEY]: SettingsSchema.parse({ enabled: true }) });
  const lifetime = initializeGeminiToolOutputModeApi(useJimiStore(createPinia()));
  try {
    getGeminiToolOutputModeApi()!.selectTool!('publish_story_content', 'publish_story');
    const settings = variables.get()[SETTINGS_KEY];
    expect(SettingsSchema.safeParse(settings).success).toBe(true);
    expect(settings.tools[1]).toMatchObject({ name: 'publish_story_content', outputPath: 'text', enabled: true });
  } finally {
    lifetime.destroy();
  }
});
