import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Rect, WorkPage } from '../pdf/model';
import { CROP_HANDLES, moveCrop, resizeCrop, type CropHandle } from '../pdf/crop';
import { safeSetPointerCapture, screenDeltaToPage } from './OverlayLayer';
import { t } from '../i18n/translations';

interface CropFrameProps {
  /** The page as shown while cropping: whole, turned the way the crop will be. */
  page: WorkPage;
  rect: Rect;
  scale: number;
  /** Width over height the box keeps (page space), or null for any. */
  ratio: number | null;
  onChange: (rect: Rect) => void;
}

/**
 * The crop box over the whole page: dragged inside to move it, by its sides
 * and corners to size it, with the rule-of-thirds grid while it's held. The
 * rest of the page is dimmed — that's what the crop cuts away. Lives in
 * page space inside the page's plane, so it turns along with the page.
 */
export function CropFrame({ page, rect, scale, ratio, onChange }: CropFrameProps) {
  const drag = useRef<{ handle: CropHandle | 'move'; startX: number; startY: number; start: Rect } | null>(null);
  const [active, setActive] = useState(false);

  const begin = (handle: CropHandle | 'move') => (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    safeSetPointerCapture(e.currentTarget as HTMLElement, e.pointerId);
    drag.current = { handle, startX: e.clientX, startY: e.clientY, start: rect };
    setActive(true);
  };

  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    const { dx, dy } = screenDeltaToPage(e.clientX - d.startX, e.clientY - d.startY, page.rotation, scale);
    onChange(d.handle === 'move' ? moveCrop(d.start, dx, dy, page) : resizeCrop(d.start, d.handle, dx, dy, ratio, page));
  };

  const end = () => {
    drag.current = null;
    setActive(false);
  };

  // Arrow keys nudge the box (Shift: ten times as far), as the page is seen.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = steps[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const px = (e.shiftKey ? 10 : 1) * Math.max(1, Math.min(page.width, page.height) / 200) * scale;
    const { dx, dy } = screenDeltaToPage(step[0] * px, step[1] * px, page.rotation, scale);
    onChange(moveCrop(rect, dx, dy, page));
  };

  const pointer = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };

  return (
    <div
      className={`crop-frame${active ? ' crop-frame-active' : ''}`}
      style={{
        left: rect.x * scale,
        top: (page.height - rect.y - rect.height) * scale,
        width: rect.width * scale,
        height: rect.height * scale,
      }}
      tabIndex={0}
      role="group"
      aria-label={t('crop.frameAria')}
      onPointerDown={begin('move')}
      {...pointer}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="crop-grid" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      {CROP_HANDLES.map((handle) => (
        <div key={handle} className={`crop-handle crop-handle-${handle}`} onPointerDown={begin(handle)} {...pointer} />
      ))}
    </div>
  );
}
