import { afterEach, describe, expect, it, vi } from 'vitest';
import { copy, preset, prompt, settingsFile, setupAdapter } from './test-helpers';

afterEach(() => vi.unstubAllGlobals());

describe('内容导入', () => {
  it('按当前匹配规则解析来源，保留来源预设原状', () => {
    const { store, data, replace } = setupAdapter();
    const source = preset([prompt('开始'), prompt('甲'), prompt('丙', true), prompt('结束')]);
    source.extensions.tavern_helper = { scripts: [{ data: { groups: [{ id: 'old', options: [] }] } }], variales: {} };
    data.saved['来源'] = copy(source);
    expect(store.importFromPreset('来源')).toBe(true);
    expect(store.review_panel?.items.map(item => item.name)).toEqual(['甲', '丙']);
    expect(store.selected_import_count).toBe(1);
    expect(store.import_review_groups[0].label).toBe('文风');
    expect(data.saved['来源']).toEqual(source);
    expect(loadPreset).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
  it('解析提示列出无法定位的区间', () => {
    const { store, data } = setupAdapter();
    data.saved['来源'] = preset([prompt('旧开始'), prompt('丙'), prompt('旧结束')]);
    expect(store.importFromPreset('来源')).toBe(true);
    if (store.review_panel?.kind !== 'import') throw new Error('缺少预览');
    expect(store.review_panel.source_warnings.length).toBeGreaterThan(0);
    expect(store.review_panel.items).toHaveLength(0);
  });
  it('文件默认选新增，确认仅写入勾选项', async () => {
    const { store, data, replace } = setupAdapter();
    await store.importPresetSettings(settingsFile(['甲', '丙', '丁']));
    const group = store.import_review_groups[0];
    store.setImportSelection([group.items.find(item => item.name === '丁')!.key], false);
    await store.confirmImportReview();
    expect(data.current.prompts.map(item => item.name)).toEqual(['开始', '甲', '乙', '丙', '结束']);
    expect(data.current.prompts.find(item => item.name === '甲')?.content).toBe('甲');
    expect(data.current.prompts.find(item => item.name === '丙')?.enabled).toBe(false);
    expect(data.saved['当前预设']).toEqual(data.current);
    expect(replace).toHaveBeenCalledTimes(2);
  });
  it('手动覆盖保留目标身份和启用状态', async () => {
    const { store, data } = setupAdapter();
    data.current.prompts[1].id = 'target-identity';
    await store.importPresetSettings(settingsFile(['甲']));
    expect(store.selected_import_count).toBe(0);
    store.setImportSelection([store.review_panel!.items[0].key], true);
    await store.confirmImportReview();
    expect(data.current.prompts[1]).toMatchObject({ id: 'target-identity', enabled: true, content: '导入内容-甲' });
  });
  it('取消和空选择不修改预设', async () => {
    const { store, replace } = setupAdapter();
    await store.importPresetSettings(settingsFile(['甲']));
    await store.confirmImportReview();
    store.closeReviewPanel();
    expect(replace).not.toHaveBeenCalled();
    expect(store.review_panel).toBeUndefined();
  });
  it('确认时阻止写入不同的目标预设', async () => {
    const { store, data, replace } = setupAdapter();
    await store.importPresetSettings(settingsFile(['丙']));
    data.name = '另一个预设';
    await store.confirmImportReview();
    expect(replace).not.toHaveBeenCalled();
    expect(store.review_panel).toBeUndefined();
  });
  it('目标新增同名条目后重新预览并取消自动覆盖选择', async () => {
    const { store, data, replace } = setupAdapter();
    await store.importPresetSettings(settingsFile(['丙']));
    data.current.prompts.splice(2, 0, prompt('丙'));
    await store.confirmImportReview();
    expect(replace).not.toHaveBeenCalled();
    expect(store.selected_import_count).toBe(0);
    expect(store.review_panel?.items[0].action).toBe('overwrite');
  });
  it('配置变化需要再次确认', async () => {
    const { store, data, replace } = setupAdapter();
    await store.importPresetSettings(settingsFile(['丙']));
    data.script.groups[0].label = '新文风';
    await store.confirmImportReview();
    expect(replace).not.toHaveBeenCalled();
    expect(store.review_panel?.items[0].group_label).toBe('新文风');
    await store.confirmImportReview();
    expect(replace).toHaveBeenCalledTimes(2);
  });
  it('重复来源条目和目标同名歧义无法勾选', async () => {
    const { store, data } = setupAdapter();
    await store.importPresetSettings(settingsFile(['丙', '丙']));
    expect(store.import_review_groups[0].items.every(item => item.disabled)).toBe(true);
    store.setImportSelection(
      store.import_review_groups[0].items.map(item => item.key),
      true,
    );
    expect(store.selected_import_count).toBe(0);
    data.current.prompts.splice(2, 0, prompt('甲'));
    await store.importPresetSettings(settingsFile(['甲']));
    expect(store.import_review_groups[0].items[0].disabled).toBe(true);
  });
  it('无法定位的文件条目可以手动选择追加', async () => {
    const { store, data } = setupAdapter();
    const file = JSON.parse(settingsFile(['丙']));
    file.items[0].group_id = 'another';
    await store.importPresetSettings(JSON.stringify(file));
    expect(store.selected_import_count).toBe(0);
    store.setImportSelection([store.import_review_groups[0].items[0].key], true);
    await store.confirmImportReview();
    expect(data.current.prompts.at(-1)?.name).toBe('丙');
    expect(data.current.prompts.at(-1)?.enabled).toBe(false);
  });
  it('无效提示词结构不会进入导入预览', async () => {
    const { store, replace } = setupAdapter();
    const file = JSON.parse(settingsFile(['丙']));
    delete file.items[0].prompt.id;
    await store.importPresetSettings(JSON.stringify(file));
    expect(store.review_panel).toBeUndefined();
    expect(replace).not.toHaveBeenCalled();
  });
});
