// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { isolateDocumentDoubleClick, resizeFrame, type ResizeBounds, type ResizeDirection } from './window-interaction';

const bounds: ResizeBounds = { bottom: 800, left: 10, minHeight: 380, minWidth: 420, right: 1000, top: 10 };
const start = { height: 500, width: 600, x: 200, y: 150 };

describe('resizeFrame', () => {
  it.each([
    ['e', 80, 0, { height: 500, width: 680, x: 200, y: 150 }],
    ['s', 0, 60, { height: 560, width: 600, x: 200, y: 150 }],
    ['w', -70, 0, { height: 500, width: 670, x: 130, y: 150 }],
    ['n', 0, -40, { height: 540, width: 600, x: 200, y: 110 }],
    ['se', 80, 60, { height: 560, width: 680, x: 200, y: 150 }],
    ['sw', -70, 60, { height: 560, width: 670, x: 130, y: 150 }],
    ['ne', 80, -40, { height: 540, width: 680, x: 200, y: 110 }],
    ['nw', -70, -40, { height: 540, width: 670, x: 130, y: 110 }],
  ] satisfies Array<[ResizeDirection, number, number, typeof start]>)('支持 %s 方向缩放', (direction, deltaX, deltaY, expected) => {
    expect(resizeFrame(start, direction, deltaX, deltaY, bounds)).toEqual(expected);
  });

  it('保持对边不动，并限制最小尺寸和可视区域', () => {
    expect(resizeFrame(start, 'nw', 900, 900, bounds)).toEqual({ height: 380, width: 420, x: 380, y: 270 });
    expect(resizeFrame(start, 'nw', -900, -900, bounds)).toEqual({ height: 640, width: 790, x: 10, y: 10 });
    expect(resizeFrame(start, 'se', 900, 900, bounds)).toEqual({ height: 650, width: 800, x: 200, y: 150 });
  });
});

describe('isolateDocumentDoubleClick', () => {
  it('阻止 iframe body 的第三方捕获监听，但不取消浏览器默认行为', () => {
    const listener = vi.fn();
    const target = document.createElement('div');
    document.body.append(target);
    document.body.addEventListener('dblclick', listener, true);
    const cleanup = isolateDocumentDoubleClick(document);

    const blocked = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
    expect(target.dispatchEvent(blocked)).toBe(true);
    expect(blocked.defaultPrevented).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    cleanup();
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(listener).toHaveBeenCalledOnce();
  });
});
