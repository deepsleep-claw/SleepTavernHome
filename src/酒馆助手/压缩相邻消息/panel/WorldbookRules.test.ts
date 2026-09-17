import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { useSettingsStore } from '../store';
import { setupTavern } from '../test-helpers';
import WorldbookRules from './WorldbookRules.vue';
import { WorldbookSettings } from '../worldbook_settings';

vi.mock('@util/script', () => ({ registerAsUniqueScript: () => ({ listenPreferenceState: () => {} }) }));

describe('世界书规则设置界面', () => {
  let app: App;
  let pinia: Pinia;
  let root: HTMLDivElement;
  beforeEach(() => {
    setupTavern();
    pinia = createPinia();
    setActivePinia(pinia);
    root = document.createElement('div');
    document.body.append(root);
    app = createApp(WorldbookRules).use(pinia);
    app.mount(root);
  });
  afterEach(() => {
    app.unmount();
    disposePinia(pinia);
    root.remove();
  });

  it('显示四条规则，并通过稳定身份调整顺序', async () => {
    const store = useSettingsStore();
    expect(root.querySelectorAll('details')).toHaveLength(4);
    const last = root.querySelectorAll('details')[3];
    const move = [...last.querySelectorAll('button')].find(button => button.textContent?.trim() === '上移')!;
    move.click();
    await nextTick();
    expect(store.settings.entry_processing.worldbook.rules.map(rule => rule.id)).toEqual([
      'blue-static',
      'green',
      'acu-memory',
      'blue-dynamic',
    ]);
  });

  it('逐规则修改来源、提取词、缓存开关，并显示正则错误', async () => {
    const store = useSettingsStore();
    const details = root.querySelectorAll('details')[1];
    const sources = details.querySelectorAll<HTMLInputElement>('fieldset input');
    sources[0].click();
    const labels = [...details.querySelectorAll('label')];
    const keyword = labels.find(label => label.textContent?.trim().startsWith('提取词'))!.querySelector('input')!;
    keyword.value = 'shared';
    keyword.dispatchEvent(new Event('input', { bubbles: true }));
    const pattern = labels.find(label => label.textContent?.trim().startsWith('匹配表达式'))!.querySelector('input')!;
    pattern.value = '/[/';
    pattern.dispatchEvent(new Event('input', { bubbles: true }));
    details.querySelector<HTMLInputElement>('.checkbox_label input')!.click();
    await nextTick();
    const [blue, green] = store.settings.entry_processing.worldbook.rules;
    expect(green.sources).not.toContain('character');
    expect(green.placeholder).toBe('{{压缩相邻消息::shared}}');
    expect(green.aggressive_green_cache).toBe(true);
    expect(blue.aggressive_green_cache).toBe(false);
    expect(details.querySelector('[role="alert"]')?.textContent).toContain('正则表达式无效');
  });

  it('内置规则以单选弹窗添加，取消不改变列表', async () => {
    const buttons = [...root.querySelectorAll('button')];
    buttons.find(button => button.textContent?.trim() === '添加内置规则')!.click();
    const dialog = root.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelectorAll('input[type="radio"]')).toHaveLength(9);
    dialog.querySelector<HTMLInputElement>('input[value="ruby-output"]')!.click();
    await nextTick();
    expect(dialog.querySelectorAll('input:checked')).toHaveLength(1);
    [...dialog.querySelectorAll('button')].find(button => button.textContent?.trim() === '取消')!.click();
    expect(dialog.open).toBe(false);
    expect(useSettingsStore().settings.entry_processing.worldbook.rules).toHaveLength(4);
  });

  it('删除后的内置规则可恢复为新副本，不影响其他规则的编辑', async () => {
    const store = useSettingsStore();
    store.settings.entry_processing.worldbook.rules[0].name = '我的设定';
    const open = () =>
      [...root.querySelectorAll('button')].find(button => button.textContent?.trim() === '添加内置规则')!.click();
    const add = () =>
      [...root.querySelector('dialog')!.querySelectorAll('button')]
        .find(button => button.textContent?.trim() === '添加所选规则')!
        .click();
    open();
    root.querySelector<HTMLInputElement>('input[value="ruby-output"]')!.click();
    await nextTick();
    add();
    await nextTick();
    const added = store.settings.entry_processing.worldbook.rules.at(-1)!;
    expect(added).toMatchObject({
      builtin_id: 'ruby-output',
      provider: 'ruby',
      placeholder: '{{压缩相邻消息::ruby_state}}',
    });
    const oldId = added.id;
    const details = [...root.querySelectorAll('details')].at(-1)!;
    expect(details.open).toBe(true);
    [...details.querySelectorAll('button')].find(button => button.textContent?.trim() === '删除')!.click();
    await nextTick();
    expect(WorldbookSettings.parse(store.settings.entry_processing.worldbook).rules).toHaveLength(4);
    open();
    add();
    await nextTick();
    expect(store.settings.entry_processing.worldbook.rules.at(-1)!.id).not.toBe(oldId);
    expect(store.settings.entry_processing.worldbook.rules[0].name).toBe('我的设定');
  });

  it('添加规则创建可编辑的通用规则，空列表不会自动恢复模板', async () => {
    const store = useSettingsStore();
    store.settings.entry_processing.worldbook.rules.splice(0);
    await nextTick();
    expect(WorldbookSettings.parse(store.settings.entry_processing.worldbook).rules).toEqual([]);
    [...root.querySelectorAll('button')].find(button => button.textContent?.trim() === '添加规则')!.click();
    await nextTick();
    expect(store.settings.entry_processing.worldbook.rules).toHaveLength(1);
    expect(store.settings.entry_processing.worldbook.rules[0]).toMatchObject({
      provider: 'worldbook',
      action: 'extract',
      pattern: '',
    });
    expect(store.settings.entry_processing.worldbook.rules[0].builtin_id).toBeUndefined();
  });
});
