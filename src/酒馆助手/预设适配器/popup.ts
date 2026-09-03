import { teleportStyle } from '@util/script';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import Popup from './Popup.vue';
import { SCRIPT_NAME, usePresetAdapterStore } from './store';
import {
  DEFAULT_PRESET_ADAPTER_THEME,
  isPresetAdapterThemeId,
  PRESET_ADAPTER_THEMES,
  type PresetAdapterThemeId,
} from './theme';

type Frame = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type ViewportInsets = {
  bottom: number;
  left: number;
  right: number;
  top: number;
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

// TauriTavern 在移动端通过这些变量公布原生安全区；标准酒馆中读取结果为 0。
function getViewport() {
  const host_window = getHostWindow();
  const root_style = host_window.getComputedStyle(host_window.document.documentElement);
  const body_style = host_window.document.body ? host_window.getComputedStyle(host_window.document.body) : undefined;
  const readInset = (property: string): number => {
    const value = Number.parseFloat(body_style?.getPropertyValue(property) || root_style.getPropertyValue(property));
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  };
  return {
    height: host_window.innerHeight,
    insets: {
      bottom: readInset('--tt-inset-bottom'),
      left: readInset('--tt-inset-left'),
      right: readInset('--tt-inset-right'),
      top: readInset('--tt-inset-top'),
    } satisfies ViewportInsets,
    width: host_window.innerWidth,
  };
}

function clampFrame(frame: Frame): Frame {
  const viewport = getViewport();
  const min_x = viewport.insets.left + VIEWPORT_MARGIN;
  const min_y = viewport.insets.top + VIEWPORT_MARGIN;
  const boundary_x = Math.max(min_x, viewport.width - viewport.insets.right - VIEWPORT_MARGIN);
  const boundary_y = Math.max(min_y, viewport.height - viewport.insets.bottom - VIEWPORT_MARGIN);
  const available_width = Math.max(1, boundary_x - min_x);
  const available_height = Math.max(1, boundary_y - min_y);
  const min_width = Math.min(MIN_WIDTH, available_width);
  const min_height = Math.min(MIN_HEIGHT, available_height);
  const max_width = Math.max(min_width, available_width);
  const max_height = Math.max(min_height, available_height);
  const width = Math.min(Math.max(frame.width, min_width), max_width);
  const height = Math.min(Math.max(frame.height, min_height), max_height);
  const max_x = Math.max(min_x, boundary_x - width);
  const max_y = Math.max(min_y, boundary_y - height);

  return {
    height,
    width,
    x: Math.min(Math.max(frame.x, min_x), max_x),
    y: Math.min(Math.max(frame.y, min_y), max_y),
  };
}

function getDefaultFrame(): Frame {
  const viewport = getViewport();
  const min_x = viewport.insets.left + VIEWPORT_MARGIN;
  const min_y = viewport.insets.top + VIEWPORT_MARGIN;
  const available_width = Math.max(
    1,
    viewport.width - viewport.insets.left - viewport.insets.right - VIEWPORT_MARGIN * 2,
  );
  const available_height = Math.max(
    1,
    viewport.height - viewport.insets.top - viewport.insets.bottom - VIEWPORT_MARGIN * 2,
  );
  const is_mobile = viewport.width <= 720;
  const width = is_mobile ? available_width : Math.min(1180, Math.max(980, Math.round(available_width * 0.82)));
  const height = is_mobile
    ? Math.min(620, available_height)
    : Math.min(available_height, Math.max(620, Math.round(available_height * 0.84)));

  return clampFrame({
    height,
    width,
    x: is_mobile ? min_x : viewport.width - viewport.insets.right - width - 28,
    y: is_mobile ? min_y : min_y + Math.round((available_height - height) / 2),
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
      'data-preset-adapter-theme': DEFAULT_PRESET_ADAPTER_THEME,
      'data-tt-mobile-surface': 'free-window',
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
  const $title_actions = $('<div>').addClass('preset-adapter-floating-title-actions').appendTo($titlebar);
  const $theme_button = $('<button>')
    .attr({
      'aria-controls': 'preset-adapter-theme-picker',
      'aria-expanded': 'false',
      'aria-label': '切换主题',
      title: '切换主题',
      type: 'button',
    })
    .addClass('menu_button preset-adapter-floating-theme')
    .append($('<i>').addClass('fa-solid fa-palette').attr('aria-hidden', 'true'))
    .appendTo($title_actions);
  const $close = $('<button>')
    .attr({
      'aria-label': '关闭',
      title: '关闭',
      type: 'button',
    })
    .addClass('menu_button preset-adapter-floating-close')
    .append($('<i>').addClass('fa-solid fa-xmark').attr('aria-hidden', 'true'))
    .appendTo($title_actions);
  const $theme_picker = $('<section>')
    .attr({
      'aria-label': '切换主题',
      hidden: '',
      id: 'preset-adapter-theme-picker',
      role: 'dialog',
    })
    .addClass('preset-adapter-theme-picker')
    .appendTo($window);
  const $theme_picker_header = $('<header>').appendTo($theme_picker);
  $('<div>')
    .append($('<strong>').text('选择主题'))
    .append($('<small>').text('三套深色 · 三套浅色'))
    .appendTo($theme_picker_header);
  const $theme_picker_close = $('<button>')
    .attr({ 'aria-label': '关闭主题选择', title: '关闭', type: 'button' })
    .append($('<i>').addClass('fa-solid fa-xmark').attr('aria-hidden', 'true'))
    .appendTo($theme_picker_header);
  const $theme_grid = $('<div>').addClass('preset-adapter-theme-grid').appendTo($theme_picker);
  PRESET_ADAPTER_THEMES.forEach(theme => {
    const $option = $('<button>')
      .attr({
        'aria-label': `${theme.label}：${theme.description}`,
        'aria-pressed': 'false',
        'data-preset-adapter-theme-option': theme.id,
        type: 'button',
      })
      .addClass('preset-adapter-theme-option')
      .appendTo($theme_grid);
    $('<span>')
      .addClass('preset-adapter-theme-option-icon')
      .append($('<i>').addClass(`fa-solid ${theme.icon}`).attr('aria-hidden', 'true'))
      .appendTo($option);
    $('<span>')
      .addClass('preset-adapter-theme-option-copy')
      .append($('<strong>').text(theme.label))
      .append($('<small>').text(theme.description))
      .appendTo($option);
    const $swatches = $('<span>').addClass('preset-adapter-theme-option-swatches').attr('aria-hidden', 'true');
    theme.swatches.forEach(color => $('<i>').css('background-color', color).appendTo($swatches));
    $swatches.appendTo($option);
  });
  const $body = $('<div>').addClass('preset-adapter-floating-body').appendTo($window);
  const $resize = $('<div>').attr({ title: '调整大小' }).addClass('preset-adapter-floating-resize').appendTo($window);

  const pinia = createPinia();
  const app = createApp(Popup).use(pinia);
  app.mount($body[0]);

  const style = teleportStyle();
  const store = usePresetAdapterStore(pinia);
  const getActiveTheme = (): PresetAdapterThemeId => {
    const theme = store.ui_preferences.theme;
    return isPresetAdapterThemeId(theme) ? theme : DEFAULT_PRESET_ADAPTER_THEME;
  };
  const applyTheme = (theme: PresetAdapterThemeId) => {
    const definition = PRESET_ADAPTER_THEMES.find(candidate => candidate.id === theme);
    $window.attr('data-preset-adapter-theme', theme);
    $theme_button.attr('title', `切换主题（当前：${definition?.label ?? '夜金'}）`);
    $theme_grid.find<HTMLElement>('[data-preset-adapter-theme-option]').each((_, option) => {
      const selected = option.dataset.presetAdapterThemeOption === theme;
      option.setAttribute('aria-pressed', String(selected));
    });
  };
  const closeThemePicker = () => {
    $theme_picker.prop('hidden', true);
    $theme_button.attr('aria-expanded', 'false');
  };
  const openThemePicker = () => {
    $theme_picker.prop('hidden', false);
    $theme_button.attr('aria-expanded', 'true');
    $theme_grid
      .find<HTMLElement>(`[data-preset-adapter-theme-option="${getActiveTheme()}"]`)
      .trigger('focus');
  };
  const refresh = () => {
    store.refresh();
    applyTheme(getActiveTheme());
  };
  const onDocumentPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (
      !$theme_picker.prop('hidden') &&
      target &&
      !$theme_picker[0].contains(target as Node) &&
      !$theme_button[0].contains(target as Node)
    ) {
      closeThemePicker();
    }
  };
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !$theme_picker.prop('hidden')) {
      closeThemePicker();
      $theme_button.trigger('focus');
    }
  };
  refresh();
  applyFrame($window, getDefaultFrame());

  let removePointerListeners = () => {};
  let destroyed = false;

  const destroy = () => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    removePointerListeners();
    host_document.removeEventListener('pointerdown', onDocumentPointerDown);
    host_document.removeEventListener('keydown', onDocumentKeyDown);
    app.unmount();
    $window.remove();
    style.destroy();
    host_window.removeEventListener('resize', keepInViewport);
    active_popup = undefined;
  };

  const keepInViewport = () => applyFrame($window, getFrame($window));
  const resetPosition = () => applyFrame($window, getDefaultFrame());

  const startPointerTracking = (event: PointerEvent, resize: boolean) => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }

    event.preventDefault();
    const pointer_id = event.pointerId;
    const pointer_target = resize ? $resize[0] : $titlebar[0];
    const start_frame = getFrame($window);
    const start_x = event.clientX;
    const start_y = event.clientY;

    const onPointerMove = (move_event: PointerEvent) => {
      if (move_event.pointerId !== pointer_id) {
        return;
      }
      move_event.preventDefault();
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

    const cleanupPointerTracking = () => {
      host_document.removeEventListener('pointermove', onPointerMove);
      host_document.removeEventListener('pointerup', stopPointerTracking);
      host_document.removeEventListener('pointercancel', stopPointerTracking);
      if (pointer_target.hasPointerCapture(pointer_id)) {
        pointer_target.releasePointerCapture(pointer_id);
      }
      removePointerListeners = () => {};
    };

    const stopPointerTracking = (end_event: PointerEvent) => {
      if (end_event.pointerId === pointer_id) {
        cleanupPointerTracking();
      }
    };

    removePointerListeners();
    removePointerListeners = cleanupPointerTracking;
    host_document.addEventListener('pointermove', onPointerMove);
    host_document.addEventListener('pointerup', stopPointerTracking);
    host_document.addEventListener('pointercancel', stopPointerTracking);
    pointer_target.setPointerCapture(pointer_id);
  };

  $titlebar.on('pointerdown', event => startPointerTracking(event.originalEvent as PointerEvent, false));
  $resize.on('pointerdown', event => startPointerTracking(event.originalEvent as PointerEvent, true));
  $title_actions.on('pointerdown', event => event.stopPropagation());
  $theme_picker.on('pointerdown', event => event.stopPropagation());
  $theme_button.on('click', event => {
    event.preventDefault();
    if ($theme_picker.prop('hidden')) {
      openThemePicker();
    } else {
      closeThemePicker();
    }
  });
  $theme_picker_close.on('click', event => {
    event.preventDefault();
    closeThemePicker();
    $theme_button.trigger('focus');
  });
  $theme_grid.on('click', '[data-preset-adapter-theme-option]', event => {
    const theme = $(event.currentTarget).attr('data-preset-adapter-theme-option');
    if (!isPresetAdapterThemeId(theme)) {
      return;
    }
    store.setTheme(theme);
    applyTheme(theme);
  });
  $close
    .on('pointerdown', event => event.stopPropagation())
    .on('click', event => {
      event.preventDefault();
      destroy();
    });
  host_window.addEventListener('resize', keepInViewport);
  host_document.addEventListener('pointerdown', onDocumentPointerDown);
  host_document.addEventListener('keydown', onDocumentKeyDown);

  active_popup = { destroy, resetPosition, refresh };
  return Promise.resolve();
}

export function refreshPresetAdapterPopup(): void {
  active_popup?.refresh();
}

export function destroyPresetAdapterPopup(): void {
  active_popup?.destroy();
}
