import $ from 'jquery';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

import { mountPresetEditor, type HostPromptManager } from './preset-module';
import {
  assignToGroup,
  buildPromptList,
  cleanupGroups,
  getExclusiveSiblings,
  getGroupPromptIds,
  moveOrderEntries,
  removeGroup,
  reparentGroup,
  type HostPrompt,
  type PromptGroupData,
  type PromptOrderEntry,
} from './preset-prompt-model';

type Store = Parameters<typeof mountPresetEditor>[0];
let dispose = () => {};

async function flushLayout(): Promise<void> {
  await nextTick();
  for (let frame = 0; frame < 3; frame += 1) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
}

function createStore(): Store {
  return reactive({ is_active: true, settings: { modernPresetEditor: true } }) as unknown as Store;
}

function order(...ids: string[]): PromptOrderEntry[] {
  return ids.map(identifier => ({ identifier, enabled: true }));
}

function createPromptManager(): HostPromptManager & { calls: Record<string, number> } {
  const prompts: HostPrompt[] = [
    { identifier: 'main', name: 'Main Prompt', role: 'system', content: '主提示', system_prompt: true },
    { identifier: 'chatHistory', name: 'Chat History', system_prompt: true, marker: true },
    { identifier: 'intro', name: '开场', role: 'system', content: '开场', system_prompt: false },
    { identifier: 'write', name: '写作模式', role: 'user', content: '写作', system_prompt: false },
    { identifier: 'chat', name: '聊天模式', role: 'user', content: '聊天', system_prompt: false },
    { identifier: 'spare', name: '备用条目', role: 'system', content: '备用', system_prompt: false },
  ];
  const character = { id: 100001 };
  const promptOrder = [{ character_id: 100001, order: [
    { identifier: 'main', enabled: true },
    { identifier: 'chatHistory', enabled: true },
    { identifier: 'intro', enabled: false },
    { identifier: 'write', enabled: true },
    { identifier: 'chat', enabled: false },
  ] }];
  const calls: Record<string, number> = { save: 0, render: 0, load: 0, update: 0 };
  const field = (name: string) => document.getElementById(`completion_prompt_manager_popup_entry_form_${name}`) as
    | HTMLInputElement
    | HTMLTextAreaElement;

  const pm: HostPromptManager & { calls: Record<string, number> } = {
    calls,
    activeCharacter: character,
    configuration: { prefix: 'completion_' },
    serviceSettings: {
      prompts,
      prompt_order: promptOrder,
      extensions: {
        luker: {
          prompt_groups: [
            { id: 'grp_mode', name: '输出模式', collapsed: false, identifiers: ['write', 'chat'], parentId: null, single_select: true },
          ],
        },
      },
    },
    tokenUsage: 0,
    getPromptOrderForCharacter: () => promptOrder.find(entry => entry.character_id === character.id)?.order ?? [],
    removePromptOrderForCharacter: () => {
      const index = promptOrder.findIndex(entry => entry.character_id === character.id);
      if (index !== -1) promptOrder.splice(index, 1);
    },
    addPromptOrderForCharacter: (_character, next) => {
      promptOrder.push({ character_id: character.id, order: next });
    },
    getPromptById: identifier => prompts.find(prompt => prompt.identifier === identifier) ?? null,
    addPrompt: (prompt, identifier) => {
      prompts.push({ identifier, system_prompt: false, marker: false, ...prompt });
    },
    isPromptDeletionAllowed: prompt => prompt.system_prompt === false,
    isPromptEditAllowed: prompt => !prompt.marker,
    isPromptToggleAllowed: prompt => !prompt.marker || prompt.identifier === 'chatHistory',
    loadPromptIntoEditForm: prompt => {
      calls.load += 1;
      field('name').value = prompt.name ?? '';
      field('prompt').value = prompt.content ?? '';
      document.getElementById('completion_prompt_manager_popup_entry_form_injection_trigger')?.dispatchEvent(
        new Event('change', { bubbles: true }),
      );
    },
    updatePromptWithPromptEditForm: prompt => {
      calls.update += 1;
      prompt.name = field('name').value;
      prompt.content = field('prompt').value;
    },
    saveServiceSettings: () => {
      calls.save += 1;
      return Promise.resolve();
    },
    messages: {
      hasItemWithIdentifier: identifier => identifier === 'chatHistory',
      getItemByIdentifier: () => ({ content: '用户：你好' }),
    },
    loadMessagesIntoInspectForm: messages => {
      document.getElementById('completion_prompt_manager_popup_entry_form_inspect_list')!.textContent = (
        messages as { content: string }
      ).content;
    },
    clearInspectForm: () => {
      document.getElementById('completion_prompt_manager_popup_inspect')!.style.display = 'none';
      document.getElementById('completion_prompt_manager_popup_entry_form_inspect_list')!.textContent = '';
    },
    render: () => {
      calls.render += 1;
      const container = document.getElementById('completion_prompt_manager')!;
      container.innerHTML = `<ul id="completion_prompt_manager_list"><li>${calls.render}</li></ul>`;
    },
  };
  return pm;
}

