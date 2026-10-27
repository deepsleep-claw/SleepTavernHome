import $ from 'jquery';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

import { mountCharacterManagement } from './character-management-module';
import characterStyles from './character-management.css?raw';
import { mountExtensionSettings } from './extension-settings-module';
import { mountMobileWorldSelects } from './mobile-world-select-module';
import pickerStyles from './mobile-world-select.css?raw';
import { mountWorldInfoEditor } from './world-info-module';
import worldStyles from './world-info.css?raw';

type Store = Parameters<typeof mountWorldInfoEditor>[0];
let dispose = () => {};

async function flushLayout(): Promise<void> {
  await nextTick();
  for (let frame = 0; frame < 3; frame += 1) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
}

function createStore(): Store {
  return reactive({
    is_active: true,
    settings: {
      modernWorldInfoEditor: true,
      modernWorldSelect: false,
      modernExtensionSettings: true,
      modernCharacterManagement: true,
    },
  }) as unknown as Store;
}

beforeEach(() => {
  vi.stubGlobal('$', $);
  vi.stubGlobal('getScriptId', () => 'modern-layout-test');
  vi.stubGlobal('getVariables', () => ({}));
  vi.stubGlobal('updateVariablesWith', vi.fn());
  vi.stubGlobal('SillyTavern', { reloadWorldInfoEditor: vi.fn() });
  vi.stubGlobal('toastr', { error: vi.fn() });
  document.body.className = 'th-modern-enabled';
  sessionStorage.clear();
});

afterEach(async () => {
  dispose();
  dispose = () => {};
  await flushLayout();
  document.body.replaceChildren();
  document.head.querySelectorAll('[data-modern-test-style]').forEach(element => element.remove());
  vi.unstubAllGlobals();
});

function createCharacterEditor(toggleTag: 'button' | 'i' = 'button'): void {
  document.body.innerHTML = `
    <div id="right-nav-panel" class="openDrawer" data-menu-type="character_edit">
      <div id="rm_PinAndTabs"><div id="right-nav-panel-tabs">
        <div id="rm_button_selected_ch"><h2>示例角色</h2></div>
        <div id="result_info"><span id="result_info_text">153 Tokens</span>
          <${toggleTag} id="hideCharPanelAvatarButton" aria-expanded="true">切换角色信息面板</${toggleTag}>
        </div>
      </div></div>
      <div class="scrollableInner"><div id="rm_ch_create_block"><form id="form_create">
        <div id="avatar-and-name-block">
          <div id="name_div"><input id="character_name_pole" value="示例角色"></div>
          <div class="flex-container"><div id="avatar_div">头像</div>
            <div id="avatar_controls"><div class="form_create_bottom_buttons_block">
              <button type="button" id="character-action">操作</button>
            </div><label><select id="char-management-dropdown"><option>更多</option></select></label></div>
          </div><div id="tags_div"><input value="示例标签"></div>
        </div>
        <textarea id="description_textarea">角色描述</textarea>
      </form></div></div>
    </div>`;
  const style = document.createElement('style');
  style.dataset.modernTestStyle = '';
  style.textContent = characterStyles;
  document.head.append(style);
}

