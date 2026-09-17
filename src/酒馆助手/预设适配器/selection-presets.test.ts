import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSelectionPlan,
  captureSelections,
  isSelectionModified,
  resolveSelections,
  SELECTION_PRESETS_KEY,
  SelectionLibrarySchema,
  selectionKey,
  selectionPresetFile,
  type SelectionGroup,
  type SelectionReference,
} from './selection-presets';
import { copy, prompt, setupAdapter } from './test-helpers';

afterEach(() => vi.unstubAllGlobals());

function group(id = 'group', mode: 'single' | 'multiple' = 'multiple'): SelectionGroup {
  return {
    id,
    label: id,
    mode,
    disable_group_indexes: [],
    enable_group_indexes: [],
    options: ['甲', '乙'].map((name, index) => ({
      selection: { group_id: id, group_label: id, option_id: 'range', prompt_name: name, label: name },
      status: index === 0 ? 'active' : 'inactive',
      enable_indexes: [index],
      disable_indexes: [],
      effects: [],
    })),
  };
}

describe('组合识别与应用计划', () => {
  it('使用分组和条目身份识别，位置与显示名称独立', () => {
    const original = group();
    const saved = captureSelections([original]);
    const moved = group();
    moved.options.reverse();
    moved.options[1].enable_indexes = [7];
    moved.options[1].selection.label = '新的显示名';
    expect(buildSelectionPlan(saved, [moved]).prompt_states.get(7)).toBe(true);
    expect(selectionKey(saved[0])).toBe(selectionKey(moved.options[1].selection));
  });
  it('按选择设置多选开关', () => {
    const value = group();
    const plan = buildSelectionPlan([value.options[1].selection], [value]);
    expect([...plan.prompt_states]).toEqual([
      [0, false],
      [1, true],
    ]);
  });
  it('单选应用组基线，再应用所选项', () => {
    const value = group('single', 'single');
    value.disable_group_indexes = [0, 1, 2];
    value.enable_group_indexes = [3];
    const plan = buildSelectionPlan([value.options[1].selection], [value]);
    expect([...plan.prompt_states]).toEqual([
      [0, false],
      [1, true],
      [2, false],
      [3, true],
    ]);
  });
  it('空组合关闭当前可操作选项', () => {
    expect([...buildSelectionPlan([], [group()]).prompt_states.values()]).toEqual([false, false]);
  });
  it('全部缺失时保持页面状态', () => {
    const saved = captureSelections([group('old')]);
    const plan = buildSelectionPlan(saved, [group('new')]);
    expect(plan.missing).toHaveLength(1);
    expect(plan.prompt_states.size).toBe(0);
    expect(saved).toHaveLength(1);
  });
  it('同名条目歧义作为不可用项返回', () => {
    const value = group();
    value.options.push(copy(value.options[0]));
    expect(resolveSelections([value.options[0].selection], [value]).missing[0]).toContain('无法唯一匹配');
  });
  it('缺失项不产生页面修改标记', () => {
    const value = group();
    const missing: SelectionReference = { ...value.options[0].selection, group_id: 'other' };
    expect(isSelectionModified([...captureSelections([value]), missing], [value])).toBe(false);
  });
  it('报告单选组合和跨组目标冲突', () => {
    const value = group('single', 'single');
    expect(
      buildSelectionPlan(
        value.options.map(option => option.selection),
        [value],
      ).errors,
    ).toHaveLength(1);
    const other = group('other');
    other.options[0].enable_indexes = [2];
    other.options[0].disable_indexes = [0];
    expect(
      buildSelectionPlan([value.options[0].selection, other.options[0].selection], [value, other]).errors,
    ).toHaveLength(1);
  });
  it('共享功能开关由启用选项决定', () => {
    const first = group('first');
    const second = group('second');
    first.options[0].effects = ['effect'];
    second.options[0].effects = ['effect'];
    expect(buildSelectionPlan([first.options[0].selection], [first, second]).effect_states.get('effect')).toBe(true);
  });
  it('报告同组内互相冲突的多选要求', () => {
    const value = group();
    value.options[1].disable_indexes = [0];
    expect(
      buildSelectionPlan(
        value.options.map(option => option.selection),
        [value],
      ).errors,
    ).toHaveLength(1);
  });
});