function createPresetPanel(): void {
  document.body.innerHTML = `
    <div id="left-nav-panel" class="drawer-content openDrawer">
      <div class="scrollableInner">
        <div id="ai_response_configuration" class="flex-container">
          <div id="respective-presets-block">
            <select id="settings_preset_openai"><option selected>测试预设</option></select>
            <div id="update_oai_preset" class="menu_button"></div>
          </div>
          <div id="respective-ranges-and-temps"><div id="range_block_openai">温度</div></div>
          <div id="advanced-ai-config-block">
            <div id="openai_settings" style="display: block;">
              <div class="range-block other-settings">续写</div>
              <div class="range-block m-b-1"><div id="completion_prompt_manager"><ul id="completion_prompt_manager_list"></ul></div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div id="completion_prompt_manager_popup" style="display:none;">
      <div id="completion_prompt_manager_popup_inspect" style="display:none;">
        <h3>Inspect</h3>
        <div id="completion_prompt_manager_popup_entry_form_inspect_list"></div>
      </div>
      <div id="completion_prompt_manager_popup_edit">
        <h3>Edit</h3>
        <input id="completion_prompt_manager_popup_entry_form_name">
        <select id="completion_prompt_manager_popup_entry_form_injection_trigger" multiple></select>
        <textarea id="completion_prompt_manager_popup_entry_form_prompt"></textarea>
        <a id="completion_prompt_manager_popup_entry_form_save"></a>
      </div>
    </div>`;
}

async function mountWith(pm: HostPromptManager, checkDirty: () => boolean | null = () => false) {
  const store = createStore();
  const controller = mountPresetEditor(store, { loadHost: async () => ({ getPromptManager: () => pm }), checkDirty });
  dispose = controller.destroy;
  await flushLayout();
  await Promise.resolve();
  await flushLayout();
  return { store, controller };
}

function row(identifier: string): HTMLElement {
  return document.querySelector<HTMLElement>(`.th-modern-pm-row[data-id="${identifier}"]`)!;
}

beforeEach(() => {
  vi.stubGlobal('$', $);
  vi.stubGlobal('toastr', { error: vi.fn() });
  document.body.className = 'th-modern-enabled';
  localStorage.clear();
});

