import { watch } from 'vue';

import type { useModernLayoutStore } from './store';

const BODY_CLASS = 'th-modern-character-management';
const PANEL_CLASS = 'th-modern-character-panel';
const LIST_CLASS = 'th-modern-character-list';
const EDITOR_CLASS = 'th-modern-character-editor';
const ACTIONS_CLASS = 'th-modern-character-actions';

type Store = ReturnType<typeof useModernLayoutStore>;

function getHostDocument(): Document {
  return window.parent?.document ?? document;
}

function getDocuments(): Document[] {
  return _.uniq([document, getHostDocument()]);
}

function toggleDocumentState(enabled: boolean): void {
  getDocuments().forEach(doc => {
    doc.body?.classList.toggle(BODY_CLASS, enabled);
    doc.querySelector('#right-nav-panel')?.classList.toggle(PANEL_CLASS, enabled);
    doc.querySelector('#rm_characters_block')?.classList.toggle(LIST_CLASS, enabled);
    doc.querySelector('#rm_ch_create_block')?.classList.toggle(EDITOR_CLASS, enabled);

    if (enabled) {
      enhanceCharacterEditor(doc);
    } else {
      restoreCharacterEditor(doc);
    }
  });
}

function clearDocumentState(): void {
  getDocuments().forEach(doc => {
    restoreCharacterEditor(doc);
    doc.body?.classList.remove(BODY_CLASS);
    doc.querySelector('#right-nav-panel')?.classList.remove(PANEL_CLASS);
    doc.querySelector('#rm_characters_block')?.classList.remove(LIST_CLASS);
    doc.querySelector('#rm_ch_create_block')?.classList.remove(EDITOR_CLASS);
  });
}

function enhanceCharacterEditor(doc: Document): void {
  const shell = doc.querySelector<HTMLElement>('#avatar-and-name-block > .flex-container');
  const avatar = doc.querySelector<HTMLElement>('#avatar_div');
  const controls = doc.querySelector<HTMLElement>('#avatar_controls');
  const tags = doc.querySelector<HTMLElement>('#tags_div');

  if (!shell || !avatar || !controls || !tags) {
    return;
  }

  let actions = shell.querySelector<HTMLElement>(`:scope > .${ACTIONS_CLASS}`);
  if (!actions) {
    actions = doc.createElement('div');
    actions.className = ACTIONS_CLASS;
    avatar.after(actions);
  }

  if (controls.parentElement !== actions) {
    actions.appendChild(controls);
  }

  if (tags.parentElement !== actions) {
    actions.appendChild(tags);
  }
}

function restoreCharacterEditor(doc: Document): void {
  const shell = doc.querySelector<HTMLElement>('#avatar-and-name-block > .flex-container');
  const avatar = doc.querySelector<HTMLElement>('#avatar_div');
  const actions = shell?.querySelector<HTMLElement>(`:scope > .${ACTIONS_CLASS}`);

  if (!shell || !avatar || !actions) {
    return;
  }

  const controls = actions.querySelector<HTMLElement>('#avatar_controls');
  const tags = actions.querySelector<HTMLElement>('#tags_div');

  if (controls) {
    avatar.appendChild(controls);
  }

  if (tags) {
    shell.appendChild(tags);
  }

  actions.remove();
}

export function mountCharacterManagement(store: Store): { destroy: () => void } {
  const hostDocument = getHostDocument();
  let scheduledSync = 0;

  const sync = () => {
    scheduledSync = 0;
    toggleDocumentState(store.is_active && store.settings.modernCharacterManagement);
  };

  const scheduleSync = () => {
    if (scheduledSync) {
      return;
    }
    scheduledSync = requestAnimationFrame(sync);
  };

  const observer = new MutationObserver(scheduleSync);
  observer.observe(hostDocument.body, { childList: true });

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
        cancelAnimationFrame(scheduledSync);
      }
      clearDocumentState();
    },
  };
}