describe('全局组合库', () => {
  it('新建接收当前状态并保留已有快照和其他全局变量', () => {
    const { store, data } = setupAdapter();
    expect(store.createSelectionPreset('第一份')).toBe(true);
    const first = copy(data.global[SELECTION_PRESETS_KEY].presets[0]);
    data.current.prompts[1].enabled = false;
    data.current.prompts[2].enabled = true;
    expect(store.createSelectionPreset('第二份')).toBe(true);
    expect(data.global[SELECTION_PRESETS_KEY].presets[0]).toEqual(first);
    expect(data.global[SELECTION_PRESETS_KEY].presets[1].selections[0].prompt_name).toBe('乙');
    expect(data.global.unrelated).toEqual({ keep: true });
  });
  it('重复应用组合不会反转多选状态', async () => {
    const { store, data, replace } = setupAdapter();
    store.createSelectionPreset('组合');
    const id = store.active_selection_preset!.id;
    data.current.prompts[1].enabled = false;
    data.current.prompts[2].enabled = true;
    await store.applySelectionPreset(id);
    await store.applySelectionPreset(id);
    expect(data.current.prompts.map(item => item.enabled)).toEqual([false, true, false, false]);
    expect(replace).toHaveBeenCalledTimes(1);
  });
  it('切换、刷新和导出保留缺失内容，显式保存更新快照', async () => {
    const { store, data } = setupAdapter();
    data.current.prompts.splice(2, 0, prompt('缺失项', true));
    store.createSelectionPreset('组合');
    const saved = copy(store.active_selection_preset!);
    data.current.prompts = data.current.prompts.filter(item => item.name !== '缺失项');
    const result = await store.applySelectionPreset(saved.id);
    expect(result?.messages[0]).toContain('缺失项');
    store.refresh();
    expect(data.global[SELECTION_PRESETS_KEY].presets[0]).toEqual(saved);
    expect(selectionPresetFile(store.active_selection_preset!).preset.selections).toHaveLength(2);
    expect(store.selection_modified).toBe(false);
    store.saveSelectionPreset();
    expect(data.global[SELECTION_PRESETS_KEY].presets[0].selections).toHaveLength(1);
  });
  it('条目重新出现后可以应用原组合', async () => {
    const { store, data } = setupAdapter();
    store.createSelectionPreset('组合');
    const id = store.active_selection_preset!.id;
    data.current.prompts = data.current.prompts.filter(item => item.name !== '甲');
    await store.applySelectionPreset(id);
    data.current.prompts.splice(2, 0, prompt('甲'));
    await store.applySelectionPreset(id);
    expect(data.current.prompts.find(item => item.name === '甲')?.enabled).toBe(true);
  });
  it('重命名和删除只修改组合库', () => {
    const { store, data, replace } = setupAdapter();
    store.createSelectionPreset('组合');
    const current = copy(data.current);
    const id = store.active_selection_preset!.id;
    store.renameSelectionPreset(id, '新名称');
    expect(store.active_selection_preset?.name).toBe('新名称');
    store.deleteSelectionPreset(id);
    expect(store.selection_library.presets).toHaveLength(0);
    expect(data.current).toEqual(current);
    expect(replace).not.toHaveBeenCalled();
  });
  it('文件导入新增记录并保持当前按钮组合', () => {
    const { store, data } = setupAdapter();
    store.createSelectionPreset('组合');
    const source = selectionPresetFile(store.active_selection_preset!);
    const imported = store.readSelectionPresetFile(JSON.stringify(source))!;
    const selected_id = store.active_selection_preset!.id;
    expect(store.createSelectionPreset('导入组合', imported)).toBe(true);
    expect(store.selection_library.presets).toHaveLength(2);
    expect(store.active_selection_preset?.id).toBe(selected_id);
    expect(data.current.prompts[1].enabled).toBe(true);
  });
  it('重名和无效库不覆盖已有数据', () => {
    const { store, data } = setupAdapter();
    store.createSelectionPreset('组合');
    const original = copy(data.global);
    expect(store.createSelectionPreset('组合')).toBe(false);
    expect(data.global).toEqual(original);
    data.global[SELECTION_PRESETS_KEY] = { version: 2, presets: ['invalid'] };
    store.refresh();
    expect(store.selection_library_error).not.toBe('');
    expect(store.createSelectionPreset('另一份')).toBe(false);
    expect(data.global[SELECTION_PRESETS_KEY].version).toBe(2);
  });
  it('库校验拒绝重复标识', () => {
    const { store } = setupAdapter();
    store.createSelectionPreset('组合');
    const value = copy(store.selection_library);
    value.presets.push({ ...value.presets[0], name: '第二份' });
    expect(SelectionLibrarySchema.safeParse(value).success).toBe(false);
  });
  it('不可用的功能项与其他可匹配选项分开处理', async () => {
    const { store, data } = setupAdapter();
    data.script.groups.push({
      id: 'effects',
      label: '功能',
      mode: 'multiple',
      options: [{ id: 'kimi', label: 'Kimi', effect: ['kimi_partial_mode'] }],
    });
    const id = 'with-effect';
    data.global[SELECTION_PRESETS_KEY] = {
      version: 1,
      active_id: '',
      presets: [
        {
          id,
          name: '功能组合',
          selections: [
            { group_id: 'styles', group_label: '文风', option_id: 'styles-range', prompt_name: '乙', label: '乙' },
            { group_id: 'effects', group_label: '功能', option_id: 'kimi', label: 'Kimi' },
          ],
        },
      ],
    };
    const result = await store.applySelectionPreset(id);
    expect(result?.messages[0]).toContain('Kimi');
    expect(data.current.prompts[2].enabled).toBe(true);
    expect(data.global[SELECTION_PRESETS_KEY].presets[0].selections).toHaveLength(2);
  });
  it('功能应用失败时恢复之前的提示词状态', async () => {
    const { store, data } = setupAdapter();
    data.script.groups.push({
      id: 'effects',
      label: '功能',
      mode: 'multiple',
      options: [{ id: 'kimi', label: 'Kimi', effect: ['kimi_partial_mode'] }],
    });
    const api = {
      version: 1,
      getEnabled: () => false,
      setEnabled: () => {
        throw new Error('功能失败');
      },
      subscribe: () => ({ stop() {} }),
    };
    Object.assign(window, { __dream_whale_kimi_partial_mode_api__: api });
    try {
      data.global[SELECTION_PRESETS_KEY] = {
        version: 1,
        active_id: '',
        presets: [
          {
            id: 'rollback',
            name: '组合',
            selections: [
              { group_id: 'styles', group_label: '文风', option_id: 'styles-range', prompt_name: '乙', label: '乙' },
              { group_id: 'effects', group_label: '功能', option_id: 'kimi', label: 'Kimi' },
            ],
          },
        ],
      };
      const previous = copy(data.current);
      const result = await store.applySelectionPreset('rollback');
      expect(result?.title).toContain('失败');
      expect(data.current).toEqual(previous);
      expect(data.global[SELECTION_PRESETS_KEY].active_id).toBe('');
    } finally {
      Reflect.deleteProperty(window, '__dream_whale_kimi_partial_mode_api__');
    }
  });
});
