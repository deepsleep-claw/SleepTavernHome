import { watch } from 'vue';

import { getHostDocument, getHostWindow } from './host-context';
import type { useModernLayoutStore } from './store';

const BODY_CLASS = 'th-modern-character-management';
const PANEL_CLASS = 'th-modern-character-panel';
const LIST_CLASS = 'th-modern-character-list';
const EDITOR_CLASS = 'th-modern-character-editor';
const ACTIONS_CLASS = 'th-modern-character-actions';
const DESKTOP_MEDIA_QUERY = '(min-width: 900px)';

type Store = ReturnType<typeof useModernLayoutStore>;

type MovedCharacterControls = {
  actions: HTMLElement;
  controls: HTMLElement;
  controlsMarker: Comment;
  tags: HTMLElement;
  tagsMarker: Comment;
};

function toggleHostState(doc: Document, enabled: boolean): void {
  doc.body.classList.toggle(BODY_CLASS, enabled);
  doc.querySelector('#right-nav-panel')?.classList.toggle(PANEL_CLASS, enabled);
  doc.querySelector('#rm_characters_block')?.classList.toggle(LIST_CLASS, enabled);
  doc.querySelector('#rm_ch_create_block')?.classList.toggle(EDITOR_CLASS, enabled);
}

function moveCharacterControls(doc: Document): MovedCharacterControls | null {
  const shell = doc.querySelector<HTMLElement>('#avatar-and-name-block > .flex-container');
  const avatar = doc.querySelector<HTMLElement>('#avatar_div');
  const controls = doc.querySelector<HTMLElement>('#avatar_controls');
  const tags = doc.querySelector<HTMLElement>('#tags_div');

  if (!shell || !avatar || !controls || !tags) {
    return null;
  }

  const controlsMarker = doc.createComment('th-modern-character-controls');
  const tagsMarker = doc.createComment('th-modern-character-tags');
  controls.before(controlsMarker);
  tags.before(tagsMarker);

  const actions = doc.createElement('div');
  actions.className = ACTIONS_CLASS;
  avatar.after(actions);
  actions.append(controls, tags);

  return { actions, controls, controlsMarker, tags, tagsMarker };
}

function restoreCharacterControls(state: MovedCharacterControls | null): void {
  if (!state) {
    return;
  }

  state.controlsMarker.parentNode?.insertBefore(state.controls, state.controlsMarker);
  state.tagsMarker.parentNode?.insertBefore(state.tags, state.tagsMarker);
  state.controlsMarker.remove();
  state.tagsMarker.remove();
  state.actions.remove();
}

function isCurrentCharacterControls(doc: Document, state: MovedCharacterControls): boolean {
  return (
    state.actions.isConnected &&
    state.controlsMarker.isConnected &&
    state.tagsMarker.isConnected &&
    doc.querySelector('#avatar_controls') === state.controls &&
    doc.querySelector('#tags_div') === state.tags
  );
}

export function mountCharacterManagement(store: Store): { destroy: () => void } {
  const hostDocument = getHostDocument();
  const hostWindow = getHostWindow();
  const HostMutationObserver = (hostWindow as Window & { MutationObserver: typeof MutationObserver }).MutationObserver;
  const HostElement = hostWindow.Element;
  const desktopMedia = hostWindow.matchMedia(DESKTOP_MEDIA_QUERY);
  let movedControls: MovedCharacterControls | null = null;
  let scheduledSync = 0;

  const clearState = () => {
    restoreCharacterControls(movedControls);
    movedControls = null;
    toggleHostState(hostDocument, false);
  };

  const sync = () => {
    scheduledSync = 0;
    const enabled =
      store.is_active &&
      store.settings.modernCharacterManagement &&
      store.settings.desktopTwoColumn &&
      desktopMedia.matches;

    if (!enabled) {
      clearState();
      return;
    }

    toggleHostState(hostDocument, true);
    if (movedControls && !isCurrentCharacterControls(hostDocument, movedControls)) {
      restoreCharacterControls(movedControls);
      movedControls = null;
    }
    movedControls ??= moveCharacterControls(hostDocument);
  };

  const scheduleSync = () => {
    if (scheduledSync) {
      return;
    }
    scheduledSync = hostWindow.requestAnimationFrame(sync);
  };

  const isRelevantNode = (node: Node): boolean => {
    if (!(node instanceof HostElement)) {
      return false;
    }
    return (
      node.matches('#right-nav-panel, #rm_characters_block, #rm_ch_create_block, #avatar_controls, #tags_div') ||
      Boolean(node.closest('#right-nav-panel')) ||
      Boolean(node.querySelector('#right-nav-panel, #rm_characters_block, #rm_ch_create_block, #avatar_controls, #tags_div'))
    );
  };

  const observer = new HostMutationObserver(mutations => {
    if (
      mutations.some(
        mutation =>
          isRelevantNode(mutation.target) ||
          [...mutation.addedNodes].some(isRelevantNode) ||
          [...mutation.removedNodes].some(isRelevantNode),
      )
    ) {
      scheduleSync();
    }
  });
  observer.observe(hostDocument.body, { childList: true, subtree: true });
  desktopMedia.addEventListener('change', scheduleSync);

  const stopWatch = watch(
    () =>
      [store.is_active, store.settings.modernCharacterManagement, store.settings.desktopTwoColumn] as const,
    scheduleSync,
    { immediate: true },
  );

  return {
    destroy() {
      stopWatch();
      observer.disconnect();
      desktopMedia.removeEventListener('change', scheduleSync);
      if (scheduledSync) {
        hostWindow.cancelAnimationFrame(scheduledSync);
        scheduledSync = 0;
      }
      clearState();
    },
  };
}
