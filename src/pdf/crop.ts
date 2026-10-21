import type { Rect } from './model';

/**
 * The crop tool's geometry. The crop box lives in page space (points, y up,
 * before the page's own turn), while proportions are chosen as the page is
 * seen — a 16:9 crop on a page turned a quarter is 9:16 in page space.
 */

export type CropAspect = 'free' | 'original' | '1:1' | '4:3' | '3:4' | '3:2' | '2:3' | '16:9' | '9:16';

export const CROP_ASPECTS: CropAspect[] = ['free', 'original', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'];

/** Which side or corner of the box a handle moves: n is the top (y + height). */
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const CROP_HANDLES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

interface Bounds {
  width: number;
  height: number;
}

const quarterTurned = (rotation: number) => (((rotation % 360) + 360) % 360) % 180 !== 0;

/** Width over height, in page space, that `aspect` asks for — null when free. */
export function aspectInPage(aspect: CropAspect, page: Bounds, rotation: number): number | null {
  if (aspect === 'free') return null;
  // The page's own proportions, whichever way it's turned.
  if (aspect === 'original') return page.width / page.height;
  const [w, h] = aspect.split(':').map(Number);
  return quarterTurned(rotation) ? h / w : w / h;
}

/** The smallest a crop box may get: tiny next to the page, but grabbable. */
export function minCropSize(page: Bounds): number {
  return Math.max(4, Math.min(page.width, page.height) * 0.03);
}

/** The largest box of `ratio` centred where `rect` is, kept on the page. */
export function fitAspect(rect: Rect, ratio: number | null, page: Bounds): Rect {
  if (!ratio) return clampRect(rect, page);
  let width = page.width;
  let height = width / ratio;
  if (height > page.height) {
    height = page.height;
    width = height * ratio;
  }
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return {
    x: Math.min(page.width - width, Math.max(0, cx - width / 2)),
    y: Math.min(page.height - height, Math.max(0, cy - height / 2)),
    width,
    height,
  };
}

export function clampRect(rect: Rect, page: Bounds): Rect {
  const width = Math.min(rect.width, page.width);
  const height = Math.min(rect.height, page.height);
  return {
    x: Math.min(page.width - width, Math.max(0, rect.x)),
    y: Math.min(page.height - height, Math.max(0, rect.y)),
    width,
    height,
  };
}

/** `start` moved by (dx, dy), kept on the page. */
export function moveCrop(start: Rect, dx: number, dy: number, page: Bounds): Rect {
  return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, page);
}

/**
 * `start` with the side or corner `handle` dragged by (dx, dy): the opposite
 * side (or corner) stays put; with a `ratio`, dragging a side grows the box
 * evenly the other way too. Never leaves the page, never gets smaller than
 * `minCropSize`.
 */
export function resizeCrop(start: Rect, handle: CropHandle, dx: number, dy: number, ratio: number | null, page: Bounds): Rect {
  const min = Math.min(minCropSize(page), page.width, page.height);
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.width;
  let y1 = start.y + start.height;

  if (west) x0 = Math.min(x1 - min, Math.max(0, x0 + dx));
  if (east) x1 = Math.max(x0 + min, Math.min(page.width, x1 + dx));
  if (south) y0 = Math.min(y1 - min, Math.max(0, y0 + dy));
  if (north) y1 = Math.max(y0 + min, Math.min(page.height, y1 + dy));
  if (!ratio) return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };

  let width = x1 - x0;
  let height = y1 - y0;
  const corner = (west || east) && (north || south);
  if (corner) {
    // Whichever way the pointer went further sets the size.
    if (width / start.width >= height / start.height) height = width / ratio;
    else width = height * ratio;
    // Room from the fixed corner toward the dragged one.
    const roomW = east ? page.width - start.x : start.x + start.width;
    const roomH = north ? page.height - start.y : start.y + start.height;
    const fit = Math.min(1, roomW / width, roomH / height);
    width *= fit;
    height *= fit;
    if (width < min || height < min) {
      const grow = Math.max(min / width, min / height);
      width *= grow;
      height *= grow;
    }
    const nx = east ? start.x : start.x + start.width - width;
    const ny = north ? start.y : start.y + start.height - height;
    return { x: nx, y: ny, width, height };
  }

  if (west || east) {
    // A side: the other dimension follows, centred on the box.
    const cy = start.y + start.height / 2;
    const roomH = 2 * Math.min(cy, page.height - cy);
    height = Math.min(width / ratio, roomH);
    width = height * ratio;
    const nx = east ? start.x : start.x + start.width - width;
    return { x: nx, y: cy - height / 2, width, height };
  }
  const cx = start.x + start.width / 2;
  const roomW = 2 * Math.min(cx, page.width - cx);
  width = Math.min(height * ratio, roomW);
  height = width / ratio;
  const ny = north ? start.y : start.y + start.height - height;
  return { x: cx - width / 2, y: ny, width, height };
}

/** Whether `rect` is (all but) the whole page. */
export function coversPage(rect: Rect, page: Bounds): boolean {
  const e = Math.max(0.5, Math.min(page.width, page.height) * 0.001);
  return rect.x <= e && rect.y <= e && rect.x + rect.width >= page.width - e && rect.y + rect.height >= page.height - e;
}
