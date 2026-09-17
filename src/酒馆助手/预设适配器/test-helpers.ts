import { createPinia, setActivePinia } from 'pinia';
import { vi } from 'vitest';
import { usePresetAdapterStore } from './store';

export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function prompt(name: string, enabled = false, content = name): PresetPrompt {
  return { id: 'id-' + name, name, enabled, content, role: 'system', position: { type: 'relative' } };
}

export function preset(prompts: PresetPrompt[]): Preset {
  return { settings: {} as Preset['settings'], prompts, prompts_unused: [], extensions: {} };
}

export function setupAdapter() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const data = {
    global: { unrelated: { keep: true } } as Record<string, any>,
    script: {
      title: '测试预设',
      groups: [
        {
          id: 'styles',
          label: '文风',
          mode: 'multiple',
          options: [
            {
              id: 'styles-range',
              label: '{match}',
              type: 'between',
              match: { below: '开始', above: '结束' },
              enable: ['{match}'],
            },
          ],
        },
      ],
    } as Record<string, any>,
    name: '当前预设',
    current: preset([prompt('开始'), prompt('甲', true), prompt('乙'), prompt('结束')]),
    saved: {} as Record<string, Preset>,
  };
  data.saved[data.name] = copy(data.current);
  const replace = vi.fn(async (name: string, value: Preset) => {
    if (name === 'in_use') data.current = copy(value);
    else data.saved[name] = copy(value);
  });
  const variables = vi.fn((value: Record<string, any>, scope: { type: string }) => {
    if (scope.type === 'global') data.global = copy(value);
    if (scope.type === 'script') data.script = copy(value);
  });
  vi.stubGlobal('getScriptId', () => 'adapter-test');
  vi.stubGlobal('getLoadedPresetName', () => data.name);
  vi.stubGlobal('getPresetNames', () => ['in_use', ...Object.keys(data.saved)]);
  vi.stubGlobal('getPreset', (name: string) => {
    const value = name === 'in_use' ? data.current : data.saved[name];
    if (!value) throw new Error('预设不存在');
    return copy(value);
  });
  vi.stubGlobal('replacePreset', replace);
  vi.stubGlobal('loadPreset', vi.fn());
  vi.stubGlobal('getVariables', (scope: { type: string }) =>
    copy(scope.type === 'global' ? data.global : scope.type === 'script' ? data.script : {}),
  );
  vi.stubGlobal('replaceVariables', variables);
  vi.stubGlobal('SillyTavern', {
    getCurrentChatId: () => '',
    getContext: () => ({}),
    uuidv4: () => crypto.randomUUID(),
  });
  vi.stubGlobal('toastr', { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() });
  const store = usePresetAdapterStore(pinia);
  store.refresh();
  return { store, data, replace, variables, pinia };
}

export function settingsFile(names: string[]) {
  return JSON.stringify({
    type: 'sleep-preset-adapter.match-settings',
    version: 1,
    items: names.map(name => ({
      group_id: 'styles',
      match_id: 'styles-range',
      name,
      prompt: prompt(name, true, '导入内容-' + name),
    })),
  });
}
