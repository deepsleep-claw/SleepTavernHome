import { getHostDocument, getHostWindow } from './host-context';

const WIDE_QUERY = '(min-width: 1200px)';
const PHONE_QUERY = '(max-width: 560px)';
const SOURCE_CLASS = 'th-modern-mobile-world-source';
const NATIVE_SOURCE_CLASS = 'th-modern-mobile-world-source-native';
const SELECT2_SOURCE_CLASS = 'th-modern-mobile-world-select2-source';
const CONTROL_CLASS = 'th-modern-mobile-world-control';
const PICKER_CLASS = 'th-modern-mobile-world-picker';
const CUSTOM_MODE_CLASS = 'th-modern-world-select-custom';
const GLOBAL_FAVORITES_KEY = 'th_modern_world_book_favorites';
const RENAME_INTENT_TIMEOUT_MS = 30_000;
const SEARCH_DELAY_MS = 90;

type HostWindow = Window &
  typeof globalThis & {
    readonly $?: JQueryStatic;
  };

type PickerTab = 'all' | 'enabled' | 'favorites';
type PickerLayout = 'wide' | 'narrow' | 'phone';

type PickerOption = {
  disabled: boolean;
  favoriteKey: string;
  label: string;
  searchText: string;
  selected: boolean;
  sourceIndex: number;
  value: string;
};

type PickerRowView = {
  favoriteButton: HTMLButtonElement;
  favoriteOffIcon: HTMLElement;
  favoriteOnIcon: HTMLElement;
  labelText: Text;
  root: HTMLElement;
  selectButton: HTMLButtonElement;
  selectedIcon: HTMLElement;
};

type ControllerConfig = {
  key: string;
  multiple: boolean;
  placeholder: string;
  selector: string;
  title: string;
};

type MountWorldSelectOptions = {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
};

const CONTROLLER_CONFIGS: ControllerConfig[] = [
  {
    key: 'global',
    selector: '#world_info',
    title: '启用全局世界书',
    placeholder: '尚未启用世界书',
    multiple: true,
  },
  {
    key: 'editor',
    selector: '#world_editor_select',
    title: '选择要编辑的世界书',
    placeholder: '选择一个世界书',
    multiple: false,
  },
  {
    key: 'character-primary',
    selector: '.character_world_info_selector',
    title: '绑定主要世界书',
    placeholder: '未绑定主要世界书',
    multiple: false,
  },
  {
    key: 'character-additional',
    selector: '.character_extra_world_info_selector',
    title: '绑定附加世界书',
    placeholder: '尚未绑定附加世界书',
    multiple: true,
  },
  {
    key: 'persona',
    selector: '.persona_world_info_selector',
    title: '绑定人设世界书',
    placeholder: '未绑定人设世界书',
    multiple: false,
  },
];

const TAB_LABELS: Record<PickerTab, string> = {
  all: '全部',
  enabled: '已启用',
  favorites: '收藏',
};

function makeElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  return element;
}

function makeIcon(document: Document, className: string): HTMLElement {
  const icon = makeElement(document, 'i', className);
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim();
}

function normalizeFavorites(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((candidate): candidate is string => typeof candidate === 'string')
        .map(candidate => candidate.trim())
        .filter(Boolean),
    ),
  );
}

function targetToElement(target: EventTarget | null): Element | null {
  const candidate = target as (EventTarget & { closest?: Element['closest']; nodeType?: number; parentElement?: Element | null }) | null;
  if (!candidate) {
    return null;
  }
  if (typeof candidate.closest === 'function') {
    return candidate as Element;
  }
  return candidate.nodeType === 3 ? candidate.parentElement ?? null : null;
}

class MobileWorldSelectManager {
  private readonly document: Document;
  private readonly window: HostWindow;
  private readonly options: MountWorldSelectOptions;
  private readonly panelObserver: MutationObserver;
  private readonly documentObserver: MutationObserver;
  private readonly controllers: MobileWorldSelectController[] = [];
  private readonly lastTabs = new Map<string, PickerTab>();
  private favorites = new Set<string>();
  private enabled: boolean;
  private picker?: MobileWorldPicker;
  private pendingRename?: { oldName: string; timeout: number };
  private controllerRefreshFrame = 0;
  private variableWriteErrorNotified = false;

  constructor(options: MountWorldSelectOptions) {
    this.options = options;
    this.enabled = options.enabled;
    this.document = getHostDocument();
    this.window = getHostWindow() as HostWindow;
    this.panelObserver = new this.window.MutationObserver(() => {
      if (!this.document.querySelector('#WorldInfo.openDrawer')) {
        this.closePicker();
      }
    });
    this.documentObserver = new this.window.MutationObserver(this.scheduleControllerRefresh);
  }

  mount(): void {
    const worldInfo = this.document.querySelector('#WorldInfo');
    if (worldInfo) {
      this.panelObserver.observe(worldInfo, { attributes: true, attributeFilter: ['class'] });
    }
    this.documentObserver.observe(this.document.body, { childList: true, subtree: true });
    this.document.addEventListener('click', this.captureRenameIntent, true);
    this.favorites = this.readFavorites();
    this.mountControllers();
    this.applyEnabledState();
  }