afterEach(async () => {
  dispose();
  dispose = () => {};
  await flushLayout();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('Luker 分组数据', () => {
  const prompts: Record<string, HostPrompt> = Object.fromEntries(
    ['a', 'x', 'y', 'z', 'b'].map(identifier => [identifier, { identifier }]),
  );
  const createGroups = (): PromptGroupData[] => [
    { id: 'outer', name: '外层', identifiers: ['x'], parentId: null },
    { id: 'inner', name: '内层', identifiers: ['y', 'z'], parentId: 'outer', single_select: true },
  ];

  it('按真实顺序插入嵌套组标题，并识别不连续的片段', () => {
    const groups = createGroups();
    const rows = buildPromptList(order('a', 'x', 'y', 'b', 'z'), groups, id => prompts[id]);
    expect(rows.map(row => (row.kind === 'group' ? `#${row.group.id}${row.continued ? '+' : ''}` : row.identifier))).toEqual([
      'a',
      '#outer',
      'x',
      '#inner',
      'y',
      'b',
      '#outer+',
      '#inner+',
      'z',
    ]);
    const z = rows.at(-1)!;
    expect(z.kind === 'prompt' && z.depth).toBe(2);
    expect(getGroupPromptIds(groups, 'outer').sort()).toEqual(['x', 'y', 'z']);
    expect(getExclusiveSiblings(groups, 'y')).toEqual(['z']);
    expect(getExclusiveSiblings(groups, 'x')).toEqual([]);
  });

  it('移动、归组、解散和清理', () => {
    const groups = createGroups();
    expect(reparentGroup(groups, 'outer', 'inner')).toBe(false);
    assignToGroup(groups, ['b'], 'inner');
    expect(groups[1].identifiers).toEqual(['y', 'z', 'b']);
    removeGroup(groups, 'inner');
    expect(groups).toEqual([{ id: 'outer', name: '外层', identifiers: ['x', 'y', 'z', 'b'], parentId: null }]);
    cleanupGroups(groups, new Set(['a']));
    expect(groups).toEqual([]);

    const entries = order('a', 'x', 'y', 'b');
    expect(moveOrderEntries(entries, new Set(['x', 'y']), 'b', 'after')!.map(entry => entry.identifier)).toEqual([
      'a',
      'b',
      'x',
      'y',
    ]);
    expect(moveOrderEntries(entries, new Set(['x']), 'x', 'before')).toBeNull();
  });
});

describe('预设提示词界面', () => {
  it('拆分标签页并在销毁时恢复原生结构', async () => {
    createPresetPanel();
    const pm = createPromptManager();
    await mountWith(pm, () => true);

    const panel = document.getElementById('left-nav-panel')!;
    const presets = document.getElementById('respective-presets-block')!;
    expect(presets.parentElement?.classList.contains('th-modern-preset-toolbar')).toBe(true);
    expect(panel.getAttribute('data-th-preset-tab')).toBe('params');
    expect(document.querySelector('.th-modern-preset-tab-count')?.textContent).toBe('5');

    document.querySelector<HTMLButtonElement>('.th-modern-preset-tab[data-tab="prompts"]')!.click();
    expect(panel.getAttribute('data-th-preset-tab')).toBe('prompts');
    expect(localStorage.getItem('th-modern-preset-tab')).toBe('prompts');

    document.getElementById('respective-ranges-and-temps')!.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 850));
    expect(document.querySelector('.th-modern-preset-dirty')?.textContent).toBe('未保存的修改');

    const editArea = document.getElementById('completion_prompt_manager_popup_edit')!;
    expect(editArea.closest('.th-modern-pm-editor')).not.toBeNull();

    dispose();
    dispose = () => {};
    expect(presets.parentElement?.id).toBe('ai_response_configuration');
    expect(presets.nextElementSibling?.id).toBe('respective-ranges-and-temps');
    expect(editArea.parentElement?.id).toBe('completion_prompt_manager_popup');
    expect(document.querySelector('.th-modern-pm')).toBeNull();
    expect(panel.hasAttribute('data-th-preset-tab')).toBe(false);
  });

  it('行内开关写回原生排序，单选组互斥，未加入的条目可重新加入', async () => {
    createPresetPanel();
    const pm = createPromptManager();
    await mountWith(pm);

    const header = document.querySelector<HTMLElement>('.th-modern-pm-row[data-group-id="grp_mode"]')!;
    expect(header.nextElementSibling).toBe(row('write'));
    expect(header.querySelector('.th-modern-pm-group-count')?.textContent).toBe('1/2');
    expect(row('write').classList.contains('is-grouped')).toBe(true);
    expect(row('chatHistory').querySelector('.th-modern-pm-copy')).toBeNull();

    row('chat').querySelector<HTMLButtonElement>('.th-modern-pm-toggle')!.click();
    const current = pm.getPromptOrderForCharacter(pm.activeCharacter);
    expect(current.find(entry => entry.identifier === 'chat')?.enabled).toBe(true);
    expect(current.find(entry => entry.identifier === 'write')?.enabled).toBe(false);
    expect(pm.calls.save).toBe(1);
    expect(pm.calls.render).toBe(1);

    expect(document.querySelector('.th-modern-pm-unused > summary')?.textContent).toContain('1');
    document.querySelector<HTMLButtonElement>('.th-modern-pm-unused-add')!.click();
    expect(pm.getPromptOrderForCharacter(pm.activeCharacter).map(entry => entry.identifier)).toEqual([
      'main',
      'spare',
      'chatHistory',
      'intro',
      'write',
      'chat',
    ]);

    // 单选组标题：有开启项时全部关闭。
    document.querySelector<HTMLButtonElement>('.th-modern-pm-row[data-group-id="grp_mode"] .th-modern-pm-toggle')!.click();
    const after = pm.getPromptOrderForCharacter(pm.activeCharacter);
    expect(after.filter(entry => ['write', 'chat'].includes(entry.identifier)).every(entry => !entry.enabled)).toBe(true);
  });

  it('右侧编辑自动应用，并能删除或复制条目', async () => {
    createPresetPanel();
    const pm = createPromptManager();
    const confirm = vi.fn(async () => true);
    vi.stubGlobal('SillyTavern', { callGenericPopup: confirm, POPUP_TYPE: { CONFIRM: 2 } });
    await mountWith(pm);

    expect(row('main').classList.contains('is-active')).toBe(true);
    expect(pm.calls.load).toBe(1);
    expect(pm.calls.update).toBe(0);

    row('write').click();
    expect(pm.calls.load).toBe(2);
    const name = document.getElementById('completion_prompt_manager_popup_entry_form_name') as HTMLInputElement;
    name.value = '写作模式改';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 450));
    expect(pm.getPromptById('write')?.name).toBe('写作模式改');
    expect(row('write').querySelector('.th-modern-pm-name')?.textContent).toBe('写作模式改');

    row('write').querySelector<HTMLButtonElement>('.th-modern-pm-copy')!.click();
    const ids = pm.getPromptOrderForCharacter(pm.activeCharacter).map(entry => entry.identifier);
    const copyId = ids[ids.indexOf('write') + 1];
    expect(pm.getPromptById(copyId)?.name).toBe('写作模式改 副本');
    const groups = pm.serviceSettings.extensions!.luker!.prompt_groups as PromptGroupData[];
    expect(groups[0].identifiers).toContain(copyId);
    expect(row(copyId).classList.contains('is-active')).toBe(true);

    row(copyId).querySelector<HTMLButtonElement>('.th-modern-pm-delete')!.click();
    await flushLayout();
    expect(confirm).toHaveBeenCalledOnce();
    expect(pm.getPromptById(copyId)).toBeNull();
    expect(pm.getPromptOrderForCharacter(pm.activeCharacter).some(entry => entry.identifier === copyId)).toBe(false);
    expect(groups[0].identifiers).not.toContain(copyId);

    row('main').querySelector<HTMLButtonElement>('.th-modern-pm-delete')!.click();
    await flushLayout();
    expect(pm.getPromptById('main')).not.toBeNull();
    expect(pm.getPromptOrderForCharacter(pm.activeCharacter).some(entry => entry.identifier === 'main')).toBe(false);
  });

  it('鼠标和触屏都能进入多选，并可查看占位条目的实际内容', async () => {
    createPresetPanel();
    const pm = createPromptManager();
    await mountWith(pm);
    const shell = document.querySelector<HTMLElement>('.th-modern-pm')!;
    const batch = document.querySelector<HTMLElement>('.th-modern-pm-batch')!;

    document.querySelector<HTMLButtonElement>('.th-modern-pm-multi')!.click();
    expect(shell.classList.contains('is-multiselect')).toBe(true);
    expect(batch.hidden).toBe(false);
    row('write').click();
    row('chat').click();
    expect(document.querySelector('.th-modern-pm-batch-count')?.textContent).toBe('已选 3 项');
    expect(row('main').classList.contains('is-active')).toBe(true);
    row('main').click();
    expect(document.querySelector('.th-modern-pm-batch-count')?.textContent).toBe('已选 2 项');

    [...batch.querySelectorAll('button')].find(button => button.textContent === '完成')!.click();
    expect(shell.classList.contains('is-multiselect')).toBe(false);
    expect(batch.hidden).toBe(true);

    row('intro').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', button: 0 }));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(shell.classList.contains('is-multiselect')).toBe(true);
    expect(row('intro').classList.contains('is-selected')).toBe(true);
    row('intro').click();
    expect(row('intro').classList.contains('is-selected')).toBe(true);
    document.querySelector<HTMLButtonElement>('.th-modern-pm-multi')!.click();

    row('chatHistory').click();
    const inspect = document.getElementById('completion_prompt_manager_popup_inspect')!;
    expect(inspect.closest('.th-modern-pm-editor')).not.toBeNull();
    expect(inspect.style.display).toBe('');
    expect(inspect.textContent).toContain('用户：你好');
    expect(document.getElementById('completion_prompt_manager_popup_edit')!.style.display).toBe('none');
    const editButton = document.querySelector<HTMLButtonElement>('.th-modern-pm-view-button')!;
    expect(editButton.disabled).toBe(true);

    row('write').click();
    expect(document.getElementById('completion_prompt_manager_popup_edit')!.style.display).toBe('');
    [...document.querySelectorAll<HTMLButtonElement>('.th-modern-pm-view-button')].find(button => button.textContent === '查看')!.click();
    expect(document.querySelector('.th-modern-pm-editor-placeholder')?.textContent).toContain('还没有可查看的内容');

    dispose();
    dispose = () => {};
    expect(inspect.parentElement?.id).toBe('completion_prompt_manager_popup');
  });
});
