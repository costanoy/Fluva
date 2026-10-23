import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useApp } from '../state/AppContext';
import { PageView } from '../components/PageView';
import { OverlayLayer } from '../components/OverlayLayer';
import { WatermarkPreview } from '../components/WatermarkPreview';
import { TextRunLayer } from '../components/TextRunLayer';
import { TextRunPreview } from '../components/TextRunPreview';
import { SplitPreview } from '../components/SplitPreview';
import { ReorderPreview } from '../components/ReorderPreview';
import { CropFrame } from '../components/CropFrame';
import { DrawLayer } from '../components/DrawLayer';
import { displaySize, imageEditsOf, isImagePage, NO_ADJUST, type WorkPage } from '../pdf/model';
import { aspectInPage } from '../pdf/crop';
import { withPhotoGeometry } from '../pdf/imageEdit';
import { pageEdits } from '../pdf/replacement';
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
  /** Where the next zoom change is centred, on screen: the point of the
   * page that was at `from` ends up at `to` — the pointer for the wheel (the
   * same point), the fingers for a pinch (which also move). Unset (the
   * toolbar's buttons), it's the middle of the view. */
  const zoomAnchor = useRef<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  const lastScale = useRef<number | null>(null);
  /** The scale asked for but maybe not drawn yet: a touchpad sends many
   * wheel events a frame, each one building on the last. */
  const wantedScale = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  /** Where the page was on screen after the last render. */
  const lastRect = useRef<DOMRect | null>(null);
  /** The fingers on the canvas, for a two-finger pinch. */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number; mid: { x: number; y: number } } | null>(null);
  /** Set while the zoom is changing: no transition then, so the page grows
   * from the anchor at once instead of sliding there afterwards. */
  const [zooming, setZooming] = useState(false);
  const zoomingTimer = useRef(0);

  const activePage = state.doc.pages[state.activePageIndex];
  const zoom = state.zoom;
  const draft = state.toolMode === 'crop' && state.cropDraft?.pageId === activePage?.id ? state.cropDraft : null;
  const photo = isImagePage(state.doc, activePage);

  // The page as it's shown: while cropping, whole and turned the way the
  // crop will turn it; while "compare" is held, without its light, colour
  // and filter.
  const page = useMemo((): WorkPage | undefined => {
    if (!activePage) return activePage;
    let shown = activePage;
    if (draft) {
      shown = { ...shown, crop: null, rotation: draft.rotation };
      // The blurred areas go along, the way applying the crop will move them.
      if (photo) shown = withPhotoGeometry(shown, { ...imageEditsOf(shown), flipH: draft.flipH, flipV: draft.flipV, straighten: draft.straighten });
    }
    if (state.comparing && shown.image) shown = { ...shown, image: { ...shown.image, filter: 'none', invert: false, adjust: NO_ADJUST } };
    return shown;
  }, [activePage, draft, photo, state.comparing]);

  // Text replacements are drawn into the page bitmap itself, by pdf.js, the
  // way the export writes them (see pageEdits) — so edited text shows in the
  // document's own font, rasterized like its neighbours. The overlay layer
  // leaves to the canvas whatever the canvas already shows; the overlay being
  // edited stays live until it's left.
  const edits = useMemo(() => (page ? pageEdits(page, state.selectedOverlayId) : []), [page, state.selectedOverlayId]);
  const editsSignature = useMemo(
    () =>
      JSON.stringify(
        edits.map((o) => (o.kind === 'text' ? [o.id, o.text, o.x, o.y, o.size, o.color] : o.kind === 'cover' ? [o.id, o.x, o.y, o.width, o.height] : [o.id])),
      ),
    [edits],
  );
  const [shownEdits, setShownEdits] = useState<string | null>(null);
  const baked = useMemo(() => new Set(shownEdits === editsSignature ? edits.map((o) => o.id) : []), [shownEdits, editsSignature, edits]);

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
  }, [state.activePageIndex, state.doc.name, state.toolMode === 'crop']);

  const shown = page ? displaySize(page) : { width: 1, height: 1 };
  const fitWidthScale = (available.width - CANVAS_PADDING * 2) / shown.width;
  // While cropping, the whole page has to be in view: its edges are what's
  // being moved (a portrait photo fitted to the width runs off the bottom).
  const fitScale = state.toolMode === 'crop' ? Math.min(fitWidthScale, (available.height - CANVAS_PADDING * 2) / shown.height) : fitWidthScale;
  const defaultScale = Number.isFinite(fitScale) && fitScale > 0 ? Math.min(fitScale, MAX_INITIAL_SCALE) : 1;
  const safeScale = clampScale(zoom ?? defaultScale);

  // The toolbar's zoom slider reads this back — it needs the resolved value,
  // not the raw override, since "null" (fit-to-width) has no fixed number.
  useEffect(() => {
    actions.setEffectiveZoom(safeScale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeScale]);

  // A zoom keeps its anchor in place: measured where the page was before and
  // where the new size put it, the page is moved so the point that was under
  // the anchor still is. Zoomed out until the page fits, it settles back in
  // the middle.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const area = containerRef.current;
    const prev = lastScale.current;
    const before = lastRect.current;
    lastScale.current = safeScale;
    wantedScale.current = null;
    if (!stage || !area) return;
    const now = stage.getBoundingClientRect();
    lastRect.current = now;
    if (prev === null || prev === safeScale || !before || !before.width || !before.height) return;
    const box = area.getBoundingClientRect();
    const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const { from, to } = zoomAnchor.current ?? { from: middle, to: middle };
    zoomAnchor.current = null;
    const zoomingOut = safeScale < prev;
    const fit = (size: number, areaStart: number, areaSize: number, want: number) => {
      // Zoomed out until it fits with its margins: in the middle. (Zooming
      // in, it grows from the anchor even while small — under the fingers
      // of a pinch, say — rather than jumping to the middle.)
      if (zoomingOut && size + CANVAS_PADDING * 2 <= areaSize) return areaStart + (areaSize - size) / 2;
      // Bigger: wherever the anchor puts it, as long as a good part of it
      // stays in view — a page zoomed in near its edge isn't pulled away
      // from the pointer, nor lost off screen.
      const visible = Math.min(size, areaSize) / 4;
      return Math.min(areaStart + areaSize - visible, Math.max(areaStart + visible - size, want));
    };
    const left = fit(now.width, box.left, box.width, to.x - ((from.x - before.left) / before.width) * now.width);
    const top = fit(now.height, box.top, box.height, to.y - ((from.y - before.top) / before.height) * now.height);
    const dx = left - now.left;
    const dy = top - now.top;
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    setZooming(true);
    window.clearTimeout(zoomingTimer.current);
    zoomingTimer.current = window.setTimeout(() => setZooming(false), 250);
  });

  useEffect(() => () => window.clearTimeout(zoomingTimer.current), []);

  // The wheel is listened to directly, not through React (whose wheel
  // listener can't stop the browser): a touchpad pinch arrives as a wheel
  // with Ctrl held, and would otherwise zoom the whole app instead of the page.
  const wheelHandler = useRef<(e: WheelEvent) => void>(() => {});
  const wheelTarget = useRef<HTMLElement | null>(null);
  const onWheelNative = useRef((e: WheelEvent) => wheelHandler.current(e)).current;
  useEffect(() => {
    const el = containerRef.current;
    if (el === wheelTarget.current) return;
    wheelTarget.current?.removeEventListener('wheel', onWheelNative);
    el?.addEventListener('wheel', onWheelNative, { passive: false });
    wheelTarget.current = el;
  });
  useEffect(
    () => () => {
      wheelTarget.current?.removeEventListener('wheel', onWheelNative);
      wheelTarget.current = null;
    },
    [onWheelNative],
  );

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

  wheelHandler.current = (e: WheelEvent) => {
    e.preventDefault();
    // Lines (Firefox's mouse wheel) to pixels.
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    const current = wantedScale.current ?? safeScale;
    const next = clampScale(current * Math.exp(-delta * 0.0018));
    if (next === current) return;
    const at = { x: e.clientX, y: e.clientY };
    zoomAnchor.current = { from: zoomAnchor.current?.from ?? at, to: at };
    wantedScale.current = next;
    actions.setZoom(next);
  };

  const pinchState = () => {
    const [a, b] = [...touches.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const handlePanPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // A second finger: the pan becomes a pinch.
      if (touches.current.size === 2) {
        const { dist, mid } = pinchState();
        pinch.current = { dist: Math.max(1, dist), scale: safeScale, mid };
        panDrag.current = null;
        didPanRef.current = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* the pinch tracks without it */
        }
        return;
      }
      if (touches.current.size > 2) return;
    }
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
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    if (p && touches.current.size >= 2) {
      const { dist, mid } = pinchState();
      // The page grows or shrinks around the fingers, and follows them.
      const current = wantedScale.current ?? safeScale;
      const next = clampScale((p.scale * dist) / p.dist);
      if (next !== current) {
        zoomAnchor.current = { from: zoomAnchor.current?.from ?? p.mid, to: mid };
        wantedScale.current = next;
        actions.setZoom(next);
      } else if (zoomAnchor.current) {
        zoomAnchor.current = { ...zoomAnchor.current, to: mid };
      } else {
        setPan((cur) => ({ x: cur.x + mid.x - p.mid.x, y: cur.y + mid.y - p.mid.y }));
      }
      p.mid = mid;
      return;
    }
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

  const handlePanPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    // The finger left after a pinch doesn't start a pan from where it is.
    if (pinch.current && touches.current.size < 2) pinch.current = null;
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
      className={`canvas-area${isPanning ? ' canvas-area-panning' : ''}${zooming || (lastScale.current !== null && lastScale.current !== safeScale) ? ' canvas-area-zooming' : ''}`}
      ref={containerRef}
      onClick={handleBackgroundClick}
      onPointerDown={handlePanPointerDown}
      onPointerMove={handlePanPointerMove}
      onPointerUp={handlePanPointerUp}
      onPointerCancel={handlePanPointerUp}
    >
      <div className="canvas-stage" ref={stageRef} style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
        <PageView
          page={page}
          source={page.sourceId ? state.doc.sources[page.sourceId] : undefined}
          scale={safeScale}
          className="doc-page"
          edits={edits.length ? { doc: state.doc, overlays: edits, signature: editsSignature } : undefined}
          onRendered={setShownEdits}
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
            baked={baked}
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
            baked={baked}
          />
          {state.toolMode === null && state.doc.kind === 'pdf' && <TextRunLayer page={page} scale={safeScale} />}
          {state.toolMode === 'draw' && <DrawLayer page={page} scale={safeScale} />}
          {draft && (
            <CropFrame
              page={page}
              rect={draft.rect}
              scale={safeScale}
              ratio={aspectInPage(draft.aspect, page, draft.rotation)}
              onChange={(rect) => actions.updateCropDraft({ rect })}
            />
          )}
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
