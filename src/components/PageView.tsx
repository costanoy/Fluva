import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { DocumentState, Overlay, SourceDoc, WorkPage } from '../pdf/model';
import { displaySize } from '../pdf/model';
import { renderEditedPage, renderPageRaw } from '../pdf/render';
import { baseKey, changesPixels, redactionKey } from '../pdf/imageEdit';

/** The most pixels one page's canvas gets in the live view — plenty for a
 * sharp page on any screen, without a huge bitmap at extreme zoom. */
const VIEW_MAX_PIXELS = 24_000_000;

/**
 * Geometry shared by the page canvas and its overlay layer.
 *
 * The canvas always holds the full, unrotated page. Crop and rotation are applied
 * as one CSS transform on a "plane" that carries both the canvas and the overlays,
 * so a coordinate authored in page space lands in the same place in both.
 */
export function planeTransform(page: WorkPage, scale: number): CSSProperties {
  const crop = page.crop ?? { x: 0, y: 0, width: page.width, height: page.height };
  // Centre of the visible region, in CSS pixels relative to the full page plane.
  const cropCenterX = (crop.x + crop.width / 2) * scale;
  const cropCenterY = (page.height - crop.y - crop.height / 2) * scale;
  const dx = (page.width * scale) / 2 - cropCenterX;
  const dy = (page.height * scale) / 2 - cropCenterY;

  return {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: page.width * scale,
    height: page.height * scale,
    transformOrigin: 'center center',
    // Read right to left: park the crop centre on the plane centre, spin, then
    // centre the plane inside the viewport.
    transform: `translate(-50%, -50%) rotate(${page.rotation}deg) translate(${dx}px, ${dy}px)`,
  };
}

interface PageViewProps {
  page: WorkPage;
  source: SourceDoc | undefined;
  /** CSS pixels per PDF point. */
  scale: number;
  /** Rendered inside the plane, in page coordinate space. */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  /** Text replacements to draw into the page itself, as the export will
   * (see renderEditedPage) — `signature` identifies them. */
  edits?: { doc: DocumentState; overlays: Overlay[]; signature: string };
  /** Told which `edits` the canvas now shows (null: the plain page). */
  onRendered?: (signature: string | null) => void;
}

export function PageView({ page, source, scale, children, className, style, onClick, edits, onRendered }: PageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const shown = displaySize(page);
  const pageKeyRef = useRef<string | null>(null);
  const editsKeyRef = useRef<string | null>(null);
  const photoKeyRef = useRef<string | null>(null);
  // The latest edits and callback, read when a render starts — the effect
  // re-runs on their signature, not on every new document object.
  const latest = useRef({ edits, onRendered });
  latest.current = { edits, onRendered };
  const editsKey = edits?.overlays.length ? edits.signature : null;
  // What's been done to a photo page's own pixels (see imageEdit.ts).
  const photoKey = source?.kind === 'image' && changesPixels(page) ? `${baseKey(page)}#${redactionKey(page)}` : null;

  useEffect(() => {
    const pageKey = `${page.sourceId ?? ''}:${page.sourceIndex}:${page.id}`;
    const isFreshPage = pageKeyRef.current !== pageKey;
    pageKeyRef.current = pageKey;
    const editsChanged = editsKeyRef.current !== editsKey;
    editsKeyRef.current = editsKey;
    const photoChanged = photoKeyRef.current !== photoKey;
    photoKeyRef.current = photoKey;

    let cancelled = false;
    let settle = 0;
    if (isFreshPage) setReady(false);

    // Re-rasterizing on every intermediate step of a continuous wheel or
    // slider zoom pegs the main thread on every tick, which is what made
    // anything positioned via layout (left/top) — the selection ring in
    // particular — visibly stutter out of step with the page itself, which
    // stays smooth because it's only ever CSS-scaling the existing bitmap.
    // Debouncing the re-render (never the CSS transition) for a pure zoom
    // change keeps that same bitmap on screen, smoothly scaled, until the
    // zoom settles. A genuinely new page still swaps immediately — there's
    // no valid bitmap to fall back to, so nothing is gained by waiting.
    const delay = isFreshPage || editsChanged || photoChanged ? 0 : 120;
    // A photo whose slider is still moving is drawn small right away, then
    // sharp once it settles — at full size, every step would lag behind.
    const progressive = photoChanged && !isFreshPage && !!photoKey;
    // Drawn in device pixels, not CSS pixels: on a 125-200% display the page
    // used to be rendered at a fraction of the screen's resolution and scaled
    // up — soft next to anything the browser draws itself, edited text included.
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const pixels = Math.min(scale * dpr, Math.sqrt(VIEW_MAX_PIXELS / Math.max(1, page.width * page.height)));
    const draw = (fast: boolean) => {
      const { edits: current } = latest.current;
      const withEdits = !!editsKey && !!current;
      const render = withEdits
        ? renderEditedPage(current.doc, page, current.overlays, pixels).catch((err) => {
            console.warn('[Fluva] could not draw the edited page', err);
            return null;
          })
        : renderPageRaw(source, page, pixels, { fast });
      Promise.resolve(render)
        .then(async (rendered) => {
          const usable = rendered ?? (await renderPageRaw(source, page, pixels));
          if (cancelled) return;
          const target = canvasRef.current;
          if (!target) return;
          target.width = usable.width;
          target.height = usable.height;
          target.getContext('2d')!.drawImage(usable, 0, 0);
          setReady(true);
          latest.current.onRendered?.(rendered && withEdits ? editsKey : null);
        })
        .catch(() => {
          if (!cancelled) setReady(true);
        });
    };
    const timer = window.setTimeout(() => {
      draw(progressive);
      if (progressive) settle = window.setTimeout(() => draw(false), 220);
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(settle);
    };
    // Re-render only when the underlying bitmap would actually change.
  }, [source, page.id, page.sourceId, page.sourceIndex, page.width, page.height, scale, editsKey, photoKey]);

  return (
    <div
      className={className}
      onClick={onClick}
      style={{
        position: 'relative',
        overflow: 'hidden',
        width: shown.width * scale,
        height: shown.height * scale,
        background: '#FFFFFF',
        transition: 'width .16s ease-out, height .16s ease-out',
        ...style,
      }}
    >
      <div style={{ ...planeTransform(page, scale), transition: 'width .16s ease-out, height .16s ease-out, transform .16s ease-out' }}>
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: page.width * scale,
            height: page.height * scale,
            opacity: ready ? 1 : 0,
            transition: 'opacity .15s ease, width .16s ease-out, height .16s ease-out',
          }}
        />
        {children}
      </div>
    </div>
  );
}
