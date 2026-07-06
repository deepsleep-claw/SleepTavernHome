import { teleportStyle } from '@util/script';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import Popup from './Popup.vue';
import { SCRIPT_NAME, usePresetAdapterStore } from './store';

type Frame = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type ActivePopup = {
  destroy: () => void;
  resetPosition: () => void;
  refresh: () => void;
};

let active_popup: ActivePopup | undefined;

const VIEWPORT_MARGIN = 12;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 300;

function getHostWindow(): Window {
  return window.parent;
}

function getViewport() {
  const host_window = getHostWindow();
  return {
    height: host_window.innerHeight,
    width: host_window.innerWidth,
  };
}

function clampFrame(frame: Frame): Frame {
  const viewport = getViewport();
  const min_width = Math.min(MIN_WIDTH, Math.max(240, viewport.width - VIEWPORT_MARGIN * 2));
  const min_height = Math.min(MIN_HEIGHT, Math.max(220, viewport.height - VIEWPORT_MARGIN * 2));
  const max_width = Math.max(min_width, viewport.width - VIEWPORT_MARGIN * 2);
  const max_height = Math.max(min_height, viewport.height - VIEWPORT_MARGIN * 2);
  const width = Math.min(Math.max(frame.width, min_width), max_width);
  const height = Math.min(Math.max(frame.height, min_height), max_height);
  const max_x = Math.max(VIEWPORT_MARGIN, viewport.width - width - VIEWPORT_MARGIN);
  const max_y = Math.max(VIEWPORT_MARGIN, viewport.height - height - VIEWPORT_MARGIN);

  return {
    height,
    width,
    x: Math.min(Math.max(frame.x, VIEWPORT_MARGIN), max_x),
    y: Math.min(Math.max(frame.y, VIEWPORT_MARGIN), max_y),
  };
}

function getDefaultFrame(): Frame {
  const viewport = getViewport();
  const is_mobile = viewport.width <= 720;
  const width = is_mobile
    ? viewport.width - VIEWPORT_MARGIN * 2
    : Math.min(760, Math.max(430, Math.round(viewport.width * 0.42)));
  const height = is_mobile
    ? Math.min(620, viewport.height - VIEWPORT_MARGIN * 2)
    : Math.min(viewport.height - VIEWPORT_MARGIN * 2, Math.max(420, Math.round(viewport.height * 0.72)));

  return clampFrame({
    height,
    width,
    x: is_mobile ? VIEWPORT_MARGIN : viewport.width - width - 28,
    y: is_mobile ? VIEWPORT_MARGIN : Math.round((viewport.height - height) / 2),
  });
}

function getFrame($window: JQuery<HTMLElement>): Frame {
  return {
    height: $window.outerHeight() ?? MIN_HEIGHT,
    width: $window.outerWidth() ?? MIN_WIDTH,
    x: Number.parseFloat($window.css('left')) || VIEWPORT_MARGIN,
    y: Number.parseFloat($window.css('top')) || VIEWPORT_MARGIN,
  };
}

function applyFrame($window: JQuery<HTMLElement>, frame: Frame) {
  const clamped_frame = clampFrame(frame);
  $window.css({
    height: `${clamped_frame.height}px`,
    left: `${clamped_frame.x}px`,
    top: `${clamped_frame.y}px`,
    width: `${clamped_frame.width}px`,
  });
}

export function openPresetAdapterPopup(): Promise<void> {
  if (active_popup) {
    active_popup.refresh();
    active_popup.resetPosition();
    toastr.info(`${SCRIPT_NAME}界面已经打开。`, SCRIPT_NAME);
    return Promise.resolve();
  }

  const host_window = getHostWindow();
  const host_document = host_window.document;
  const $window = $('<section>')
    .attr({
      role: 'dialog',
      script_id: getScriptId(),
    })
    .addClass('preset-adapter-floating-window')
    .appendTo('body');
  const $titlebar = $('<div>').addClass('preset-adapter-floating-titlebar').appendTo($window);
  $('<div>')
    .addClass('preset-adapter-floating-title')
    .append($('<i>').addClass('fa-solid fa-sliders').attr('aria-hidden', 'true'))
    .append($('<span>').text(SCRIPT_NAME))
    .appendTo($titlebar);
  const $close = $('<button>')
    .attr({
      'aria-label': '关闭',
      title: '关闭',
      type: 'button',
    })
    .addClass('menu_button preset-adapter-floating-close')
    .append($('<i>').addClass('fa-solid fa-xmark').attr('aria-hidden', 'true'))
    .appendTo($titlebar);
  const $body = $('<div>').addClass('preset-adapter-floating-body').appendTo($window);
  const $resize = $('<div>')
    .attr({ title: '调整大小' })
    .addClass('preset-adapter-floating-resize')
    .appendTo($window);

  const pinia = createPinia();
  const app = createApp(Popup).use(pinia);
  app.mount($body[0]);

  const style = teleportStyle();
  const store = usePresetAdapterStore(pinia);
  store.refresh();
  applyFrame($window, getDefaultFrame());

  let removePointerListeners = () => {};
  let destroyed = false;

  const destroy = () => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    removePointerListeners();
    app.unmount();
    $window.remove();
    style.destroy();
    host_window.removeEventListener('resize', keepInViewport);
    active_popup = undefined;
  };

  const keepInViewport = () => applyFrame($window, getFrame($window));
  const resetPosition = () => applyFrame($window, getDefaultFrame());

  const startPointerTracking = (event: PointerEvent, resize: boolean) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const start_frame = getFrame($window);
    const start_x = event.clientX;
    const start_y = event.clientY;

    const onPointerMove = (move_event: PointerEvent) => {
      const delta_x = move_event.clientX - start_x;
      const delta_y = move_event.clientY - start_y;
      if (resize) {
        applyFrame($window, {
          ...start_frame,
          height: start_frame.height + delta_y,
          width: start_frame.width + delta_x,
        });
        return;
      }

      applyFrame($window, {
        ...start_frame,
        x: start_frame.x + delta_x,
        y: start_frame.y + delta_y,
      });
    };

    const stopPointerTracking = () => {
      host_document.removeEventListener('pointermove', onPointerMove);
      host_document.removeEventListener('pointerup', stopPointerTracking);
      host_document.removeEventListener('pointercancel', stopPointerTracking);
      removePointerListeners = () => {};
    };

    removePointerListeners();
    removePointerListeners = stopPointerTracking;
    host_document.addEventListener('pointermove', onPointerMove);
    host_document.addEventListener('pointerup', stopPointerTracking);
    host_document.addEventListener('pointercancel', stopPointerTracking);
  };

  $titlebar.on('pointerdown', event => startPointerTracking(event.originalEvent as PointerEvent, false));
  $resize.on('pointerdown', event => startPointerTracking(event.originalEvent as PointerEvent, true));
  $close
    .on('pointerdown', event => event.stopPropagation())
    .on('click', event => {
      event.preventDefault();
      destroy();
    });
  host_window.addEventListener('resize', keepInViewport);

  active_popup = { destroy, resetPosition, refresh: store.refresh };
  return Promise.resolve();
}

export function refreshPresetAdapterPopup(): void {
  active_popup?.refresh();
}

export function destroyPresetAdapterPopup(): void {
  active_popup?.destroy();
}
