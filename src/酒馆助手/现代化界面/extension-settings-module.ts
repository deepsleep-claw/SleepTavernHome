import { watch } from 'vue';

import { getHostDocument, getHostWindow } from './host-context';
import type { useModernLayoutStore } from './store';

const BODY_CLASS = 'th-modern-extension-settings';
const PANEL_CLASS = 'th-modern-extension-panel';
const LAYOUT_CLASS = 'th-modern-extension-layout';
const NAV_CLASS = 'th-modern-extension-nav';
const NAV_LIST_CLASS = 'th-modern-extension-nav-list';
const NAV_COUNT_CLASS = 'th-modern-extension-nav-count';
const NAV_ITEM_CLASS = 'th-modern-extension-nav-item';
const NAV_ITEM_ACTIVE_CLASS = 'is-active';
const COLUMN_CLASS = 'th-modern-extension-column';
const COLUMN_ACTIVE_CLASS = 'is-active';
const HOST_HIDDEN_CLASS = 'th-modern-extension-host-hidden';
const HOST_ACTIVE_CLASS = 'th-modern-extension-host-active';
const DRAWER_CLASS = 'th-modern-extension-drawer';
const DRAWER_ACTIVE_CLASS = 'th-modern-extension-drawer-active';
const MOBILE_ACCORDION_CLASS = 'th-modern-extension-mobile-accordion';
const MOBILE_ACCORDION_MAX_WIDTH = 640;
const SELECTED_EXTENSION_STORAGE_KEY = 'TavernHelper.modernLayout.selectedExtensionSettings';

type Store = ReturnType<typeof useModernLayoutStore>;