  destroy(): void {
    this.panelObserver.disconnect();
    this.documentObserver.disconnect();
    if (this.controllerRefreshFrame) {
      this.window.cancelAnimationFrame(this.controllerRefreshFrame);
      this.controllerRefreshFrame = 0;
    }
    this.document.removeEventListener('click', this.captureRenameIntent, true);
    this.clearRenameIntent();
    this.closePicker();
    this.unmountControllers();
    this.document.querySelector('#WorldInfo')?.classList.remove(CUSTOM_MODE_CLASS);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      this.applyEnabledState();
      return;
    }
    this.enabled = enabled;
    this.closePicker();
    this.applyEnabledState();
  }

  requestEnabledChange(enabled: boolean): void {
    this.setEnabled(enabled);
    this.options.onEnabledChange(enabled);
  }

  openPicker(controller: MobileWorldSelectController): void {
    if (!this.enabled) {
      return;
    }
    this.closePicker();
    this.refreshFavoritesAndCleanInvalid();
    this.picker = new MobileWorldPicker(this, controller, () => {
      this.picker = undefined;
    });
    this.picker.mount();
  }

  closePicker(): void {
    this.picker?.destroy();
    this.picker = undefined;
  }

  isPickerFor(controller: MobileWorldSelectController): boolean {
    return this.picker?.belongsTo(controller) ?? false;
  }

  notifySourceChanged(controller: MobileWorldSelectController): void {
    this.tryMigrateRenamedFavorite();
    controller.syncTrigger();
    if (this.picker?.belongsTo(controller)) {
      this.picker.refreshFromSource();
    }
  }

  getInitialTab(controller: MobileWorldSelectController): PickerTab {
    const remembered = this.lastTabs.get(controller.config.key);
    if (remembered && (controller.config.multiple || remembered !== 'enabled')) {
      return remembered;
    }
    return 'all';
  }

  rememberTab(controller: MobileWorldSelectController, tab: PickerTab): void {
    this.lastTabs.set(controller.config.key, tab);
  }

  getFavorites(): Set<string> {
    return new Set(this.favorites);
  }

  isFavorite(value: string): boolean {
    return this.favorites.has(value);
  }

  toggleFavorite(value: string): boolean {
    if (!value) {
      return false;
    }
    const shouldFavorite = !this.favorites.has(value);
    if (shouldFavorite) {
      this.favorites.add(value);
    } else {
      this.favorites.delete(value);
    }
    this.writeFavorites();
    return shouldFavorite;
  }

  private applyEnabledState(): void {
    this.document.querySelector('#WorldInfo')?.classList.toggle(CUSTOM_MODE_CLASS, this.enabled);
    for (const controller of this.controllers) {
      controller.setNativeMode(!this.enabled);
    }
  }

  private mountControllers(): void {
    for (let index = this.controllers.length - 1; index >= 0; index -= 1) {
      const controller = this.controllers[index];
      if (controller.source.isConnected) {
        controller.syncSelect2Container();
        continue;
      }
      if (this.isPickerFor(controller)) {
        this.closePicker();
      }
      controller.destroy();
      this.controllers.splice(index, 1);
    }

    for (const config of CONTROLLER_CONFIGS) {
      for (const source of this.document.querySelectorAll<HTMLSelectElement>(config.selector)) {
        if (source.closest('.template_element') || this.controllers.some(controller => controller.source === source)) {
          continue;
        }
        const controller = new MobileWorldSelectController(this, source, config);
        controller.mount();
        controller.setNativeMode(!this.enabled);
        this.controllers.push(controller);
      }
    }
  }

  private unmountControllers(): void {
    while (this.controllers.length > 0) {
      this.controllers.pop()?.destroy();
    }
  }

  private getAvailableWorldNames(): Set<string> {
    return new Set(
      this.controllers.flatMap(controller => controller.getOptions().map(option => option.favoriteKey).filter(Boolean)),
    );
  }

  private readFavorites(): Set<string> {
    try {
      const variables = getVariables({ type: 'global' });
      return new Set(normalizeFavorites(variables?.[GLOBAL_FAVORITES_KEY]));
    } catch (error) {
      console.warn('[现代化界面] 读取世界书收藏失败。', error);
      return new Set();
    }
  }

  private writeFavorites(): void {
    try {
      const favorites = [...this.favorites];
      updateVariablesWith(
        variables => ({
          ...variables,
          [GLOBAL_FAVORITES_KEY]: favorites,
        }),
        { type: 'global' },
      );
      this.variableWriteErrorNotified = false;
    } catch (error) {
      console.error('[现代化界面] 写入世界书收藏失败。', error);
      if (!this.variableWriteErrorNotified) {
        toastr.error('世界书收藏保存失败，请稍后重试', '现代化界面');
        this.variableWriteErrorNotified = true;
      }
    }
  }

  private refreshFavoritesAndCleanInvalid(): void {
    this.favorites = this.readFavorites();
    const available = this.getAvailableWorldNames();
    if (available.size === 0) {
      return;
    }
    const cleaned = new Set([...this.favorites].filter(name => available.has(name)));
    if (cleaned.size !== this.favorites.size) {
      this.favorites = cleaned;
      this.writeFavorites();
    }
  }

  private migrateFavorite(oldName: string, newName: string): void {
    if (!this.favorites.has(oldName) || !newName || oldName === newName) {
      return;
    }
    this.favorites.delete(oldName);
    this.favorites.add(newName);
    this.writeFavorites();
  }

  private tryMigrateRenamedFavorite(): void {
    if (!this.pendingRename) {
      return;
    }
    const available = this.getAvailableWorldNames();
    const selectedName =
      this.document.querySelector<HTMLSelectElement>('#world_editor_select')?.selectedOptions[0]?.label.trim() ?? '';
    if (!available.has(this.pendingRename.oldName) && selectedName && available.has(selectedName)) {
      this.migrateFavorite(this.pendingRename.oldName, selectedName);
      this.clearRenameIntent();
    }
  }

  private clearRenameIntent(): void {
    if (!this.pendingRename) {
      return;
    }
    this.window.clearTimeout(this.pendingRename.timeout);
    this.pendingRename = undefined;
  }

  private readonly captureRenameIntent = (event: Event) => {
    const target = targetToElement(event.target);
    if (!target?.closest('#world_popup_name_button')) {
      return;
    }
    const oldName =
      this.document.querySelector<HTMLSelectElement>('#world_editor_select')?.selectedOptions[0]?.label.trim() ?? '';
    if (!oldName) {
      return;
    }
    this.clearRenameIntent();
    const timeout = this.window.setTimeout(() => this.clearRenameIntent(), RENAME_INTENT_TIMEOUT_MS);
    this.pendingRename = { oldName, timeout };
  };

  private readonly scheduleControllerRefresh = () => {
    if (this.controllerRefreshFrame) {
      return;
    }
    this.controllerRefreshFrame = this.window.requestAnimationFrame(() => {
      this.controllerRefreshFrame = 0;
      this.mountControllers();
    });
  };
}