describe('角色信息面板折叠', () => {
  it.each(['button', 'i'] as const)('%s 开关：反复折叠及切换布局后仍可展开，保留编辑内容与操作', async toggleTag => {
    createCharacterEditor(toggleTag);
    const panel = document.getElementById('right-nav-panel')!;
    const header = document.getElementById('rm_PinAndTabs')!;
    const summary = document.getElementById('avatar-and-name-block')!;
    const toggle = document.getElementById('hideCharPanelAvatarButton')!;
    const name = document.querySelector<HTMLInputElement>('#character_name_pole')!;
    const action = vi.fn();
    document.getElementById('character-action')!.addEventListener('click', action);
    $(toggle).on('click', function () {
      const content = $(summary);
      if (toggleTag === 'button') content.stop(true, true);
      const open = content.css('display') === 'none';
      content.slideToggle(0);
      if (toggleTag === 'button') $(this).attr('aria-expanded', String(open));
    });
    const store = createStore();
    dispose = mountCharacterManagement(store).destroy;
    await flushLayout();
    name.value = '已编辑角色名';

    for (let cycle = 0; cycle < 3; cycle += 1) {
      toggle.click();
      await flushLayout();
      expect(getComputedStyle(summary).display).toBe('none');
      expect(header.parentElement).toBe(panel);
      expect(summary.contains(toggle)).toBe(false);
      expect(getComputedStyle(header).display).not.toBe('none');
      if (toggleTag === 'button') expect(toggle.getAttribute('aria-expanded')).toBe('false');

      store.settings.modernCharacterManagement = false;
      await flushLayout();
      expect(getComputedStyle(summary).display).toBe('none');
      expect(header.parentElement).toBe(panel);
      store.settings.modernCharacterManagement = true;
      await flushLayout();
      expect(getComputedStyle(summary).display).toBe('none');

      toggle.click();
      await flushLayout();
      expect(getComputedStyle(summary).display).not.toBe('none');
      if (toggleTag === 'button') expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(document.querySelectorAll('.th-modern-character-summary-main')).toHaveLength(1);
      expect(document.getElementById('character_name_pole')).toBe(name);
      expect(name.value).toBe('已编辑角色名');
      document.getElementById('character-action')!.click();
    }
    expect(action).toHaveBeenCalledTimes(3);
    dispose();
    expect(header.parentElement).toBe(panel);
    expect(document.querySelector('.th-modern-character-summary-main')).toBeNull();
    expect(name.parentElement?.parentElement).toBe(summary);
  });

  it('创建角色时显示名称输入，返回编辑时保留原生信息栏', async () => {
    createCharacterEditor();
    const panel = document.getElementById('right-nav-panel')!;
    const header = document.getElementById('rm_PinAndTabs')!;
    const name = document.getElementById('name_div')!;
    dispose = mountCharacterManagement(createStore()).destroy;
    await flushLayout();
    expect(getComputedStyle(name.parentElement!).display).toBe('none');

    panel.dataset.menuType = 'create';
    await flushLayout();
    expect(getComputedStyle(header).display).toBe('none');
    expect(getComputedStyle(name).display).not.toBe('none');
    expect(getComputedStyle(name.parentElement!).display).not.toBe('none');

    panel.dataset.menuType = 'characters';
    await flushLayout();
    expect(document.querySelector('.th-modern-character-summary-main')).toBeNull();
    panel.dataset.menuType = 'character_edit';
    await flushLayout();
    expect(header.parentElement).toBe(panel);
    expect(getComputedStyle(header).display).not.toBe('none');
    expect(document.querySelectorAll('.th-modern-character-summary-main')).toHaveLength(1);
  });
});

