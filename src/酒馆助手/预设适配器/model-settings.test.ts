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

it('思维链独立互斥，切换非Gemini适配时恢复默认思维链', async () => {
  const { store, data } = setupAdapter();
  data.script = {
    prompt_rules: copy(current_config.prompt_rules),
    groups: copy(current_config.groups.filter(group => ['模型适配', '思维链设置'].includes(group.id))),
  };
  data.current = preset(
    [
      '梦境思客Gemini',
      '梦境思客',
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
      '隐式思维链',
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
  await store.applyOption('思维链设置', '自定义思维链');
  await store.applyOption('模型适配', 'Deepseek非官方');
  expect(activeChains()).toEqual(['默认思维链']);
  await store.applyOption('思维链设置', '隐式思维链');
  expect(activeChains()).toEqual(['隐式思维链']);
  await store.applyOption('思维链设置', '默认思维链');
  expect(activeChains()).toEqual(['默认思维链']);
});

function setupModelOptions() {
  const adapter = setupAdapter();
  adapter.data.script = {
    prompt_rules: copy(current_config.prompt_rules),
    groups: copy(current_config.groups.filter(group => ['模型适配', '额外模型适配', '思维链设置'].includes(group.id))),
  };
  const names = [
    ...new Set(
      adapter.data.script.groups.flatMap((group: any) => [
        ...(group.enable_group ?? []),
        ...(group.disable_group ?? []),
        ...group.options.flatMap((option: any) => [
          ...(option.enable ?? []),
          ...(option.disable ?? []),
          ...(option.on_enable?.enable ?? []),
          ...(option.on_enable?.disable ?? []),
        ]),
      ]),
    ),
  ] as string[];
  adapter.data.current = preset(names.map(name => prompt(name)));
  adapter.store.refresh();
  return {
    ...adapter,
    route: () =>
      adapter.store.groups
        .find(group => group.id === '额外模型适配')!
        .options.find(option => option.id === 'Gemini防路由')!,
    enabled: (name: string) => adapter.data.current.prompts.find(item => item.name === name)!.enabled,
  };
}

function installToolApi(initial = false) {
  let enabled = initial;
  let changed: ((enabled: boolean) => void) | undefined;
  const selectTool = vi.fn();
  const api: GeminiToolOutputModeApi = {
    version: 1,
    getEnabled: () => enabled,
    setEnabled(value) {
      enabled = value;
      changed?.(value);
    },
    selectTool,
    subscribe(callback) {
      changed = callback;
      return { stop: vi.fn() };
    },
  };
  getGeminiToolOutputHostWindow()[GEMINI_TOOL_OUTPUT_GLOBAL_KEY] = api;
  return { api, selectTool };
}

it('Gemini防路由的开启与关闭均受模型选项限制', async () => {
  const { store, replace, route, enabled } = setupModelOptions();
  expect(route().requirements_met).toBe(false);
  await store.applyOption('额外模型适配', 'Gemini防路由');
  expect(replace).not.toHaveBeenCalled();
  for (const model of ['Gemini3', 'Gemini4']) {
    await store.applyOption('模型适配', model);
    expect(route().requirements_met).toBe(true);
    await store.applyOption('额外模型适配', 'Gemini防路由');
    expect(enabled('Gemini随机开头')).toBe(true);
    await store.applyOption('模型适配', 'Deepseek官方');
    expect(enabled('默认思维链')).toBe(true);
    expect(enabled('隐式思维链')).toBe(false);
    expect(route().requirements_met).toBe(false);
    await store.applyOption('额外模型适配', 'Gemini防路由');
    expect(enabled('Gemini随机开头')).toBe(false);
    await store.applyOption('模型适配', model);
    expect(enabled('默认思维链')).toBe(true);
    expect(enabled('隐式思维链')).toBe(false);
    await store.applyOption('额外模型适配', 'Gemini防路由');
    expect(enabled('Gemini随机开头')).toBe(true);
    expect(enabled('隐式思维链')).toBe(true);
    expect(enabled('默认思维链')).toBe(false);
    await store.applyOption('额外模型适配', 'Gemini防路由');
    expect(enabled('Gemini随机开头')).toBe(false);
    expect(enabled('默认思维链')).toBe(true);
    expect(enabled('隐式思维链')).toBe(false);
  }
});

it('Gemini防路由开启时替换任何已选思维链', async () => {
  const { store, data, enabled } = setupModelOptions();
  await store.applyOption('模型适配', 'Gemini3');
  for (const chain of ['默认思维链', '隐式思维链', '自定义思维链']) {
    data.current.prompts.forEach(item => {
      if (item.name.endsWith('思维链')) item.enabled = item.name === chain;
    });
    await store.applyOption('额外模型适配', 'Gemini防路由');
    expect(
      data.current.prompts.filter(item => item.enabled && item.name.endsWith('思维链')).map(item => item.name),
    ).toEqual(['隐式思维链']);
    expect(enabled('Gemini随机开头')).toBe(true);
    await store.applyOption('额外模型适配', 'Gemini防路由');
    expect(
      data.current.prompts.filter(item => item.enabled && item.name.endsWith('思维链')).map(item => item.name),
    ).toEqual(['默认思维链']);
  }
});

it.each(['Gemini3', 'Gemini4'])('%s在防路由开关和模型切换时保持开启schema初始化', async model => {
  const { store, enabled, route } = setupModelOptions();
  await store.applyOption('模型适配', model);
  expect(enabled('schema初始化')).toBe(true);
  await store.applyOption('额外模型适配', 'Gemini防路由');
  expect(enabled('schema初始化')).toBe(true);
  expect(route().requirements_met).toBe(true);
  for (const next_model of ['Gemini4', 'Gemini3']) {
    await store.applyOption('模型适配', next_model);
    expect(enabled('schema初始化')).toBe(true);
    expect(
      store.groups.find(group => group.id === '模型适配')!.options.find(option => option.id === next_model)!.status,
    ).toBe('active');
    expect(route().requirements_met).toBe(true);
  }
  await store.applyOption('额外模型适配', 'Gemini防路由');
  expect(enabled('schema初始化')).toBe(true);
  expect(route().requirements_met).toBe(true);
  await store.applyOption('模型适配', 'Deepseek官方');
  expect(enabled('schema初始化')).toBe(true);
});

it.each(['先防截断', '先防路由'])('%s时都按防路由状态选择正文工具', async order => {
  const { store } = setupModelOptions();
  const { selectTool } = installToolApi();
  await store.applyOption('模型适配', 'Gemini4');
  const options = order === '先防截断' ? ['Gemini防截断', 'Gemini防路由'] : ['Gemini防路由', 'Gemini防截断'];
  await store.applyOption('额外模型适配', options[0]);
  if (order === '先防路由') expect(selectTool).not.toHaveBeenCalled();
  await store.applyOption('额外模型适配', options[1]);
  expect(selectTool).toHaveBeenLastCalledWith('publish_story_content', 'publish_story');
  await store.applyOption('额外模型适配', 'Gemini防路由');
  expect(selectTool).toHaveBeenLastCalledWith('publish_story', 'publish_story_content');
});

it('外部开启防截断时同步当前防路由的正文工具', async () => {
  const { store } = setupModelOptions();
  const { api, selectTool } = installToolApi();
  await store.applyOption('模型适配', 'Gemini3');
  await store.applyOption('额外模型适配', 'Gemini防路由');
  store.startEffectWatch();
  try {
    api.setEnabled(true);
    expect(selectTool).toHaveBeenLastCalledWith('publish_story_content', 'publish_story');
  } finally {
    store.stopEffectWatch();
  }
});

it('选项组预设可同时开启Gemini和防路由，并应用思维链联动', async () => {
  const { store, enabled } = setupModelOptions();
  const { selectTool } = installToolApi();
  await store.applyOption('模型适配', 'Gemini4');
  await store.applyOption('额外模型适配', 'Gemini防路由');
  await store.applyOption('额外模型适配', 'Gemini防截断');
  await store.applyOption('思维链设置', '默认思维链');
  expect(store.createSelectionPreset('Gemini写作')).toBe(true);
  const id = store.active_selection_preset!.id;
  await store.applyOption('额外模型适配', 'Gemini防路由');
  await store.applyOption('模型适配', 'Deepseek官方');
  const result = await store.applySelectionPreset(id);
  expect(result).toBeUndefined();
  expect(enabled('Gemini随机开头')).toBe(true);
  expect(enabled('默认思维链')).toBe(false);
  expect(enabled('隐式思维链')).toBe(true);
  expect(enabled('schema初始化')).toBe(true);
  expect(selectTool).toHaveBeenLastCalledWith('publish_story_content', 'publish_story');
});

it('应用关闭防路由的Gemini选项组预设时保持开启schema初始化', async () => {
  const { store, enabled, route } = setupModelOptions();
  await store.applyOption('模型适配', 'Gemini3');
  expect(store.createSelectionPreset('Gemini普通模式')).toBe(true);
  const id = store.active_selection_preset!.id;
  await store.applyOption('额外模型适配', 'Gemini防路由');
  await store.applyOption('模型适配', 'Gemini4');
  expect(await store.applySelectionPreset(id)).toBeUndefined();
  expect(enabled('Gemini随机开头')).toBe(false);
  expect(enabled('schema初始化')).toBe(true);
  expect(route().requirements_met).toBe(true);
});

it('额外模型适配跟随工具接口加载、开关通知和卸载', async () => {
  vi.useFakeTimers();
  const { store, replace } = setupModelOptions();
  await store.applyOption('模型适配', 'Gemini3');
  replace.mockClear();
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
    selectTool: vi.fn(),
    subscribe(callback) {
      changed = callback;
      return { stop };
    },
  };
  store.refresh();
  store.startEffectWatch();
  const option = () => store.groups.find(group => group.id === '额外模型适配')!.options[0];
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
