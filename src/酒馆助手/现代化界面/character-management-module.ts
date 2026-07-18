import { watch } from 'vue';

import { getHostDocument, getHostWindow } from './host-context';
import type { useModernLayoutStore } from './store';

const BODY_CLASS = 'th-modern-character-management';
const PANEL_CLASS = 'th-modern-character-panel';
const LIST_CLASS = 'th-modern-character-list';
const EDITOR_CLASS = 'th-modern-character-editor';
const SUMMARY_CLASS = 'th-modern-character-summary';
const SUMMARY_MAIN_CLASS = 'th-modern-character-summary-main';
const SUMMARY_IDENTITY_CLASS = 'th-modern-character-summary-identity';
const SUMMARY_BUTTONS_CLASS = 'th-modern-character-summary-buttons';
const SUMMARY_FIELDS_CLASS = 'th-modern-character-summary-fields';

type Store = ReturnType<typeof useModernLayoutStore>;

type MovedNode = {
  marker: Comment;
  node: HTMLElement;
};

type ModernCharacterSummary = {
  buttons: HTMLElement;
  buttonsBlock: HTMLElement;
  dropdown: HTMLElement;
  fields: HTMLElement;
  identity: HTMLElement;
  main: HTMLElement;
  moves: MovedNode[];
  name: HTMLElement;
  pinAndTabs: HTMLElement;
  summary: HTMLElement;
  tags: HTMLElement;
};

function toggleHostState(doc: Document, enabled: boolean): void {
  doc.body.classList.toggle(BODY_CLASS, enabled);
  doc.querySelector('#right-nav-panel')?.classList.toggle(PANEL_CLASS, enabled);
  doc.querySelector('#rm_characters_block')?.classList.toggle(LIST_CLASS, enabled);
  doc.querySelector('#rm_ch_create_block')?.classList.toggle(EDITOR_CLASS, enabled);
}

function moveNode(doc: Document, node: HTMLElement, target: HTMLElement): MovedNode {
  const marker = doc.createComment(`th-modern-character-${node.id || node.classList[0] || 'node'}`);
  node.before(marker);
  target.append(node);
  return { marker, node };
}

function restoreMovedNode(move: MovedNode): void {
  move.marker.parentNode?.insertBefore(move.node, move.marker);
  move.marker.remove();
}

function restoreCharacterSummary(state: ModernCharacterSummary | null): void {
  if (!state) {
    return;
  }

  [...state.moves].reverse().forEach(restoreMovedNode);
  state.summary.classList.remove(SUMMARY_CLASS);
  state.main.remove();
  state.fields.remove();
}

function createCharacterSummary(doc: Document): ModernCharacterSummary | null {
  const summary = doc.querySelector<HTMLElement>('#avatar-and-name-block');
  const avatar = doc.querySelector<HTMLElement>('#avatar_div');
  const pinAndTabs = doc.querySelector<HTMLElement>('#rm_PinAndTabs');
  const name = doc.querySelector<HTMLElement>('#name_div');
  const buttonsBlock = doc.querySelector<HTMLElement>('#avatar_controls > .form_create_bottom_buttons_block');
  const dropdown = doc.querySelector<HTMLElement>('#char-management-dropdown')?.closest<HTMLElement>('label');
  const tags = doc.querySelector<HTMLElement>('#tags_div');

  if (!summary || !avatar || !pinAndTabs || !name || !buttonsBlock || !dropdown || !tags) {
    return null;
  }

  const main = doc.createElement('div');
  main.className = SUMMARY_MAIN_CLASS;
  const identity = doc.createElement('div');
  identity.className = SUMMARY_IDENTITY_CLASS;
  const buttons = doc.createElement('div');
  buttons.className = SUMMARY_BUTTONS_CLASS;
  const fields = doc.createElement('div');
  fields.className = SUMMARY_FIELDS_CLASS;
  const moves: MovedNode[] = [];

  try {
    moves.push(moveNode(doc, avatar, main));
    main.append(identity, buttons);
    moves.push(moveNode(doc, pinAndTabs, identity));
    moves.push(moveNode(doc, name, identity));
    moves.push(moveNode(doc, buttonsBlock, buttons));
    moves.push(moveNode(doc, dropdown, fields));
    moves.push(moveNode(doc, tags, fields));
    summary.append(main, fields);
    summary.classList.add(SUMMARY_CLASS);
  } catch (error) {
    [...moves].reverse().forEach(restoreMovedNode);
    main.remove();
    fields.remove();
    throw error;
  }

  return { buttons, buttonsBlock, dropdown, fields, identity, main, moves, name, pinAndTabs, summary, tags };
}