describe('柏宝箱世界书兼容', () => {
  function createBaiBaiWorldInfo(): void {
    vi.stubGlobal('__baiBaiToolkitExtensionInstalled', { installed: true });
    document.body.innerHTML = `
      <div id="WorldInfo" class="openDrawer"><div id="world_popup">
        <div class="bai-bai-wi-popup-header">
          <div class="bai-bai-wi-popup-source-stash" hidden></div>
          <select id="world_editor_select"><option value="0">世界书</option></select>
          <button id="world_create_button">创建</button><input id="world_info_search">
          <button id="world_import">导入</button>
        </div><div id="world_popup_entries_list"></div>
      </div><div id="WIMultiSelector">
        <select id="world_info" multiple><option value="0" selected>世界书</option></select>
        <div class="bai-bai-wi-global-selector-display">世界书</div>
      </div></div>`;
    const style = document.createElement('style');
    style.dataset.modernTestStyle = '';
    style.textContent = `${pickerStyles}\n${worldStyles}`;
    document.head.append(style);
  }

  it('切换选择器时只显示所选入口，卸载后恢复柏宝箱入口', async () => {
    createBaiBaiWorldInfo();
    const store = createStore();
    store.settings.modernWorldSelect = true;
    store.settings.baibaiWorldSelector = 'modern';
    const nativeSelect = document.getElementById('world_info') as HTMLSelectElement;
    const onChange = vi.fn();
    nativeSelect.addEventListener('change', onChange);
    dispose = mountWorldInfoEditor(store).destroy;
    await flushLayout();
    const baiDisplay = document.querySelector<HTMLElement>('.bai-bai-wi-global-selector-display')!;
    expect(getComputedStyle(baiDisplay).display).toBe('none');
    expect(document.querySelectorAll('[data-source="world_info"]')).toHaveLength(1);

    store.settings.baibaiWorldSelector = 'baibai';
    await flushLayout();
    expect(getComputedStyle(baiDisplay).display).not.toBe('none');
    expect(document.querySelectorAll('.th-modern-mobile-world-control')).toHaveLength(0);
    expect(nativeSelect.options[0].selected).toBe(true);
    nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenCalledOnce();

    store.settings.baibaiWorldSelector = 'modern';
    await flushLayout();
    expect(document.querySelectorAll('[data-source="world_info"]')).toHaveLength(1);
    dispose();
    dispose = () => {};
    expect(getComputedStyle(baiDisplay).display).not.toBe('none');
    expect(document.querySelectorAll('.th-modern-mobile-world-control')).toHaveLength(0);
  });

  it('接收柏宝箱拆分后的工具栏控件，保留事件并恢复原位置', async () => {
    createBaiBaiWorldInfo();
    const header = document.querySelector('.bai-bai-wi-popup-header')!;
    const create = document.getElementById('world_create_button')!;
    const search = document.getElementById('world_info_search')!;
    const importButton = document.getElementById('world_import')!;
    const clicked = vi.fn();
    create.addEventListener('click', clicked);
    dispose = mountWorldInfoEditor(createStore()).destroy;
    await flushLayout();
    expect(create.closest('.th-modern-wi-worldbar')).not.toBeNull();
    expect(document.getElementById('world_editor_select')?.closest('.th-modern-wi-worldbar')).not.toBeNull();
    expect(search.closest('.th-modern-wi-toolbar')).not.toBeNull();
    expect(importButton.closest('.th-modern-wi-toolbar')).not.toBeNull();
    create.click();
    expect(clicked).toHaveBeenCalledOnce();
    dispose();
    dispose = () => {};
    expect(create.parentElement).toBe(header);
    expect(search.parentElement).toBe(header);
    expect(importButton.parentElement).toBe(header);
  });

  it('现代工具栏挂载后出现的柏宝箱控件也可接收', async () => {
    createBaiBaiWorldInfo();
    dispose = mountWorldInfoEditor(createStore()).destroy;
    await flushLayout();
    const button = document.createElement('button');
    button.textContent = '导出';
    document.querySelector('.bai-bai-wi-popup-header')!.append(button);
    await flushLayout();
    expect(button.closest('.th-modern-wi-toolbar')).not.toBeNull();
  });
});

