import { getHostDocument, getHostWindow } from './host-context';

const MOBILE_QUERY = '(max-width: 899.98px)';
const SOURCE_CLASS = 'th-modern-mobile-world-source';
const NATIVE_SOURCE_CLASS = 'th-modern-mobile-world-source-native';
const SELECT2_SOURCE_CLASS = 'th-modern-mobile-world-select2-source';
const CONTROL_CLASS = 'th-modern-mobile-world-control';
const PICKER_CLASS = 'th-modern-mobile-world-picker';
const ROW_HEIGHT = 48;
const ROW_OVERSCAN = 6;
const SEARCH_DELAY_MS = 90;

type HostWindow = Window &
  typeof globalThis & {
    readonly $?: JQueryStatic;
  };

type PickerOption = {
  disabled: boolean;
  label: string;
  searchText: string;
  selected: boolean;
  sourceIndex: number;
  value: string;
};

type ControllerConfig = {
  multiple: boolean;
  placeholder: string;
  selector: string;
  title: string;
};

const CONTROLLER_CONFIGS: ControllerConfig[] = [
  {
    selector: '#world_info',
    title: '启用全局世界书',
    placeholder: '尚未启用世界书',
    multiple: true,
  },
  {
    selector: '#world_editor_select',
    title: '选择要编辑的世界书',
    placeholder: '选择一个世界书',
    multiple: false,
  },
];

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

class MobileWorldSelectManager {
  private readonly document: Document;
  private readonly window: HostWindow;
  private readonly mobileQuery: MediaQueryList;
  private readonly panelObserver: MutationObserver;
  private readonly controllers: MobileWorldSelectController[] = [];
  private picker?: MobileWorldPicker;

  constructor() {
    this.document = getHostDocument();
    this.window = getHostWindow() as HostWindow;
    this.mobileQuery = this.window.matchMedia(MOBILE_QUERY);
    this.panelObserver = new this.window.MutationObserver(() => {
      if (!this.document.querySelector('#WorldInfo.openDrawer')) {
        this.closePicker();
      }
    });
  }

  mount(): void {
    this.mobileQuery.addEventListener('change', this.syncResponsiveMode);
    const worldInfo = this.document.querySelector('#WorldInfo');
    if (worldInfo) {
      this.panelObserver.observe(worldInfo, { attributes: true, attributeFilter: ['class'] });
    }
    this.syncResponsiveMode();
  }

  destroy(): void {
    this.mobileQuery.removeEventListener('change', this.syncResponsiveMode);
    this.panelObserver.disconnect();
    this.closePicker();
    this.unmountControllers();
  }

  openPicker(controller: MobileWorldSelectController): void {
    this.closePicker();
    this.picker = new MobileWorldPicker(controller, () => {
      this.picker = undefined;
    });
    this.picker.mount();
  }

  closePicker(): void {
    this.picker?.destroy();
    this.picker = undefined;
  }

  notifySourceChanged(controller: MobileWorldSelectController): void {
    controller.syncTrigger();
    if (this.picker?.belongsTo(controller)) {
      this.picker.refreshFromSource();
    }
  }

  private readonly syncResponsiveMode = () => {
    if (this.mobileQuery.matches) {
      this.mountControllers();
      return;
    }
    this.closePicker();
    this.unmountControllers();
  };

  private mountControllers(): void {
    if (this.controllers.length > 0) {
      return;
    }

    for (const config of CONTROLLER_CONFIGS) {
      const source = this.document.querySelector<HTMLSelectElement>(config.selector);
      if (!source) {
        continue;
      }
      const controller = new MobileWorldSelectController(this, source, config);
      controller.mount();
      this.controllers.push(controller);
    }
  }

  private unmountControllers(): void {
    while (this.controllers.length > 0) {
      this.controllers.pop()?.destroy();
    }
  }
}

class MobileWorldSelectController {
  readonly config: ControllerConfig;
  readonly document: Document;
  readonly source: HTMLSelectElement;
  readonly window: HostWindow;

