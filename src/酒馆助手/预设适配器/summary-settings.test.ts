import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SELECTION_PRESETS_KEY } from './selection-presets';
import { SUMMARY_SETTINGS_KEY, UI_PREFERENCES_KEY, usePresetAdapterStore } from './store';
import { copy, setupAdapter } from './test-helpers';

afterEach(() => vi.unstubAllGlobals());

describe('总结操作设置持久化', () => {
  it('同时迁移界面偏好和总结操作设置，保留匹配规则及其他变量', () => {
    const { store, data } = setupAdapter();
    const generation = { group_id: 'styles', option_id: 'styles-range', detect_regexes: ['总结'] };
    const settings = {
      content_handling: 'first_message',
      filter_html_code_blocks: true,
      manual_prompt_enabled: true,
      hide_rules: { hide_first: true, hide_user: false, keep_latest_count: 3 },
    };
    data.script.summary = { generation, settings, extra: { keep: true } };
    data.script.ui = { theme: 'deep-blue' };
    data.global[SELECTION_PRESETS_KEY] = { version: 1, active_id: '', presets: [] };
    const groups = copy(data.script.groups);

    store.refresh();

    expect(data.script.summary).toEqual({ generation, extra: { keep: true } });
    expect(data.script.groups).toEqual(groups);
    expect(store.summary_settings).toMatchObject(settings);
    expect(store.summary_settings.hide_rules.only_before_latest_summary).toBe(true);
    expect(data.global[SUMMARY_SETTINGS_KEY]).toEqual(store.summary_settings);
    expect(data.global[UI_PREFERENCES_KEY].theme).toBe('deep-blue');
    expect(data.global[SELECTION_PRESETS_KEY]).toEqual({ version: 1, active_id: '', presets: [] });
    expect(data.global.unrelated).toEqual({ keep: true });
    expect(data.script.ui).toBeUndefined();
  });

  it('已有全局总结设置优先于脚本中的设置', () => {
    const { store, data } = setupAdapter();
    data.global[SUMMARY_SETTINGS_KEY] = { content_handling: 'worldbook', hide_rules: { hide_summary: true } };
    data.script.summary = { settings: { content_handling: 'unknown' } };

    store.refresh();

    expect(store.summary_settings.content_handling).toBe('worldbook');
    expect(store.summary_settings.hide_rules.hide_summary).toBe(true);
    expect(data.script.summary.settings).toBeUndefined();
    expect(store.has_blocking_errors).toBe(false);
  });

  it('操作设置保存在全局，重新打开后保留并支持重置隐藏规则', () => {
    const { store, data, variables } = setupAdapter();
    const script = copy(data.script);
    store.setTheme('moon-white');
    store.createSelectionPreset('组合');
    const global = copy(data.global);
    variables.mockClear();

    store.setSummaryContentHandling('worldbook');
    store.setSummaryFilterHtmlCodeBlocks(true);
    store.setSummaryManualPromptEnabled(true);
    store.setSummaryHideRule('only_before_latest_summary', false);
    store.setSummaryHideRule('hide_first', true);
    store.setSummaryHideRule('hide_user', false);
    store.setSummaryHideRule('hide_assistant_system', false);
    store.setSummaryHideRule('hide_summary', true);
    store.setSummaryHideRule('keep_latest_enabled', false);
    store.setSummaryHideRule('auto_hide_after_manual', false);
    store.setSummaryKeepLatestCount('8.7');

    const settings = copy(store.summary_settings);
    expect(settings).toEqual({
      content_handling: 'worldbook',
      filter_html_code_blocks: true,
      manual_prompt_enabled: true,
      hide_rules: {
        only_before_latest_summary: false,
        hide_first: true,
        hide_user: false,
        hide_assistant_system: false,
        hide_summary: true,
        keep_latest_enabled: false,
        keep_latest_count: 8,
        auto_hide_after_manual: false,
      },
    });
    expect(data.global).toEqual({ ...global, [SUMMARY_SETTINGS_KEY]: settings });
    expect(data.script).toEqual(script);
    expect(variables.mock.calls.every(([, scope]) => scope.type === 'global')).toBe(true);

    data.script = { ...copy(script), summary: { settings: { content_handling: 'direct' } } };
    vi.stubGlobal('getScriptId', () => 'another-adapter');
    const reopened = usePresetAdapterStore(createPinia());
    reopened.refresh();
    expect(reopened.summary_settings).toEqual(settings);
    reopened.resetSummaryHideRules();
    reopened.refresh();
    expect(reopened.summary_settings).toEqual({
      ...settings,
      hide_rules: {
        only_before_latest_summary: true,
        hide_first: false,
        hide_user: true,
        hide_assistant_system: true,
        hide_summary: false,
        keep_latest_enabled: true,
        keep_latest_count: 5,
        auto_hide_after_manual: true,
      },
    });
    expect(data.global[SUMMARY_SETTINGS_KEY]).toEqual(reopened.summary_settings);
  });

  it('全局写入失败时保留完整的旧总结配置并允许重试', () => {
    const { store, data, variables } = setupAdapter();
    const summary = {
      generation: { group_id: 'styles', option_id: 'styles-range', detect_regexes: ['总结'] },
      settings: { manual_prompt_enabled: true, hide_rules: { keep_latest_count: 2 } },
    };
    data.script.summary = copy(summary);
    const write = variables.getMockImplementation()!;
    variables.mockImplementation((value, scope) => {
      if (scope.type === 'global') throw new Error('写入失败');
      write(value, scope);
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    store.refresh();

    expect(data.script.summary).toEqual(summary);
    expect(store.summary_settings).toMatchObject(summary.settings);
    expect(data.global[SUMMARY_SETTINGS_KEY]).toBeUndefined();
    variables.mockImplementation(write);
    store.refresh();
    expect(data.script.summary).toEqual({ generation: summary.generation });
    expect(data.global[SUMMARY_SETTINGS_KEY]).toEqual(store.summary_settings);
  });
});