describe('世界书面板恢复', () => {
  it.each(['resident', 'list', 'panel'] as const)('%s：重复打开保留条目、编辑值与唯一布局', async residency => {
    document.body.innerHTML = `
      <div id="WorldInfo" class="closedDrawer"><div id="wi-holder"><div id="world_popup">
        <div class="flex-container"><button id="world_create_button">创建</button>
          <select id="world_editor_select"><option value="0">示例世界书</option></select></div>
        <div class="flex-container"><input id="world_info_search"></div>
        <div id="world_popup_entries_list"><div class="world_entry" uid="7">
          <form class="world_entry_form"><div class="inline-drawer">
            <div class="inline-drawer-header"><button class="inline-drawer-toggle" type="button">条目</button>
              <textarea name="comment">示例条目</textarea></div>
            <div class="inline-drawer-content inline-drawer-outlet"><div class="world_entry_edit">
              <div><textarea name="content">原始内容</textarea></div>
            </div></div>
          </div></form>
        </div></div>
      </div></div></div>`;
    const panel = document.getElementById('WorldInfo')!;
    const list = document.getElementById('world_popup_entries_list')!;
    const parkedRoot = residency === 'panel' ? document.getElementById('wi-holder')! : list;
    const anchor = document.createComment('panel position');
    parkedRoot.after(anchor);
    const originalParent = list.parentElement;
    const content = list.querySelector<HTMLTextAreaElement>('textarea[name="content"]')!;
    const onInput = vi.fn();
    content.addEventListener('input', onInput);
    const runtime = mountWorldInfoEditor(createStore());
    dispose = runtime.destroy;

    for (let cycle = 0; cycle < 3; cycle += 1) {
      if (!parkedRoot.isConnected) {
        anchor.before(parkedRoot);
      }
      panel.classList.replace('closedDrawer', 'openDrawer');
      await flushLayout();
      expect(list.parentElement?.classList.contains('th-modern-wi-native-list')).toBe(true);
      expect(panel.querySelectorAll('.th-modern-wi-native-shell')).toHaveLength(1);
      expect(panel.querySelector('.th-modern-wi-native-editor textarea[name="content"]')).toBe(content);
      expect(content.value).toBe(cycle === 0 ? '原始内容' : '已编辑内容');
      content.value = '已编辑内容';
      content.dispatchEvent(new Event('input', { bubbles: true }));
      panel.classList.replace('openDrawer', 'closedDrawer');
      if (residency !== 'resident') {
        parkedRoot.remove();
      }
      await flushLayout();
    }
    expect(onInput).toHaveBeenCalledTimes(3);
    runtime.destroy();
    dispose = () => {};
    expect(list.parentElement).toBe(originalParent);
  });
});

describe('世界书条目列表开关', () => {
  function createEntry(uid: number, title: string): string {
    return `<div class="world_entry" uid="${uid}">
      <form class="world_entry_form"><div class="inline-drawer">
        <div class="inline-drawer-header"><button class="inline-drawer-toggle" type="button">条目</button>
          <div class="fa-solid fa-toggle-on killSwitch" name="entryKillSwitch"></div>
          <textarea name="comment">${title}</textarea></div>
        <div class="inline-drawer-content inline-drawer-outlet"><div class="world_entry_edit">
          <div><textarea name="content">${title}内容</textarea></div>
        </div></div>
      </div></form>
    </div>`;
  }

  it('未选中与已选中条目都能直接切换，且不改变当前选中项', async () => {
    document.body.innerHTML = `
      <div id="WorldInfo" class="openDrawer"><div id="world_popup">
        <div class="flex-container"><button id="world_create_button">创建</button>
          <select id="world_editor_select"><option value="0">示例世界书</option></select></div>
        <div class="flex-container"><input id="world_info_search"></div>
        <div id="world_popup_entries_list">${createEntry(1, '甲')}${createEntry(2, '乙')}</div>
      </div></div>`;
    const entries = Array.from(document.querySelectorAll<HTMLElement>('.world_entry'));
    const nativeClicks = entries.map(entry => {
      const onClick = vi.fn(() => entry.classList.toggle('disabledWIEntry'));
      entry.querySelector('.killSwitch')!.addEventListener('click', onClick);
      return onClick;
    });
    dispose = mountWorldInfoEditor(createStore()).destroy;
    await flushLayout();

    const [selected, other] = entries;
    expect(selected.classList.contains('th-modern-wi-selected')).toBe(true);
    const editorHost = document.querySelector('.th-modern-wi-native-editor .th-modern-wi-editor-entry-host')!;
    expect(editorHost.querySelector('.killSwitch')).not.toBeNull();

    const otherToggle = other.querySelector<HTMLButtonElement>('.th-modern-wi-row-toggle')!;
    expect(otherToggle.getAttribute('aria-checked')).toBe('true');
    otherToggle.click();
    expect(nativeClicks[1]).toHaveBeenCalledOnce();
    expect(other.classList.contains('disabledWIEntry')).toBe(true);
    expect(otherToggle.getAttribute('aria-checked')).toBe('false');
    expect(selected.classList.contains('th-modern-wi-selected')).toBe(true);
    expect(other.classList.contains('th-modern-wi-selected')).toBe(false);

    const selectedToggle = selected.querySelector<HTMLButtonElement>('.th-modern-wi-row-toggle')!;
    selectedToggle.click();
    expect(nativeClicks[0]).toHaveBeenCalledOnce();
    expect(selected.classList.contains('disabledWIEntry')).toBe(true);
    expect(selectedToggle.getAttribute('aria-checked')).toBe('false');
    expect(editorHost.classList.contains('disabledWIEntry')).toBe(true);
  });
});