class MobileWorldSelectController {
  readonly config: ControllerConfig;
  readonly document: Document;
  readonly source: HTMLSelectElement;
  readonly window: HostWindow;

  private readonly manager: MobileWorldSelectManager;
  private readonly namespace: string;
  private observer?: MutationObserver;
  private surface?: HTMLElement;
  private wrapper?: HTMLElement;
  private trigger?: HTMLButtonElement;
  private primaryText?: HTMLElement;
  private secondaryText?: HTMLElement;
  private countBadge?: HTMLElement;
  private nativeReturn?: HTMLButtonElement;
  private select2Container?: HTMLElement;
  private $source?: JQuery<HTMLSelectElement>;
  private nativeChangeHandler?: () => void;
  private syncFrame = 0;
  private nativeMode = false;

  constructor(manager: MobileWorldSelectManager, source: HTMLSelectElement, config: ControllerConfig) {
    this.manager = manager;
    this.source = source;
    this.config = config;
    this.document = source.ownerDocument;
    this.window = (this.document.defaultView ?? getHostWindow()) as HostWindow;
    this.namespace = `.thModernWorldSelect_${source.id || config.key}`;
  }

  mount(): void {
    if (this.wrapper) {
      return;
    }

    this.source.classList.add(SOURCE_CLASS);
    this.surface =
      this.source.closest<HTMLElement>('#WorldInfo, .character_world, .persona_world') ??
      this.source.parentElement ??
      undefined;
    this.select2Container = this.findSelect2Container();
    this.select2Container?.classList.add(SELECT2_SOURCE_CLASS);

    const wrapper = makeElement(this.document, 'div', CONTROL_CLASS);
    wrapper.dataset.source = this.source.id || this.config.key;
    const trigger = makeElement(this.document, 'button', 'menu_button th-modern-mobile-world-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.append(makeIcon(this.document, this.config.multiple ? 'fa-solid fa-layer-group' : 'fa-solid fa-book-open'));

    const text = makeElement(this.document, 'span', 'th-modern-mobile-world-trigger-text');
    const primary = makeElement(this.document, 'span', 'th-modern-mobile-world-trigger-primary');
    const secondary = makeElement(this.document, 'span', 'th-modern-mobile-world-trigger-secondary');
    text.append(primary, secondary);
    const count = makeElement(this.document, 'span', 'th-modern-mobile-world-trigger-count');
    trigger.append(text, count, makeIcon(this.document, 'fa-solid fa-chevron-down th-modern-mobile-world-trigger-chevron'));

    const nativeReturn = makeElement(
      this.document,
      'button',
      'menu_button menu_button_icon th-modern-mobile-world-native-return',
    );
    nativeReturn.type = 'button';
    nativeReturn.title = '使用现代世界书选择器';
    nativeReturn.append(makeIcon(this.document, 'fa-solid fa-list-check'), makeElement(this.document, 'span'));
    nativeReturn.lastElementChild!.textContent = '现代选择';

    trigger.addEventListener('click', this.openPicker);
    nativeReturn.addEventListener('click', this.returnToCustomMode);
    wrapper.append(trigger, nativeReturn);
    (this.select2Container ?? this.source).insertAdjacentElement('afterend', wrapper);

    this.wrapper = wrapper;
    this.trigger = trigger;
    this.primaryText = primary;
    this.secondaryText = secondary;
    this.countBadge = count;
    this.nativeReturn = nativeReturn;

    if (typeof this.window.$ === 'function') {
      this.$source = this.window.$(this.source);
      this.$source.on(`change${this.namespace}`, this.onSourceChange);
    } else {
      this.nativeChangeHandler = this.onSourceChange;
      this.source.addEventListener('change', this.nativeChangeHandler);
    }

    this.observer = new this.window.MutationObserver(this.scheduleSync);
    this.observer.observe(this.source, {
      attributes: true,
      attributeFilter: ['disabled'],
      childList: true,
      subtree: true,
    });
    this.syncTrigger();
  }

  destroy(): void {
    if (this.syncFrame) {
      this.window.cancelAnimationFrame(this.syncFrame);
      this.syncFrame = 0;
    }
    this.observer?.disconnect();
    this.observer = undefined;
    this.$source?.off(`change${this.namespace}`, this.onSourceChange);
    this.$source = undefined;
    if (this.nativeChangeHandler) {
      this.source.removeEventListener('change', this.nativeChangeHandler);
      this.nativeChangeHandler = undefined;
    }
    this.trigger?.removeEventListener('click', this.openPicker);
    this.nativeReturn?.removeEventListener('click', this.returnToCustomMode);
    this.wrapper?.remove();
    this.wrapper = undefined;
    this.trigger = undefined;
    this.primaryText = undefined;
    this.secondaryText = undefined;
    this.countBadge = undefined;
    this.nativeReturn = undefined;
    this.source.classList.remove(SOURCE_CLASS, NATIVE_SOURCE_CLASS);
    this.select2Container?.classList.remove(SELECT2_SOURCE_CLASS);
    this.select2Container = undefined;
    this.surface = undefined;
    this.nativeMode = false;
  }

  getOptions(): PickerOption[] {
    const options = Array.from(this.source.options).map((option, sourceIndex): PickerOption => {
      const label = String(option.label || option.textContent || option.value).trim();
      return {
        disabled: option.disabled,
        favoriteKey: option.value ? label : '',
        label,
        searchText: normalizeSearchText(label),
        selected: option.selected,
        sourceIndex,
        value: option.value,
      };
    });
    if (!this.config.multiple) {
      return options;
    }
    const meaningful = options.filter(option => option.value !== '');
    return meaningful.length > 0 ? meaningful : options;
  }

  getSelectedValues(): Set<string> {
    return new Set(
      Array.from(this.source.selectedOptions)
        .map(option => option.value)
        .filter(value => !this.config.multiple || value !== ''),
    );
  }

  getTriggerRect(): DOMRect | undefined {
    return this.trigger?.getBoundingClientRect();
  }

  commit(values: ReadonlySet<string>): void {
    let changed = false;
    if (this.config.multiple) {
      for (const option of Array.from(this.source.options)) {
        const selected = option.value !== '' && values.has(option.value);
        if (option.selected !== selected) {
          option.selected = selected;
          changed = true;
        }
      }
    } else {
      const value = values.values().next().value ?? '';
      changed = this.source.value !== value;
      this.source.value = value;
    }

    if (changed) {
      this.triggerSourceChange();
    } else {
      this.syncTrigger();
    }
  }

  setNativeMode(nativeMode: boolean): void {
    this.nativeMode = nativeMode;
    this.surface?.classList.toggle(CUSTOM_MODE_CLASS, !nativeMode);
    this.source.classList.toggle(NATIVE_SOURCE_CLASS, nativeMode);
    this.wrapper?.classList.toggle('is-native', nativeMode);
    this.syncTrigger();
  }

  syncSelect2Container(): void {
    const select2Container = this.findSelect2Container();
    if (select2Container === this.select2Container) {
      return;
    }
    this.select2Container?.classList.remove(SELECT2_SOURCE_CLASS);
    this.select2Container = select2Container;
    this.select2Container?.classList.add(SELECT2_SOURCE_CLASS);
    if (this.wrapper) {
      (this.select2Container ?? this.source).insertAdjacentElement('afterend', this.wrapper);
    }
  }

  syncTrigger(): void {
    if (!this.trigger || !this.primaryText || !this.secondaryText || !this.countBadge) {
      return;
    }

    const options = this.getOptions();
    const selectedValues = this.getSelectedValues();
    const selected = options.filter(option => selectedValues.has(option.value));
    const enabledOptions = options.filter(option => !option.disabled);
    this.trigger.disabled = this.source.disabled || enabledOptions.length === 0;
    this.trigger.setAttribute('aria-expanded', String(this.manager.isPickerFor(this)));

    if (this.config.multiple) {
      this.primaryText.textContent = selected.length > 0 ? `${selected.length} 本已启用` : this.config.placeholder;
      this.secondaryText.textContent =
        selected.length > 0
          ? `${selected
              .slice(0, 2)
              .map(option => option.label)
              .join('、')}${selected.length > 2 ? ` 等 ${selected.length} 本` : ''}`
          : '';
      this.secondaryText.hidden = selected.length === 0;
      this.countBadge.textContent = String(selected.length);
      this.countBadge.hidden = selected.length === 0;
    } else {
      const current = selected[0];
      this.primaryText.textContent = current?.value ? current.label : this.config.placeholder;
      this.secondaryText.textContent = '';
      this.secondaryText.hidden = true;
      this.countBadge.hidden = true;
    }

    this.trigger.title = `${this.config.title}：${this.primaryText.textContent}`;
    this.wrapper?.classList.toggle('is-native', this.nativeMode);
  }

  private findSelect2Container(): HTMLElement | undefined {
    const next = this.source.nextElementSibling;
    return next instanceof this.window.HTMLElement && next.classList.contains('select2-container') ? next : undefined;
  }

  private triggerSourceChange(): void {
    if (typeof this.window.$ === 'function') {
      this.window.$(this.source).trigger('change');
      return;
    }
    this.source.dispatchEvent(new this.window.Event('change', { bubbles: true }));
  }

  private readonly openPicker = () => {
    if (!this.source.disabled) {
      this.manager.openPicker(this);
    }
  };

  private readonly returnToCustomMode = () => {
    this.manager.requestEnabledChange(true);
  };

  private readonly onSourceChange = () => {
    this.manager.notifySourceChanged(this);
  };

  private readonly scheduleSync = () => {
    if (this.syncFrame) {
      return;
    }
    this.syncFrame = this.window.requestAnimationFrame(() => {
      this.syncFrame = 0;
      this.manager.notifySourceChanged(this);
    });
  };
}

class MobileWorldPicker {
  private readonly manager: MobileWorldSelectManager;
  private readonly controller: MobileWorldSelectController;
  private readonly document: Document;
  private readonly window: HostWindow;
  private readonly onDestroy: () => void;
  private options: PickerOption[] = [];
  private filteredOptions: PickerOption[] = [];
  private selectedValues = new Set<string>();
  private enabledSnapshot = new Set<string>();
  private favoriteSnapshot = new Set<string>();
  private activeTab: PickerTab;
  private layout: PickerLayout = 'phone';
  private overlay?: HTMLDialogElement;
  private sheet?: HTMLElement;
  private tabs?: HTMLElement;
  private searchInput?: HTMLInputElement;
  private clearSearchButton?: HTMLButtonElement;
  private resultStatus?: HTMLElement;
  private viewport?: HTMLElement;
  private rows?: HTMLElement;
  private emptyState?: HTMLElement;
  private emptyStateText?: Text;
  private rowPool: PickerRowView[] = [];
  private previousFocus?: HTMLElement;
  private searchTimer = 0;
  private query = '';
  private destroyed = false;

