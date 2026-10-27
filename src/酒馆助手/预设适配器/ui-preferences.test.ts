import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SELECTION_PRESETS_KEY } from './selection-presets';
import { UI_PREFERENCES_KEY, usePresetAdapterStore } from './store';
import { copy, setupAdapter } from './test-helpers';

afterEach(() => vi.unstubAllGlobals());

describe('界面偏好持久化', () => {
  it.each([
    {
      name: '新增适配组跟随模型组并保留已有排序',
      defaults: ['模型适配', '额外模型适配', '思维链设置', '文风'],
      saved: ['文风', '模型适配'],
      expected: ['文风', '模型适配', '额外模型适配', '思维链设置'],
    },
    {
      name: '开头的新增组定位到后方已有分组之前',
      defaults: ['介绍', '额外设置', '模型适配', '文风'],
      saved: ['文风', '模型适配'],
      expected: ['文风', '介绍', '额外设置', '模型适配'],
    },
    {
      name: '连续新增组沿用配置顺序',
      defaults: ['模型适配', '额外模型适配', '思维链设置', '文风', '输出模式'],
      saved: ['模型适配', '文风'],
      expected: ['模型适配', '额外模型适配', '思维链设置', '文风', '输出模式'],
    },
    {
      name: '没有可用的已保存位置时使用配置顺序',
      defaults: ['模型适配', '文风'],
      saved: ['其他分组'],
      expected: ['模型适配', '文风'],
    },
    {
      name: '完整的自定义顺序优先',
      defaults: ['模型适配', '文风', '输出模式'],
      saved: ['输出模式', '文风', '模型适配'],
      expected: ['输出模式', '文风', '模型适配'],
    },
  ])('$name', ({ defaults, saved, expected }) => {
    const { store, data } = setupAdapter();
    data.script.groups = defaults.map(id => ({ id, label: id, options: [] }));
    data.global[UI_PREFERENCES_KEY] = { group_order: saved };

    store.refresh();
    store.refresh();

    expect(store.groups.map(group => group.id)).toEqual(expected);
    expect(data.global[UI_PREFERENCES_KEY].group_order).toEqual(saved);
  });

  it('将旧界面偏好迁移到全局并保留其他变量', () => {
    const { store, data, variables } = setupAdapter();
    const preferences = {
      group_order: ['styles', 'styles'],
      collapsed_group_ids: ['styles'],
      favorite_option_keys: ['favorite'],
      favorites_collapsed: true,
      theme: 'moon-white',
    };
    const script = copy(data.script);
    data.script.ui = preferences;
    const library = { version: 1, active_id: '', presets: [] };
    data.global[SELECTION_PRESETS_KEY] = library;

    store.refresh();

    expect(store.ui_preferences).toEqual({ ...preferences, group_order: ['styles'] });
    expect(data.global).toEqual({
      unrelated: { keep: true },
      [SELECTION_PRESETS_KEY]: library,
      [UI_PREFERENCES_KEY]: store.ui_preferences,
    });
    expect(data.script).toEqual(script);
    variables.mockClear();
    store.refresh();
    expect(variables).not.toHaveBeenCalled();
  });

  it('已有全局值优先于脚本中的界面偏好', () => {
    const { store, data } = setupAdapter();
    data.global[UI_PREFERENCES_KEY] = { theme: 'deep-blue', collapsed_group_ids: ['styles'] };
    data.script.ui = { theme: 'unknown', favorites_collapsed: true };

    store.refresh();

    expect(store.ui_preferences).toMatchObject({ theme: 'deep-blue', favorites_collapsed: false });
    expect(store.isGroupCollapsed('styles')).toBe(true);
    expect(data.script.ui).toBeUndefined();
    expect(store.has_blocking_errors).toBe(false);
  });

  it('设置在更换脚本和重新打开后保持，并支持重置', () => {
    const { store, data, variables } = setupAdapter();
    data.script.groups.push({ id: 'other', label: '其他', options: [] });
    store.refresh();
    const script = copy(data.script);
    variables.mockClear();

    store.setTheme('jade-green');
    store.moveGroup('other', 'styles');
    store.toggleGroupCollapsed('styles');
    store.toggleFavoritesCollapsed();
    const [first, second] = store.groups.find(group => group.id === 'styles')!.options;
    store.toggleFavoriteOption('styles', first.id);
    store.toggleFavoriteOption('styles', second.id);
    const [first_key, second_key] = store.ui_preferences.favorite_option_keys;
    store.moveFavorite(second_key, first_key);

    const preferences = copy(store.ui_preferences);
    expect(preferences).toEqual({
      theme: 'jade-green',
      group_order: ['other', 'styles'],
      collapsed_group_ids: ['styles'],
      favorites_collapsed: true,
      favorite_option_keys: [second_key, first_key],
    });
    expect(data.global[UI_PREFERENCES_KEY]).toEqual(preferences);
    expect(data.script).toEqual(script);
    expect(variables.mock.calls.every(([, scope]) => scope.type === 'global')).toBe(true);

    data.script = { ...copy(script), title: '另一个脚本配置' };
    data.name = '另一个预设';
    vi.stubGlobal('getScriptId', () => 'another-adapter');
    const reopened = usePresetAdapterStore(createPinia());
    reopened.refresh();
    expect(reopened.ui_preferences).toEqual(preferences);
    expect(reopened.groups.map(group => group.id)).toEqual(['other', 'styles']);
    expect(reopened.favorite_options.map(option => option.key)).toEqual([second_key, first_key]);

    reopened.restoreGroupOrder();
    reopened.setAllGroupsCollapsed(true);
    expect(reopened.all_groups_collapsed).toBe(true);
    reopened.setAllGroupsCollapsed(false);
    reopened.clearFavorites();
    reopened.toggleFavoritesCollapsed();
    reopened.refresh();
    expect(reopened.groups.map(group => group.id)).toEqual(['styles', 'other']);
    expect(reopened.ui_preferences).toEqual({
      theme: 'jade-green',
      group_order: [],
      collapsed_group_ids: [],
      favorites_collapsed: false,
      favorite_option_keys: [],
    });
    expect(data.global.unrelated).toEqual({ keep: true });
  });

  it('全局写入失败时保留旧值并允许重试迁移', () => {
    const { store, data, variables } = setupAdapter();
    const preferences = { theme: 'frost-blue', collapsed_group_ids: ['styles'] };
    data.script.ui = copy(preferences);
    const write = variables.getMockImplementation()!;
    variables.mockImplementation((value, scope) => {
      if (scope.type === 'global') throw new Error('写入失败');
      write(value, scope);
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    store.refresh();

    expect(warning).toHaveBeenCalled();
    expect(data.script.ui).toEqual(preferences);
    expect(data.global[UI_PREFERENCES_KEY]).toBeUndefined();
    expect(store.ui_preferences.theme).toBe('frost-blue');
    variables.mockImplementation(write);
    store.refresh();
    expect(data.script.ui).toBeUndefined();
    expect(data.global[UI_PREFERENCES_KEY]).toEqual(store.ui_preferences);
  });

  it('旧位置清理失败时保留已迁移的全局值', () => {
    const { store, data, variables } = setupAdapter();
    data.script.ui = { theme: 'purple-black' };
    const write = variables.getMockImplementation()!;
    variables.mockImplementation((value, scope) => {
      if (scope.type === 'script') throw new Error('写入失败');
      write(value, scope);
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    store.refresh();

    expect(data.global[UI_PREFERENCES_KEY].theme).toBe('purple-black');
    expect(data.script.ui).toEqual({ theme: 'purple-black' });
    data.script.ui.theme = 'moon-white';
    variables.mockImplementation(write);
    store.refresh();
    expect(store.ui_preferences.theme).toBe('purple-black');
    expect(data.script.ui).toBeUndefined();
  });

  it('全局偏好损坏时保留当前显示及旧值', () => {
    const { store, data } = setupAdapter();
    store.setTheme('deep-blue');
    data.global[UI_PREFERENCES_KEY] = { theme: 'unknown' };
    data.script.ui = { theme: 'moon-white' };
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    store.refresh();

    expect(store.ui_preferences.theme).toBe('deep-blue');
    expect(data.script.ui).toEqual({ theme: 'moon-white' });
    expect(data.global[UI_PREFERENCES_KEY]).toEqual({ theme: 'unknown' });
    expect(store.has_blocking_errors).toBe(false);
  });

  it('新配置使用默认界面偏好', () => {
    const { store, data } = setupAdapter();
    data.script = {};

    store.refresh();

    expect(data.script.groups.length).toBeGreaterThan(0);
    expect(data.script.ui).toBeUndefined();
    expect(data.script.summary.settings).toBeUndefined();
    expect(store.ui_preferences).toEqual({
      theme: 'night-gold',
      group_order: [],
      collapsed_group_ids: [],
      favorite_option_keys: [],
      favorites_collapsed: false,
    });
  });
});
