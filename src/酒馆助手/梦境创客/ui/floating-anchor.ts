import {
  defaultFloatingButtonOffset,
  type FloatingButtonAnchor,
  type FloatingButtonOffset,
} from '../core/persistence/settings';

export const FLOATING_BUTTON_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;

export type { FloatingButtonAnchor } from '../core/persistence/settings';
export type { FloatingButtonOffset } from '../core/persistence/settings';

export const DEFAULT_FLOATING_BUTTON_ANCHOR: FloatingButtonAnchor = 'middle-right';

export type FloatingViewport = {
  height: number;
  insets: { bottom: number; left: number; right: number; top: number };
  width: number;
};

export type FloatingButtonPosition = { x: number; y: number };

function axisPosition(
  anchor: 'bottom' | 'center' | 'left' | 'middle' | 'right' | 'top',
  start: number,
  length: number,
  size: number,
  offset: number,
): number {
  if (anchor === 'left' || anchor === 'top') return start + offset;
  if (anchor === 'center' || anchor === 'middle') return start + (length - size) / 2 + offset;
  return start + length - size - offset;
}

export function floatingButtonPosition(
  anchor: FloatingButtonAnchor,
  viewport: FloatingViewport,
  size: { height: number; width: number },
  offset: FloatingButtonOffset = defaultFloatingButtonOffset(anchor),
): FloatingButtonPosition {
  const [vertical, horizontal] = anchor.split('-') as [
    'bottom' | 'middle' | 'top',
    'center' | 'left' | 'right',
  ];
  const availableWidth = Math.max(size.width, viewport.width - viewport.insets.left - viewport.insets.right);
  const availableHeight = Math.max(size.height, viewport.height - viewport.insets.top - viewport.insets.bottom);
  return {
    x: axisPosition(horizontal, viewport.insets.left, availableWidth, size.width, offset.x),
    y: axisPosition(vertical, viewport.insets.top, availableHeight, size.height, offset.y),
  };
}

function nearestAxis(value: number, start: number, length: number): 0 | 1 | 2 {
  const ratio = length <= 0 ? 0.5 : Math.min(1, Math.max(0, (value - start) / length));
  if (ratio < 1 / 3) return 0;
  if (ratio > 2 / 3) return 2;
  return 1;
}

function axisOffset(
  anchor: 'bottom' | 'center' | 'left' | 'middle' | 'right' | 'top',
  position: number,
  start: number,
  length: number,
  size: number,
): number {
  if (anchor === 'left' || anchor === 'top') return position - start;
  if (anchor === 'center' || anchor === 'middle') return position - (start + (length - size) / 2);
  return start + length - size - position;
}

export function floatingButtonOffsetForPosition(
  anchor: FloatingButtonAnchor,
  position: FloatingButtonPosition,
  viewport: FloatingViewport,
  size: { height: number; width: number },
): FloatingButtonOffset {
  const [vertical, horizontal] = anchor.split('-') as [
    'bottom' | 'middle' | 'top',
    'center' | 'left' | 'right',
  ];
  const availableWidth = Math.max(size.width, viewport.width - viewport.insets.left - viewport.insets.right);
  const availableHeight = Math.max(size.height, viewport.height - viewport.insets.top - viewport.insets.bottom);
  return {
    x: axisOffset(horizontal, position.x, viewport.insets.left, availableWidth, size.width),
    y: axisOffset(vertical, position.y, viewport.insets.top, availableHeight, size.height),
  };
}

export function nearestFloatingButtonAnchor(
  center: FloatingButtonPosition,
  viewport: FloatingViewport,
): FloatingButtonAnchor {
  const width = Math.max(1, viewport.width - viewport.insets.left - viewport.insets.right);
  const height = Math.max(1, viewport.height - viewport.insets.top - viewport.insets.bottom);
  const horizontal = (['left', 'center', 'right'] as const)[nearestAxis(center.x, viewport.insets.left, width)];
  const vertical = (['top', 'middle', 'bottom'] as const)[nearestAxis(center.y, viewport.insets.top, height)];
  return `${vertical}-${horizontal}`;
}

export function isFloatingButtonVisible(
  position: FloatingButtonPosition,
  viewport: FloatingViewport,
  size: { height: number; width: number },
): boolean {
  return (
    position.x >= viewport.insets.left &&
    position.y >= viewport.insets.top &&
    position.x + size.width <= viewport.width - viewport.insets.right &&
    position.y + size.height <= viewport.height - viewport.insets.bottom
  );
}