  constructor(manager: MobileWorldSelectManager, controller: MobileWorldSelectController, onDestroy: () => void) {
    this.manager = manager;
    this.controller = controller;
    this.document = controller.document;
    this.window = controller.window;
    this.onDestroy = onDestroy;
    this.activeTab = manager.getInitialTab(controller);
  }

  belongsTo(controller: MobileWorldSelectController): boolean {
    return this.controller === controller;
  }

  mount(): void {
    this.previousFocus = this.document.activeElement as HTMLElement | undefined;
    this.options = this.controller.getOptions();
    this.selectedValues = this.controller.getSelectedValues();
    this.enabledSnapshot = new Set(this.selectedValues);
    this.favoriteSnapshot = this.manager.getFavorites();

    const overlay = makeElement(this.document, 'dialog', PICKER_CLASS);
    const titleId = `th-modern-mobile-world-picker-title-${this.controller.source.id}`;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-labelledby', titleId);
    overlay.tabIndex = -1;

    const sheet = makeElement(this.document, 'section', 'th-modern-mobile-world-picker-sheet');
    const handle = makeElement(this.document, 'span', 'th-modern-mobile-world-picker-handle');
    handle.setAttribute('aria-hidden', 'true');
    const header = makeElement(this.document, 'header', 'th-modern-mobile-world-picker-header');
    const heading = makeElement(this.document, 'div', 'th-modern-mobile-world-picker-heading');
    const title = makeElement(this.document, 'strong');
    title.id = titleId;
    title.textContent = this.controller.config.title;
    heading.append(title);

    const headerActions = makeElement(this.document, 'div', 'th-modern-mobile-world-picker-header-actions');
    const nativeButton = makeElement(this.document, 'button', 'menu_button th-modern-mobile-world-picker-native');
    nativeButton.type = 'button';
    nativeButton.append(makeIcon(this.document, 'fa-solid fa-arrow-rotate-left'), this.document.createTextNode('原生界面'));
    nativeButton.addEventListener('click', this.useNativeMode);
    const closeButton = makeElement(this.document, 'button', 'menu_button th-modern-mobile-world-picker-close');
    closeButton.type = 'button';
    closeButton.title = '关闭世界书选择';
    closeButton.setAttribute('aria-label', '关闭世界书选择');
    closeButton.append(makeIcon(this.document, 'fa-solid fa-xmark'));
    closeButton.addEventListener('click', this.close);
    headerActions.append(nativeButton, closeButton);
    header.append(heading, headerActions);

    const tabs = makeElement(this.document, 'nav', 'th-modern-mobile-world-picker-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '世界书筛选');
    tabs.addEventListener('click', this.onTabClick);

    const search = makeElement(this.document, 'label', 'th-modern-mobile-world-picker-search');
    search.append(makeIcon(this.document, 'fa-solid fa-magnifying-glass'));
    const searchInput = makeElement(this.document, 'input');
    searchInput.type = 'search';
    searchInput.placeholder = '搜索世界书名称…';
    searchInput.autocomplete = 'off';
    searchInput.spellcheck = false;
    searchInput.setAttribute('enterkeyhint', 'search');
    searchInput.addEventListener('input', this.onSearchInput);
    searchInput.addEventListener('keydown', this.onSearchKeyDown);
    const clearSearchButton = makeElement(this.document, 'button', 'th-modern-mobile-world-picker-search-clear');
    clearSearchButton.type = 'button';
    clearSearchButton.title = '清空搜索';
    clearSearchButton.setAttribute('aria-label', '清空搜索');
    clearSearchButton.append(makeIcon(this.document, 'fa-solid fa-circle-xmark'));
    clearSearchButton.addEventListener('click', this.clearSearch);
    search.append(searchInput, clearSearchButton);

    const resultStatus = makeElement(this.document, 'div', 'th-modern-mobile-world-picker-status');
    resultStatus.setAttribute('aria-live', 'polite');
    const viewport = makeElement(this.document, 'div', 'th-modern-mobile-world-picker-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'listbox');
    if (this.controller.config.multiple) {
      viewport.setAttribute('aria-multiselectable', 'true');
    }
    const rows = makeElement(this.document, 'div', 'th-modern-mobile-world-picker-rows');
    const emptyState = makeElement(this.document, 'div', 'th-modern-mobile-world-picker-empty');
    const emptyText = this.document.createTextNode('没有找到匹配的世界书');
    emptyState.append(makeIcon(this.document, 'fa-regular fa-folder-open'), emptyText);
    viewport.append(rows, emptyState);

    sheet.append(handle, header, tabs, search, resultStatus, viewport);
    overlay.append(sheet);
    overlay.addEventListener('touchstart', this.stopDrawerAutoClose, { passive: true });
    overlay.addEventListener('mousedown', this.stopDrawerAutoClose);
    overlay.addEventListener('click', this.onOverlayClick);
    overlay.addEventListener('keydown', this.onKeyDown);
    this.window.addEventListener('resize', this.syncLayout, { passive: true });

    this.overlay = overlay;
    this.sheet = sheet;
    this.tabs = tabs;
    this.searchInput = searchInput;
    this.clearSearchButton = clearSearchButton;
    this.resultStatus = resultStatus;
    this.viewport = viewport;
    this.rows = rows;
    this.emptyState = emptyState;
    this.emptyStateText = emptyText;
    this.renderTabs();
    this.filterOptions();
    this.document.body.append(overlay);
    overlay.showModal();
    this.syncLayout();
    this.controller.syncTrigger();
    this.window.requestAnimationFrame(() => {
      if (this.layout === 'wide') {
        this.searchInput?.focus({ preventScroll: true });
      } else {
        overlay.focus({ preventScroll: true });
      }
    });
  }

  destroy(restoreFocus = true): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    if (this.searchTimer) {
      this.window.clearTimeout(this.searchTimer);
      this.searchTimer = 0;
    }
    this.searchInput?.removeEventListener('input', this.onSearchInput);
    this.searchInput?.removeEventListener('keydown', this.onSearchKeyDown);
    this.clearSearchButton?.removeEventListener('click', this.clearSearch);
    this.tabs?.removeEventListener('click', this.onTabClick);
    this.overlay?.removeEventListener('touchstart', this.stopDrawerAutoClose);
    this.overlay?.removeEventListener('mousedown', this.stopDrawerAutoClose);
    this.overlay?.removeEventListener('click', this.onOverlayClick);
    this.overlay?.removeEventListener('keydown', this.onKeyDown);
    this.window.removeEventListener('resize', this.syncLayout);
    this.overlay?.remove();
    this.overlay = undefined;
    if (restoreFocus && this.previousFocus?.isConnected) {
      this.previousFocus.focus({ preventScroll: true });
    }
    this.controller.syncTrigger();
    this.onDestroy();
  }

  refreshFromSource(): void {
    this.options = this.controller.getOptions();
    this.selectedValues = this.controller.getSelectedValues();
    for (const value of this.selectedValues) {
      this.enabledSnapshot.add(value);
    }
    this.renderTabs();
    this.filterOptions();
  }

  private getAvailableTabs(): PickerTab[] {
    return this.controller.config.multiple ? ['all', 'enabled', 'favorites'] : ['all', 'favorites'];
  }

  private renderTabs(): void {
    if (!this.tabs) {
      return;
    }
    const fragment = this.document.createDocumentFragment();
    for (const tab of this.getAvailableTabs()) {
      const button = makeElement(this.document, 'button', 'th-modern-mobile-world-picker-tab');
      button.type = 'button';
      button.dataset.tab = tab;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(this.activeTab === tab));
      button.classList.toggle('is-active', this.activeTab === tab);
      const count =
        tab === 'all'
          ? this.options.length
          : tab === 'enabled'
            ? this.selectedValues.size
            : this.manager.getFavorites().size;
      button.append(this.document.createTextNode(TAB_LABELS[tab]), makeElement(this.document, 'span'));
      button.lastElementChild!.textContent = String(count);
      fragment.append(button);
    }
    this.tabs.replaceChildren(fragment);
  }

