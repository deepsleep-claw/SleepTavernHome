import { teleportStyle } from '@util/script';
import { createApp } from 'vue';
import WorkspaceWindow from './WorkspaceWindow.vue';
import {
  isolateDocumentDoubleClick,
  resizeFrame,
  type Frame,
  type ResizeBounds,
  type ResizeDirection,
} from './window-interaction';

type Popup = { connected: () => boolean; destroy: () => void; focus: () => void };
type WindowPreferences = { desktopMode: 'fullscreen' | 'windowed'; windowedFrame?: Frame };

let popup: Popup | undefined;
const MARGIN = 10;
const WINDOW_ID = 'dream-card-agent-window';
const WINDOW_PREFERENCES_KEY = 'dream-card-agent:window-layout:v1';
const WINDOW_LAYOUT_EVENT = 'dream-card-agent:window-layout';
const RESIZE_DIRECTIONS: ResizeDirection[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

function viewport() {
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
    mobile: host.innerWidth <= 720,
    scrollX: host.scrollX,
    scrollY: host.scrollY,
    width: host.innerWidth,
  };
}

function resizeBounds(): ResizeBounds {
  const view = viewport();
  const left = view.insets.left + view.scrollX + MARGIN;
  const top = view.insets.top + view.scrollY + MARGIN;
  const right = view.scrollX + view.width - view.insets.right - MARGIN;
  const bottom = view.scrollY + view.height - view.insets.bottom - MARGIN;
  return {
    bottom,
    left,
    minHeight: Math.min(380, bottom - top),
    minWidth: Math.min(420, right - left),
    right,
    top,
  };
}

function clamp(frame: Frame): Frame {
  const view = viewport();
  const left = view.insets.left + view.scrollX + MARGIN;
  const top = view.insets.top + view.scrollY + MARGIN;
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
  return clamp({
    height,
    width,
    x: view.scrollX + (view.width - width) / 2,
    y: view.scrollY + (view.height - height) / 2,
  });
}

function fullscreenFrame(): Frame {
  const view = viewport();
  return {
    height: Math.max(1, view.height - view.insets.top - view.insets.bottom),
    width: Math.max(1, view.width - view.insets.left - view.insets.right),
    x: view.insets.left + view.scrollX,
    y: view.insets.top + view.scrollY,
  };
}

function readPreferences(): WindowPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(WINDOW_PREFERENCES_KEY) ?? '') as Partial<WindowPreferences>;
    return {
      desktopMode: value.desktopMode === 'windowed' ? 'windowed' : 'fullscreen',
      windowedFrame: value.windowedFrame,
    };
  } catch {
    return { desktopMode: 'fullscreen' };
  }
}

function savePreferences(value: WindowPreferences): void {
  localStorage.setItem(WINDOW_PREFERENCES_KEY, JSON.stringify(value));
}

function readFrame($window: JQuery<HTMLElement>): Frame {
  const x = Number.parseFloat($window.css('left'));
  const y = Number.parseFloat($window.css('top'));
  return {
    height: $window.outerHeight() ?? 500,
    width: $window.outerWidth() ?? 700,
    x: Number.isFinite(x) ? x : MARGIN,
    y: Number.isFinite(y) ? y : MARGIN,
  };
}

function applyFrame($window: JQuery<HTMLElement>, frame: Frame, fullscreen: boolean): void {
  const value = fullscreen ? fullscreenFrame() : clamp(frame);
  $window.css({ height: `${value.height}px`, left: `${value.x}px`, top: `${value.y}px`, width: `${value.width}px` });
  $window.toggleClass('dca-floating-window-mobile', viewport().mobile);
  $window.toggleClass('dca-floating-window-fullscreen', fullscreen);
}

