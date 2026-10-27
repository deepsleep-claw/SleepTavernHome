import { afterEach, expect, it, vi } from 'vitest';
import { getBaiBaiDisabledPrompts, readBaiBaiPromptGroups } from './baibai-compat';

afterEach(() => vi.unstubAllGlobals());

it('当前预设使用柏宝箱实时分组；其它预设使用各自的已存分组', () => {
  const persisted = {
    groups: [{ id: 'old', name: '已存分组', enabled: false }],
    prompts: { a: { groupId: 'old' } },
  };
  const live = {
    groups: [{ id: 'new', name: '实时分组', enabled: false }],
    prompts: { b: { groupId: 'new' } },
  };
  vi.stubGlobal('__baiBaiToolkitExtensionInstalled', {
    installed: true,
    presetPromptGroupRuntimePresetName: '当前预设',
    presetPromptGroupRuntimeState: live,
    __baiBaiToolkitPresetGroupGenerationGatePatch: {},
  });
  const settings = { extensions: { baibaiToolkit: { presetPromptGroups: persisted } } };
  expect(readBaiBaiPromptGroups(settings, '当前预设')).toBe(live);
  expect([...getBaiBaiDisabledPrompts(settings, '当前预设')]).toEqual([['b', '实时分组']]);
  expect([...getBaiBaiDisabledPrompts(settings, '其它预设')]).toEqual([['a', '已存分组']]);
});
