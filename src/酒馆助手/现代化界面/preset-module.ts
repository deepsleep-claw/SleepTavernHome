import { watch } from 'vue';

import { getHostDocument, getHostWindow } from './host-context';
import { trackHostPointerDrag } from './pointer-drag';
import {
  assignToGroup,
  buildPromptList,
  cleanupGroups,
  createGroup,
  ensurePromptGroups,
  findGroupOf,
  getDescendantGroupIds,
  getExclusiveSiblings,
  getGroupPromptIds,
  getPromptGroups,
  insertOrderEntries,
  moveOrderEntries,
  removeGroup,
  reparentGroup,
  type GroupRow,
  type HostPrompt,
  type ListRow,
  type PromptGroupData,
  type PromptGroupSettings,
  type PromptOrderEntry,
  type PromptRow,
} from './preset-prompt-model';
import type { useModernLayoutStore } from './store';

type Store = ReturnType<typeof useModernLayoutStore>;

export type HostPromptManager = {
  activeCharacter: unknown;
  configuration: { prefix: string };
  serviceSettings: PromptGroupSettings & {
    prompts: HostPrompt[];
    prompt_order?: Array<{ character_id: unknown; order: PromptOrderEntry[] }>;
  };
  tokenUsage?: number;
  tokenHandler?: { getCounts?: () => Record<string, number | null | undefined> };
  getPromptOrderForCharacter(character: unknown): PromptOrderEntry[];
  removePromptOrderForCharacter(character: unknown): void;
  addPromptOrderForCharacter(character: unknown, order: PromptOrderEntry[]): void;
  getPromptById(identifier: string): HostPrompt | null;
  addPrompt(prompt: Partial<HostPrompt>, identifier: string): void;
  isPromptDeletionAllowed(prompt: HostPrompt): boolean;
  isPromptEditAllowed(prompt: HostPrompt): boolean;
  isPromptToggleAllowed(prompt: HostPrompt): boolean;
  loadPromptIntoEditForm(prompt: HostPrompt): void;
  updatePromptWithPromptEditForm(prompt: HostPrompt): void;
  updateQuickEdit?(identifier: string, prompt: HostPrompt): void;
  saveServiceSettings(): unknown;
  render(afterTryGenerate?: boolean): unknown;
  getUuidv4?(): string;
  messages?: { hasItemWithIdentifier(identifier: string): boolean; getItemByIdentifier(identifier: string): unknown } | null;
  loadMessagesIntoInspectForm?(messages: unknown): void;
  clearInspectForm?(): void;
  handleImport?(event?: Event): unknown;
  handleFullExport?(event?: Event): unknown;
  handleCharacterReset?(event?: Event): unknown;
};

export type PresetEditorHost = {
  getPromptManager(): HostPromptManager | null;
};

export type PresetEditorOptions = {
  loadHost?: () => Promise<PresetEditorHost>;
  /** 返回 `null` 表示暂时无法判断。 */
  checkDirty?: () => boolean | null;
};

type PresetTab = 'params' | 'prompts' | 'advanced';

type EditorView = 'edit' | 'preview';

type MovedNode = { marker: Comment; node: HTMLElement };

type DropTarget = {
  anchorId: string;
  placement: 'before' | 'after';
  groupId: string | null;
};

const PANEL_CLASS = 'th-modern-preset-enabled';
const PANEL_TAB_ATTRIBUTE = 'data-th-preset-tab';
const PROMPT_SECTION_CLASS = 'th-modern-preset-pm-section';
const NARROW_CLASS = 'th-modern-pm-narrow';
const DETAIL_OPEN_CLASS = 'th-modern-pm-detail-open';
const TAB_STORAGE_KEY = 'th-modern-preset-tab';
const COLLAPSED_STORAGE_PREFIX = 'th-modern-preset-collapsed:';
const QUICK_EDIT_PROMPTS = ['main', 'nsfw', 'jailbreak'];
const EDITOR_APPLY_DELAY = 400;
const DIRTY_CHECK_DELAY = 800;
const DIRTY_POLL_INTERVAL = 5000;
const NARROW_WIDTH = 640;
const DRAG_THRESHOLD = 4;
const AUTO_SCROLL_EDGE = 36;
const INDENT_REM = 1;
const LONG_PRESS_DELAY = 450;
const LONG_PRESS_TOLERANCE = 8;
const MULTISELECT_CLASS = 'is-multiselect';

const ROLE_LABELS: Record<string, string> = { system: '系统', user: '用户', assistant: 'AI' };

const TABS: Array<{ id: PresetTab; label: string }> = [
  { id: 'params', label: '参数' },
  { id: 'prompts', label: '提示词' },
  { id: 'advanced', label: '高级' },
];

function readStorage(key: string): string | null {
  try {
    return getHostWindow().localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    const storage = getHostWindow().localStorage;
    if (value === null) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, value);
    }
  } catch {
    /* 隐私模式或禁用站点数据时只保留本次会话的状态。 */
  }
}

function makeElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function makeIconButton(document: Document, className: string, title: string, icon: string): HTMLButtonElement {
  const button = makeElement(document, 'button', `th-modern-pm-icon-button ${className}`.trim());
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.append(makeElement(document, 'i', `bi ${icon}`));
  return button;
}

function makeSwitch(document: Document, checked: boolean | 'mixed', title: string): HTMLButtonElement {
  const toggle = makeElement(document, 'button', 'th-modern-pm-toggle');
  toggle.type = 'button';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(checked));
  toggle.title = title;
  return toggle;
}

function moveNode(node: HTMLElement, target: HTMLElement): MovedNode {
  const marker = node.ownerDocument.createComment('th-modern-preset');
  node.before(marker);
  target.append(node);
  return { marker, node };
}

function restoreMovedNode(move: MovedNode | undefined): void {
  if (!move) return;
  if (move.marker.isConnected) {
    move.marker.replaceWith(move.node);
  }
  move.marker.remove();
}