  private filterOptions(): void {
    const normalizedQuery = normalizeSearchText(this.query);
    let candidates = this.options;
    if (this.activeTab === 'enabled') {
      candidates = candidates.filter(option => this.enabledSnapshot.has(option.value));
    } else if (this.activeTab === 'favorites') {
      candidates = candidates.filter(option => this.favoriteSnapshot.has(option.favoriteKey));
    }
    this.filteredOptions = normalizedQuery
      ? candidates.filter(option => option.searchText.includes(normalizedQuery))
      : [...candidates];
    if (this.viewport) {
      this.viewport.scrollTop = 0;
    }
    this.updateStatus(candidates.length);
    this.renderRows();
  }

  private renderRows(): void {
    if (!this.viewport || !this.rows || !this.emptyState) {
      return;
    }

    const total = this.filteredOptions.length;
    this.emptyState.hidden = total > 0;
    if (total === 0) {
      for (const row of this.rowPool) {
        row.root.hidden = true;
      }
      return;
    }

    this.ensureRowPool(total);
    for (let poolIndex = 0; poolIndex < this.rowPool.length; poolIndex += 1) {
      const row = this.rowPool[poolIndex];
      const option = this.filteredOptions[poolIndex];
      if (!option) {
        row.root.hidden = true;
        continue;
      }
      row.root.hidden = false;
      this.updatePooledRow(row, option);
    }
  }

