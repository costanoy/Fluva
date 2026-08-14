import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Move } from 'lucide-react';
import { TEXT_BASELINE_RATIO, TEXT_LINE_HEIGHT } from '../pdf/build';
import { familyByKey } from '../pdf/fonts';
import { safeSetPointerCapture, screenDeltaToPage } from './OverlayLayer';
import type { Rect, WorkPage } from '../pdf/model';
import { useApp } from '../state/AppContext';

/** How far the pointer has to move, in screen pixels, before a press on the
 * move handle counts as a drag rather than a plain tap. */
const DRAG_THRESHOLD = 4;

/**
 * Shows the in-progress text-run edit directly on the page, live, before the
 * user confirms it. It mirrors exactly what `replaceTextRun` will eventually
 * commit (same cover box, same anchor math) so nothing shifts when it does.
 */
export function TextRunPreview({ page, scale }: { page: WorkPage; scale: number }) {
  const { state, actions } = useApp();
  const target = state.textRunTarget;
  const draft = state.textRunDraft;
  const textRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });
  const [dragOffset, setDragOffset] = useState({ dx: 0, dy: 0 });
  const [isDraggingHandle, setIsDraggingHandle] = useState(false);

  // The text node is deliberately not React children (see below) — a
  // contentEditable div fights the caret every time React's diff touches its
  // text node, which is what made edits revert and made the second keystroke
  // of a fresh edit jump to the start of the line. The DOM owns the live
  // content while focused; this only pushes changes that came from elsewhere
  // (the side panel's font/size controls don't touch text, but a fresh
  // target does) — never while the element itself is focused.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || !draft) return;
    if (document.activeElement === el) return;
    if (el.textContent !== draft.text) el.textContent = draft.text;
  }, [draft?.text]);

  if (!target || !draft) return null;

  const handleInput = (e: FormEvent<HTMLDivElement>) => {
    actions.setTextRunDraft({ text: e.currentTarget.textContent ?? '' });
  };

  // A bare Enter would let the browser insert a <div>/<br>, which fights the
  // plain-text sync above — inserting a literal newline character instead
  // keeps the DOM a single text node, matching draft.text.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    document.execCommand('insertText', false, '\n');
  };

  // Clicking the draft text (to place a caret) shouldn't bubble out to the
  // canvas's "click outside closes the panel" handler.
  const stopClick = (e: MouseEvent) => e.stopPropagation();

  const bounds: Rect = { x: target.x, y: target.y, width: target.width, height: target.height };

  /**
   * The move handle supports two gestures in one:
   *  - A plain press-and-release (no real movement) behaves like before —
   *    commit the replacement and drop into "Movendo texto" mode, so the
   *    text can still be dragged by grabbing it directly afterward.
   *  - A press-and-drag moves the draft live, right from the handle, and
   *    commits the replacement already at the dragged position — no second
   *    drag needed once it lands. This is the gesture that was missing:
   *    holding the handle only ever toggled the mode, it never itself moved
   *    anything.
   */
  const handlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    safeSetPointerCapture(e.currentTarget, e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false };
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dxScreen = e.clientX - drag.startX;
    const dyScreen = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(dxScreen) < DRAG_THRESHOLD && Math.abs(dyScreen) < DRAG_THRESHOLD) return;
      drag.moved = true;
      setIsDraggingHandle(true);
    }
    const next = screenDeltaToPage(dxScreen, dyScreen, page.rotation, scale);
    dragOffsetRef.current = next;
    setDragOffset(next);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const drag = dragRef.current;
    dragRef.current = null;
    setIsDraggingHandle(false);
    if (drag?.moved) {
      // Committed already at the dragged position — no need for the
      // separate "Movendo texto" mode afterward, the move already happened.
      actions.replaceTextRun(bounds, draft.text, draft.fontKey, draft.size, draft.bold, draft.italic, false, dragOffsetRef.current);
      dragOffsetRef.current = { dx: 0, dy: 0 };
      setDragOffset({ dx: 0, dy: 0 });
    } else {
      actions.replaceTextRun(bounds, draft.text, draft.fontKey, draft.size, draft.bold, draft.italic, true);
    }
  };

  const coverX = target.x - 1;
  const coverY = target.y - 1;
  const coverW = target.width + 2;
  const coverH = target.height + 2;

  const textX = target.x + dragOffset.dx;
  // Same recovery as replaceTextRun: target.y is the original run's own top
  // (baseline minus 20% of ITS font size), not the new draft's. Reconstructing
  // the real baseline and re-adding the draft's own drop keeps the preview
  // anchored exactly where the original glyphs sat, however different its
  // size is — plus whatever the move handle's own drag has added on top.
  const originalBaseline = target.y + target.height / 6;
  const textY = originalBaseline + draft.size * TEXT_BASELINE_RATIO + dragOffset.dy;
  const family = familyByKey(draft.fontKey);
  // Matches OverlayLayer's overlays, so the preview keeps pace with the page
  // during a zoom instead of jumping to each new size a beat behind it.
  // Suppressed while actively dragging the handle, same as OverlayLayer does
  // for its own drags — otherwise every pointermove would animate toward its
  // target instead of tracking the cursor immediately.
  const smoothTransition = isDraggingHandle
    ? 'none'
    : 'left .16s ease-out, top .16s ease-out, width .16s ease-out, height .16s ease-out, font-size .16s ease-out';

  return (
    <>
      <div
        onClick={stopClick}
        style={{
          position: 'absolute',
          left: coverX * scale,
          top: (page.height - coverY - coverH) * scale,
          width: coverW * scale,
          height: coverH * scale,
          background: '#FFFFFF',
          // The same selection ring committed overlays get once selected —
          // without it, this cover's own opaque white paints directly over
          // TextRunLayer's highlighted `.text-run-selected` state underneath,
          // so nothing on screen showed which run was actually being edited
          // until the first drag or commit turned it into a real overlay.
          boxShadow: '0 0 0 2px var(--color-accent)',
          pointerEvents: 'none',
          transition: smoothTransition,
        }}
      />
      <div
        ref={textRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onClick={stopClick}
        style={{
          position: 'absolute',
          left: textX * scale,
          top: (page.height - textY) * scale,
          fontFamily: family.cssFamily,
          fontSize: draft.size * scale,
          lineHeight: TEXT_LINE_HEIGHT,
          fontWeight: draft.bold ? 700 : 400,
          fontStyle: draft.italic ? 'italic' : 'normal',
          color: '#2C2C2A',
          whiteSpace: 'pre',
          cursor: 'text',
          outline: 'none',
          transition: smoothTransition,
        }}
      />
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={stopClick}
        title="Segure e arraste para mover"
        aria-label="Mover texto"
        style={{
          position: 'absolute',
          // Anchored to the original run's own corner (not the draft's), plus
          // the handle's own drag offset — a bigger target than the 20px
          // circle this used to be, since that was easy to miss by a few
          // pixels and land on the text or the page behind it instead.
          left: (coverX + coverW + dragOffset.dx) * scale - 14,
          top: (page.height - (coverY + dragOffset.dy)) * scale - 14,
          width: 28,
          height: 28,
          padding: 0,
          borderRadius: '50%',
          border: '2px solid #FFFFFF',
          background: 'var(--color-accent)',
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: isDraggingHandle ? 'grabbing' : 'grab',
          boxShadow: 'var(--shadow-sm)',
          touchAction: 'none',
          transition: smoothTransition,
        }}
      >
        <Move size={14} strokeWidth={2.75} />
      </button>
    </>
  );
}
