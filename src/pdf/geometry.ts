import type { Rect } from './model';

export type Quarter = 0 | 90 | 180 | 270;

export function normalizeRotation(deg: number): Quarter {
  const r = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return r as Quarter;
}

/**
 * A PDF page carries its own /Rotate, which viewers apply clockwise at display time.
 * Overlay coordinates are authored in that *displayed* space, so they must be mapped
 * back into the page's raw user space before pdf-lib draws them (pdf-lib ignores
 * /Rotate and always draws in raw space).
 *
 * @param rawW width of the raw MediaBox
 * @param rawH height of the raw MediaBox
 */
export function displayToRaw(
  rotation: Quarter,
  rawW: number,
  rawH: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  switch (rotation) {
    case 90:
      return { x: rawW - dy, y: dx };
    case 180:
      return { x: rawW - dx, y: rawH - dy };
    case 270:
      return { x: dy, y: rawH - dx };
    default:
      return { x: dx, y: dy };
  }
}

/** Size of a page as displayed, given its raw size and /Rotate. */
export function displayedSize(rotation: Quarter, rawW: number, rawH: number) {
  return rotation % 180 === 0 ? { width: rawW, height: rawH } : { width: rawH, height: rawW };
}

/** Maps a rect from displayed space into a raw-space bounding box. */
export function displayRectToRaw(rotation: Quarter, rawW: number, rawH: number, rect: Rect): Rect {
  const corners = [
    displayToRaw(rotation, rawW, rawH, rect.x, rect.y),
    displayToRaw(rotation, rawW, rawH, rect.x + rect.width, rect.y),
    displayToRaw(rotation, rawW, rawH, rect.x, rect.y + rect.height),
    displayToRaw(rotation, rawW, rawH, rect.x + rect.width, rect.y + rect.height),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function clampRect(rect: Rect, maxW: number, maxH: number): Rect {
  const x = Math.max(0, Math.min(rect.x, maxW));
  const y = Math.max(0, Math.min(rect.y, maxH));
  return {
    x,
    y,
    width: Math.max(1, Math.min(rect.width, maxW - x)),
    height: Math.max(1, Math.min(rect.height, maxH - y)),
  };
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const int = parseInt(h, 16);
  if (Number.isNaN(int)) return { r: 0, g: 0, b: 0 };
  return {
    r: ((int >> 16) & 255) / 255,
    g: ((int >> 8) & 255) / 255,
    b: (int & 255) / 255,
  };
}