  private ensureRowPool(requiredSize: number): void {
    if (!this.rows || this.rowPool.length >= requiredSize) {
      return;
    }
    const fragment = this.document.createDocumentFragment();
    while (this.rowPool.length < requiredSize) {
      const root = makeElement(this.document, 'div', 'th-modern-mobile-world-picker-row');
      root.setAttribute('role', 'option');

      const selectButton = makeElement(this.document, 'button', 'th-modern-mobile-world-picker-row-select');
      selectButton.type = 'button';
      selectButton.addEventListener('click', this.onRowClick);
      const marker = makeElement(
        this.document,
        'span',
        this.controller.config.multiple
          ? 'th-modern-mobile-world-picker-checkbox'
          : 'th-modern-mobile-world-picker-radio',
      );
      marker.append(makeIcon(this.document, this.controller.config.multiple ? 'fa-solid fa-check' : 'fa-solid fa-circle'));
      const label = makeElement(this.document, 'span', 'th-modern-mobile-world-picker-row-label');
      const labelText = this.document.createTextNode('');
      label.append(labelText);
      const selectedIcon = makeIcon(
        this.document,
        'fa-solid fa-check th-modern-mobile-world-picker-row-check',
      );
      selectedIcon.hidden = true;
      selectButton.append(marker, label, selectedIcon);

      const favoriteButton = makeElement(this.document, 'button', 'th-modern-mobile-world-picker-favorite');
      favoriteButton.type = 'button';
      favoriteButton.addEventListener('click', this.onRowClick);
      const favoriteOnIcon = makeIcon(this.document, 'fa-solid fa-star');
      const favoriteOffIcon = makeIcon(this.document, 'fa-regular fa-star');
      favoriteOnIcon.hidden = true;
      favoriteButton.append(favoriteOnIcon, favoriteOffIcon);
      root.append(selectButton, favoriteButton);
      fragment.append(root);
      this.rowPool.push({
        favoriteButton,
        favoriteOffIcon,
        favoriteOnIcon,
        labelText,
        root,
        selectButton,
        selectedIcon,
      });
    }
    this.rows.append(fragment);
  }