type ExtensionEntry = {
  column: HTMLElement;
  content: HTMLElement | null;
  drawer: HTMLElement | null;
  header: HTMLElement | null;
  host: HTMLElement;
  key: string;
  title: string;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function findTopLevelDrawers(host: HTMLElement): HTMLElement[] {
  if (host.matches('.inline-drawer')) {
    return [host];
  }

  return Array.from(host.querySelectorAll<HTMLElement>('.inline-drawer')).filter(drawer => {
    const parentDrawer = drawer.parentElement?.closest('.inline-drawer');
    return !parentDrawer || !host.contains(parentDrawer);
  });
}

function findDirectBranch(host: HTMLElement, descendant: HTMLElement): HTMLElement {
  let branch = descendant;
  while (branch.parentElement && branch.parentElement !== host) {
    branch = branch.parentElement;
  }
  return branch;
}

function getEntryTitle(host: HTMLElement, drawer: HTMLElement | null): string {
  const header = drawer?.querySelector<HTMLElement>(
    ':scope > .inline-drawer-toggle.inline-drawer-header, :scope > .inline-drawer-toggle',
  );
  const emphasizedTitle = header?.querySelector<HTMLElement>('b, strong, h3, h4');
  const fallbackHeading = host.querySelector<HTMLElement>('h3, h4, .standoutHeader');
  const title = normalizeText(emphasizedTitle?.textContent ?? header?.textContent ?? fallbackHeading?.textContent);

  if (title) {
    return title;
  }

  return normalizeText(host.id.replace(/_container$/i, '').replaceAll('_', ' ')) || '未命名扩展';
}

export function mountExtensionSettings(store: Store): { destroy: () => void } {
  const hostDocument = getHostDocument();
  const hostWindow = getHostWindow();
  let panel: HTMLElement | null = null;
  let layout: HTMLElement | null = null;
  let navigation: HTMLElement | null = null;
  let navigationList: HTMLElement | null = null;
  let navigationCount: HTMLElement | null = null;
  let columns: HTMLElement[] = [];
  let entries: ExtensionEntry[] = [];
  let selectedKey = readSelectedKey();
  let renderedSignature = '';
  let syncFrame = 0;
  let openFrame = 0;
  let structureObserver: MutationObserver | null = null;
  let panelObserver: MutationObserver | null = null;
  let panelResizeObserver: ResizeObserver | null = null;
  let usesMobileAccordion = hostWindow.matchMedia(`(max-width: ${MOBILE_ACCORDION_MAX_WIDTH}px)`).matches;

  function readSelectedKey(): string | null {
    try {
      return hostWindow.sessionStorage.getItem(SELECTED_EXTENSION_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function writeSelectedKey(key: string | null): void {
    try {
      if (key) {
        hostWindow.sessionStorage.setItem(SELECTED_EXTENSION_STORAGE_KEY, key);
      } else {
        hostWindow.sessionStorage.removeItem(SELECTED_EXTENSION_STORAGE_KEY);
      }
    } catch {
      // Session storage can be unavailable in privacy-restricted browser contexts.
    }
  }

  function collectEntries(): ExtensionEntry[] {
    const keyCounts = new Map<string, number>();
    const nextEntries: ExtensionEntry[] = [];

    const appendEntry = (
      column: HTMLElement,
      sourceHost: HTMLElement,
      host: HTMLElement,
      drawer: HTMLElement | null,
      rawKeyOverride?: string,
    ) => {
      const title = getEntryTitle(host, drawer);
      const scriptId =
        host.getAttribute('script_id') ?? drawer?.getAttribute('script_id') ?? sourceHost.getAttribute('script_id');
      const rawKey =
        rawKeyOverride ??
        (host.id
          ? `id:${host.id}`
          : drawer?.id
            ? `id:${drawer.id}`
            : scriptId
              ? `script:${scriptId}`
              : `column:${column.id}:title:${title}`);
      const duplicateIndex = keyCounts.get(rawKey) ?? 0;
      keyCounts.set(rawKey, duplicateIndex + 1);
      const key = duplicateIndex === 0 ? rawKey : `${rawKey}:${duplicateIndex}`;
      const header =
        drawer?.querySelector<HTMLElement>(
          ':scope > .inline-drawer-toggle.inline-drawer-header, :scope > .inline-drawer-toggle',
        ) ?? null;
      const content = drawer?.querySelector<HTMLElement>(':scope > .inline-drawer-content') ?? null;

      nextEntries.push({ column, content, drawer, header, host, key, title });
    };

    columns.forEach(column => {
      Array.from(column.children).forEach(node => {
        if (!(node instanceof hostWindow.HTMLElement) || node === navigation) {
          return;
        }

        const drawers = findTopLevelDrawers(node);
        const hasFallbackContent = node.childElementCount > 0 && normalizeText(node.textContent).length > 0;
        if (drawers.length === 0 && !hasFallbackContent) {
          return;
        }

        if (drawers.length <= 1) {
          appendEntry(column, node, node, drawers[0] ?? null);
          return;
        }

        const branches = drawers.map(drawer => findDirectBranch(node, drawer));
        const branchCounts = new Map<HTMLElement, number>();
        branches.forEach(branch => branchCounts.set(branch, (branchCounts.get(branch) ?? 0) + 1));
        const sourceRawKey = node.id
          ? `id:${node.id}`
          : node.getAttribute('script_id')
            ? `script:${node.getAttribute('script_id')}`
            : undefined;

        drawers.forEach((drawer, index) => {
          const branch = branches[index];
          const entryHost = branchCounts.get(branch) === 1 ? branch : drawer;
          appendEntry(column, node, entryHost, drawer, index === 0 ? sourceRawKey : undefined);
        });
      });
    });

    return nextEntries;
  }

  function isEntryExpanded(entry: ExtensionEntry): boolean {
    if (!entry.content) {
      return true;
    }

    if (entry.content.style.display) {
      return entry.content.style.display !== 'none';
    }

    return hostWindow.getComputedStyle(entry.content).display !== 'none';
  }

  function updateNavigationState(): void {
    navigationList?.querySelectorAll<HTMLButtonElement>(`.${NAV_ITEM_CLASS}`).forEach(button => {
      const isActive = button.dataset.extensionKey === selectedKey;
      button.classList.toggle(NAV_ITEM_ACTIVE_CLASS, isActive);
      button.setAttribute('aria-current', isActive ? 'page' : 'false');
    });
  }

  function renderNavigation(): void {
    if (!navigationList || !navigationCount) {
      return;
    }

    const fragment = hostDocument.createDocumentFragment();
    entries.forEach(entry => {
      const button = hostDocument.createElement('button');
      button.type = 'button';
      button.className = NAV_ITEM_CLASS;
      button.dataset.extensionKey = entry.key;
      button.title = entry.title;

      const label = hostDocument.createElement('span');
      label.className = 'th-modern-extension-nav-label';
      label.textContent = entry.title;
      button.append(label);
      fragment.append(button);
    });

    navigationList.replaceChildren(fragment);
    navigationCount.textContent = String(entries.length);
    updateNavigationState();
  }

  function applySelection(): void {
    if (usesMobileAccordion) {
      entries.forEach(entry => {
        entry.host.classList.remove(HOST_HIDDEN_CLASS, HOST_ACTIVE_CLASS);
        entry.drawer?.classList.remove(DRAWER_ACTIVE_CLASS);
      });
      columns.forEach(column => column.classList.remove(COLUMN_ACTIVE_CLASS));
      updateNavigationState();
      return;
    }

    const selectedEntry = entries.find(entry => entry.key === selectedKey) ?? null;

    entries.forEach(entry => {
      const isActive = entry === selectedEntry;
      entry.host.classList.toggle(HOST_HIDDEN_CLASS, !isActive);
      entry.host.classList.toggle(HOST_ACTIVE_CLASS, isActive);
      entry.drawer?.classList.toggle(DRAWER_ACTIVE_CLASS, isActive);
    });

    columns.forEach(column => {
      column.classList.toggle(COLUMN_ACTIVE_CLASS, selectedEntry?.column === column);
    });
    updateNavigationState();
  }

  function ensureSelectedEntryOpen(): void {
    openFrame = 0;
    if (usesMobileAccordion || !panel?.classList.contains('openDrawer')) {
      return;
    }

    const selectedEntry = entries.find(entry => entry.key === selectedKey);
    if (!selectedEntry?.header || !selectedEntry.content || isEntryExpanded(selectedEntry)) {
      return;
    }

    selectedEntry.header.click();
  }

  function scheduleEnsureSelectedEntryOpen(): void {
    if (openFrame !== 0) {
      return;
    }

    openFrame = hostWindow.requestAnimationFrame(ensureSelectedEntryOpen);
  }

  function selectEntry(key: string): void {
    if (!entries.some(entry => entry.key === key)) {
      return;
    }

    selectedKey = key;
    writeSelectedKey(selectedKey);
    applySelection();
    scheduleEnsureSelectedEntryOpen();
  }

  function updateResponsiveMode(width: number): void {
    if (width <= 0) {
      return;
    }

    const nextUsesMobileAccordion = width <= MOBILE_ACCORDION_MAX_WIDTH;
    panel?.classList.toggle(MOBILE_ACCORDION_CLASS, nextUsesMobileAccordion);
    if (usesMobileAccordion === nextUsesMobileAccordion) {
      return;
    }

    usesMobileAccordion = nextUsesMobileAccordion;
    applySelection();
    if (!usesMobileAccordion) {
      scheduleEnsureSelectedEntryOpen();
    }
  }

  function syncEntries(): void {
    syncFrame = 0;
    if (!layout?.isConnected) {
      return;
    }

    const nextEntries = collectEntries();
    entries.forEach(entry => {
      entry.host.classList.remove(HOST_HIDDEN_CLASS, HOST_ACTIVE_CLASS);
      entry.drawer?.classList.remove(DRAWER_CLASS, DRAWER_ACTIVE_CLASS);
    });
    entries = nextEntries;
    entries.forEach(entry => entry.drawer?.classList.add(DRAWER_CLASS));

    if (!entries.some(entry => entry.key === selectedKey)) {
      selectedKey = entries.find(isEntryExpanded)?.key ?? entries[0]?.key ?? null;
      writeSelectedKey(selectedKey);
    }

    const nextSignature = entries.map(entry => `${entry.key}\u0000${entry.title}`).join('\u0001');
    if (nextSignature !== renderedSignature) {
      renderedSignature = nextSignature;
      renderNavigation();
    }

    applySelection();
    observeStructure();
    scheduleEnsureSelectedEntryOpen();
  }

  function scheduleSyncEntries(): void {
    if (syncFrame !== 0) {
      return;
    }

    syncFrame = hostWindow.requestAnimationFrame(syncEntries);
  }

  function handleStructureMutations(): void {
    scheduleSyncEntries();
  }

  function observeStructure(): void {
    structureObserver?.disconnect();
    if (!structureObserver) {
      return;
    }

    columns.forEach(column => {
      structureObserver?.observe(column, { childList: true });
      Array.from(column.children).forEach(host => {
        if (!(host instanceof hostWindow.HTMLElement)) {
          return;
        }

        structureObserver?.observe(host, { childList: true });
        Array.from(host.children).forEach(wrapper => {
          if (wrapper instanceof hostWindow.HTMLElement) {
            structureObserver?.observe(wrapper, { childList: true });
          }
        });
      });
    });
    entries.forEach(entry => {
      if (entry.header) {
        structureObserver?.observe(entry.header, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      }
    });
  }

  function handleNavigationClick(event: MouseEvent): void {
    const target = event.target instanceof hostWindow.Element ? event.target : null;
    const button = target?.closest<HTMLButtonElement>(`.${NAV_ITEM_CLASS}`);
    if (!button || !navigation?.contains(button)) {
      return;
    }

    const key = button.dataset.extensionKey;
    if (key) {
      selectEntry(key);
    }
  }

  function createNavigation(): HTMLElement {
    const nav = hostDocument.createElement('nav');
    nav.className = NAV_CLASS;
    nav.setAttribute('aria-label', '扩展程序设置');

    const header = hostDocument.createElement('div');
    header.className = 'th-modern-extension-nav-header';
    const title = hostDocument.createElement('span');
    title.textContent = '扩展设置';
    const count = hostDocument.createElement('span');
    count.className = NAV_COUNT_CLASS;
    header.append(title, count);

    const list = hostDocument.createElement('div');
    list.className = NAV_LIST_CLASS;
    nav.append(header, list);
    nav.addEventListener('click', handleNavigationClick);
    navigationList = list;
    navigationCount = count;
    return nav;
  }

  function mountLayout(): void {
    if (layout?.isConnected) {
      scheduleSyncEntries();
      return;
    }

    panel = hostDocument.querySelector<HTMLElement>('#rm_extensions_block');
    layout = panel?.querySelector<HTMLElement>(':scope > .extensions_block') ?? null;
    columns = ['extensions_settings', 'extensions_settings2']
      .map(id => hostDocument.getElementById(id))
      .filter((column): column is HTMLElement => column instanceof hostWindow.HTMLElement);
    if (!panel || !layout || columns.length === 0) {
      panel = null;
      layout = null;
      columns = [];
      return;
    }

    hostDocument.body.classList.add(BODY_CLASS);
    panel.classList.add(PANEL_CLASS);
    layout.classList.add(LAYOUT_CLASS);
    columns.forEach(column => column.classList.add(COLUMN_CLASS));
    const initialPanelWidth = panel.getBoundingClientRect().width;
    if (initialPanelWidth > 0) {
      usesMobileAccordion = initialPanelWidth <= MOBILE_ACCORDION_MAX_WIDTH;
    }
    panel.classList.toggle(MOBILE_ACCORDION_CLASS, usesMobileAccordion);
    navigation = createNavigation();
    columns[0].before(navigation);

    structureObserver = new hostWindow.MutationObserver(handleStructureMutations);
    observeStructure();
    panelObserver = new hostWindow.MutationObserver(() => scheduleEnsureSelectedEntryOpen());
    panelObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });
    panelResizeObserver = new hostWindow.ResizeObserver(records => {
      const panelRecord = records.find(record => record.target === panel);
      if (panelRecord) {
        updateResponsiveMode(panelRecord.contentRect.width);
      }
    });
    panelResizeObserver.observe(panel);
    syncEntries();
  }

  function unmountLayout(): void {
    structureObserver?.disconnect();
    structureObserver = null;
    panelObserver?.disconnect();
    panelObserver = null;
    panelResizeObserver?.disconnect();
    panelResizeObserver = null;
    if (syncFrame !== 0) {
      hostWindow.cancelAnimationFrame(syncFrame);
      syncFrame = 0;
    }
    if (openFrame !== 0) {
      hostWindow.cancelAnimationFrame(openFrame);
      openFrame = 0;
    }

    navigation?.removeEventListener('click', handleNavigationClick);
    navigation?.remove();
    entries.forEach(entry => {
      entry.host.classList.remove(HOST_HIDDEN_CLASS, HOST_ACTIVE_CLASS);
      entry.drawer?.classList.remove(DRAWER_CLASS, DRAWER_ACTIVE_CLASS);
    });
    columns.forEach(column => {
      column.classList.remove(COLUMN_CLASS, COLUMN_ACTIVE_CLASS);
      column
        .querySelectorAll<HTMLElement>(`.${DRAWER_ACTIVE_CLASS}`)
        .forEach(drawer => drawer.classList.remove(DRAWER_ACTIVE_CLASS));
      Array.from(column.children).forEach(child => child.classList.remove(HOST_HIDDEN_CLASS, HOST_ACTIVE_CLASS));
    });
    layout?.classList.remove(LAYOUT_CLASS);
    panel?.classList.remove(PANEL_CLASS, MOBILE_ACCORDION_CLASS);
    hostDocument.body.classList.remove(BODY_CLASS);

    panel = null;
    layout = null;
    navigation = null;
    navigationList = null;
    navigationCount = null;
    columns = [];
    entries = [];
    renderedSignature = '';
  }

  const stopWatch = watch(
    () => [store.is_active, store.settings.modernExtensionSettings] as const,
    ([isActive, isEnabled]) => {
      if (isActive && isEnabled) {
        mountLayout();
      } else {
        unmountLayout();
      }
    },
    { immediate: true },
  );

  return {
    destroy() {
      stopWatch();
      unmountLayout();
    },
  };
}
