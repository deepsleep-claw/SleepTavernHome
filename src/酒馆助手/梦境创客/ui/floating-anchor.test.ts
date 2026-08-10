import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLOATING_BUTTON_ANCHOR,
  floatingButtonOffsetForPosition,
  floatingButtonPosition,
  isFloatingButtonVisible,
  nearestFloatingButtonAnchor,
  type FloatingViewport,
} from './floating-anchor';

const viewport: FloatingViewport = {
  height: 800,
  insets: { bottom: 20, left: 10, right: 30, top: 40 },
  width: 1200,
};

describe('floating button anchor', () => {
  it('默认吸附在右侧中部，并始终避开安全区', () => {
    const size = { height: 50, width: 50 };
    const position = floatingButtonPosition(DEFAULT_FLOATING_BUTTON_ANCHOR, viewport, size);
    expect(position.x).toBe(1102);
    expect(position.y).toBe(385);
    expect(isFloatingButtonVisible(position, viewport, size)).toBe(true);
  });

  it('按九宫格区域选择相对锚点', () => {
    expect(nearestFloatingButtonAnchor({ x: 100, y: 400 }, viewport)).toBe('middle-left');
    expect(nearestFloatingButtonAnchor({ x: 600, y: 70 }, viewport)).toBe('top-center');
    expect(nearestFloatingButtonAnchor({ x: 1100, y: 760 }, viewport)).toBe('bottom-right');

    const portrait = { ...viewport, height: 1100, width: 430 };
    const position = floatingButtonPosition('middle-right', portrait, { height: 50, width: 50 });
    expect(position).toEqual({ x: 332, y: 535 });
    expect(isFloatingButtonVisible(position, portrait, { height: 50, width: 50 })).toBe(true);
  });

  it('保留自由位置，并按照左右与中心锚点响应宽度变化', () => {
    const size = { height: 50, width: 50 };
    const rightPosition = { x: 900, y: 310 };
    const rightAnchor = nearestFloatingButtonAnchor(
      { x: rightPosition.x + 25, y: rightPosition.y + 25 },
      viewport,
    );
    const rightOffset = floatingButtonOffsetForPosition(rightAnchor, rightPosition, viewport, size);
    expect(rightAnchor).toBe('middle-right');
    expect(floatingButtonPosition(rightAnchor, viewport, size, rightOffset)).toEqual(rightPosition);

    const narrower = { ...viewport, width: 1000 };
    expect(floatingButtonPosition(rightAnchor, narrower, size, rightOffset).x).toBe(700);

    const leftPosition = { x: 100, y: 310 };
    const leftAnchor = nearestFloatingButtonAnchor(
      { x: leftPosition.x + 25, y: leftPosition.y + 25 },
      viewport,
    );
    const leftOffset = floatingButtonOffsetForPosition(leftAnchor, leftPosition, viewport, size);
    expect(leftAnchor).toBe('middle-left');
    expect(floatingButtonPosition(leftAnchor, narrower, size, leftOffset).x).toBe(100);

    const centerPosition = { x: 550, y: 310 };
    const centerAnchor = nearestFloatingButtonAnchor(
      { x: centerPosition.x + 25, y: centerPosition.y + 25 },
      viewport,
    );
    const centerOffset = floatingButtonOffsetForPosition(centerAnchor, centerPosition, viewport, size);
    expect(centerAnchor).toBe('middle-center');
    expect(floatingButtonPosition(centerAnchor, narrower, size, centerOffset).x).toBe(450);
  });

  it('可以识别完全离开当前可视范围的旧坐标', () => {
    expect(isFloatingButtonVisible({ x: 1160, y: 780 }, viewport, { height: 50, width: 50 })).toBe(false);
    expect(isFloatingButtonVisible({ x: 100, y: 100 }, viewport, { height: 50, width: 50 })).toBe(true);
  });
});
