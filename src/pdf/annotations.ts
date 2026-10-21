import type { DrawOverlay, LineOverlay, Rect } from './model';

/**
 * Geometry of the drawn annotations — arrows, lines and freehand strokes —
 * shared by the editor's SVG and the PDF export, so both draw the very same
 * shapes. Everything is in page space (points, y up).
 */

export interface Pt {
  x: number;
  y: number;
}

/** How see-through a highlighter's ink is. */
export const HIGHLIGHTER_OPACITY = 0.45;

/** Dash and gap lengths for a dashed line `width` thick (round caps add
 * half the width at each end of a dash). */
export const dashPattern = (width: number): [number, number] => [width * 1.6, width * 2.6];

/** The shaft to stroke and the arrowheads (triangles) to fill. */
export function lineGeometry(line: LineOverlay): { from: Pt; to: Pt; heads: Pt[][] } {
  const start = { x: line.x, y: line.y };
  const end = { x: line.x + line.dx, y: line.y + line.dy };
  const length = Math.hypot(line.dx, line.dy);
  if (length < 1e-6) return { from: start, to: end, heads: [] };
  const ux = line.dx / length;
  const uy = line.dy / length;
  const w = line.strokeWidth;
  // Heads never take more than 45% of the line each.
  const headLength = Math.min(w * 3.6 + 2, length * 0.45);
  const headHalf = headLength * 0.58;
  const head = (tip: Pt, dir: number): Pt[] => {
    const bx = tip.x - ux * dir * headLength;
    const by = tip.y - uy * dir * headLength;
    return [tip, { x: bx - uy * headHalf, y: by + ux * headHalf }, { x: bx + uy * headHalf, y: by - ux * headHalf }];
  };
  const heads: Pt[][] = [];
  // The shaft stops inside a head, so its round end never pokes past the tip.
  const back = headLength * 0.7;
  const from = line.arrowStart ? { x: start.x + ux * back, y: start.y + uy * back } : start;
  const to = line.arrowEnd ? { x: end.x - ux * back, y: end.y - uy * back } : end;
  if (line.arrowStart) heads.push(head(start, -1));
  if (line.arrowEnd) heads.push(head(end, 1));
  return { from, to, heads };
}

/** A line's box, padded for its thickness and heads. */
export function lineBox(line: LineOverlay): Rect {
  const pad = line.strokeWidth * 3 + 4;
  const x0 = Math.min(line.x, line.x + line.dx) - pad;
  const y0 = Math.min(line.y, line.y + line.dy) - pad;
  return { x: x0, y: y0, width: Math.abs(line.dx) + pad * 2, height: Math.abs(line.dy) + pad * 2 };
}

/** A stroke's points in page space. */
export function strokePoints(stroke: DrawOverlay): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < stroke.points.length; i += 2) {
    out.push({ x: stroke.x + stroke.points[i] * stroke.width, y: stroke.y + stroke.points[i + 1] * stroke.height });
  }
  return out;
}

export type Segment = { op: 'M' | 'L'; to: Pt } | { op: 'Q'; control: Pt; to: Pt };

/** A smooth path through `points`: curves through the midpoints, each
 * point a control — the jitter of a hand-drawn line is ironed out without
 * the path leaving where it was drawn. */
export function smoothSegments(points: Pt[]): Segment[] {
  if (!points.length) return [];
  const segments: Segment[] = [{ op: 'M', to: points[0] }];
  if (points.length === 1) return [...segments, { op: 'L', to: points[0] }];
  if (points.length === 2) return [...segments, { op: 'L', to: points[1] }];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const next = points[i + 1];
    segments.push({ op: 'Q', control: p, to: { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 } });
  }
  segments.push({ op: 'L', to: points[points.length - 1] });
  return segments;
}

/** The SVG path of `segments`, mapped by `map` (page space to the SVG's own). */
export function svgPath(segments: Segment[], map: (p: Pt) => Pt): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  return segments
    .map((s) => {
      const to = map(s.to);
      if (s.op === 'Q') {
        const c = map(s.control);
        return `Q${f(c.x)} ${f(c.y)} ${f(to.x)} ${f(to.y)}`;
      }
      return `${s.op}${f(to.x)} ${f(to.y)}`;
    })
    .join('');
}

/**
 * Turns a gesture's points (page space) into a stroke's box and its points
 * across that box, dropping points closer than `minStep` to the last kept.
 */
export function strokeFromPoints(points: Pt[], minStep: number): Pick<DrawOverlay, 'x' | 'y' | 'width' | 'height' | 'points'> | null {
  if (!points.length) return null;
  const kept: Pt[] = [points[0]];
  for (const p of points.slice(1)) {
    const last = kept[kept.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minStep) kept.push(p);
  }
  const end = points[points.length - 1];
  if (kept.length > 1 && kept[kept.length - 1] !== end) kept.push(end);
  const xs = kept.map((p) => p.x);
  const ys = kept.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  // A dead-straight stroke has no height (or width) to spread across.
  const width = Math.max(1e-3, Math.max(...xs) - x);
  const height = Math.max(1e-3, Math.max(...ys) - y);
  const rounded = (n: number) => Math.round(n * 10000) / 10000;
  return { x, y, width, height, points: kept.flatMap((p) => [rounded((p.x - x) / width), rounded((p.y - y) / height)]) };
}

/** How far `p` is from the nearest part of a stroke's path (page space). */
export function distanceToStroke(stroke: DrawOverlay, p: Pt): number {
  const pts = strokePoints(stroke);
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, distanceToSegment(p, pts[i], pts[i + 1]));
  return best;
}

export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A thickness setting (1..100) as points on a page of this size: a share
 * of its shorter side, so a stroke reads the same on a phone photo as on an
 * A4 page. */
export function thicknessToPoints(value: number, page: { width: number; height: number }): number {
  return Math.max(0.5, (value / 100) * 0.05 * Math.min(page.width, page.height));
}

export function pointsToThickness(points: number, page: { width: number; height: number }): number {
  return Math.max(1, Math.min(100, Math.round((points / (0.05 * Math.min(page.width, page.height))) * 100)));
}
