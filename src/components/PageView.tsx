import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { SourceDoc, WorkPage } from '../pdf/model';
import { displaySize } from '../pdf/model';
import { renderPageRaw } from '../pdf/render';

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
}

export function PageView({ page, source, scale, children, className, style, onClick }: PageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const shown = displaySize(page);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    renderPageRaw(source, page, scale)
      .then((rendered) => {
        if (cancelled) return;
        const target = canvasRef.current;
        if (!target) return;
        target.width = rendered.width;
        target.height = rendered.height;
        target.getContext('2d')!.drawImage(rendered, 0, 0);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
    // Re-render only when the underlying bitmap would actually change.
  }, [source, page.id, page.sourceId, page.sourceIndex, page.width, page.height, scale]);

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