  private readonly manager: MobileWorldSelectManager;
  private readonly namespace: string;
  private observer?: MutationObserver;
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
    this.namespace = `.thModernMobileWorldSelect_${source.id || (config.multiple ? 'multi' : 'single')}`;
  }

  mount(): void {
    if (this.wrapper) {
      return;
    }

    this.source.classList.add(SOURCE_CLASS);
    this.select2Container = this.findSelect2Container();
    this.select2Container?.classList.add(SELECT2_SOURCE_CLASS);

    const wrapper = makeElement(this.document, 'div', CONTROL_CLASS);
    wrapper.dataset.source = this.source.id;
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
    nativeReturn.title = '返回自绘世界书列表';
    nativeReturn.append(makeIcon(this.document, 'fa-solid fa-list-check'), makeElement(this.document, 'span'));
    nativeReturn.lastElementChild!.textContent = '自绘列表';

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
    this.nativeMode = false;
  }

  getOptions(): PickerOption[] {
    const options = Array.from(this.source.options).map((option, sourceIndex): PickerOption => {
      const label = String(option.label || option.textContent || option.value).trim();
      return {
        disabled: option.disabled,
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
    this.source.classList.toggle(NATIVE_SOURCE_CLASS, nativeMode);
    this.wrapper?.classList.toggle('is-native', nativeMode);
    this.syncTrigger();
    if (nativeMode) {
      this.window.requestAnimationFrame(() => this.source.focus({ preventScroll: true }));
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
    this.trigger.setAttribute('aria-expanded', String(Boolean(this.document.querySelector(`.${PICKER_CLASS}`))));

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
    this.setNativeMode(false);
    this.trigger?.focus({ preventScroll: true });
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
  private readonly controller: MobileWorldSelectController;
  private readonly document: Document;
  private readonly window: HostWindow;
  private readonly onDestroy: () => void;
  private options: PickerOption[] = [];
  private filteredOptions: PickerOption[] = [];
  private draftValues = new Set<string>();
  private overlay?: HTMLElement;
  private searchInput?: HTMLInputElement;
  private clearSearchButton?: HTMLButtonElement;
  private resultStatus?: HTMLElement;
  private viewport?: HTMLElement;
  private spacer?: HTMLElement;
  private rows?: HTMLElement;
  private emptyState?: HTMLElement;
  private applyButton?: HTMLButtonElement;
  private previousFocus?: HTMLElement;
  private searchTimer = 0;
  private renderFrame = 0;
  private query = '';
  private destroyed = false;

  constructor(controller: MobileWorldSelectController, onDestroy: () => void) {
    this.controller = controller;
    this.document = controller.document;
    this.window = controller.window;
    this.onDestroy = onDestroy;
  }

  belongsTo(controller: MobileWorldSelectController): boolean {
    return this.controller === controller;
  }

  mount(): void {
    this.previousFocus = this.document.activeElement as HTMLElement | undefined;
    this.options = this.controller.getOptions();
    this.draftValues = this.controller.getSelectedValues();

    const overlay = makeElement(this.document, 'div', PICKER_CLASS);
    const titleId = `th-modern-mobile-world-picker-title-${this.controller.source.id}`;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
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
    nativeButton.append(makeIcon(this.document, 'fa-solid fa-mobile-screen-button'), this.document.createTextNode('系统选择'));
    nativeButton.addEventListener('click', this.useNativeMode);
    const closeButton = makeElement(this.document, 'button', 'menu_button th-modern-mobile-world-picker-close');
    closeButton.type = 'button';
    closeButton.title = '关闭世界书选择';
    closeButton.setAttribute('aria-label', '关闭世界书选择');
    closeButton.append(makeIcon(this.document, 'fa-solid fa-xmark'));
    closeButton.addEventListener('click', this.cancel);
    headerActions.append(nativeButton, closeButton);
    header.append(heading, headerActions);

    const search = makeElement(this.document, 'label', 'th-modern-mobile-world-picker-search');
    search.append(makeIcon(this.document, 'fa-solid fa-magnifying-glass'));
    const searchInput = makeElement(this.document, 'input');
    searchInput.type = 'search';
    searchInput.placeholder = '搜索世界书名称…';
    searchInput.autocomplete = 'off';
    searchInput.spellcheck = false;
    searchInput.setAttribute('enterkeyhint', 'search');
    searchInput.addEventListener('input', this.onSearchInput);
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
    const spacer = makeElement(this.document, 'div', 'th-modern-mobile-world-picker-spacer');
    spacer.setAttribute('aria-hidden', 'true');
    const rows = makeElement(this.document, 'div', 'th-modern-mobile-world-picker-rows');
    rows.addEventListener('click', this.onRowClick);
    const emptyState = makeElement(this.document, 'div', 'th-modern-mobile-world-picker-empty');
    emptyState.append(makeIcon(this.document, 'fa-regular fa-folder-open'), this.document.createTextNode('没有找到匹配的世界书'));
    viewport.addEventListener('scroll', this.scheduleRender, { passive: true });
    viewport.append(spacer, rows, emptyState);

    const footer = makeElement(this.document, 'footer', 'th-modern-mobile-world-picker-footer');
    const cancelButton = makeElement(this.document, 'button', 'menu_button');
    cancelButton.type = 'button';
    cancelButton.textContent = '取消';
    cancelButton.addEventListener('click', this.cancel);
    footer.append(cancelButton);
    if (this.controller.config.multiple) {
      const applyButton = makeElement(this.document, 'button', 'menu_button th-modern-mobile-world-picker-apply');
      applyButton.type = 'button';
      applyButton.addEventListener('click', this.apply);
      footer.append(applyButton);
      this.applyButton = applyButton;
    }

    sheet.append(handle, header, search, resultStatus, viewport, footer);
    overlay.append(sheet);
    overlay.addEventListener('touchstart', this.stopDrawerAutoClose, { passive: true });
    overlay.addEventListener('mousedown', this.stopDrawerAutoClose);
    overlay.addEventListener('click', this.onOverlayClick);
    overlay.addEventListener('keydown', this.onKeyDown);
    this.document.body.append(overlay);

    this.overlay = overlay;
    this.searchInput = searchInput;
    this.clearSearchButton = clearSearchButton;
    this.resultStatus = resultStatus;
    this.viewport = viewport;
    this.spacer = spacer;
    this.rows = rows;
    this.emptyState = emptyState;
    this.filterOptions();
    this.controller.syncTrigger();
    this.window.requestAnimationFrame(() => overlay.focus({ preventScroll: true }));
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
    if (this.renderFrame) {
      this.window.cancelAnimationFrame(this.renderFrame);
      this.renderFrame = 0;
    }
    this.searchInput?.removeEventListener('input', this.onSearchInput);
    this.clearSearchButton?.removeEventListener('click', this.clearSearch);
    this.viewport?.removeEventListener('scroll', this.scheduleRender);
    this.rows?.removeEventListener('click', this.onRowClick);
    this.overlay?.removeEventListener('touchstart', this.stopDrawerAutoClose);
    this.overlay?.removeEventListener('mousedown', this.stopDrawerAutoClose);
    this.overlay?.removeEventListener('click', this.onOverlayClick);
    this.overlay?.removeEventListener('keydown', this.onKeyDown);
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
    this.draftValues = this.controller.getSelectedValues();
    this.filterOptions();
  }

  private filterOptions(): void {
    const normalizedQuery = normalizeSearchText(this.query);
    this.filteredOptions = normalizedQuery
      ? this.options.filter(option => option.searchText.includes(normalizedQuery))
      : [...this.options];
    if (this.viewport) {
      this.viewport.scrollTop = 0;
    }
    this.updateStatus();
    this.renderRows();
  }

  private renderRows(): void {
    if (!this.viewport || !this.spacer || !this.rows || !this.emptyState) {
      return;
    }

    const total = this.filteredOptions.length;
    this.spacer.style.height = `${total * ROW_HEIGHT}px`;
    this.emptyState.hidden = total > 0;
    if (total === 0) {
      this.rows.replaceChildren();
      return;
    }

    const viewportHeight = this.viewport.clientHeight || 360;
    const start = Math.max(0, Math.floor(this.viewport.scrollTop / ROW_HEIGHT) - ROW_OVERSCAN);
    const end = Math.min(total, Math.ceil((this.viewport.scrollTop + viewportHeight) / ROW_HEIGHT) + ROW_OVERSCAN);
    const fragment = this.document.createDocumentFragment();

    for (let filteredIndex = start; filteredIndex < end; filteredIndex += 1) {
      const option = this.filteredOptions[filteredIndex];
      const selected = this.draftValues.has(option.value);
      const row = makeElement(this.document, 'button', 'th-modern-mobile-world-picker-row');
      row.type = 'button';
      row.dataset.sourceIndex = String(option.sourceIndex);
      row.disabled = option.disabled;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(selected));
      row.classList.toggle('is-selected', selected);
      const marker = makeElement(
        this.document,
        'span',
        this.controller.config.multiple
          ? 'th-modern-mobile-world-picker-checkbox'
          : 'th-modern-mobile-world-picker-radio',
      );
      marker.append(makeIcon(this.document, this.controller.config.multiple ? 'fa-solid fa-check' : 'fa-solid fa-circle'));
      const label = makeElement(this.document, 'span', 'th-modern-mobile-world-picker-row-label');
      label.textContent = option.label || (option.value === '' ? '不选择世界书' : option.value);
      row.append(marker, label);
      if (selected) {
        row.append(makeIcon(this.document, 'fa-solid fa-check th-modern-mobile-world-picker-row-check'));
      }
      fragment.append(row);
    }

    this.rows.style.transform = `translateY(${start * ROW_HEIGHT}px)`;
    this.rows.replaceChildren(fragment);
  }

  private updateStatus(): void {
    if (this.resultStatus) {
      const resultText = this.query ? `找到 ${this.filteredOptions.length} / ${this.options.length} 本` : `共 ${this.options.length} 本`;
      this.resultStatus.textContent = this.controller.config.multiple
        ? `${resultText} · 已选择 ${this.draftValues.size} 本`
        : resultText;
    }
    if (this.clearSearchButton) {
      this.clearSearchButton.hidden = this.query.length === 0;
    }
    if (this.applyButton) {
      this.applyButton.textContent = `应用（${this.draftValues.size}）`;
    }
  }

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

  private readonly clearSearch = () => {
    if (!this.searchInput) {
      return;
    }
    this.searchInput.value = '';
    this.query = '';
    this.filterOptions();
    this.searchInput.focus({ preventScroll: true });
  };

  private readonly scheduleRender = () => {
    if (this.renderFrame) {
      return;
    }
    this.renderFrame = this.window.requestAnimationFrame(() => {
      this.renderFrame = 0;
      this.renderRows();
    });
  };

  private readonly onRowClick = (event: MouseEvent) => {
    const target = event.target instanceof this.window.Element ? event.target : null;
    const row = target?.closest<HTMLButtonElement>('.th-modern-mobile-world-picker-row');
    if (!row || row.disabled) {
      return;
    }
    const sourceIndex = Number(row.dataset.sourceIndex);
    const option = this.options.find(candidate => candidate.sourceIndex === sourceIndex);
    if (!option) {
      return;
    }

    if (this.controller.config.multiple) {
      if (this.draftValues.has(option.value)) {
        this.draftValues.delete(option.value);
      } else {
        this.draftValues.add(option.value);
      }
      this.updateStatus();
      this.renderRows();
      return;
    }

    this.controller.commit(new Set([option.value]));
    this.destroy();
  };

  private readonly useNativeMode = () => {
    if (this.controller.config.multiple) {
      this.controller.commit(this.draftValues);
    }
    this.controller.setNativeMode(true);
    this.destroy(false);
  };

  private readonly apply = () => {
    this.controller.commit(this.draftValues);
    this.destroy();
  };

  private readonly cancel = () => {
    this.destroy();
  };

  private readonly onOverlayClick = (event: MouseEvent) => {
    if (event.target === this.overlay) {
      this.cancel();
    }
  };

  private readonly stopDrawerAutoClose = (event: Event) => {
    event.stopPropagation();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
    }
  };
}

export function mountMobileWorldSelects(): { destroy: () => void } {
  const manager = new MobileWorldSelectManager();
  manager.mount();
  return { destroy: () => manager.destroy() };
}