  private updatePooledRow(row: PickerRowView, option: PickerOption): void {
    const selected = this.selectedValues.has(option.value);
    const favorite = this.manager.isFavorite(option.favoriteKey);
    const label = option.label || (option.value === '' ? '不选择世界书' : option.value);
    row.root.dataset.sourceIndex = String(option.sourceIndex);
    row.root.setAttribute('aria-selected', String(selected));
    row.root.dataset.favorite = String(favorite);
    row.selectButton.disabled = option.disabled;
    row.selectButton.title = this.controller.config.multiple
      ? `${selected ? '停用' : '启用'}世界书：${option.label}`
      : `选择世界书：${option.label}`;
    row.labelText.data = label;
    row.selectedIcon.hidden = !selected;
    row.favoriteButton.hidden = !option.value;
    row.favoriteButton.setAttribute('aria-pressed', String(favorite));
    row.favoriteButton.setAttribute('aria-label', `${favorite ? '取消收藏' : '收藏'}世界书：${option.label}`);
    row.favoriteButton.title = favorite ? '取消收藏' : '收藏';
    row.favoriteOnIcon.hidden = !favorite;
    row.favoriteOffIcon.hidden = favorite;
  }

  private updateStatus(tabTotal: number): void {
    if (this.resultStatus) {
      const resultText = this.query ? `找到 ${this.filteredOptions.length} / ${tabTotal} 本` : `当前页签 ${tabTotal} 本`;
      this.resultStatus.textContent = this.controller.config.multiple
        ? `${resultText} · 已启用 ${this.selectedValues.size} 本 · 点击即生效`
        : `${resultText} · 点击即选择`;
    }
    if (this.clearSearchButton) {
      this.clearSearchButton.hidden = this.query.length === 0;
    }
    if (this.emptyStateText) {
      this.emptyStateText.data = this.query
        ? '没有找到匹配的世界书'
        : this.activeTab === 'favorites'
          ? '还没有收藏世界书'
          : this.activeTab === 'enabled'
            ? '当前没有已启用的世界书'
            : '没有可选择的世界书';
    }
  }

  private getLayout(): PickerLayout {
    if (this.window.matchMedia(WIDE_QUERY).matches) {
      return 'wide';
    }
    return this.window.matchMedia(PHONE_QUERY).matches ? 'phone' : 'narrow';
  }

  private positionWideSheet(): void {
    if (!this.sheet) {
      return;
    }
    const viewportWidth = Math.min(this.window.innerWidth, this.document.documentElement.clientWidth || this.window.innerWidth);
    const viewportHeight = Math.min(this.window.innerHeight, this.document.documentElement.clientHeight || this.window.innerHeight);
    const triggerRect = this.controller.getTriggerRect();
    if (!triggerRect) {
      return;
    }
    const margin = 12;
    const gap = 8;
    const width = Math.min(560, viewportWidth - margin * 2);
    const preferredHeight = Math.min(640, viewportHeight - margin * 2);
    const below = Math.max(0, viewportHeight - triggerRect.bottom - gap - margin);
    const above = Math.max(0, triggerRect.top - gap - margin);
    const placeBelow = below >= Math.min(420, preferredHeight) || below >= above;
    const availableHeight = placeBelow ? below : above;
    const height = Math.max(220, Math.min(preferredHeight, availableHeight));
    const left = Math.max(margin, Math.min(triggerRect.left, viewportWidth - width - margin));
    const top = placeBelow
      ? Math.min(viewportHeight - height - margin, triggerRect.bottom + gap)
      : Math.max(margin, triggerRect.top - gap - height);
    this.sheet.style.left = `${left}px`;
    this.sheet.style.top = `${top}px`;
    this.sheet.style.width = `${width}px`;
    this.sheet.style.height = `${height}px`;
  }

