export type Frame = { height: number; width: number; x: number; y: number };

export type ResizeDirection = 'e' | 'n' | 'ne' | 'nw' | 's' | 'se' | 'sw' | 'w';

export type ResizeBounds = {
  bottom: number;
  left: number;
  minHeight: number;
  minWidth: number;
  right: number;
  top: number;
};

function clampValue(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function resizeFrame(
  start: Frame,
  direction: ResizeDirection,
  deltaX: number,
  deltaY: number,
  bounds: ResizeBounds,
): Frame {
  let left = start.x;
  let right = start.x + start.width;
  let top = start.y;
  let bottom = start.y + start.height;

  if (direction.includes('w')) left = clampValue(start.x + deltaX, bounds.left, right - bounds.minWidth);
  if (direction.includes('e')) right = clampValue(start.x + start.width + deltaX, left + bounds.minWidth, bounds.right);
  if (direction.includes('n')) top = clampValue(start.y + deltaY, bounds.top, bottom - bounds.minHeight);
  if (direction.includes('s')) bottom = clampValue(start.y + start.height + deltaY, top + bounds.minHeight, bounds.bottom);

  return { height: bottom - top, width: right - left, x: left, y: top };
}

export function isolateDocumentDoubleClick(target: Document): () => void {
  const stopExternalDoubleClick = (event: MouseEvent) => event.stopPropagation();
  target.addEventListener('dblclick', stopExternalDoubleClick, true);
  return () => target.removeEventListener('dblclick', stopExternalDoubleClick, true);
}
