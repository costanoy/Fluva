import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { useApp } from '../state/AppContext';
import { PageView } from '../components/PageView';
import { OverlayLayer } from '../components/OverlayLayer';
import { WatermarkPreview } from '../components/WatermarkPreview';
import { TextRunLayer } from '../components/TextRunLayer';
import { TextRunPreview } from '../components/TextRunPreview';
import { SplitPreview } from '../components/SplitPreview';
import { ReorderPreview } from '../components/ReorderPreview';
import { displaySize } from '../pdf/model';
import '../styles/canvas.css';

/** Leaves room around the page so the drop shadow and crop handles are not clipped. */
const CANVAS_PADDING = 48;
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 5;
/** Caps how large the opening zoom can get on very wide windows. */
const MAX_INITIAL_SCALE = 2.4;
const clampScale = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

/** How far the pointer has to move before a press counts as a pan, not a click. */
const DRAG_THRESHOLD = 4;

export function EditorCanvas() {
  const { state, actions } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 800, height: 600 });
  // Manual pan offset — the canvas doesn't scroll natively, the user drags the
  // document itself to reposition it.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panDrag = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  // A real pan still ends in a native `click` on release — this flags that click
  // so the background-click handler below can ignore it instead of clearing the
  // selection the user was never trying to change.
  const didPanRef = useRef(false);

  const page = state.doc.pages[state.activePageIndex];
  const zoom = state.zoom;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setAvailable({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    setAvailable({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  // A newly opened document starts zoomed to fill the available width, so the
  // text is legible right away instead of shrunk down to fit the whole page.
  useEffect(() => {
    actions.setZoom(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.doc.name]);

  // Each page starts centred again — a pan offset left over from another page
  // could otherwise put the freshly opened one off-screen.
  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [state.activePageIndex, state.doc.name]);

  const shown = page ? displaySize(page) : { width: 1, height: 1 };
  const fitWidthScale = (available.width - CANVAS_PADDING * 2) / shown.width;
  const defaultScale = Number.isFinite(fitWidthScale) && fitWidthScale > 0 ? Math.min(fitWidthScale, MAX_INITIAL_SCALE) : 1;
  const safeScale = clampScale(zoom ?? defaultScale);

  // The toolbar's zoom slider reads this back — it needs the resolved value,
  // not the raw override, since "null" (fit-to-width) has no fixed number.
  useEffect(() => {
    actions.setEffectiveZoom(safeScale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeScale]);

  // The split and reorder tools replace the normal single-page editing view
  // entirely — split with a live preview of how the chosen split will come
  // apart, reorder with a draggable grid of every page — showing just the
  // current page here would be misleading for either.
  if (state.toolMode === 'split') {
    return <SplitPreview />;
  }
  if (state.toolMode === 'reorder') {
    return <ReorderPreview />;
  }

  if (!page) {
    return <div className="canvas-area" ref={containerRef} />;
  }

  const handleWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0018);
    actions.setZoom(clampScale(safeScale * factor));
  };

  const handlePanPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Left mouse button (or touch/pen) only.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Pointer capture is deliberately NOT taken here yet. Capturing immediately
    // redirects the click that would otherwise land on whatever was pressed (a
    // text run, a button) to this element instead, silently breaking it. Capture
    // is deferred to the first real move, so a plain click still reaches its
    // target and only a genuine drag turns into a pan.
    panDrag.current = { startX: e.clientX, startY: e.clientY, originX: pan.x, originY: pan.y, moved: false };
  };

  const handlePanPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panDrag.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      didPanRef.current = true;
      setIsPanning(true);
      // Capture can reject a stale/synthetic pointer id; the pan itself doesn't
      // depend on it, so a rejection here shouldn't stop the drag from tracking.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* not fatal — see comment above */
      }
    }
    setPan({ x: drag.originX + dx, y: drag.originY + dy });
  };

  const handlePanPointerUp = () => {
    panDrag.current = null;
    setIsPanning(false);
  };

  // Every overlay and text run stops its own click from bubbling this far, so
  // reaching here means the click landed on blank page — return the side panel
  // to its default state, exactly like pressing the browser's own deselect. Any
  // text run being edited is saved first, so leaving never silently drops it.
  const handleBackgroundClick = () => {
    if (didPanRef.current) {
      didPanRef.current = false;
      return;
    }
    actions.commitPendingTextRunEdit();
    actions.selectOverlay(null);
  };

  // Selecting a different overlay is also "leaving" whatever text run was being
  // edited — save it first instead of silently discarding it.
  const handleOverlaySelect = (id: string | null) => {
    actions.commitPendingTextRunEdit();
    actions.selectOverlay(id);
  };

  return (
    <div
      className={`canvas-area${isPanning ? ' canvas-area-panning' : ''}`}
      ref={containerRef}
      onClick={handleBackgroundClick}
      onWheel={handleWheel}
      onPointerDown={handlePanPointerDown}
      onPointerMove={handlePanPointerMove}
      onPointerUp={handlePanPointerUp}
      onPointerCancel={handlePanPointerUp}
    >
      <div className="canvas-stage" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
        <PageView
          page={page}
          source={page.sourceId ? state.doc.sources[page.sourceId] : undefined}
          scale={safeScale}
          className="doc-page"
        >
          {/* Covers exist only to blank out stale original PDF text, not to
              block the watermark — painting them below it (and everything
              else above it) lets the watermark show straight through a
              cover instead of leaving a plain white rectangle over it. */}
          <OverlayLayer
            page={page}
            overlays={page.overlays.filter((o) => o.kind === 'cover')}
            assets={state.doc.assets}
            scale={safeScale}
            selectedId={state.selectedOverlayId}
            onSelect={handleOverlaySelect}
            onLiveChange={(id, patch) => actions.updateOverlay(id, patch, false)}
            onCommit={(id, patch) => actions.updateOverlay(id, patch, true)}
            interactive={!state.toolMode}
          />
          <WatermarkPreview
            page={page}
            watermark={state.doc.watermark}
            assets={state.doc.assets}
            scale={safeScale}
            isTargetPage={state.activePageIndex === state.doc.watermark.singlePageIndex}
          />
          <OverlayLayer
            page={page}
            overlays={page.overlays.filter((o) => o.kind !== 'cover')}
            assets={state.doc.assets}
            scale={safeScale}
            selectedId={state.selectedOverlayId}
            onSelect={handleOverlaySelect}
            onLiveChange={(id, patch) => actions.updateOverlay(id, patch, false)}
            onCommit={(id, patch) => actions.updateOverlay(id, patch, true)}
            interactive={!state.toolMode}
          />
          {state.toolMode === null && state.doc.kind === 'pdf' && <TextRunLayer page={page} scale={safeScale} />}
          {/* Keyed by the target run so switching to a different run remounts
              fresh at its own spot instead of animating a slide between the two
              — the smooth transition should only ever apply within one run
              (e.g. across a zoom change), never across a selection change. */}
          <TextRunPreview key={state.textRunTarget?.id ?? 'none'} page={page} scale={safeScale} />
        </PageView>
      </div>
    </div>
  );
}