  private focusFilteredIndex(index: number): void {
    if (!this.viewport || this.filteredOptions.length === 0) {
      return;
    }
    const targetIndex = Math.max(0, Math.min(index, this.filteredOptions.length - 1));
    const option = this.filteredOptions[targetIndex];
    this.window.requestAnimationFrame(() => {
      const button = this.rows
        ?.querySelector<HTMLButtonElement>(
          `.th-modern-mobile-world-picker-row[data-source-index="${option.sourceIndex}"] .th-modern-mobile-world-picker-row-select`,
        );
      button?.focus({ preventScroll: true });
      button?.scrollIntoView({ block: 'nearest' });
    });
  }

  private readonly syncLayout = () => {
    this.layout = this.getLayout();
    if (!this.overlay || !this.sheet) {
      return;
    }
    this.overlay.dataset.layout = this.layout;
    this.overlay.setAttribute('aria-modal', String(this.layout !== 'wide'));
    this.sheet.removeAttribute('style');
    if (this.layout === 'wide') {
      this.positionWideSheet();
    }
  };

  private readonly onTabClick = (event: MouseEvent) => {
    const target = targetToElement(event.target);
    const button = target?.closest<HTMLButtonElement>('.th-modern-mobile-world-picker-tab');
    const tab = button?.dataset.tab as PickerTab | undefined;
    if (!tab || tab === this.activeTab || !this.getAvailableTabs().includes(tab)) {
      return;
    }
    this.activeTab = tab;
    this.manager.rememberTab(this.controller, tab);
    this.renderTabs();
    this.filterOptions();
  };

  private readonly onSearchInput = () => {
    if (this.searchTimer) {
      this.window.clearTimeout(this.searchTimer);
    }
    this.searchTimer = this.window.setTimeout(() => {
      this.searchTimer = 0;
      this.query = this.searchInput?.value ?? '';
      this.filterOptions();
    }, SEARCH_DELAY_MS);
  };

  private readonly onSearchKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.focusFilteredIndex(0);
    }
  };

  private readonly clearSearch = () => {
    if (!this.searchInput) {
      return;
    }
    this.searchInput.value = '';
    this.query = '';
    this.filterOptions();
    this.searchInput.focus({ preventScroll: true });
  };

  private readonly onRowClick = (event: MouseEvent) => {
    const target = targetToElement(event.target);
    const row = target?.closest<HTMLElement>('.th-modern-mobile-world-picker-row');
    if (!row) {
      return;
    }
    const sourceIndex = Number(row.dataset.sourceIndex);
    const option = this.options.find(candidate => candidate.sourceIndex === sourceIndex);
    if (!option) {
      return;
    }

    if (target?.closest('.th-modern-mobile-world-picker-favorite')) {
      const favorite = this.manager.toggleFavorite(option.favoriteKey);
      if (favorite) {
        this.favoriteSnapshot.add(option.favoriteKey);
      }
      this.renderTabs();
      this.updateStatus(
        this.activeTab === 'all'
          ? this.options.length
          : this.activeTab === 'enabled'
            ? this.options.filter(candidate => this.enabledSnapshot.has(candidate.value)).length
            : this.options.filter(candidate => this.favoriteSnapshot.has(candidate.favoriteKey)).length,
      );
      this.renderRows();
      return;
    }

    const selectButton = target?.closest<HTMLButtonElement>('.th-modern-mobile-world-picker-row-select');
    if (!selectButton || selectButton.disabled) {
      return;
    }

    if (this.controller.config.multiple) {
      if (this.selectedValues.has(option.value)) {
        this.selectedValues.delete(option.value);
      } else {
        this.selectedValues.add(option.value);
        this.enabledSnapshot.add(option.value);
      }
      this.controller.commit(this.selectedValues);
      this.renderTabs();
      this.renderRows();
      return;
    }

    this.controller.commit(new Set([option.value]));
    this.destroy();
  };

  private readonly useNativeMode = () => {
    this.manager.requestEnabledChange(false);
    this.destroy(false);
  };

  private readonly close = () => {
    this.destroy();
  };

  private readonly onOverlayClick = (event: MouseEvent) => {
    if (event.target === this.overlay) {
      this.close();
    }
  };

  private readonly stopDrawerAutoClose = (event: Event) => {
    event.stopPropagation();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    const target = targetToElement(event.target);
    const row = target?.closest<HTMLElement>('.th-modern-mobile-world-picker-row');
    if (!row || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
      return;
    }
    const sourceIndex = Number(row.dataset.sourceIndex);
    const currentIndex = this.filteredOptions.findIndex(option => option.sourceIndex === sourceIndex);
    if (currentIndex < 0) {
      return;
    }
    event.preventDefault();
    this.focusFilteredIndex(currentIndex + (event.key === 'ArrowDown' ? 1 : -1));
  };
}

export function mountMobileWorldSelects(options: MountWorldSelectOptions): {
  destroy: () => void;
  setEnabled: (enabled: boolean) => void;
} {
  const manager = new MobileWorldSelectManager(options);
  manager.mount();
  return {
    destroy: () => manager.destroy(),
    setEnabled: enabled => manager.setEnabled(enabled),
  };
}
