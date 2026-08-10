import { checkMinimumVersion } from '@util/common';
import { teleportStyle } from '@util/script';
import { createProbeModel, createProbeStream } from './core/provider-probe';
import { getDreamCardAgentRuntime } from './runtime/dream-card-agent-runtime';
import {
  DEFAULT_FLOATING_BUTTON_ANCHOR,
  floatingButtonOffsetForPosition,
  floatingButtonPosition,
  isFloatingButtonVisible,
  nearestFloatingButtonAnchor,
  type FloatingButtonAnchor,
  type FloatingButtonOffset,
  type FloatingViewport,
} from './ui/floating-anchor';
import { destroyDreamCardAgentWindow, openDreamCardAgentWindow } from './ui/popup';

export const DREAM_CARD_AGENT_ID = 'dream-card-agent';
export const DREAM_CARD_AGENT_NAME = '梦境创客';
export const dreamCardAgentProbe = createProbeStream;

const WAND_CONTAINER_ID = 'dream-card-agent-wand-container';
const FLOATING_BUTTON_ID = 'dream-card-agent-floating-button';
const HOST_RUNTIME_KEY = '__dream_card_agent_host_runtime_v1__';

type HostRuntime = { destroy: () => void; owner: string };

function eventNamespace(owner: string): string {
  return `.dreamCardAgent_${owner.replaceAll('-', '')}`;
}

function hostRuntime(): HostRuntime | undefined {
  return (window.parent as unknown as Record<string, HostRuntime | undefined>)[HOST_RUNTIME_KEY];
}

function setHostRuntime(runtime: HostRuntime | undefined): void {
  const host = window.parent as unknown as Record<string, HostRuntime | undefined>;
  if (runtime) host[HOST_RUNTIME_KEY] = runtime;
  else delete host[HOST_RUNTIME_KEY];
}

function refreshExtensionsMenuButton(): void {
  const visible = $('#extensionsMenu').children().filter((_, item) => $(item).css('display') !== 'none').length > 0;
  $('#extensionsMenuButton').toggle(visible);
}

function floatingViewport(): FloatingViewport {
  const host = window.parent;
  const style = host.getComputedStyle(host.document.documentElement);
  const inset = (name: string) => Math.max(0, Number.parseFloat(style.getPropertyValue(name)) || 0);
  return {
    height: host.innerHeight,
    insets: {
      bottom: inset('--tt-inset-bottom'),
      left: inset('--tt-inset-left'),
      right: inset('--tt-inset-right'),
      top: inset('--tt-inset-top'),
    },
    width: host.innerWidth,
  };
}

function mountWandEntry(owner: string): { destroy: () => void } {
  const namespace = eventNamespace(owner);
  $(`#${WAND_CONTAINER_ID}`).remove();
  let $container: JQuery<HTMLElement> | undefined;
  let timer: ReturnType<typeof window.setInterval> | undefined;
  const append = () => {
    if ($container?.parent().length) return true;
    const $menu = $('#extensionsMenu');
    if (!$menu.length) return false;
    $container = $('<div>')
      .attr({ id: WAND_CONTAINER_ID, script_id: getScriptId() })
      .addClass('extension_container')
      .append(
        $('<div>')
          .addClass('list-group-item flex-container flexGap5')
          .attr({ title: DREAM_CARD_AGENT_NAME })
          .append($('<i>').addClass('fa-solid fa-wand-magic-sparkles'))
          .append($('<span>').text(DREAM_CARD_AGENT_NAME))
          .on(`click${namespace}`, event => {
            event.preventDefault();
            openDreamCardAgentWindow();
          }),
      )
      .appendTo($menu);
    $('#extensionsMenuButton').css('display', 'flex');
    return true;
  };
  if (!append()) timer = window.setInterval(() => { if (append() && timer !== undefined) { window.clearInterval(timer); timer = undefined; } }, 1000);
  return {
    destroy: () => {
      if (timer !== undefined) window.clearInterval(timer);
      $container?.find('.list-group-item').off(namespace);
      $container?.remove();
      refreshExtensionsMenuButton();
    },
  };
}

