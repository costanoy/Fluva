import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useApp } from '../state/AppContext';
import { PageView } from '../components/PageView';
import { OverlayLayer } from '../components/OverlayLayer';
import { WatermarkPreview } from '../components/WatermarkPreview';
import { TextRunLayer } from '../components/TextRunLayer';
import { displaySize, type Rect } from '../pdf/model';
import { Button } from '../components/Button';
import '../styles/canvas.css';

/** Leaves room around the page so the drop shadow and crop handles are not clipped. */
const CANVAS_PADDING = 48;

export function EditorCanvas() {
  const { state, actions } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 800, height: 600 });

  const page = state.doc.pages[state.activePageIndex];

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

  if (!page) {
    return <div className="canvas-area" ref={containerRef} />;
  }

  const shown = displaySize(page);
  const scale = Math.min(
    (available.width - CANVAS_PADDING * 2) / shown.width,
    (available.height - CANVAS_PADDING * 2) / shown.height,
  );
  const safeScale = Number.isFinite(scale) && scale > 0 ? Math.min(scale, 2) : 0.5;

  const isCropping = state.cropDraft !== null;

  return (
    <div className="canvas-area" ref={containerRef} onClick={() => actions.selectOverlay(null)}>
      <div className="canvas-stage" onClick={(e) => e.stopPropagation()}>
        <PageView
          page={page}
          source={page.sourceId ? state.doc.sources[page.sourceId] : undefined}
          scale={safeScale}
          className="doc-page"
        >
          <WatermarkPreview page={page} watermark={state.doc.watermark} assets={state.doc.assets} scale={safeScale} isFirstPage={state.activePageIndex === 0} />
          <OverlayLayer
            page={page}
            assets={state.doc.assets}
            scale={safeScale}
            selectedId={state.selectedOverlayId}
            onSelect={actions.selectOverlay}
            onLiveChange={(id, patch) => actions.updateOverlay(id, patch, false)}
            onCommit={(id, patch) => actions.updateOverlay(id, patch, true)}
            interactive={!state.toolMode && !isCropping}
          />
          {state.toolMode === null && state.doc.kind === 'pdf' && (
            <TextRunLayer page={page} scale={safeScale} />
          )}
        </PageView>

        {isCropping && <CropOverlay page={page} scale={safeScale} />}
      </div>

      {page.crop && !isCropping && (
        <div className="canvas-badge">
          Página recortada
          <button onClick={actions.clearCrop}>desfazer recorte</button>
        </div>
      )}
    </div>
  );
}

/** Drag-to-crop rectangle drawn over the page, in page coordinates. */
function CropOverlay({ page, scale }: { page: { width: number; height: number; rotation: number }; scale: number }) {
  const { state, actions } = useApp();
  const draft = state.cropDraft;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number } | null>(null);

  const shown = displaySize(page as never);

  const toPagePoint = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const px = (clientX - rect.left) / scale;
      const py = (clientY - rect.top) / scale;
      return { x: px, y: shown.height - py };
    },
    [scale, shown.height],
  );

  const onPointerDown = (e: ReactPointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = toPagePoint(e.clientX, e.clientY);
    drag.current = { startX: p.x, startY: p.y };
    actions.setCropDraft({ x: p.x, y: p.y, width: 0, height: 0 });
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    const p = toPagePoint(e.clientX, e.clientY);
    actions.setCropDraft({
      x: Math.min(drag.current.startX, p.x),
      y: Math.min(drag.current.startY, p.y),
      width: Math.abs(p.x - drag.current.startX),
      height: Math.abs(p.y - drag.current.startY),
    });
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const hasArea = !!draft && draft.width > 4 && draft.height > 4;

  return (
    <>
      <div
        ref={ref}
        className="crop-surface"
        style={{ width: shown.width * scale, height: shown.height * scale }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {hasArea && (
          <div
            className="crop-rect"
            style={{
              left: draft!.x * scale,
              top: (shown.height - draft!.y - draft!.height) * scale,
              width: draft!.width * scale,
              height: draft!.height * scale,
            }}
          />
        )}
      </div>
      <div className="crop-actions">
        <span>{hasArea ? `${Math.round(draft!.width)} × ${Math.round(draft!.height)} pt` : 'Arraste sobre a página para definir o recorte'}</span>
        <Button onClick={() => actions.setCropDraft(null)}>Cancelar</Button>
        <Button variant="primary" disabled={!hasArea} onClick={actions.applyCrop}>
          Aplicar recorte
        </Button>
      </div>
    </>
  );
}

export type { Rect };