export function openDreamCardAgentWindow(): void {
  if (popup?.connected()) {
    popup.focus();
    return;
  }
  popup?.destroy();
  popup = undefined;
  $(`#${WINDOW_ID}`).remove();
  const host = window.parent;
  const $window = $('<section>')
    .attr({
      'aria-label': '梦境创客',
      'data-tt-mobile-surface': 'free-window',
      id: WINDOW_ID,
      role: 'dialog',
      script_id: getScriptId(),
    })
    .addClass('dca-floating-window')
    .appendTo('body');
  const $title = $('<header>').addClass('dca-floating-titlebar').appendTo($window);
  const $dragSurface = $('<div>').addClass('dca-floating-drag-surface').attr('aria-hidden', 'true').appendTo($title);
  const updateDragSurface = (event: Event) => {
    const detail = (event as CustomEvent<{ collapsed?: boolean; mobile?: boolean }>).detail;
    $dragSurface.css('width', detail?.collapsed || detail?.mobile ? '0' : 'calc(17.5rem - 3rem)');
  };
  host.addEventListener(WINDOW_LAYOUT_EVENT, updateDragSurface);
  const $titleActions = $('<div>').addClass('dca-floating-title-actions').appendTo($title);
  const $mode = $('<button>')
    .addClass('dca-floating-mode')
    .attr({ 'aria-label': '切换窗口模式', type: 'button' })
    .append($('<i>'))
    .appendTo($titleActions);
  const $close = $('<button>')
    .addClass('dca-floating-close')
    .attr({ 'aria-label': '关闭窗口', title: '关闭窗口（Agent继续运行）', type: 'button' })
    .append($('<i>').addClass('fa-solid fa-xmark'))
    .appendTo($titleActions);
  let destroyed = false;
  const frameElement = window.frameElement;
  if (!frameElement || frameElement.tagName !== 'IFRAME') {
    $window.remove();
    throw new Error('梦境创客只能在酒馆助手脚本 iframe 中打开');
  }
  const frame = frameElement as HTMLIFrameElement;
  const originalStyle = frame.getAttribute('style');
  const originalClass = frame.getAttribute('class');
  const originalTitle = frame.getAttribute('title');
  const originalAriaLabel = frame.getAttribute('aria-label');
  const removeDoubleClickIsolation = isolateDocumentDoubleClick(document);

  // Vue在酒馆助手自己的iframe里创建节点。直接把这些节点挂到父页面会发生
  // 跨document采用，第三方焦点监听和动态事件都会变得不可靠。iframe本身也
  // 不能被移动，否则浏览器会重载脚本。这里保持它仍是body直属子节点，仅用
  // fixed定位把它显示在浮窗内容区，让Vue、DOM与事件始终属于同一文档。
  frame.classList.add('dca-floating-body-frame');
  frame.setAttribute('aria-label', '梦境创客工作台');
  frame.style.display = 'block';
  frame.style.position = 'fixed';
  frame.style.minHeight = '0';
  frame.style.border = '0';
  frame.style.zIndex = '6000';

  $window.css({ background: 'transparent', pointerEvents: 'none', zIndex: 6001 });

  document.documentElement.style.height = '100%';
  document.body.style.height = '100%';
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.querySelector('[data-dca-ui-root]')?.remove();
  let iconStyle = document.head.querySelector<HTMLLinkElement>('link[data-dca-fontawesome]');
  if (!iconStyle) {
    iconStyle = document.createElement('link');
    iconStyle.rel = 'stylesheet';
    iconStyle.href = 'https://testingcf.jsdelivr.net/npm/@fortawesome/fontawesome-free/css/all.min.css';
    iconStyle.dataset.dcaFontawesome = 'true';
    document.head.append(iconStyle);
  }
  const mountPoint = document.createElement('div');
  mountPoint.className = 'dca-shadow-root';
  mountPoint.dataset.dcaUiRoot = 'true';
  document.body.append(mountPoint);
  const app = createApp(WorkspaceWindow);
  app.mount(mountPoint);
  const $resizeHandles = $(
    RESIZE_DIRECTIONS.map(
      direction =>
        $('<div>')
          .addClass(`dca-floating-resize dca-floating-resize-${direction}`)
          .attr({ 'aria-hidden': 'true', 'data-direction': direction, title: '拖拽调整大小' })
          .css('pointer-events', 'auto')
          .appendTo($window)[0],
    ),
  );
  const style = teleportStyle();
  let preferences = readPreferences();
  let fullscreen = viewport().mobile || preferences.desktopMode === 'fullscreen';
  const updateModeButton = () => {
    const mobile = viewport().mobile;
    $mode.toggle(!mobile);
    $mode.attr('title', fullscreen ? '切换到窗口模式' : '填满酒馆可用区域');
    $mode.find('i').attr('class', fullscreen ? 'fa-regular fa-window-restore' : 'fa-solid fa-expand');
    $resizeHandles.toggle(!fullscreen && !mobile);
  };
  const placeFrame = (value: Frame, nextFullscreen = fullscreen) => {
    fullscreen = viewport().mobile || nextFullscreen;
    applyFrame($window, value, fullscreen);
    const actual = readFrame($window);
    $(frame).css({
      height: `${Math.max(1, actual.height)}px`,
      left: `${actual.x}px`,
      top: `${actual.y}px`,
      width: `${actual.width}px`,
    });
    updateModeButton();
  };
  const placePreferredFrame = () => {
    const mobile = viewport().mobile;
    const useFullscreen = mobile || preferences.desktopMode === 'fullscreen';
    placeFrame(useFullscreen ? fullscreenFrame() : (preferences.windowedFrame ?? defaultFrame()), useFullscreen);
  };
  placePreferredFrame();

  let removePointer = () => {};
  const keepVisible = () => placePreferredFrame();
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    removePointer();
    removeDoubleClickIsolation();
    app.unmount();
    mountPoint.remove();
    if (originalClass === null) frame.removeAttribute('class');
    else frame.setAttribute('class', originalClass);
    if (originalStyle === null) frame.removeAttribute('style');
    else frame.setAttribute('style', originalStyle);
    if (originalTitle === null) frame.removeAttribute('title');
    else frame.setAttribute('title', originalTitle);
    if (originalAriaLabel === null) frame.removeAttribute('aria-label');
    else frame.setAttribute('aria-label', originalAriaLabel);
    $window.remove();
    style.destroy();
    host.removeEventListener(WINDOW_LAYOUT_EVENT, updateDragSurface);
    host.removeEventListener('resize', keepVisible);
    popup = undefined;
  };
  const track = (
    event: PointerEvent,
    captureTarget: HTMLElement,
    operation: { direction: ResizeDirection; type: 'resize' } | { type: 'move' },
  ) => {
    if (event.button !== 0 || viewport().mobile || fullscreen) return;
    event.preventDefault();
    event.stopPropagation();
    removePointer();
    const start = readFrame($window);
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const previousUserSelect = host.document.body.style.userSelect;
    const interactionCursor = host.getComputedStyle(captureTarget).cursor;
    let ended = false;
    host.document.body.style.userSelect = 'none';
    $window.css({ cursor: interactionCursor, pointerEvents: 'auto' });
    try {
      captureTarget.setPointerCapture(pointerId);
    } catch {
      // 透明窗口外壳仍会覆盖 iframe，作为不支持指针捕获时的退路。
    }
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      next.preventDefault();
      placeFrame(
        operation.type === 'resize'
          ? resizeFrame(start, operation.direction, next.clientX - startX, next.clientY - startY, resizeBounds())
          : { ...start, x: start.x + next.clientX - startX, y: start.y + next.clientY - startY },
      );
    };
    const end = (next?: Event) => {
      if (ended || (next && 'pointerId' in next && (next as PointerEvent).pointerId !== pointerId)) return;
      ended = true;
      host.document.removeEventListener('pointermove', move);
      host.document.removeEventListener('pointerup', end);
      host.document.removeEventListener('pointercancel', end);
      captureTarget.removeEventListener('lostpointercapture', end);
      if (captureTarget.hasPointerCapture(pointerId)) captureTarget.releasePointerCapture(pointerId);
      host.document.body.style.userSelect = previousUserSelect;
      $window.css({ cursor: '', pointerEvents: 'none' });
      removePointer = () => {};
      preferences = { ...preferences, windowedFrame: clamp(readFrame($window)) };
      savePreferences(preferences);
    };
    removePointer = end;
    host.document.addEventListener('pointermove', move);
    host.document.addEventListener('pointerup', end);
    host.document.addEventListener('pointercancel', end);
    captureTarget.addEventListener('lostpointercapture', end);
  };
  $dragSurface.on('pointerdown', event =>
    track(event.originalEvent as PointerEvent, $dragSurface[0], { type: 'move' }),
  );
  $resizeHandles.on('pointerdown', function (event) {
    const direction = $(this).attr('data-direction') as ResizeDirection;
    track(event.originalEvent as PointerEvent, this, { direction, type: 'resize' });
  });
  $mode
    .on('pointerdown', event => event.stopPropagation())
    .on('click', () => {
      if (viewport().mobile) return;
      if (fullscreen) {
        preferences = { ...preferences, desktopMode: 'windowed' };
      } else {
        preferences = { desktopMode: 'fullscreen', windowedFrame: clamp(readFrame($window)) };
      }
      savePreferences(preferences);
      placePreferredFrame();
    });
  $close.on('pointerdown', event => event.stopPropagation()).on('click', destroy);
  host.addEventListener('resize', keepVisible);
  popup = {
    connected: () => $window[0]?.isConnected === true && frame.isConnected,
    destroy,
    focus: () => {
      $(frame).css('z-index', 6100);
      $window.css('z-index', 6101);
      window.setTimeout(() => {
        $(frame).css('z-index', 6000);
        $window.css('z-index', 6001);
      }, 0);
    },
  };
}

export function destroyDreamCardAgentWindow(): void {
  popup?.destroy();
}
