// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { trackHostPointerDrag } from '../../现代化界面/pointer-drag';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.innerHTML = '';
});

it('无指针捕获时由宿主遮罩继续拖拽，松开后恢复iframe交互', () => {
  const target = document.createElement('div');
  const frame = document.createElement('iframe');
  frame.style.pointerEvents = 'auto';
  document.body.append(target, frame);
  target.setPointerCapture = () => {
    throw new Error('unavailable');
  };
  const onMove = vi.fn();
  const onStop = vi.fn();
  stop = trackHostPointerDrag({ target, event: new PointerEvent('pointerdown', { pointerId: 7 }), onMove, onStop });
  const shield = document.querySelector<HTMLElement>('.th-modern-drag-shield')!;
  expect(shield.style.pointerEvents).toBe('auto');
  expect(shield.style.position).toBe('fixed');
  shield.dispatchEvent(new PointerEvent('pointermove', { pointerId: 8, clientX: 500, bubbles: true }));
  expect(onMove).not.toHaveBeenCalled();
  shield.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 500, buttons: 1, bubbles: true }));
  expect(onMove).toHaveBeenCalledOnce();
  shield.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true }));
  expect(onStop).toHaveBeenCalledOnce();
  expect(document.querySelector('.th-modern-drag-shield')).toBeNull();
  expect(frame.style.pointerEvents).toBe('auto');
  stop();
  expect(onStop).toHaveBeenCalledOnce();
});

it('窗口失焦会释放捕获、遮罩和监听，后续事件不再改变宽度', () => {
  const target = document.createElement('div');
  document.body.append(target);
  target.setPointerCapture = vi.fn();
  target.hasPointerCapture = () => true;
  target.releasePointerCapture = vi.fn();
  const onMove = vi.fn();
  const onStop = vi.fn();
  stop = trackHostPointerDrag({ target, event: new PointerEvent('pointerdown', { pointerId: 3 }), onMove, onStop });
  expect(target.setPointerCapture).toHaveBeenCalledWith(3);
  window.dispatchEvent(new Event('blur'));
  expect(target.releasePointerCapture).toHaveBeenCalledWith(3);
  expect(onStop).toHaveBeenCalledOnce();
  expect(document.querySelector('.th-modern-drag-shield')).toBeNull();
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, buttons: 1 }));
  expect(onMove).not.toHaveBeenCalled();
});
