type HostPointerDragOptions = {
  target: HTMLElement;
  event: PointerEvent;
  onMove: (event: PointerEvent) => void;
  onStop: () => void;
};

/** 在宿主文档中跟踪拖拽，透明遮罩使跨域 iframe 也不会截走指针。 */
export function trackHostPointerDrag({ target, event, onMove, onStop }: HostPointerDragOptions): () => void {
  const document = target.ownerDocument;
  const host = document.defaultView!;
  const pointerId = event.pointerId;
  const shield = document.createElement('div');
  shield.className = 'th-modern-drag-shield';
  shield.setAttribute('aria-hidden', 'true');
  shield.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;pointer-events:auto;touch-action:none;cursor:col-resize;background:transparent';
  document.body.append(shield);
  let active = true;

  const stop = () => {
    if (!active) return;
    active = false;
    host.removeEventListener('pointermove', move, true);
    host.removeEventListener('pointerup', end, true);
    host.removeEventListener('pointercancel', end, true);
    host.removeEventListener('blur', stop);
    document.removeEventListener('visibilitychange', visibility);
    target.removeEventListener('lostpointercapture', end);
    shield.remove();
    try {
      if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
    } catch {
      /* 目标已移除或捕获已由浏览器释放。 */
    }
    onStop();
  };
  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    if (next.pointerType === 'mouse' && (next.buttons & 1) === 0) {
      stop();
      return;
    }
    onMove(next);
  };
  const end = (next: PointerEvent) => {
    if (next.pointerId === pointerId) stop();
  };
  const visibility = () => {
    if (document.hidden) stop();
  };
  host.addEventListener('pointermove', move, true);
  host.addEventListener('pointerup', end, true);
  host.addEventListener('pointercancel', end, true);
  host.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', visibility);
  target.addEventListener('lostpointercapture', end);
  try {
    target.setPointerCapture?.(pointerId);
  } catch {
    /* 指针捕获不可用时仍由宿主遮罩接收后续事件。 */
  }
  return stop;
}
