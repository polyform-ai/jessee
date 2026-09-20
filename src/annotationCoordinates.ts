export interface RectangleBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export function containedContentBounds(
  bounds: RectangleBounds,
  naturalWidth: number,
  naturalHeight: number
): RectangleBounds | undefined {
  if (bounds.width <= 0 || bounds.height <= 0 || naturalWidth <= 0 || naturalHeight <= 0) {
    return undefined;
  }
  const scale = Math.min(bounds.width / naturalWidth, bounds.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    left: bounds.left + (bounds.width - width) / 2,
    top: bounds.top + (bounds.height - height) / 2,
    width,
    height
  };
}

export function normalizePointInBounds(
  clientX: number,
  clientY: number,
  bounds: RectangleBounds
): NormalizedPoint | undefined {
  if (bounds.width <= 0 || bounds.height <= 0) return undefined;
  return {
    x: clamp((clientX - bounds.left) / bounds.width),
    y: clamp((clientY - bounds.top) / bounds.height)
  };
}

export function pointIsInsideBounds(
  clientX: number,
  clientY: number,
  bounds: RectangleBounds
): boolean {
  return bounds.width > 0 && bounds.height > 0
    && clientX >= bounds.left && clientX <= bounds.left + bounds.width
    && clientY >= bounds.top && clientY <= bounds.top + bounds.height;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
