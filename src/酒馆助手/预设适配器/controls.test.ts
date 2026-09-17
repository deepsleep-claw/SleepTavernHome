import { createApp, nextTick, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdapterModal from './AdapterModal.vue';
import SelectionPresets from './SelectionPresets.vue';
import SettingsImport from './SettingsImport.vue';
import { SELECTION_PRESETS_KEY } from './selection-presets';
import { copy, preset, prompt, settingsFile, setupAdapter } from './test-helpers';

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
async function flush() {
  await nextTick();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}
function host() {
  document.body.innerHTML =
    '<section class="preset-adapter-floating-window" data-preset-adapter-theme="night-gold"><div class="preset-adapter-root"><div id="mount"></div></div></section>';
  return document.querySelector('#mount')!;
}
function button(text: string, parent: ParentNode = document): HTMLButtonElement {
  const result = [...parent.querySelectorAll('button')].find(item => item.textContent?.trim() === text);
  if (!result) throw new Error('找不到按钮：' + text);
  return result;
}
function change(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('选项组预设界面', () => {
  it('单个组合修改后可以重新选择已保存版本', async () => {
    const fixture = setupAdapter();
    fixture.store.createSelectionPreset('组合');
    const id = fixture.store.active_selection_preset!.id;
    fixture.data.current.prompts[1].enabled = false;
    fixture.data.current.prompts[2].enabled = true;
    fixture.store.refresh();
    app = createApp(SelectionPresets).use(fixture.pinia);
    app.mount(host());
    expect(document.querySelector('select')!.value).toBe('');
    change(document.querySelector('select')!, id);
    await flush();
    button('切换', document.querySelector('[role="dialog"]')!).click();
    await flush();
    expect(fixture.data.current.prompts[1].enabled).toBe(true);
    expect(fixture.data.current.prompts[2].enabled).toBe(false);
    expect(document.querySelector('select')!.value).toBe(id);
  });
  it('新建使用当前按钮状态，名称冲突给出提示', async () => {
    const fixture = setupAdapter();
    fixture.store.createSelectionPreset('已有组合');
    const saved = copy(fixture.store.active_selection_preset!);
    fixture.data.current.prompts[1].enabled = false;
    fixture.data.current.prompts[2].enabled = true;
    fixture.store.refresh();
    app = createApp(SelectionPresets).use(fixture.pinia);
    app.mount(host());
    button('新建').click();
    await flush();
    const input = document.querySelector<HTMLInputElement>('.pa-modal-input')!;
    input.value = '已有组合';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    expect(document.querySelector('.pa-modal-error')?.textContent).toContain('同名');
    expect(button('确认').disabled).toBe(true);
    input.value = '新组合';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(fixture.store.selection_library.presets[0]).toEqual(saved);
    expect(fixture.store.active_selection_preset?.selections[0].prompt_name).toBe('乙');
  });
  it('切换前的取消保留当前页面', async () => {
    const fixture = setupAdapter();
    fixture.store.createSelectionPreset('甲组合');
    const first = fixture.store.active_selection_preset!.id;
    fixture.data.current.prompts[1].enabled = false;
    fixture.data.current.prompts[2].enabled = true;
    fixture.store.createSelectionPreset('乙组合');
    fixture.data.current.prompts[1].enabled = true;
    fixture.store.refresh();
    app = createApp(SelectionPresets).use(fixture.pinia);
    app.mount(host());
    change(document.querySelector('select')!, first);
    await flush();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('未保存');
    button('取消', document.querySelector('[role="dialog"]')!).click();
    await flush();
    expect(fixture.data.current.prompts[1].enabled).toBe(true);
    expect(fixture.data.current.prompts[2].enabled).toBe(true);
    expect(fixture.store.active_selection_preset?.name).toBe('乙组合');
  });
  it('切换后的缺失项在主题弹窗显示，快照完整保留', async () => {
    const fixture = setupAdapter();
    fixture.data.current.prompts.splice(2, 0, prompt('丙', true));
    fixture.store.createSelectionPreset('带丙组合');
    const saved = copy(fixture.store.active_selection_preset!);
    fixture.data.current.prompts = fixture.data.current.prompts.filter(item => item.name !== '丙');
    fixture.store.createSelectionPreset('当前组合');
    app = createApp(SelectionPresets).use(fixture.pinia);
    app.mount(host());
    change(document.querySelector('select')!, saved.id);
    await flush();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('丙');
    expect(document.querySelector('.pa-modal-backdrop')?.parentElement?.className).toBe(
      'preset-adapter-floating-window',
    );
    expect(fixture.data.global[SELECTION_PRESETS_KEY].presets[0]).toEqual(saved);
  });
  it('名称输入框支持 Escape 关闭', async () => {
    const fixture = setupAdapter();
    app = createApp(SelectionPresets).use(fixture.pinia);
    app.mount(host());
    button('新建').focus();
    button('新建').click();
    await flush();
    document
      .querySelector('input[autofocus]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button('新建'));
  });
});

describe('导入界面', () => {
  it('鼠标悬停展开菜单，触屏通过点击展开', async () => {
    const fixture = setupAdapter();
    app = createApp(SettingsImport).use(fixture.pinia);
    app.mount(host());
    const menu = document.querySelector('details')!;
    menu.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    expect(menu.open).toBe(true);
    expect(menu.textContent).toContain('从文件导入');
    expect(menu.textContent).toContain('从旧预设导入');
    menu.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    expect(menu.open).toBe(false);
    menu.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
    expect(menu.open).toBe(false);
    menu.querySelector('summary')!.click();
    await flush();
    expect(menu.open).toBe(true);
  });
  it('选来源并解析后显示分组列表及默认新增勾选', async () => {
    const fixture = setupAdapter();
    fixture.data.saved['来源'] = preset([prompt('开始'), prompt('甲'), prompt('丙'), prompt('结束')]);
    app = createApp(SettingsImport).use(fixture.pinia);
    app.mount(host());
    button('从旧预设导入').click();
    await flush();
    change(document.querySelector('.pa-modal-panel select')!, '来源');
    await flush();
    button('解析').click();
    await flush();
    const group_checkbox = document.querySelector<HTMLInputElement>('.pa-import-group-heading input')!;
    expect(group_checkbox.indeterminate).toBe(true);
    const rows = [...document.querySelectorAll('.pa-import-item')];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('input')!.checked).toBe(false);
    expect(rows[1].querySelector('input')!.checked).toBe(true);
    group_checkbox.click();
    await flush();
    expect(fixture.store.selected_import_count).toBe(2);
    expect(group_checkbox.indeterminate).toBe(false);
    expect(document.querySelector('.pa-modal-footer')?.parentElement).toBe(
      document.querySelector('.pa-modal-body')?.parentElement,
    );
  });
  it('导入进行中禁用勾选和关闭', async () => {
    const fixture = setupAdapter();
    app = createApp(SettingsImport).use(fixture.pinia);
    app.mount(host());
    await fixture.store.importPresetSettings(settingsFile(['丙']));
    await flush();
    fixture.store.is_applying = true;
    await flush();
    const input = document.querySelector<HTMLInputElement>('.pa-import-item input')!;
    expect(input.disabled).toBe(true);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fixture.store.review_panel).toBeDefined();
    fixture.store.is_applying = false;
  });
});

describe('主题弹窗', () => {
  it.each(['night-gold', 'deep-blue', 'purple-black', 'jade-green', 'moon-white', 'frost-blue'])(
    '继承 %s 的主题容器',
    async theme => {
      const target = host();
      const container = target.closest('.preset-adapter-floating-window')!;
      container.setAttribute('data-preset-adapter-theme', theme);
      app = createApp(AdapterModal, { title: '测试弹窗' });
      app.mount(target);
      await flush();
      expect(document.querySelector('.pa-modal-backdrop')?.parentElement).toBe(container);
      expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('测试弹窗');
    },
  );
});