function isCurrentCharacterSummary(doc: Document, state: ModernCharacterSummary): boolean {
  return (
    state.summary.isConnected &&
    state.summary.classList.contains(SUMMARY_CLASS) &&
    state.main.parentElement === state.summary &&
    state.fields.parentElement === state.summary &&
    state.moves.every(move => move.marker.isConnected && move.node.isConnected) &&
    doc.querySelector('#rm_PinAndTabs') === state.pinAndTabs &&
    state.pinAndTabs.parentElement === state.identity &&
    doc.querySelector('#name_div') === state.name &&
    state.name.parentElement === state.identity &&
    state.buttonsBlock.parentElement === state.buttons &&
    doc.querySelector('#char-management-dropdown')?.closest('label') === state.dropdown &&
    state.dropdown.parentElement === state.fields &&
    doc.querySelector('#tags_div') === state.tags &&
    state.tags.parentElement === state.fields
  );
}

function isEditorMode(panel: HTMLElement | null): boolean {
  return panel?.dataset.menuType === 'create' || panel?.dataset.menuType === 'character_edit';
}

export function mountCharacterManagement(store: Store): { destroy: () => void } {
  const hostDocument = getHostDocument();
  const hostWindow = getHostWindow();
  const HostMutationObserver = (hostWindow as Window & { MutationObserver: typeof MutationObserver }).MutationObserver;
  let characterSummary: ModernCharacterSummary | null = null;
  let observedPanel: HTMLElement | null = null;
  let scheduledSync = 0;

  const restoreSummary = () => {
    restoreCharacterSummary(characterSummary);
    characterSummary = null;
  };

  const clearState = () => {
    restoreSummary();
    toggleHostState(hostDocument, false);
  };

  const sync = () => {
    scheduledSync = 0;
    const enabled = store.is_active && store.settings.modernCharacterManagement;

    if (!enabled) {
      observePanel(null);
      clearState();
      return;
    }

    toggleHostState(hostDocument, true);
    const panel = hostDocument.querySelector<HTMLElement>('#right-nav-panel');
    observePanel(panel);
    if (!isEditorMode(panel)) {
      restoreSummary();
      return;
    }

    if (characterSummary && !isCurrentCharacterSummary(hostDocument, characterSummary)) {
      restoreSummary();
    }
    characterSummary ??= createCharacterSummary(hostDocument);
  };

  const scheduleSync = () => {
    if (scheduledSync) {
      return;
    }
    scheduledSync = hostWindow.requestAnimationFrame(sync);
  };

  const observer = new HostMutationObserver(scheduleSync);

  function observePanel(panel: HTMLElement | null) {
    if (panel === observedPanel) {
      return;
    }

    observer.disconnect();
    observedPanel = panel;
    if (panel) {
      observer.observe(panel, {
        attributes: true,
        attributeFilter: ['data-menu-type'],
        childList: true,
        subtree: true,
      });
    }
  }

  const stopWatch = watch(
    () => [store.is_active, store.settings.modernCharacterManagement] as const,
    scheduleSync,
    { immediate: true },
  );

  return {
    destroy() {
      stopWatch();
      observer.disconnect();
      if (scheduledSync) {
        hostWindow.cancelAnimationFrame(scheduledSync);
        scheduledSync = 0;
      }
      clearState();
    },
  };
}