function getPromptName(prompt: HostPrompt | null, identifier: string): string {
  return prompt?.name?.trim() || identifier;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultCheckDirty(): boolean | null {
  try {
    const name = getLoadedPresetName();
    if (!name) return null;
    return !_.isEqual(getPreset('in_use'), getPreset(name));
  } catch {
    return null;
  }
}

async function loadDefaultHost(): Promise<PresetEditorHost> {
  const hostWindow = getHostWindow() as Window & { Function: FunctionConstructor };
  const url = new URL('scripts/openai.js', getHostDocument().baseURI || hostWindow.location.href).href;
  const importModule = hostWindow.Function('url', 'return import(url);') as (url: string) => Promise<unknown>;
  const module = (await importModule(url)) as { promptManager?: HostPromptManager | null };
  // 模块命名空间是实时绑定，切换 API 后重建的 promptManager 也能读到。
  return { getPromptManager: () => module.promptManager ?? null };
}

class PresetEditor {
  private readonly document = getHostDocument();
  private readonly window = getHostWindow();
  private readonly checkDirty: () => boolean | null;
  private host?: PresetEditorHost;
  private hostLoading = false;
  private scheduledSync = 0;

  private panel?: HTMLElement;
  private toolbar?: HTMLElement;
  private presetsMove?: MovedNode;
  private pinMove?: MovedNode;
  private readonly tabButtons = new Map<PresetTab, HTMLButtonElement>();
  private dirtyBadge?: HTMLElement;
  private saveButton?: HTMLButtonElement;
  private promptSection?: HTMLElement;

  private shell?: HTMLElement;
  private list?: HTMLElement;
  private dropLine?: HTMLElement;
  private editorHeader?: HTMLElement;
  private editorExtra?: HTMLElement;
  private editorBody?: HTMLElement;
  private editorPlaceholder?: HTMLElement;
  private editAreaMove?: MovedNode;
  private inspectMove?: MovedNode;
  private multiButton?: HTMLButtonElement;
  private batchBar?: HTMLElement;
  private batchCount?: HTMLElement;
  private tokenTotal?: HTMLElement;
  private resizeObserver?: ResizeObserver;

  private readonly observer: MutationObserver;
  private observedSettings?: HTMLElement;
  private observedContainer?: HTMLElement;

  private tab: PresetTab;
  private search = '';
  private onlyEnabled = false;
  private unusedOpen = false;
  private selected = new Set<string>();
  private activeId: string | null = null;
  private activeGroupId: string | null = null;
  private anchorId: string | null = null;
  private editingId: string | null = null;
  /** 表单载入时的条目对象；切换预设后同 id 会换成新对象，需要重新载入。 */
  private editingPrompt: HostPrompt | null = null;
  private detailOpen = false;
  private collapsed = new Map<string, boolean>();
  private collapsedKey = '';
  private rows: ListRow[] = [];
  private visibleRows: ListRow[] = [];
  private groups: PromptGroupData[] = [];
  private suppressEditorEvents = false;
  private applyTimer = 0;
  private dirtyTimer = 0;
  private dirtyInterval = 0;
  private dirty: boolean | null = null;
  private stopDrag?: () => void;
  private autoScrollFrame = 0;
  private multiSelect = false;
  private longPress?: { timer: number; x: number; y: number; pointerId: number };
  private suppressNextClick = false;
  private editorView: EditorView = 'edit';
  /** 当前预览所用的消息对象；没变时不重绘，保留已展开的消息。 */
  private previewSource: unknown = undefined;

  constructor(
    private readonly store: Store,
    private readonly options: PresetEditorOptions,
  ) {
    this.checkDirty = options.checkDirty ?? defaultCheckDirty;
    const stored = readStorage(TAB_STORAGE_KEY);
    this.tab = TABS.some(tab => tab.id === stored) ? (stored as PresetTab) : 'params';
    const HostMutationObserver = (this.window as Window & { MutationObserver: typeof MutationObserver })
      .MutationObserver;
    this.observer = new HostMutationObserver(() => this.scheduleSync());
  }

  readonly scheduleSync = (): void => {
    if (this.scheduledSync) return;
    this.scheduledSync = this.window.requestAnimationFrame(() => {
      this.scheduledSync = 0;
      this.sync();
    });
  };

  destroy(): void {
    if (this.scheduledSync) {
      this.window.cancelAnimationFrame(this.scheduledSync);
      this.scheduledSync = 0;
    }
    this.observer.disconnect();
    this.observedSettings = undefined;
    this.observedContainer = undefined;
    this.teardown();
  }

  private get promptManager(): HostPromptManager | null {
    return this.host?.getPromptManager() ?? null;
  }

  private sync(): void {
    if (!this.store.is_active || !this.store.settings.modernPresetEditor) {
      this.observe(undefined, undefined);
      this.teardown();
      return;
    }

    if (!this.host) {
      this.ensureHost();
      return;
    }

    const settings = this.document.getElementById('openai_settings') ?? undefined;
    const container = this.document.getElementById('completion_prompt_manager') ?? undefined;
    this.observe(settings, container);

    const panel = this.document.getElementById('left-nav-panel');
    const presetsBlock = this.document.getElementById('respective-presets-block');
    const pm = this.promptManager;
    const isOpenAi = !!settings && settings.style.display !== 'none';
    if (!panel || !presetsBlock || !settings || !container || !pm || !isOpenAi) {
      this.teardown();
      return;
    }

    this.panel = panel;
    panel.classList.add(PANEL_CLASS);
    this.ensurePanelPin(panel);
    this.ensureToolbar(presetsBlock);
    this.ensurePromptShell(container);
    this.applyTab();
    this.renderList();
    this.ensureDirtyPolling();
  }

  private ensureHost(): void {
    if (this.hostLoading) return;
    this.hostLoading = true;
    (this.options.loadHost ?? loadDefaultHost)()
      .then(host => {
        this.host = host;
        this.scheduleSync();
      })
      .catch(error => {
        console.warn('[现代化界面] 预设界面无法读取酒馆提示词管理器，已保留原生界面。', error);
      })
      .finally(() => {
        this.hostLoading = false;
      });
  }

  private observe(settings: HTMLElement | undefined, container: HTMLElement | undefined): void {
    if (settings === this.observedSettings && container === this.observedContainer) return;
    this.observer.disconnect();
    this.observedSettings = settings;
    this.observedContainer = container;
    if (settings) {
      this.observer.observe(settings, { attributes: true, attributeFilter: ['style'] });
    }
    if (container) {
      // 原生每次改动都会重绘这个容器，借此得知数据变化。
      this.observer.observe(container, { childList: true, subtree: true, characterData: true });
    }
  }

  private teardown(): void {
    this.flushEditorApply();
    this.stopDrag?.();
    this.stopDrag = undefined;
    this.window.clearTimeout(this.dirtyTimer);
    this.window.clearInterval(this.dirtyInterval);
    this.dirtyTimer = 0;
    this.dirtyInterval = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;

    this.cancelLongPress();
    restoreMovedNode(this.editAreaMove);
    this.editAreaMove = undefined;
    restoreMovedNode(this.inspectMove);
    this.inspectMove = undefined;
    this.previewSource = undefined;
    restoreMovedNode(this.presetsMove);
    this.presetsMove = undefined;
    restoreMovedNode(this.pinMove);
    this.pinMove = undefined;
    this.toolbar?.remove();
    this.toolbar = undefined;
    this.tabButtons.clear();
    this.shell?.remove();
    this.shell = undefined;
    this.list = undefined;
    this.editingId = null;
    this.editingPrompt = null;
    this.promptSection?.classList.remove(PROMPT_SECTION_CLASS);
    this.promptSection = undefined;
    this.panel?.classList.remove(PANEL_CLASS);
    this.panel?.removeAttribute(PANEL_TAB_ATTRIBUTE);
    this.panel = undefined;
  }

  /* ---------- 顶部工具栏与标签页 ---------- */

  /** 面板固定按钮原本单独占一行，并入标题栏操作区。 */
  private ensurePanelPin(panel: HTMLElement): void {
    const pin = this.document.getElementById('lm_button_panel_pin_div');
    const actions = panel.querySelector<HTMLElement>(':scope > .th-modern-drawer-titlebar .th-modern-drawer-actions');
    if (this.pinMove && this.pinMove.marker.isConnected && this.pinMove.node === pin && pin?.parentElement === actions) return;
    restoreMovedNode(this.pinMove);
    this.pinMove = undefined;
    if (pin && actions) {
      const marker = this.document.createComment('th-modern-preset-pin');
      pin.before(marker);
      actions.prepend(pin);
      this.pinMove = { marker, node: pin };
    }
  }

  private ensureToolbar(presetsBlock: HTMLElement): void {
    if (this.toolbar?.isConnected && presetsBlock.parentElement === this.toolbar) return;

    restoreMovedNode(this.presetsMove);
    this.toolbar?.remove();
    const toolbar = makeElement(this.document, 'div', 'th-modern-preset-toolbar');
    presetsBlock.before(toolbar);
    this.presetsMove = moveNode(presetsBlock, toolbar);

    const tabsRow = makeElement(this.document, 'div', 'th-modern-preset-tabs');
    const tabList = makeElement(this.document, 'div', 'th-modern-preset-tablist');
    tabList.setAttribute('role', 'tablist');
    this.tabButtons.clear();
    for (const tab of TABS) {
      const button = makeElement(this.document, 'button', 'th-modern-preset-tab');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.dataset.tab = tab.id;
      button.append(makeElement(this.document, 'span', '', tab.label));
      if (tab.id === 'prompts') {
        button.append(makeElement(this.document, 'span', 'th-modern-preset-tab-count'));
      }
      button.addEventListener('click', () => this.setTab(tab.id));
      tabList.append(button);
      this.tabButtons.set(tab.id, button);
    }

    const status = makeElement(this.document, 'div', 'th-modern-preset-status');
    this.dirtyBadge = makeElement(this.document, 'span', 'th-modern-preset-dirty');
    this.saveButton = makeElement(this.document, 'button', 'th-modern-preset-save menu_button', '保存预设');
    this.saveButton.type = 'button';
    this.saveButton.addEventListener('click', () => {
      this.document.getElementById('update_oai_preset')?.click();
      this.scheduleDirtyCheck(1200);
    });
    status.append(this.dirtyBadge, this.saveButton);
    tabsRow.append(tabList, status);
    toolbar.append(tabsRow);
    this.toolbar = toolbar;
    this.renderDirty();
  }

  private setTab(tab: PresetTab): void {
    if (this.tab === tab) return;
    this.flushEditorApply();
    this.tab = tab;
    writeStorage(TAB_STORAGE_KEY, tab);
    this.applyTab();
    this.panel?.querySelector('.scrollableInner')?.scrollTo({ top: 0 });
  }

  private applyTab(): void {
    this.panel?.setAttribute(PANEL_TAB_ATTRIBUTE, this.tab);
    for (const [id, button] of this.tabButtons) {
      const active = id === this.tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    }
  }

  /* ---------- 未保存提示 ---------- */

  private ensureDirtyPolling(): void {
    if (this.dirtyInterval) return;
    this.dirtyInterval = this.window.setInterval(() => {
      if (this.panel?.classList.contains('openDrawer')) this.runDirtyCheck();
    }, DIRTY_POLL_INTERVAL);
    this.scheduleDirtyCheck();
  }

  readonly scheduleDirtyCheck = (delay = DIRTY_CHECK_DELAY): void => {
    if (!this.toolbar) return;
    this.window.clearTimeout(this.dirtyTimer);
    this.dirtyTimer = this.window.setTimeout(() => this.runDirtyCheck(), delay);
  };

  private runDirtyCheck(): void {
    this.dirtyTimer = 0;
    const dirty = this.checkDirty();
    if (dirty === this.dirty) return;
    this.dirty = dirty;
    this.renderDirty();
  }

  private renderDirty(): void {
    if (!this.dirtyBadge || !this.saveButton) return;
    const dirty = this.dirty === true;
    this.dirtyBadge.textContent = dirty ? '未保存的修改' : this.dirty === false ? '已保存' : '';
    this.dirtyBadge.classList.toggle('is-dirty', dirty);
    this.saveButton.classList.toggle('is-dirty', dirty);
  }

  /* ---------- 提示词页骨架 ---------- */

  private ensurePromptShell(container: HTMLElement): void {
    const section = this.findPromptSection(container);
    if (section !== this.promptSection) {
      this.promptSection?.classList.remove(PROMPT_SECTION_CLASS);
      this.promptSection = section ?? undefined;
      this.promptSection?.classList.add(PROMPT_SECTION_CLASS);
    }

    if (this.shell?.isConnected && this.shell.previousElementSibling === container) return;

    this.shell?.remove();
    const shell = makeElement(this.document, 'div', 'th-modern-pm');
    container.after(shell);
    this.shell = shell;
    shell.append(this.buildPromptToolbar(), this.buildBatchBar());

    const body = makeElement(this.document, 'div', 'th-modern-pm-body');
    const list = makeElement(this.document, 'div', 'th-modern-pm-list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-multiselectable', 'true');
    list.tabIndex = 0;
    list.addEventListener('click', this.handleListClick);
    list.addEventListener('pointerdown', this.handleListPointerDown);
    list.addEventListener('pointerdown', this.handleLongPressStart);
    list.addEventListener('pointermove', this.handleLongPressMove);
    list.addEventListener('pointerup', this.cancelLongPress);
    list.addEventListener('pointercancel', this.cancelLongPress);
    list.addEventListener('contextmenu', this.handleListContextMenu);
    list.addEventListener('keydown', this.handleListKeyDown);
    this.dropLine = makeElement(this.document, 'div', 'th-modern-pm-drop-line');
    this.list = list;

    const editor = makeElement(this.document, 'section', 'th-modern-pm-editor');
    this.editorHeader = makeElement(this.document, 'div', 'th-modern-pm-editor-header');
    this.editorExtra = makeElement(this.document, 'div', 'th-modern-pm-editor-extra');
    this.editorBody = makeElement(this.document, 'div', 'th-modern-pm-editor-body');
    this.editorPlaceholder = makeElement(this.document, 'div', 'th-modern-pm-editor-placeholder');
    editor.append(this.editorHeader, this.editorExtra, this.editorBody, this.editorPlaceholder);

    body.append(list, editor);
    shell.append(body);
    shell.classList.toggle(MULTISELECT_CLASS, this.multiSelect);

    this.editingId = null;
    this.editingPrompt = null;
    const ResizeObserverCtor = (this.window as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    this.resizeObserver?.disconnect();
    this.resizeObserver = ResizeObserverCtor ? new ResizeObserverCtor(() => this.updateNarrow()) : undefined;
    this.resizeObserver?.observe(shell);
    this.updateNarrow();
  }

  private findPromptSection(container: HTMLElement): HTMLElement | null {
    let node: HTMLElement | null = container;
    while (node?.parentElement && node.parentElement.id !== 'openai_settings') {
      node = node.parentElement;
    }
    return node?.parentElement ? node : null;
  }

  private updateNarrow(): void {
    if (!this.shell) return;
    const width = this.shell.getBoundingClientRect().width;
    const narrow = width > 0 && width < NARROW_WIDTH;
    this.shell.classList.toggle(NARROW_CLASS, narrow);
    this.shell.classList.toggle(DETAIL_OPEN_CLASS, narrow && this.detailOpen);
  }

  private buildPromptToolbar(): HTMLElement {
    const toolbar = makeElement(this.document, 'div', 'th-modern-pm-toolbar');

    const searchBox = makeElement(this.document, 'label', 'th-modern-pm-search');
    searchBox.append(makeElement(this.document, 'i', 'bi bi-search'));
    const search = makeElement(this.document, 'input', 'text_pole');
    search.type = 'search';
    search.placeholder = '搜索条目名称或内容';
    search.value = this.search;
    search.addEventListener('input', () => {
      this.search = search.value.trim().toLowerCase();
      this.renderList();
    });
    searchBox.append(search);

    const onlyEnabled = makeElement(this.document, 'button', 'th-modern-pm-chip', '仅显示启用');
    onlyEnabled.type = 'button';
    onlyEnabled.setAttribute('aria-pressed', String(this.onlyEnabled));
    onlyEnabled.addEventListener('click', () => {
      this.onlyEnabled = !this.onlyEnabled;
      onlyEnabled.setAttribute('aria-pressed', String(this.onlyEnabled));
      this.renderList();
    });

    const multi = makeElement(this.document, 'button', 'th-modern-pm-chip th-modern-pm-multi');
    multi.type = 'button';
    multi.title = '多选模式：单击条目即可勾选，手机上也可以长按条目进入';
    multi.append(makeElement(this.document, 'i', 'bi bi-check2-square'), makeElement(this.document, 'span', '', '多选'));
    multi.setAttribute('aria-pressed', String(this.multiSelect));
    multi.addEventListener('click', () => this.setMultiSelect(!this.multiSelect));
    this.multiButton = multi;

    this.tokenTotal = makeElement(this.document, 'span', 'th-modern-pm-token-total');

    const add = makeElement(this.document, 'button', 'th-modern-pm-add menu_button');
    add.type = 'button';
    add.append(makeElement(this.document, 'i', 'bi bi-plus-lg'), makeElement(this.document, 'span', '', '新增'));
    add.title = '在选中条目下方新增条目';
    add.addEventListener('click', () => this.addPromptEntry());

    const more = makeElement(this.document, 'details', 'th-modern-pm-more');
    const summary = makeElement(this.document, 'summary', 'th-modern-pm-icon-button');
    summary.title = '更多操作';
    summary.setAttribute('aria-label', '更多操作');
    summary.append(makeElement(this.document, 'i', 'bi bi-three-dots'));
    const menu = makeElement(this.document, 'div', 'th-modern-pm-menu');
    const menuItems: Array<[string, string, () => void]> = [
      ['bi-box-arrow-in-down', '导入条目', () => this.promptManager?.handleImport?.()],
      ['bi-box-arrow-up', '导出条目', () => this.promptManager?.handleFullExport?.()],
      ['bi-arrow-counterclockwise', '重置当前角色的排序', () => this.promptManager?.handleCharacterReset?.()],
    ];
    for (const [icon, label, action] of menuItems) {
      const item = makeElement(this.document, 'button', 'th-modern-pm-menu-item');
      item.type = 'button';
      item.append(makeElement(this.document, 'i', `bi ${icon}`), makeElement(this.document, 'span', '', label));
      item.addEventListener('click', () => {
        more.open = false;
        action();
      });
      menu.append(item);
    }
    more.append(summary, menu);

    toolbar.append(searchBox, onlyEnabled, multi, this.tokenTotal, add, more);
    return toolbar;
  }

  private buildBatchBar(): HTMLElement {
    const bar = makeElement(this.document, 'div', 'th-modern-pm-batch');
    this.batchCount = makeElement(this.document, 'span', 'th-modern-pm-batch-count');
    const actions: Array<[string, string, () => void]> = [
      ['bi-toggle-on', '开启', () => this.setEnabled([...this.selected], true)],
      ['bi-toggle-off', '关闭', () => this.setEnabled([...this.selected], false)],
      ['bi-folder-plus', '建组', () => void this.createGroupFromSelection()],
      ['bi-files', '复制', () => this.copyEntries([...this.selected])],
      ['bi-trash3', '删除', () => void this.deleteEntries([...this.selected])],
      ['bi-check-all', '全选', () => this.selectAllVisible()],
      ['bi-x-lg', '完成', () => this.clearSelection()],
    ];
    bar.append(this.batchCount);
    for (const [icon, label, action] of actions) {
      const button = makeElement(this.document, 'button', 'th-modern-pm-batch-button');
      button.type = 'button';
      button.append(makeElement(this.document, 'i', `bi ${icon}`), makeElement(this.document, 'span', '', label));
      button.addEventListener('click', action);
      bar.append(button);
    }
    this.batchBar = bar;
    return bar;
  }

  /* ---------- 列表渲染 ---------- */

  private getOrder(): PromptOrderEntry[] {
    const pm = this.promptManager;
    return pm ? pm.getPromptOrderForCharacter(pm.activeCharacter) : [];
  }

  private getPrompt(identifier: string): HostPrompt | null {
    return this.promptManager?.getPromptById(identifier) ?? null;
  }

  private getGroup(groupId: string | null): PromptGroupData | undefined {
    return groupId ? this.groups.find(group => group.id === groupId) : undefined;
  }

  private loadCollapsed(): void {
    const presetName =
      this.document.querySelector<HTMLSelectElement>('#settings_preset_openai')?.selectedOptions[0]?.textContent ?? '';
    const key = `${COLLAPSED_STORAGE_PREFIX}${presetName}`;
    if (key === this.collapsedKey) return;
    this.collapsedKey = key;
    this.collapsed = new Map();
    try {
      const parsed = JSON.parse(readStorage(key) ?? '{}') as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [id, value] of Object.entries(parsed)) {
          if (typeof value === 'boolean') this.collapsed.set(id, value);
        }
      }
    } catch {
      /* 损坏的本地状态直接忽略。 */
    }
  }

  /** 折叠状态只存在本机，避免每次折叠都让预设显示为未保存；未记录时沿用 Luker 保存的状态。 */
  private isCollapsed(group: PromptGroupData): boolean {
    return this.collapsed.get(group.id) ?? !!group.collapsed;
  }

  private toggleCollapsed(groupId: string): void {
    const group = this.getGroup(groupId);
    if (!group) return;
    this.collapsed.set(groupId, !this.isCollapsed(group));
    writeStorage(this.collapsedKey, JSON.stringify(Object.fromEntries(this.collapsed)));
    this.renderList();
  }

  private matchesFilter(row: PromptRow): boolean {
    if (this.onlyEnabled && !row.enabled) return false;
    if (!this.search) return true;
    const name = getPromptName(row.prompt, row.identifier).toLowerCase();
    return name.includes(this.search) || (row.prompt?.content ?? '').toLowerCase().includes(this.search);
  }

  private computeVisibleRows(): ListRow[] {
    if (this.search || this.onlyEnabled) {
      // 筛选时忽略折叠，并保留命中条目所在的各级组标题。
      const groupIds = new Set<string>();
      const prompts = new Set<PromptRow>();
      for (const row of this.rows) {
        if (row.kind === 'prompt' && this.matchesFilter(row)) {
          prompts.add(row);
          row.ancestors.forEach(id => groupIds.add(id));
        }
      }
      return this.rows.filter(row => (row.kind === 'group' ? groupIds.has(row.group.id) : prompts.has(row)));
    }
    return this.rows.filter(row => {
      const hidden = row.ancestors.some(id => {
        const group = this.getGroup(id);
        return group ? this.isCollapsed(group) : false;
      });
      return !hidden;
    });
  }

  private renderList(): void {
    const pm = this.promptManager;
    const list = this.list;
    if (!pm || !list) return;

    this.loadCollapsed();
    const order = this.getOrder();
    this.groups = getPromptGroups(pm.serviceSettings);
    this.rows = buildPromptList(order, this.groups, identifier => this.getPrompt(identifier));

    const known = new Set(order.map(entry => entry.identifier));
    for (const identifier of [...this.selected]) {
      if (!known.has(identifier)) this.selected.delete(identifier);
    }
    if (this.activeId && !known.has(this.activeId) && !this.getPrompt(this.activeId)) this.activeId = null;
    if (this.activeGroupId && !this.getGroup(this.activeGroupId)) this.activeGroupId = null;
    if (!this.activeId && !this.activeGroupId && order.length && !this.shell?.classList.contains(NARROW_CLASS)) {
      this.activeId = order[0].identifier;
      this.selected = new Set([this.activeId]);
      this.anchorId = this.activeId;
    }

    const counts = pm.tokenHandler?.getCounts?.() ?? {};
    // 只要有一个条目算出了 Token，就为所有行保留 Token 列，保证标签对齐。
    list.classList.toggle('has-tokens', order.some(entry => typeof counts[entry.identifier] === 'number'));
    const scrollTop = list.scrollTop;
    const fragment = this.document.createDocumentFragment();
    this.visibleRows = this.computeVisibleRows();
    for (const row of this.visibleRows) {
      fragment.append(row.kind === 'group' ? this.createGroupRow(row, order) : this.createPromptRow(pm, row, counts[row.identifier]));
    }
    if (!this.visibleRows.length) {
      fragment.append(
        makeElement(this.document, 'div', 'th-modern-pm-empty', this.rows.length ? '没有符合条件的条目' : '列表里还没有条目'),
      );
    }
    fragment.append(this.createUnusedSection(pm, known));
    if (this.dropLine) fragment.append(this.dropLine);
    list.replaceChildren(fragment);
    list.scrollTop = scrollTop;

    const countLabel = this.tabButtons.get('prompts')?.querySelector('.th-modern-preset-tab-count');
    if (countLabel) countLabel.textContent = String(order.length);
    if (this.tokenTotal) this.tokenTotal.textContent = pm.tokenUsage ? `总 Token：${pm.tokenUsage}` : '';
    this.renderBatchBar();
    this.syncEditor();
  }

  private getGroupState(group: PromptGroupData, order: readonly PromptOrderEntry[]): { enabled: number; total: number } {
    const ids = getGroupPromptIds(this.groups, group.id);
    const enabled = ids.filter(id => order.find(entry => entry.identifier === id)?.enabled).length;
    return { enabled, total: ids.length };
  }

  private createGroupRow(row: GroupRow, order: readonly PromptOrderEntry[]): HTMLElement {
    const { group } = row;
    const collapsed = this.isCollapsed(group);
    const state = this.getGroupState(group, order);
    const element = makeElement(this.document, 'div', 'th-modern-pm-row is-group-header');
    element.dataset.groupId = group.id;
    element.style.setProperty('--th-modern-pm-indent', `${row.depth * INDENT_REM}rem`);
    element.classList.toggle('is-active', group.id === this.activeGroupId);
    element.classList.toggle('is-disabled', state.enabled === 0);
    element.classList.toggle('is-continued', row.continued);

    const handle = makeElement(this.document, 'span', 'th-modern-pm-handle');
    handle.title = '拖动整组';
    handle.append(makeElement(this.document, 'i', 'bi bi-grip-vertical'));
    const chevron = makeIconButton(
      this.document,
      'th-modern-pm-collapse',
      collapsed ? '展开分组' : '折叠分组',
      collapsed ? 'bi-chevron-right' : 'bi-chevron-down',
    );
    chevron.setAttribute('aria-expanded', String(!collapsed));

    const main = makeElement(this.document, 'span', 'th-modern-pm-main');
    main.append(
      makeElement(this.document, 'i', `th-modern-pm-kind bi ${collapsed ? 'bi-folder' : 'bi-folder2-open'}`),
      makeElement(this.document, 'span', 'th-modern-pm-name', group.name || '未命名分组'),
      makeElement(this.document, 'span', 'th-modern-pm-group-count', `${state.enabled}/${state.total}`),
    );
    if (group.single_select) main.append(makeElement(this.document, 'span', 'th-modern-pm-badge is-mode', '单选'));
    if (row.continued) main.append(makeElement(this.document, 'span', 'th-modern-pm-badge', '续'));

    const checked = group.single_select
      ? state.enabled > 0
      : state.enabled === state.total
        ? true
        : state.enabled
          ? 'mixed'
          : false;
    const toggle = makeSwitch(
      this.document,
      checked,
      group.single_select ? '单选组：有选项开启时点击全部关闭，否则开启第一项' : '开启或关闭组内全部条目',
    );
    toggle.disabled = !state.total;
    const ids = getGroupPromptIds(this.groups, group.id);
    const allSelected = ids.length > 0 && ids.every(id => this.selected.has(id));
    element.classList.toggle('is-selected', this.multiSelect && allSelected);
    element.append(handle, this.createCheck(allSelected), chevron, main, toggle);
    return element;
  }

  private createPromptRow(pm: HostPromptManager, row: PromptRow, tokens: number | null | undefined): HTMLElement {
    const { identifier, prompt } = row;
    const element = makeElement(this.document, 'div', 'th-modern-pm-row');
    element.dataset.id = identifier;
    element.style.setProperty('--th-modern-pm-indent', `${row.depth * INDENT_REM}rem`);
    element.setAttribute('role', 'option');
    element.setAttribute('aria-selected', String(this.selected.has(identifier)));
    element.classList.toggle('is-disabled', !row.enabled);
    element.classList.toggle('is-active', identifier === this.activeId && !this.activeGroupId);
    element.classList.toggle('is-selected', this.selected.has(identifier));
    element.classList.toggle('is-marker', !!prompt?.marker);
    element.classList.toggle('is-grouped', row.depth > 0);
    element.classList.toggle('is-missing', !prompt);

    const handle = makeElement(this.document, 'span', 'th-modern-pm-handle');
    handle.title = '拖动排序；选中多项后可一起拖动';
    handle.append(makeElement(this.document, 'i', 'bi bi-grip-vertical'));
    element.append(handle, this.createCheck(this.selected.has(identifier)));

    if (prompt?.marker) {
      const icon = makeElement(this.document, 'i', 'th-modern-pm-kind bi bi-pin-angle-fill');
      icon.title = '占位条目：内容由酒馆在生成时填入';
      element.append(icon);
    }

    const main = makeElement(this.document, 'span', 'th-modern-pm-main');
    main.append(makeElement(this.document, 'span', 'th-modern-pm-name', getPromptName(prompt, identifier)));
    element.append(main);

    const badges = makeElement(this.document, 'span', 'th-modern-pm-badges');
    if (prompt && !prompt.marker && prompt.role) {
      badges.append(
        makeElement(this.document, 'span', `th-modern-pm-badge is-role-${prompt.role}`, ROLE_LABELS[prompt.role] ?? prompt.role),
      );
    }
    if (prompt?.injection_position === 1) {
      badges.append(makeElement(this.document, 'span', 'th-modern-pm-badge is-depth', `@${prompt.injection_depth ?? 4}`));
    }
    if (!prompt) badges.append(makeElement(this.document, 'span', 'th-modern-pm-badge is-warning', '缺失'));
    element.append(badges);

    element.append(makeElement(this.document, 'span', 'th-modern-pm-tokens', typeof tokens === 'number' ? String(tokens) : ''));

    const actions = makeElement(this.document, 'span', 'th-modern-pm-actions');
    if (prompt && !prompt.marker) actions.append(makeIconButton(this.document, 'th-modern-pm-copy', '复制条目', 'bi-files'));
    if (prompt) {
      const deletable = pm.isPromptDeletionAllowed(prompt);
      actions.append(
        makeIconButton(
          this.document,
          'th-modern-pm-delete',
          deletable ? '删除条目' : '移出列表（内置条目不能删除）',
          deletable ? 'bi-trash3' : 'bi-box-arrow-right',
        ),
      );
    }
    element.append(actions);

    const toggle = makeSwitch(this.document, row.enabled, row.enabled ? '已启用，点击关闭' : '已关闭，点击启用');
    toggle.disabled = !prompt || !pm.isPromptToggleAllowed(prompt);
    element.append(toggle);
    return element;
  }

  private createUnusedSection(pm: HostPromptManager, used: ReadonlySet<string>): HTMLElement {
    const prompts = pm.serviceSettings.prompts.filter(prompt => prompt && !used.has(prompt.identifier));
    const details = makeElement(this.document, 'details', 'th-modern-pm-unused');
    details.open = this.unusedOpen;
    details.hidden = !prompts.length;
    details.addEventListener('toggle', () => {
      this.unusedOpen = details.open;
    });
    details.append(makeElement(this.document, 'summary', '', `未加入列表的条目（${prompts.length}）`));
    for (const prompt of prompts) {
      const item = makeElement(this.document, 'div', 'th-modern-pm-unused-item');
      item.append(makeElement(this.document, 'span', 'th-modern-pm-name', getPromptName(prompt, prompt.identifier)));
      const add = makeElement(this.document, 'button', 'th-modern-pm-unused-add menu_button', '加入');
      add.type = 'button';
      add.title = '加入到选中条目下方';
      add.addEventListener('click', () => this.attachEntry(prompt.identifier));
      item.append(add);
      details.append(item);
    }
    return details;
  }

  private renderBatchBar(): void {
    if (!this.batchBar || !this.batchCount) return;
    this.batchBar.hidden = this.multiSelect ? false : this.selected.size < 2;
    this.batchCount.textContent = `已选 ${this.selected.size} 项`;
  }

  /* ---------- 列表交互 ---------- */

  private readonly handleListClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const element = target?.closest<HTMLElement>('.th-modern-pm-row');
    if (this.suppressNextClick) {
      // 长按已经处理过这次点击。
      this.suppressNextClick = false;
      return;
    }
    if (!element || target?.closest('.th-modern-pm-handle')) return;

    const groupId = element.dataset.groupId;
    if (groupId) {
      if (target?.closest('.th-modern-pm-toggle')) {
        this.toggleGroup(groupId);
      } else if (target?.closest('.th-modern-pm-collapse')) {
        this.toggleCollapsed(groupId);
      } else if (this.multiSelect) {
        this.toggleGroupSelection(groupId);
      } else {
        this.flushEditorApply();
        this.activeGroupId = groupId;
        this.selected.clear();
        this.openDetail();
        this.renderList();
      }
      return;
    }

    const identifier = element.dataset.id;
    if (!identifier) return;
    if (target?.closest('.th-modern-pm-toggle')) {
      this.toggleEntry(identifier);
      return;
    }
    if (target?.closest('.th-modern-pm-copy')) {
      this.copyEntries(this.selected.has(identifier) ? [...this.selected] : [identifier]);
      return;
    }
    if (target?.closest('.th-modern-pm-delete')) {
      void this.deleteEntries(this.selected.has(identifier) ? [...this.selected] : [identifier]);
      return;
    }

    if (event.shiftKey && this.anchorId) {
      const visible = this.visibleRows.flatMap(row => (row.kind === 'prompt' ? [row.identifier] : []));
      const from = visible.indexOf(this.anchorId);
      const to = visible.indexOf(identifier);
      if (from !== -1 && to !== -1) {
        this.selected = new Set(visible.slice(Math.min(from, to), Math.max(from, to) + 1));
      }
    } else if (this.multiSelect || event.ctrlKey || event.metaKey) {
      if (this.selected.has(identifier) && (this.multiSelect || this.selected.size > 1)) {
        this.selected.delete(identifier);
      } else {
        this.selected.add(identifier);
      }
      this.anchorId = identifier;
    } else {
      this.select(identifier);
    }
    this.renderList();
  };

  private readonly handleListKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && (this.multiSelect || this.selected.size > 1)) {
      event.preventDefault();
      this.clearSelection();
    }
  };

  /** 退出多选并只保留当前编辑的条目。 */
  private clearSelection(): void {
    this.multiSelect = false;
    this.selected = new Set(this.activeId && !this.activeGroupId ? [this.activeId] : []);
    this.applyMultiSelectState();
    this.renderList();
  }

  private setMultiSelect(enabled: boolean): void {
    if (!enabled) {
      this.clearSelection();
      return;
    }
    this.multiSelect = true;
    this.applyMultiSelectState();
    this.renderList();
  }

  private applyMultiSelectState(): void {
    this.shell?.classList.toggle(MULTISELECT_CLASS, this.multiSelect);
    this.multiButton?.setAttribute('aria-pressed', String(this.multiSelect));
  }

  private selectAllVisible(): void {
    const visible = this.visibleRows.flatMap(row => (row.kind === 'prompt' ? [row.identifier] : []));
    const allSelected = visible.length > 0 && visible.every(id => this.selected.has(id));
    this.selected = allSelected ? new Set() : new Set(visible);
    this.multiSelect = true;
    this.applyMultiSelectState();
    this.renderList();
  }

  private toggleGroupSelection(groupId: string): void {
    const ids = getGroupPromptIds(this.groups, groupId);
    const allSelected = ids.every(id => this.selected.has(id));
    for (const id of ids) {
      if (allSelected) {
        this.selected.delete(id);
      } else {
        this.selected.add(id);
      }
    }
    this.renderList();
  }

  private createCheck(checked: boolean): HTMLElement {
    const check = makeElement(this.document, 'span', 'th-modern-pm-check');
    check.setAttribute('aria-hidden', 'true');
    if (checked) check.append(makeElement(this.document, 'i', 'bi bi-check-lg'));
    return check;
  }

  /* 触屏长按进入多选；鼠标使用多选按钮或 Ctrl/Shift。 */
  private readonly handleLongPressStart = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' || event.button !== 0) return;
    const target = event.target as Element | null;
    const row = target?.closest<HTMLElement>('.th-modern-pm-row');
    if (!row || target?.closest('.th-modern-pm-handle, .th-modern-pm-toggle, button')) return;
    this.cancelLongPress();
    const timer = this.window.setTimeout(() => {
      this.longPress = undefined;
      this.suppressNextClick = true;
      this.multiSelect = true;
      if (row.dataset.groupId) {
        this.toggleGroupSelection(row.dataset.groupId);
      } else if (row.dataset.id) {
        this.selected.add(row.dataset.id);
        this.anchorId = row.dataset.id;
      }
      this.applyMultiSelectState();
      this.renderList();
      (this.window.navigator as Navigator & { vibrate?: (pattern: number) => boolean }).vibrate?.(15);
    }, LONG_PRESS_DELAY);
    this.longPress = { timer, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  };

  private readonly handleLongPressMove = (event: PointerEvent): void => {
    const press = this.longPress;
    if (!press || press.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_TOLERANCE) this.cancelLongPress();
  };

  private readonly cancelLongPress = (): void => {
    if (!this.longPress) return;
    this.window.clearTimeout(this.longPress.timer);
    this.longPress = undefined;
  };

  private readonly handleListContextMenu = (event: MouseEvent): void => {
    // 长按触发的系统菜单会打断多选。
    if (this.longPress || this.suppressNextClick) event.preventDefault();
  };

  private openDetail(): void {
    this.detailOpen = true;
    this.updateNarrow();
  }

  private select(identifier: string): void {
    this.activeId = identifier;
    this.activeGroupId = null;
    this.anchorId = identifier;
    this.selected = new Set([identifier]);
    this.openDetail();
  }

  /* ---------- 写回原生数据 ---------- */

  private commit(): void {
    const pm = this.promptManager;
    if (!pm) return;
    Promise.resolve(pm.saveServiceSettings()).catch(error => console.error('[现代化界面] 保存提示词设置失败', error));
    pm.render();
    this.renderList();
    this.scheduleDirtyCheck();
  }

  private replaceOrder(order: PromptOrderEntry[]): void {
    const pm = this.promptManager;
    if (!pm) return;
    pm.removePromptOrderForCharacter(pm.activeCharacter);
    pm.addPromptOrderForCharacter(pm.activeCharacter, order);
  }

  private cleanupGroupData(): void {
    const pm = this.promptManager;
    if (!pm) return;
    const groups = getPromptGroups(pm.serviceSettings);
    if (!groups.length) return;
    cleanupGroups(ensurePromptGroups(pm.serviceSettings), new Set(this.getOrder().map(entry => entry.identifier)));
  }

  private resetTokenCount(identifier: string): void {
    const counts = this.promptManager?.tokenHandler?.getCounts?.();
    if (counts) counts[identifier] = null;
  }

  private toggleEntry(identifier: string): void {
    const entry = this.getOrder().find(item => item.identifier === identifier);
    if (entry) this.setEnabled([identifier], !entry.enabled);
  }

  private setEnabled(identifiers: string[], enabled: boolean): void {
    const pm = this.promptManager;
    if (!pm) return;
    const order = this.getOrder();
    let changed = false;
    for (const identifier of identifiers) {
      const entry = order.find(item => item.identifier === identifier);
      const prompt = this.getPrompt(identifier);
      if (!entry || !prompt || !pm.isPromptToggleAllowed(prompt) || entry.enabled === enabled) continue;
      entry.enabled = enabled;
      this.resetTokenCount(identifier);
      changed = true;
      if (!enabled) continue;
      for (const sibling of getExclusiveSiblings(this.groups, identifier)) {
        const siblingEntry = order.find(item => item.identifier === sibling);
        if (siblingEntry?.enabled) {
          siblingEntry.enabled = false;
          this.resetTokenCount(sibling);
        }
      }
    }
    if (changed) this.commit();
  }

  private toggleGroup(groupId: string): void {
    const group = this.getGroup(groupId);
    if (!group) return;
    const order = this.getOrder();
    if (group.single_select) {
      const enabled = group.identifiers.filter(id => order.find(entry => entry.identifier === id)?.enabled);
      if (enabled.length) {
        this.setEnabled(enabled, false);
      } else {
        const first = order.find(entry => group.identifiers.includes(entry.identifier));
        if (first) this.setEnabled([first.identifier], true);
      }
      return;
    }
    const ids = getGroupPromptIds(this.groups, groupId);
    const allEnabled = ids.every(id => order.find(entry => entry.identifier === id)?.enabled);
    this.setEnabled(ids, !allEnabled);
  }

  private createIdentifier(): string {
    const hostCrypto = (this.window as Window & { crypto?: Crypto }).crypto;
    return (
      this.promptManager?.getUuidv4?.() ??
      hostCrypto?.randomUUID?.() ??
      `th-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    );
  }

  /** 新条目跟随锚点所在的分组。 */
  private insertNear(entries: PromptOrderEntry[], anchorId: string | null): void {
    const pm = this.promptManager;
    if (!pm) return;
    this.replaceOrder(insertOrderEntries(this.getOrder(), entries, anchorId));
    const group = anchorId ? findGroupOf(this.groups, anchorId) : null;
    if (group) {
      assignToGroup(
        ensurePromptGroups(pm.serviceSettings),
        entries.map(entry => entry.identifier),
        group.id,
      );
    }
  }

  private getInsertAnchor(): string | null {
    if (this.activeGroupId) {
      const ids = getGroupPromptIds(this.groups, this.activeGroupId);
      return [...this.getOrder()].reverse().find(entry => ids.includes(entry.identifier))?.identifier ?? null;
    }
    return this.activeId;
  }

  private addPromptEntry(): void {
    const pm = this.promptManager;
    if (!pm) return;
    this.flushEditorApply();
    const identifier = this.createIdentifier();
    pm.addPrompt(
      {
        name: '新条目',
        role: 'system',
        content: '',
        system_prompt: false,
        marker: false,
        injection_position: 0,
        injection_depth: 4,
        injection_order: 100,
        forbid_overrides: false,
      },
      identifier,
    );
    this.insertNear([{ identifier, enabled: false }], this.getInsertAnchor());
    this.select(identifier);
    this.commit();
    this.focusEditorName();
  }

  private attachEntry(identifier: string): void {
    if (this.getOrder().some(entry => entry.identifier === identifier)) return;
    this.insertNear([{ identifier, enabled: false }], this.getInsertAnchor());
    this.select(identifier);
    this.commit();
  }

  private copyEntries(identifiers: string[]): void {
    const pm = this.promptManager;
    if (!pm) return;
    this.flushEditorApply();
    const sources = this.getOrder().filter(entry => identifiers.includes(entry.identifier));
    let lastCopy: string | null = null;
    for (const source of sources) {
      const prompt = this.getPrompt(source.identifier);
      if (!prompt || prompt.marker) continue;
      const identifier = this.createIdentifier();
      const copy = JSON.parse(JSON.stringify(prompt)) as HostPrompt;
      pm.serviceSettings.prompts.push({
        ...copy,
        identifier,
        name: `${getPromptName(prompt, source.identifier)} 副本`,
        system_prompt: false,
        marker: false,
      });
      this.insertNear([{ identifier, enabled: source.enabled }], source.identifier);
      lastCopy = identifier;
    }
    if (!lastCopy) return;
    this.select(lastCopy);
    this.commit();
  }

  private async confirm(message: string): Promise<boolean> {
    try {
      return !!(await SillyTavern.callGenericPopup(message, SillyTavern.POPUP_TYPE.CONFIRM));
    } catch (error) {
      toastr.error(`无法打开确认框：${getErrorMessage(error)}`);
      return false;
    }
  }

  private async deleteEntries(identifiers: string[]): Promise<void> {
    const pm = this.promptManager;
    if (!pm || !identifiers.length) return;
    this.flushEditorApply();
    const prompts = identifiers.map(identifier => this.getPrompt(identifier));
    const removable = identifiers.filter((_, index) => {
      const prompt = prompts[index];
      return !prompt || pm.isPromptDeletionAllowed(prompt);
    });
    const detachOnly = identifiers.filter(identifier => !removable.includes(identifier));

    const names = identifiers.slice(0, 3).map((identifier, index) => getPromptName(prompts[index], identifier));
    const subject =
      identifiers.length === 1
        ? `「${names[0]}」`
        : `${names.join('、')}${identifiers.length > 3 ? ' 等' : ''} ${identifiers.length} 个条目`;
    const note = detachOnly.length
      ? `\n其中 ${detachOnly.length} 个是酒馆内置条目，只会移出列表，可在列表底部重新加入。`
      : '';
    if (!(await this.confirm(`确定要删除${subject}吗？${note}`))) return;

    const removeSet = new Set(removable);
    const detachSet = new Set(detachOnly);
    const currentOrder = this.getOrder();
    const visible = this.rows.flatMap(row => (row.kind === 'prompt' ? [row.identifier] : []));
    for (const entry of pm.serviceSettings.prompt_order ?? []) {
      const isCurrent = entry.order === currentOrder;
      for (let index = entry.order.length - 1; index >= 0; index -= 1) {
        const id = entry.order[index].identifier;
        if (removeSet.has(id) || (isCurrent && detachSet.has(id))) entry.order.splice(index, 1);
      }
    }
    for (let index = pm.serviceSettings.prompts.length - 1; index >= 0; index -= 1) {
      if (removeSet.has(pm.serviceSettings.prompts[index]?.identifier)) pm.serviceSettings.prompts.splice(index, 1);
    }
    this.cleanupGroupData();

    if (this.activeId && (removeSet.has(this.activeId) || detachSet.has(this.activeId))) {
      const remaining = new Set(this.getOrder().map(entry => entry.identifier));
      const start = visible.indexOf(this.activeId);
      this.activeId =
        visible.slice(start + 1).find(id => remaining.has(id)) ??
        visible
          .slice(0, start)
          .reverse()
          .find(id => remaining.has(id)) ??
        null;
    }
    this.selected = new Set(this.activeId ? [this.activeId] : []);
    this.anchorId = this.activeId;
    this.commit();
  }

  /* ---------- 分组 ---------- */

  private async askGroupName(defaultName = ''): Promise<string | null> {
    try {
      const result = await SillyTavern.callGenericPopup('分组名称', SillyTavern.POPUP_TYPE.INPUT, defaultName);
      return typeof result === 'string' && result.trim() ? result.trim() : null;
    } catch (error) {
      toastr.error(`无法打开输入框：${getErrorMessage(error)}`);
      return null;
    }
  }

  private async createGroupFromSelection(identifiers = [...this.selected]): Promise<void> {
    const pm = this.promptManager;
    if (!pm || !identifiers.length) return;
    this.flushEditorApply();
    const name = await this.askGroupName();
    if (!name) return;

    // 选中的条目不连续时先收拢到第一项的位置，与 Luker 要求组内条目连续一致。
    const order = this.getOrder();
    const chosen = new Set(identifiers);
    const firstIndex = order.findIndex(entry => chosen.has(entry.identifier));
    if (firstIndex === -1) return;
    const moved = order.filter(entry => chosen.has(entry.identifier));
    const rest = order.filter(entry => !chosen.has(entry.identifier));
    const insertAt = order.slice(0, firstIndex).filter(entry => !chosen.has(entry.identifier)).length;
    this.replaceOrder([...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)]);

    const groups = ensurePromptGroups(pm.serviceSettings);
    const owners = new Set(moved.map(entry => findGroupOf(groups, entry.identifier)?.id ?? null));
    const parentId = owners.size === 1 ? [...owners][0] : null;
    const group = createGroup(groups, {
      id: `grp_${this.createIdentifier()}`,
      name,
      identifiers: moved.map(entry => entry.identifier),
      parentId,
    });
    this.cleanupGroupData();
    this.activeGroupId = group.id;
    this.selected.clear();
    this.commit();
  }

  private updateGroup(groupId: string, update: (group: PromptGroupData) => void): void {
    const group = this.getGroup(groupId);
    if (!group) return;
    update(group);
    this.commit();
  }

  private async dissolveGroup(groupId: string): Promise<void> {
    const pm = this.promptManager;
    const group = this.getGroup(groupId);
    if (!pm || !group) return;
    if (!(await this.confirm(`解散分组「${group.name}」？组内条目会保留，只是不再归组。`))) return;
    removeGroup(ensurePromptGroups(pm.serviceSettings), groupId);
    this.cleanupGroupData();
    this.activeGroupId = null;
    this.activeId = group.identifiers[0] ?? this.activeId;
    this.commit();
  }

  /* ---------- 拖拽排序 ---------- */

  private readonly handleListPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const handle = (event.target as Element | null)?.closest<HTMLElement>('.th-modern-pm-handle');
    const row = handle?.closest<HTMLElement>('.th-modern-pm-row');
    if (!handle || !row || !this.list) return;
    event.preventDefault();

    const movingGroupId = row.dataset.groupId ?? null;
    const identifier = row.dataset.id;
    let moving: Set<string>;
    let movingGroups = new Set<string>();
    if (movingGroupId) {
      moving = new Set(getGroupPromptIds(this.groups, movingGroupId));
      movingGroups = new Set([movingGroupId, ...getDescendantGroupIds(this.groups, movingGroupId)]);
    } else if (identifier) {
      moving = this.selected.has(identifier) ? new Set(this.selected) : new Set([identifier]);
    } else {
      return;
    }
    if (!moving.size) return;

    const startY = event.clientY;
    let started = false;
    let drop: DropTarget | null = null;
    let pointerY = event.clientY;
    const ghost = makeElement(
      this.document,
      'div',
      'th-modern-pm-drag-ghost',
      movingGroupId ? `移动分组（${moving.size} 项）` : `移动 ${moving.size} 项`,
    );
    const isMovingRow = (element: HTMLElement) =>
      element.dataset.groupId ? movingGroups.has(element.dataset.groupId) : moving.has(element.dataset.id ?? '');

    const autoScroll = () => {
      this.autoScrollFrame = 0;
      if (!started || !this.list) return;
      const rect = this.list.getBoundingClientRect();
      let delta = 0;
      if (pointerY < rect.top + AUTO_SCROLL_EDGE) delta = -Math.ceil((rect.top + AUTO_SCROLL_EDGE - pointerY) / 3);
      if (pointerY > rect.bottom - AUTO_SCROLL_EDGE) delta = Math.ceil((pointerY - rect.bottom + AUTO_SCROLL_EDGE) / 3);
      if (delta) {
        this.list.scrollTop += delta;
        drop = this.updateDropTarget(pointerY, isMovingRow, moving, movingGroups);
        this.autoScrollFrame = this.window.requestAnimationFrame(autoScroll);
      }
    };

    this.stopDrag?.();
    this.stopDrag = trackHostPointerDrag({
      target: handle,
      event,
      cursor: 'grabbing',
      onMove: next => {
        pointerY = next.clientY;
        if (!started) {
          if (Math.abs(next.clientY - startY) < DRAG_THRESHOLD) return;
          started = true;
          this.flushEditorApply();
          this.document.body.append(ghost);
          this.list?.querySelectorAll<HTMLElement>('.th-modern-pm-row').forEach(item => {
            item.classList.toggle('is-dragging', isMovingRow(item));
          });
        }
        ghost.style.transform = `translate(${next.clientX + 14}px, ${next.clientY + 10}px)`;
        drop = this.updateDropTarget(next.clientY, isMovingRow, moving, movingGroups);
        if (!this.autoScrollFrame) this.autoScrollFrame = this.window.requestAnimationFrame(autoScroll);
      },
      onStop: () => {
        this.stopDrag = undefined;
        if (this.autoScrollFrame) {
          this.window.cancelAnimationFrame(this.autoScrollFrame);
          this.autoScrollFrame = 0;
        }
        ghost.remove();
        this.dropLine?.classList.remove('is-visible');
        this.list?.querySelectorAll('.is-dragging').forEach(item => item.classList.remove('is-dragging'));
        if (started && drop) this.applyDrop(drop, moving, movingGroupId);
      },
    });
  };

  private applyDrop(drop: DropTarget, moving: ReadonlySet<string>, movingGroupId: string | null): void {
    const pm = this.promptManager;
    if (!pm) return;
    const order = this.getOrder();
    const nextOrder = moveOrderEntries(order, moving, drop.anchorId, drop.placement);
    let groupChanged = false;
    if (movingGroupId) {
      const group = this.getGroup(movingGroupId);
      if ((group?.parentId ?? null) !== drop.groupId) {
        if (!reparentGroup(ensurePromptGroups(pm.serviceSettings), movingGroupId, drop.groupId)) return;
        groupChanged = true;
      }
    } else {
      const changed = [...moving].some(id => (findGroupOf(this.groups, id)?.id ?? null) !== drop.groupId);
      if (changed && (drop.groupId || this.groups.length)) {
        // 按排序顺序写入，保持组内条目顺序与列表一致。
        const ids = (nextOrder ?? order).filter(entry => moving.has(entry.identifier)).map(entry => entry.identifier);
        assignToGroup(ensurePromptGroups(pm.serviceSettings), ids, drop.groupId);
        groupChanged = true;
      }
    }
    if (!nextOrder && !groupChanged) return;
    if (nextOrder) this.replaceOrder(nextOrder);
    this.cleanupGroupData();
    this.commit();
  }

  /** 根据指针位置决定插入点和目标分组。 */
  private updateDropTarget(
    clientY: number,
    isMovingRow: (element: HTMLElement) => boolean,
    moving: ReadonlySet<string>,
    movingGroups: ReadonlySet<string>,
  ): DropTarget | null {
    const list = this.list;
    const line = this.dropLine;
    if (!list || !line) return null;
    const elements = [...list.querySelectorAll<HTMLElement>('.th-modern-pm-row')].filter(element => !isMovingRow(element));
    if (!elements.length) return null;

    let target = elements[elements.length - 1];
    let placement: 'before' | 'after' = 'after';
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        target = element;
        placement = 'before';
        break;
      }
    }

    const order = this.getOrder();
    const firstOutside = (ids: readonly string[], fromEnd = false) => {
      const entries = fromEnd ? [...order].reverse() : order;
      return entries.find(entry => ids.includes(entry.identifier) && !moving.has(entry.identifier))?.identifier ?? null;
    };

    let result: DropTarget | null = null;
    const groupId = target.dataset.groupId;
    if (groupId) {
      const group = this.getGroup(groupId);
      if (!group) return null;
      const ids = getGroupPromptIds(this.groups, groupId);
      const parentId = group.parentId ?? null;
      if (placement === 'before') {
        const anchor = firstOutside(ids);
        result = anchor ? { anchorId: anchor, placement: 'before', groupId: parentId } : null;
      } else if (this.isCollapsed(group)) {
        const anchor = firstOutside(ids, true);
        result = anchor ? { anchorId: anchor, placement: 'after', groupId: parentId } : null;
      } else {
        const anchor = firstOutside(ids);
        result = anchor ? { anchorId: anchor, placement: 'before', groupId } : null;
      }
      if (result?.groupId && movingGroups.has(result.groupId)) result = null;
    } else {
      const identifier = target.dataset.id ?? '';
      result = { anchorId: identifier, placement, groupId: findGroupOf(this.groups, identifier)?.id ?? null };
    }

    if (!result) {
      line.classList.remove('is-visible');
      return null;
    }
    line.style.top = `${placement === 'before' ? target.offsetTop - 1 : target.offsetTop + target.offsetHeight - 1}px`;
    line.classList.add('is-visible');
    return result;
  }

  /* ---------- 右侧编辑 ---------- */

  private getEditArea(): HTMLElement | null {
    const prefix = this.promptManager?.configuration.prefix ?? 'completion_';
    return this.document.getElementById(`${prefix}prompt_manager_popup_edit`);
  }

  private syncEditor(): void {
    if (!this.editorBody) return;
    if (this.activeGroupId) {
      this.flushEditorApply();
      this.editingId = null;
      this.editingPrompt = null;
      this.renderGroupEditor(this.activeGroupId);
      return;
    }
    const identifier = this.activeId;
    const prompt = identifier ? this.getPrompt(identifier) : null;
    if (identifier !== this.editingId || prompt !== this.editingPrompt) {
      this.flushEditorApply();
      this.editingId = identifier;
      this.editingPrompt = prompt;
      this.loadPromptEditor();
    } else if (prompt && (this.editorView === 'preview' || !this.isEditable(prompt))) {
      this.renderPreview();
    }
    this.renderPromptEditorHeader();
  }

  private getInspectArea(): HTMLElement | null {
    const prefix = this.promptManager?.configuration.prefix ?? 'completion_';
    return this.document.getElementById(`${prefix}prompt_manager_popup_inspect`);
  }

  private showEditArea(visible: boolean, placeholder = ''): void {
    const editArea = this.getEditArea();
    const inspectArea = this.getInspectArea();
    if (editArea) editArea.style.display = visible ? '' : 'none';
    if (inspectArea && this.inspectMove) inspectArea.style.display = 'none';
    this.previewSource = undefined;
    if (this.editorBody) this.editorBody.hidden = !visible;
    this.setPlaceholder(visible ? '' : placeholder);
  }

  private setPlaceholder(text: string): void {
    if (!this.editorPlaceholder) return;
    this.editorPlaceholder.hidden = !text;
    this.editorPlaceholder.textContent = text;
  }

  private isEditable(prompt: HostPrompt | null): prompt is HostPrompt {
    return !!prompt && !!this.promptManager?.isPromptEditAllowed(prompt);
  }

  /** 原生的「检视」：显示条目在最近一次组装时实际生成的消息，聊天记录等占位条目也能看到内容。 */
  private renderPreview(force = false): void {
    const pm = this.promptManager;
    const identifier = this.editingId;
    const inspectArea = this.getInspectArea();
    if (!pm || !identifier || !this.editorBody) return;
    if (inspectArea && !this.inspectMove) this.inspectMove = moveNode(inspectArea, this.editorBody);

    const editArea = this.getEditArea();
    if (editArea) editArea.style.display = 'none';
    const messages = pm.messages?.hasItemWithIdentifier(identifier) ? pm.messages.getItemByIdentifier(identifier) : null;
    if (!force && messages === this.previewSource) return;
    this.previewSource = messages;

    if (!inspectArea || !messages || !pm.loadMessagesIntoInspectForm) {
      if (inspectArea) inspectArea.style.display = 'none';
      this.editorBody.hidden = true;
      this.setPlaceholder(
        '还没有可查看的内容。打开一个聊天后，酒馆在计算 Token 时会生成每个条目实际发送的消息；也可以点上方的刷新按钮重新计算。',
      );
      return;
    }
    pm.clearInspectForm?.();
    pm.loadMessagesIntoInspectForm(messages);
    inspectArea.style.display = '';
    this.editorBody.hidden = false;
    this.setPlaceholder('');
  }

  private setEditorView(view: EditorView): void {
    if (this.editorView === view) return;
    this.flushEditorApply();
    this.editorView = view;
    this.loadPromptEditor();
    this.renderPromptEditorHeader();
  }

  private loadPromptEditor(): void {
    const pm = this.promptManager;
    const identifier = this.editingId;
    const editArea = this.getEditArea();
    if (!pm || !this.editorBody) return;

    if (editArea && !this.editAreaMove) {
      this.editAreaMove = moveNode(editArea, this.editorBody);
      editArea.addEventListener('input', this.handleEditorInput);
      editArea.addEventListener('change', this.handleEditorInput);
      editArea.addEventListener('click', this.handleEditorClick);
    }

    const prompt = this.editingPrompt;
    if (prompt && (this.editorView === 'preview' || !this.isEditable(prompt))) {
      this.renderPreview(true);
      return;
    }
    if (editArea && prompt && pm.isPromptEditAllowed(prompt)) {
      this.suppressEditorEvents = true;
      try {
        pm.loadPromptIntoEditForm(prompt);
      } finally {
        this.suppressEditorEvents = false;
      }
      this.showEditArea(true);
      return;
    }
    this.showEditArea(false, !identifier ? '在左侧选择一个条目进行编辑' : '这个条目在预设里找不到定义，可以删除后重新添加。');
  }

  private renderPromptEditorHeader(): void {
    const header = this.editorHeader;
    const extra = this.editorExtra;
    const pm = this.promptManager;
    if (!header || !extra || !pm) return;
    header.replaceChildren();
    extra.replaceChildren();
    const identifier = this.editingId;
    if (!identifier) return;

    const prompt = this.getPrompt(identifier);
    const entry = this.getOrder().find(item => item.identifier === identifier);
    const actions = makeElement(this.document, 'div', 'th-modern-pm-editor-actions');
    const editable = this.isEditable(prompt);
    const previewing = !!prompt && (this.editorView === 'preview' || !editable);
    if (prompt) {
      const views = makeElement(this.document, 'div', 'th-modern-pm-view-switch');
      views.setAttribute('role', 'group');
      for (const [view, label] of [
        ['edit', '编辑'],
        ['preview', '查看'],
      ] as const) {
        const button = makeElement(this.document, 'button', 'th-modern-pm-view-button', label);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(previewing === (view === 'preview')));
        button.disabled = view === 'edit' && !editable;
        button.title =
          view === 'edit'
            ? editable
              ? '编辑条目'
              : '占位条目的内容由酒馆生成，不能直接编辑'
            : '查看最近一次实际发送的内容';
        button.addEventListener('click', () => this.setEditorView(view));
        views.append(button);
      }
      actions.append(views);
      if (previewing) {
        const refresh = makeIconButton(this.document, '', '重新计算实际内容', 'bi-arrow-clockwise');
        refresh.addEventListener('click', () => {
          this.previewSource = undefined;
          this.promptManager?.render();
        });
        actions.append(refresh);
      }
    }
    if (entry && prompt) {
      const toggle = makeSwitch(this.document, entry.enabled, entry.enabled ? '已启用，点击关闭' : '已关闭，点击启用');
      toggle.disabled = !pm.isPromptToggleAllowed(prompt);
      toggle.addEventListener('click', () => this.toggleEntry(identifier));
      actions.append(toggle);
    }
    if (entry) {
      const group = makeIconButton(this.document, '', '放入新分组', 'bi-folder-plus');
      group.addEventListener('click', () => void this.createGroupFromSelection([identifier]));
      actions.append(group);
    }
    if (prompt && !prompt.marker) {
      const copy = makeIconButton(this.document, '', '复制条目', 'bi-files');
      copy.addEventListener('click', () => this.copyEntries([identifier]));
      actions.append(copy);
    }
    if (prompt && entry) {
      const deletable = pm.isPromptDeletionAllowed(prompt);
      const remove = makeIconButton(
        this.document,
        'is-danger',
        deletable ? '删除条目' : '移出列表',
        deletable ? 'bi-trash3' : 'bi-box-arrow-right',
      );
      remove.addEventListener('click', () => void this.deleteEntries([identifier]));
      actions.append(remove);
    }
    header.append(
      this.createBackButton(),
      makeElement(this.document, 'div', 'th-modern-pm-editor-title', getPromptName(prompt, identifier)),
      actions,
    );

    const owner = findGroupOf(this.groups, identifier);
    if (owner) {
      const path = makeElement(this.document, 'div', 'th-modern-pm-editor-path');
      path.append(makeElement(this.document, 'i', 'bi bi-folder2-open'));
      path.append(makeElement(this.document, 'span', '', owner.name || '未命名分组'));
      if (owner.single_select) path.append(makeElement(this.document, 'span', 'th-modern-pm-badge is-mode', '单选'));
      extra.append(path);
    }
  }

  private createBackButton(): HTMLButtonElement {
    const back = makeIconButton(this.document, 'th-modern-pm-back', '返回列表', 'bi-arrow-left');
    back.addEventListener('click', () => {
      this.detailOpen = false;
      this.updateNarrow();
    });
    return back;
  }

  private renderGroupEditor(groupId: string): void {
    const header = this.editorHeader;
    const extra = this.editorExtra;
    const group = this.getGroup(groupId);
    if (!header || !extra || !group) return;
    this.showEditArea(false);
    header.replaceChildren();
    extra.replaceChildren();

    const order = this.getOrder();
    const state = this.getGroupState(group, order);
    const actions = makeElement(this.document, 'div', 'th-modern-pm-editor-actions');
    const dissolve = makeIconButton(this.document, 'is-danger', '解散分组', 'bi-folder-x');
    dissolve.addEventListener('click', () => void this.dissolveGroup(groupId));
    actions.append(dissolve);
    header.append(
      this.createBackButton(),
      makeElement(this.document, 'div', 'th-modern-pm-editor-title', group.name || '未命名分组'),
      actions,
    );

    const form = makeElement(this.document, 'div', 'th-modern-pm-group-form');
    const nameLabel = makeElement(this.document, 'label', 'th-modern-pm-field');
    nameLabel.append(makeElement(this.document, 'span', '', '分组名称'));
    const nameInput = makeElement(this.document, 'input', 'text_pole');
    nameInput.value = group.name;
    nameInput.addEventListener('change', () => {
      const name = nameInput.value.trim();
      if (name && name !== group.name) this.updateGroup(groupId, item => (item.name = name));
    });
    nameLabel.append(nameInput);

    const modeLabel = makeElement(this.document, 'label', 'th-modern-pm-field');
    modeLabel.append(makeElement(this.document, 'span', '', '选择方式'));
    const modeSelect = makeElement(this.document, 'select', 'text_pole');
    for (const [value, text] of [
      ['multi', '可多选'],
      ['single', '单选：开启一项时关闭同组其它项'],
    ]) {
      const option = makeElement(this.document, 'option', '', text);
      option.value = value;
      modeSelect.append(option);
    }
    modeSelect.value = group.single_select ? 'single' : 'multi';
    modeSelect.addEventListener('change', () => {
      this.updateGroup(groupId, item => {
        if (modeSelect.value === 'single') {
          item.single_select = true;
        } else {
          delete item.single_select;
        }
      });
    });
    modeLabel.append(modeSelect);

    const summary = makeElement(
      this.document,
      'p',
      'th-modern-pm-group-summary',
      `共 ${state.total} 个条目，已开启 ${state.enabled} 个。拖动组标题可以整组移动；把条目拖进或拖出分组即可调整成员。`,
    );
    const note = makeElement(
      this.document,
      'small',
      'th-modern-pm-meta-hint',
      '分组保存在预设的 Luker 分组数据里，Luker 原生界面也能识别；单选设置只在现代化界面中生效。',
    );
    form.append(nameLabel, modeLabel, summary, note);
    extra.append(form);
  }

  private readonly handleEditorInput = (): void => {
    if (this.suppressEditorEvents || !this.editingId) return;
    this.window.clearTimeout(this.applyTimer);
    this.applyTimer = this.window.setTimeout(() => this.applyEditor(), EDITOR_APPLY_DELAY);
  };

  private readonly handleEditorClick = (event: MouseEvent): void => {
    const prefix = this.promptManager?.configuration.prefix ?? 'completion_';
    if ((event.target as Element | null)?.closest(`#${prefix}prompt_manager_popup_entry_form_reset`)) {
      // 原生重置会清空并隐藏表单，完成后重新载入当前条目。
      this.window.setTimeout(() => {
        this.editingId = null;
        this.editingPrompt = null;
        this.syncEditor();
        this.scheduleDirtyCheck();
      }, 50);
    }
  };

  private flushEditorApply(): void {
    if (this.applyTimer) this.applyEditor();
  }

  private applyEditor(): void {
    this.window.clearTimeout(this.applyTimer);
    this.applyTimer = 0;
    const pm = this.promptManager;
    const identifier = this.editingId;
    const prompt = identifier ? this.getPrompt(identifier) : null;
    // 表单里是 editingPrompt 的内容，条目已被替换时丢弃这次写回。
    if (!pm || !identifier || !prompt || prompt !== this.editingPrompt || !pm.isPromptEditAllowed(prompt)) return;
    pm.updatePromptWithPromptEditForm(prompt);
    if (QUICK_EDIT_PROMPTS.includes(identifier)) pm.updateQuickEdit?.(identifier, prompt);
    this.resetTokenCount(identifier);
    this.commit();
  }

  private focusEditorName(): void {
    const prefix = this.promptManager?.configuration.prefix ?? 'completion_';
    const field = this.document.getElementById(`${prefix}prompt_manager_popup_entry_form_name`) as HTMLInputElement | null;
    field?.focus();
    field?.select();
  }
}

export function mountPresetEditor(store: Store, options: PresetEditorOptions = {}): { destroy: () => void } {
  const editor = new PresetEditor(store, options);
  const hostDocument = getHostDocument();
  const handleInput = (event: Event) => {
    if ((event.target as Element | null)?.closest?.('#left-nav-panel')) editor.scheduleDirtyCheck();
  };
  hostDocument.addEventListener('input', handleInput, true);
  hostDocument.addEventListener('change', handleInput, true);

  const stopWatch = watch(
    () => [store.is_active, store.settings.modernPresetEditor] as const,
    () => editor.scheduleSync(),
    { immediate: true },
  );

  return {
    destroy() {
      stopWatch();
      hostDocument.removeEventListener('input', handleInput, true);
      hostDocument.removeEventListener('change', handleInput, true);
      editor.destroy();
    },
  };
}
