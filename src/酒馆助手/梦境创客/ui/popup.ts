import { teleportStyle } from '@util/script';
import { createApp } from 'vue';
import AgentWindow from './AgentWindow.vue';

type Frame = { height: number; width: number; x: number; y: number };
type Popup = { destroy: () => void; focus: () => void };

let popup: Popup | undefined;
const MARGIN = 10;

function viewport() {
  const host = window.parent;
  const style = host.getComputedStyle(host.document.documentElement);
  const inset = (name: string) => Math.max(0, Number.parseFloat(style.getPropertyValue(name)) || 0);
  return {
    height: host.innerHeight,
    insets: { bottom: inset('--tt-inset-bottom'), left: inset('--tt-inset-left'), right: inset('--tt-inset-right'), top: inset('--tt-inset-top') },
    mobile: host.innerWidth <= 720,
    width: host.innerWidth,
  };
}

function clamp(frame: Frame): Frame {
  const view = viewport();
  const left = view.insets.left + MARGIN;
  const top = view.insets.top + MARGIN;
  const availableWidth = Math.max(1, view.width - view.insets.left - view.insets.right - MARGIN * 2);
  const availableHeight = Math.max(1, view.height - view.insets.top - view.insets.bottom - MARGIN * 2);
  if (view.mobile) return { height: availableHeight, width: availableWidth, x: left, y: top };
  const width = Math.min(Math.max(frame.width, Math.min(420, availableWidth)), availableWidth);
  const height = Math.min(Math.max(frame.height, Math.min(380, availableHeight)), availableHeight);
  return {
    height,
    width,
    x: Math.min(Math.max(frame.x, left), left + availableWidth - width),
    y: Math.min(Math.max(frame.y, top), top + availableHeight - height),
  };
}

function defaultFrame(): Frame {
  const view = viewport();
  const width = Math.min(980, Math.max(520, view.width * 0.72));
  const height = Math.min(780, Math.max(440, view.height * 0.82));
  return clamp({ height, width, x: (view.width - width) / 2, y: (view.height - height) / 2 });
}

function readFrame($window: JQuery<HTMLElement>): Frame {
  return {
    height: $window.outerHeight() ?? 500,
    width: $window.outerWidth() ?? 700,
    x: Number.parseFloat($window.css('left')) || MARGIN,
    y: Number.parseFloat($window.css('top')) || MARGIN,
  };
}

function applyFrame($window: JQuery<HTMLElement>, frame: Frame): void {
  const value = clamp(frame);
  $window.css({ height: `${value.height}px`, left: `${value.x}px`, top: `${value.y}px`, width: `${value.width}px` });
  $window.toggleClass('dca-floating-window-mobile', viewport().mobile);
}

export function openDreamCardAgentWindow(): void {
  if (popup) {
    popup.focus();
    return;
  }
  const host = window.parent;
  const $window = $('<section>')
    .attr({ 'aria-label': '梦境创客', 'data-tt-mobile-surface': 'free-window', role: 'dialog', script_id: getScriptId() })
    .addClass('dca-floating-window')
    .appendTo('body');
  const $title = $('<header>').addClass('dca-floating-titlebar').appendTo($window);
  $('<span>').append($('<i>').addClass('fa-solid fa-wand-magic-sparkles')).append(' 梦境创客').appendTo($title);
  const $close = $('<button>').attr({ 'aria-label': '关闭窗口', title: '关闭窗口（Agent继续运行）', type: 'button' }).append($('<i>').addClass('fa-solid fa-xmark')).appendTo($title);
  const $body = $('<div>').addClass('dca-floating-body').appendTo($window);
  const $resize = $('<div>').addClass('dca-floating-resize').attr('title', '拖拽调整大小').appendTo($window);
  const app = createApp(AgentWindow);
  app.mount($body[0]);
  const style = teleportStyle();
  applyFrame($window, defaultFrame());

  let removePointer = () => {};
  let destroyed = false;
  const keepVisible = () => applyFrame($window, readFrame($window));
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    removePointer();
    app.unmount();
    $window.remove();
    style.destroy();
    host.removeEventListener('resize', keepVisible);
    popup = undefined;
  };
  const track = (event: PointerEvent, resize: boolean) => {
    if (event.button !== 0 || viewport().mobile) return;
    event.preventDefault();
    const start = readFrame($window);
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (next: PointerEvent) => applyFrame($window, resize
      ? { ...start, height: start.height + next.clientY - startY, width: start.width + next.clientX - startX }
      : { ...start, x: start.x + next.clientX - startX, y: start.y + next.clientY - startY });
    const end = () => {
      host.document.removeEventListener('pointermove', move);
      host.document.removeEventListener('pointerup', end);
      host.document.removeEventListener('pointercancel', end);
      removePointer = () => {};
    };
    removePointer();
    removePointer = end;
    host.document.addEventListener('pointermove', move);
    host.document.addEventListener('pointerup', end);
    host.document.addEventListener('pointercancel', end);
  };
  $title.on('pointerdown', event => track(event.originalEvent as PointerEvent, false));
  $resize.on('pointerdown', event => track(event.originalEvent as PointerEvent, true));
  $close.on('pointerdown', event => event.stopPropagation()).on('click', destroy);
  host.addEventListener('resize', keepVisible);
  popup = {
    destroy,
    focus: () => {
      $window.css('z-index', 6100);
      window.setTimeout(() => $window.css('z-index', ''), 0);
    },
  };
}

export function destroyDreamCardAgentWindow(): void {
  popup?.destroy();
}
