import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { DrawOverlay, WorkPage } from '../pdf/model';
import { distanceToStroke, HIGHLIGHTER_OPACITY, smoothSegments, strokeFromPoints, svgPath, thicknessToPoints, type Pt } from '../pdf/annotations';
import { useApp } from '../state/AppContext';
import { safeSetPointerCapture } from './OverlayLayer';
import { t } from '../i18n/translations';

/**
 * The drawing tool, laid over the whole page: each press-drag-release with
 * the pen or the highlighter is one stroke; the eraser rubs out whole
 * strokes it passes over. Lives inside the page's plane, in page space.
 */
export function DrawLayer({ page, scale }: { page: WorkPage; scale: number }) {
  const { state, actions } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ pointerId: number; pointerType: string; points: Pt[]; erased: Set<string> } | null>(null);
  const [points, setPoints] = useState<Pt[] | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const { tool } = state.draw;
  const pen = tool === 'highlighter' ? state.draw.highlighter : state.draw.pen;
  const width = thicknessToPoints(pen.thickness, page);
  // The eraser's reach: what's under a fingertip, or the pen's own size.
  const reach = Math.max(10 / scale, thicknessToPoints(state.draw.pen.thickness, page));

  /** Where a pointer is on the page, through the plane's turn. */
  const toPage = (clientX: number, clientY: number): Pt => {
    const box = ref.current!.getBoundingClientRect();
    const vx = clientX - (box.left + box.width / 2);
    const vy = clientY - (box.top + box.height / 2);
    const rad = (page.rotation * Math.PI) / 180;
    const lx = vx * Math.cos(rad) + vy * Math.sin(rad);
    const ly = -vx * Math.sin(rad) + vy * Math.cos(rad);
    return { x: page.width / 2 + lx / scale, y: page.height / 2 - ly / scale };
  };

  const eraseAt = (p: Pt) => {
    const g = gesture.current;
    if (!g) return;
    const hits = page.overlays
      .filter((o): o is DrawOverlay => o.kind === 'draw' && !g.erased.has(o.id))
      .filter((o) => distanceToStroke(o, p) <= reach + o.strokeWidth / 2)
      .map((o) => o.id);
    if (!hits.length) return;
    hits.forEach((id) => g.erased.add(id));
    actions.eraseStrokes(hits, false);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    // A second finger mid-stroke is a pinch or a resting palm, not more
    // ink: the stroke in progress is dropped rather than zigzagged between
    // the two. A new first pointer of the same kind, though, means the last
    // one was let go where this never heard of it: this one draws.
    const g = gesture.current;
    if (g) {
      if (g.pointerId !== e.pointerId) {
        if (tool === 'eraser') {
          if (g.erased.size) actions.eraseStrokes([], true);
        }
        gesture.current = null;
        setPoints(null);
      }
      if (!(e.isPrimary && e.pointerType === g.pointerType && g.pointerId !== e.pointerId)) return;
    }
    safeSetPointerCapture(e.currentTarget as HTMLElement, e.pointerId);
    const p = toPage(e.clientX, e.clientY);
    gesture.current = { pointerId: e.pointerId, pointerType: e.pointerType, points: [p], erased: new Set() };
    if (tool === 'eraser') eraseAt(p);
    else setPoints([p]);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const p = toPage(e.clientX, e.clientY);
    if (tool === 'eraser') setHover(p);
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    e.stopPropagation();
    if (tool === 'eraser') {
      eraseAt(p);
      return;
    }
    // Every sample the pointer took since the last event, not just the
    // last one: a quick flick of the pen stays a curve.
    const native = e.nativeEvent as PointerEvent;
    const samples = native.getCoalescedEvents?.().map((s) => toPage(s.clientX, s.clientY)) ?? [];
    g.points.push(...(samples.length ? samples : [p]));
    setPoints([...g.points]);
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (tool === 'eraser') {
      if (g.erased.size) actions.eraseStrokes([], true);
      return;
    }
    setPoints(null);
    const stroke = strokeFromPoints(g.points, 0.75 / scale);
    if (stroke) actions.addStroke({ ...stroke, color: pen.color, strokeWidth: width, highlighter: tool === 'highlighter' });
  };

  const live = points && points.length ? svgPath(smoothSegments(points), (p) => ({ x: p.x, y: page.height - p.y })) : null;

  return (
    <div
      ref={ref}
      className={`draw-layer draw-layer-${tool}`}
      role="application"
      aria-label={t('draw.layerAria')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Multiplied into the page while it's drawn, as it will be once drawn. */}
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${page.width} ${page.height}`}
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible', mixBlendMode: tool === 'highlighter' ? 'multiply' : undefined }}
      >
        {live && (
          <path
            d={live}
            stroke={pen.color}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity={tool === 'highlighter' ? HIGHLIGHTER_OPACITY : 1}
          />
        )}
        {tool === 'eraser' && hover && (
          <circle cx={hover.x} cy={page.height - hover.y} r={reach} fill="rgba(255,255,255,.35)" stroke="var(--graphite)" strokeWidth={1.5 / scale} />
        )}
      </svg>
    </div>
  );
}
