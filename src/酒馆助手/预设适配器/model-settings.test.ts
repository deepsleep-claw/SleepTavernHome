import { afterEach, expect, it, vi } from 'vitest';
import {
  GEMINI_TOOL_OUTPUT_GLOBAL_KEY,
  getGeminiToolOutputHostWindow,
  type GeminiToolOutputModeApi,
} from '../../公共模块/gemini_tool_output_mode';
import current_config from './current_dream_config.json';
import { copy, preset, prompt, setupAdapter } from './test-helpers';

afterEach(() => {
  delete getGeminiToolOutputHostWindow()[GEMINI_TOOL_OUTPUT_GLOBAL_KEY];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('思维链独立互斥，模型切换保持所选思维链并更新渠道适配', async () => {
  const { store, data } = setupAdapter();
  data.script = {
    groups: copy(current_config.groups.filter(group => ['模型适配', '思维链设置'].includes(group.id))),
  };
  data.current = preset(
    [
      '梦境思客Gemini',
      '梦境思客',
      'schema初始化-thinking',
      'schema初始化',
      'Deepseek官方',
      '硅基流动或其他',
      'KimiK3思考',
      'Gemini思考适配',
      'DeepSeek禁词',
      'Glm/Gemini禁词',
      '☆Gemini预填充对话',
      '☆Gemini预填充回复',
      '☆混元3预填充',
      '☆KimiK3预填充',
      '默认思维链',
      '发散思维链',
      'DeepseekV4pro思维链',
      '自定义思维链',
    ].map(name => prompt(name, true)),
  );
  store.refresh();
  const enabled = (name: string) => data.current.prompts.find(item => item.name === name)!.enabled;
  const activeChains = () =>
    data.current.prompts.filter(item => item.name.endsWith('思维链') && item.enabled).map(item => item.name);

  await store.applyOption('思维链设置', '默认思维链');
  expect(activeChains()).toEqual(['默认思维链']);
  for (const id of ['Deepseek官方', 'GLM5.3/其他模型', 'KimiK3', 'Gemini4', 'Gemini3', '混元3']) {
    await store.applyOption('模型适配', id);
    expect(enabled('Gemini思考适配')).toBe(id.startsWith('Gemini'));
    expect(activeChains()).toEqual(['默认思维链']);
  }
  await store.applyOption('思维链设置', '发散思维链');
  await store.applyOption('模型适配', 'Deepseek非官方');
  expect(activeChains()).toEqual(['发散思维链']);
});

it('额外模型适配跟随工具接口加载、开关通知和卸载', async () => {
  vi.useFakeTimers();
  const { store, data, replace } = setupAdapter();
  data.script = { groups: copy(current_config.groups.filter(group => group.id === '额外模型适配')) };
  let enabled = false;
  let changed: ((enabled: boolean) => void) | undefined;
  const stop = vi.fn();
  const api: GeminiToolOutputModeApi = {
    version: 1,
    getEnabled: () => enabled,
    setEnabled(value) {
      enabled = value;
      changed?.(enabled);
    },
    subscribe(callback) {
      changed = callback;
      return { stop };
    },
  };
  store.refresh();
  store.startEffectWatch();
  const option = () => store.groups[0].options[0];
  try {
    expect(option().selection_available).toBe(false);
    getGeminiToolOutputHostWindow()[GEMINI_TOOL_OUTPUT_GLOBAL_KEY] = api;
    vi.advanceTimersByTime(1000);
    expect(option().selection_available).toBe(true);
    await store.applyOption('额外模型适配', 'Gemini防截断');
    expect(enabled).toBe(true);
    expect(option().status).toBe('active');
    api.setEnabled(false);
    expect(option().status).toBe('inactive');
    await store.applyOption('额外模型适配', 'Gemini防截断');
    await store.applyOption('额外模型适配', 'Gemini防截断');
    expect(enabled).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    delete getGeminiToolOutputHostWindow()[GEMINI_TOOL_OUTPUT_GLOBAL_KEY];
    vi.advanceTimersByTime(1000);
    expect(option().selection_available).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
  } finally {
    store.stopEffectWatch();
  }
});