describe('扩展设置选择', () => {
  it.each([false, true])('内容暂存=%s：重开保留选择，移除选中扩展后选择剩余项目', async park => {
    document.body.innerHTML = `
      <div id="rm_extensions_block" class="openDrawer"><div class="extensions_block">
        <div id="extensions_settings">
          <div id="alpha" class="extension_container"><div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">Alpha</div>
            <div class="inline-drawer-content">Alpha 设置</div></div></div>
          <div id="beta" class="extension_container"><div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">Beta</div>
            <div class="inline-drawer-content">Beta 设置</div></div></div>
        </div><div id="extensions_settings2"></div>
      </div></div>`;
    dispose = mountExtensionSettings(createStore()).destroy;
    await flushLayout();
    document.querySelector<HTMLButtonElement>('[data-extension-key="id:beta"]')!.click();
    const panel = document.getElementById('rm_extensions_block')!;
    const containers = Array.from(document.querySelectorAll('.extension_container'));
    const fragments = containers.map(() => document.createDocumentFragment());
    const storageKey = 'TavernHelper.modernLayout.selectedExtensionSettings';

    for (let cycle = 0; cycle < 3; cycle += 1) {
      panel.classList.replace('openDrawer', 'closedDrawer');
      if (park) containers.forEach((container, index) => fragments[index].append(...container.childNodes));
      await flushLayout();
      expect(sessionStorage.getItem(storageKey)).toBe('id:beta');
      if (park) containers.forEach((container, index) => container.append(fragments[index]));
      panel.classList.replace('closedDrawer', 'openDrawer');
      await flushLayout();
      expect(document.querySelector('[aria-current="page"]')?.getAttribute('data-extension-key')).toBe('id:beta');
      expect(document.getElementById('beta')?.classList.contains('th-modern-extension-host-active')).toBe(true);
    }

    document.getElementById('beta')!.remove();
    await flushLayout();
    expect(sessionStorage.getItem(storageKey)).toBe('id:alpha');
    expect(document.querySelector('[aria-current="page"]')?.getAttribute('data-extension-key')).toBe('id:alpha');
  });
});

describe('世界书选择器关闭', () => {
  it.each(['native', 'cancel', 'escape', 'button'] as const)('%s：关闭后清理弹窗并允许再次选择', async action => {
    document.body.innerHTML = `<div id="WorldInfo" class="openDrawer th-modern-wi-enabled">
      <select id="world_editor_select"><option value="0">世界书甲</option><option value="1">世界书乙</option></select>
    </div>`;
    const style = document.createElement('style');
    style.dataset.modernTestStyle = '';
    style.textContent = pickerStyles;
    document.head.append(style);
    dispose = mountMobileWorldSelects({ enabled: true, onEnabledChange: vi.fn() }).destroy;
    await flushLayout();
    const trigger = document.querySelector<HTMLButtonElement>('.th-modern-mobile-world-trigger')!;
    trigger.focus();
    trigger.click();
    await flushLayout();
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    if (action === 'native') {
      dialog.close();
      expect(dialog.isConnected && getComputedStyle(dialog).display !== 'none').toBe(false);
    } else if (action === 'cancel') {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    } else if (action === 'escape') {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    } else {
      dialog.querySelector<HTMLButtonElement>('.th-modern-mobile-world-picker-close')!.click();
    }
    await flushLayout();
    expect(document.querySelector('dialog')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);

    const source = document.getElementById('world_editor_select') as HTMLSelectElement;
    const change = vi.fn();
    $(source).on('change', change);
    trigger.click();
    await flushLayout();
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
    document
      .querySelector<HTMLButtonElement>('[data-source-index="1"] .th-modern-mobile-world-picker-row-select')!
      .click();
    await flushLayout();
    expect(source.value).toBe('1');
    expect(change).toHaveBeenCalledOnce();
    expect(document.querySelector('dialog')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