function mountFloatingButton(owner: string): { destroy: () => void } {
  const runtime = getDreamCardAgentRuntime();
  const host = window.parent;
  const namespace = eventNamespace(owner);
  $(`#${FLOATING_BUTTON_ID}`).remove();
  const $button = $('<button>')
    .attr({ 'aria-label': '打开梦境创客', id: FLOATING_BUTTON_ID, script_id: getScriptId(), title: '打开梦境创客' })
    .addClass('dca-floating-trigger')
    .append($('<i>').addClass('fa-solid fa-wand-magic-sparkles'))
    .on(`click${namespace}`, event => {
      event.preventDefault();
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      openDreamCardAgentWindow();
    })
    .appendTo('body');
  let anchor: FloatingButtonAnchor = runtime.snapshot().floatingButtonAnchor;
  let offset: FloatingButtonOffset = runtime.snapshot().floatingButtonOffset;
  let suppressClick = false;
  let stopDragging = () => {};

  const buttonSize = () => {
    const rect = $button[0].getBoundingClientRect();
    return { height: rect.height || 50, width: rect.width || 50 };
  };
  const setPlacement = (nextAnchor: FloatingButtonAnchor, nextOffset: FloatingButtonOffset) => {
    anchor = nextAnchor;
    offset = nextOffset;
    const position = floatingButtonPosition(anchor, floatingViewport(), buttonSize(), offset);
    $button.css({ bottom: 'auto', left: `${position.x}px`, right: 'auto', top: `${position.y}px` });
  };
  const persistPlacement = (
    nextAnchor: FloatingButtonAnchor,
    nextOffset: FloatingButtonOffset,
    apply = true,
  ) => {
    anchor = nextAnchor;
    offset = nextOffset;
    if (apply) setPlacement(nextAnchor, nextOffset);
    void runtime
      .updateSettings({ floatingButtonAnchor: nextAnchor, floatingButtonOffset: nextOffset })
      .catch(() => undefined);
  };
  const keepVisible = () => {
    if (!$button.is(':visible')) return;
    const view = floatingViewport();
    const size = buttonSize();
    const position = floatingButtonPosition(anchor, view, size, offset);
    if (!isFloatingButtonVisible(position, view, size)) {
      persistPlacement(DEFAULT_FLOATING_BUTTON_ANCHOR, { x: 18, y: 0 });
      return;
    }
    setPlacement(anchor, offset);
  };
  const startDragging = (event: JQuery.TriggeredEvent) => {
    const pointer = event.originalEvent as PointerEvent;
    if (pointer.button !== 0) return;
    pointer.preventDefault();
    stopDragging();
    const rect = $button[0].getBoundingClientRect();
    const start = { x: pointer.clientX, y: pointer.clientY };
    const origin = { x: rect.left, y: rect.top };
    let moved = false;
    const move = (next: PointerEvent) => {
      const dx = next.clientX - start.x;
      const dy = next.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      const view = floatingViewport();
      const size = buttonSize();
      const x = Math.min(
        view.width - view.insets.right - size.width,
        Math.max(view.insets.left, origin.x + dx),
      );
      const y = Math.min(
        view.height - view.insets.bottom - size.height,
        Math.max(view.insets.top, origin.y + dy),
      );
      $button.css({ bottom: 'auto', left: `${x}px`, right: 'auto', top: `${y}px` });
    };
    const end = () => {
      host.document.removeEventListener('pointermove', move);
      host.document.removeEventListener('pointerup', end);
      host.document.removeEventListener('pointercancel', end);
      stopDragging = () => {};
      if (!moved) return;
      suppressClick = true;
      const current = $button[0].getBoundingClientRect();
      const view = floatingViewport();
      const size = { height: current.height, width: current.width };
      const nextAnchor = nearestFloatingButtonAnchor(
        { x: current.left + current.width / 2, y: current.top + current.height / 2 },
        view,
      );
      const nextOffset = floatingButtonOffsetForPosition(
        nextAnchor,
        { x: current.left, y: current.top },
        view,
        size,
      );
      // 九宫格只决定后续缩放参照，松手时保留用户拖到的自由位置。
      persistPlacement(nextAnchor, nextOffset, false);
    };
    stopDragging = end;
    host.document.addEventListener('pointermove', move);
    host.document.addEventListener('pointerup', end);
    host.document.addEventListener('pointercancel', end);
  };
  $button.on(`pointerdown${namespace}`, startDragging);
  setPlacement(anchor, offset);
  host.addEventListener('resize', keepVisible);
  const unsubscribe = runtime.subscribe(state => {
    $button.toggle(state.floatingButton);
    if (
      state.floatingButtonAnchor !== anchor ||
      state.floatingButtonOffset.x !== offset.x ||
      state.floatingButtonOffset.y !== offset.y
    ) {
      setPlacement(state.floatingButtonAnchor, state.floatingButtonOffset);
    }
  });
  return {
    destroy: () => {
      stopDragging();
      unsubscribe();
      host.removeEventListener('resize', keepVisible);
      $button.off(namespace);
      $button.remove();
    },
  };
}

$(() => {
  const owner = crypto.randomUUID();
  try {
    hostRuntime()?.destroy();
  } catch {
    $(`#${FLOATING_BUTTON_ID}, #${WAND_CONTAINER_ID}, #dream-card-agent-window`).remove();
  }
  checkMinimumVersion('4.0.0', DREAM_CARD_AGENT_NAME);
  createProbeModel({
    apiKey: '',
    baseURL: 'https://example.invalid/v1',
    interfaceType: 'openai-responses',
    model: 'probe',
  });
  const runtime = getDreamCardAgentRuntime();
  const style = teleportStyle();
  const floating = mountFloatingButton(owner);
  const wand = mountWandEntry(owner);
  const refresh = () => { void runtime.refreshCharacter().catch(() => undefined); };
  const events = [
    eventOn(tavern_events.CHAT_CHANGED, refresh),
    eventOn(tavern_events.CHARACTER_EDITED, refresh),
    eventOn(tavern_events.CHARACTER_RENAMED, refresh),
    eventOn(tavern_events.CHARACTER_DUPLICATED, refresh),
  ];
  refresh();
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    events.forEach(event => event.stop());
    destroyDreamCardAgentWindow();
    floating.destroy();
    wand.destroy();
    runtime.destroy();
    style.destroy();
    if (hostRuntime()?.owner === owner) setHostRuntime(undefined);
  };
  setHostRuntime({ destroy, owner });
  $(window).one('pagehide', destroy);
  console.info(`[${DREAM_CARD_AGENT_NAME}] 已启动。`);
});
