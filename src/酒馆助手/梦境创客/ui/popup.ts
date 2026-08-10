import { teleportStyle } from '@util/script';
import { createApp } from 'vue';
import WorkspaceWindow from './WorkspaceWindow.vue';

type Frame = { height: number; width: number; x: number; y: number };
type Popup = { connected: () => boolean; destroy: () => void; focus: () => void };

let popup: Popup | undefined;
const MARGIN = 10;
const WINDOW_ID = 'dream-card-agent-window';

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
  if (popup?.connected()) {
    popup.focus();
    return;
  }
  popup?.destroy();
  popup = undefined;
  $(`#${WINDOW_ID}`).remove();
  const host = window.parent;
  const $window = $('<section>')
    .attr({ 'aria-label': '梦境创客', 'data-tt-mobile-surface': 'free-window', id: WINDOW_ID, role: 'dialog', script_id: getScriptId() })
    .addClass('dca-floating-window')
    .appendTo('body');
  const $title = $('<header>').addClass('dca-floating-titlebar').appendTo($window);
  $('<span>').append($('<i>').addClass('fa-solid fa-wand-magic-sparkles')).append(' 梦境创客').appendTo($title);
  const $close = $('<button>').attr({ 'aria-label': '关闭窗口', title: '关闭窗口（Agent继续运行）', type: 'button' }).append($('<i>').addClass('fa-solid fa-xmark')).appendTo($title);
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
  $title.css('pointer-events', 'auto');

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
  const $resize = $('<div>').addClass('dca-floating-resize').attr('title', '拖拽调整大小').appendTo($window);
  $resize.css('pointer-events', 'auto');
  const style = teleportStyle();
  const placeFrame = (value: Frame) => {
    applyFrame($window, value);
    const actual = readFrame($window);
    const titleHeight = $title.outerHeight() ?? 43;
    $(frame).css({
      height: `${Math.max(1, actual.height - titleHeight)}px`,
      left: `${actual.x}px`,
      top: `${actual.y + titleHeight}px`,
      width: `${actual.width}px`,
    });
  };
  placeFrame(defaultFrame());

  let removePointer = () => {};
  const keepVisible = () => placeFrame(readFrame($window));
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    removePointer();
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
    host.removeEventListener('resize', keepVisible);
    popup = undefined;
  };
  const track = (event: PointerEvent, resize: boolean) => {
    if (event.button !== 0 || viewport().mobile) return;
    event.preventDefault();
    const start = readFrame($window);
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (next: PointerEvent) => placeFrame(resize
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
