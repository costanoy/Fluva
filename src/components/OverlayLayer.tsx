import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Move } from 'lucide-react';
import type { ImageAsset, Overlay, WorkPage } from '../pdf/model';
import { TEXT_LINE_HEIGHT } from '../pdf/build';
import { familyByKey } from '../pdf/fonts';
import { useApp } from '../state/AppContext';
import { t } from '../i18n/translations';

/** Height a text overlay occupies, in points. */
export function textOverlayHeight(overlay: Extract<Overlay, { kind: 'text' }>): number {
  const lines = Math.max(1, overlay.text.split('\n').length);
  return lines * overlay.size * TEXT_LINE_HEIGHT;
}

export function overlayBox(overlay: Overlay): { x: number; y: number; width: number; height: number } {
  if (overlay.kind === 'text') {
    // Width is only needed for hit-testing, so a generous estimate is fine; the
    // element itself sizes to its content.
    const longest = overlay.text.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
    return { x: overlay.x, y: overlay.y, width: longest * overlay.size * 0.55, height: textOverlayHeight(overlay) };
  }
  return { x: overlay.x, y: overlay.y, width: overlay.width, height: overlay.height };
}

/**
 * Converts a pointer movement on screen into a movement in page space.
 * The plane is rotated by the page rotation, so screen deltas must be un-rotated
 * before they mean anything in page coordinates.
 */
/** Capture can reject a stale/synthetic pointer id; the drag itself doesn't
 * depend on it succeeding, so a rejection shouldn't stop the gesture. */
export function safeSetPointerCapture(el: HTMLElement, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* not fatal — see comment above */
  }
}

/** The very click that selects a text overlay lands before React has turned
 * `contentEditable` on for it, so the browser's own caret placement misses it.
 * Placing the caret manually, at the same point the user actually clicked,
 * makes the first click behave exactly like every click after it. */
function placeCaretAt(el: HTMLElement, clientX: number, clientY: number) {
  el.focus();
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let range: Range | null = null;
  if (doc.caretRangeFromPoint) {
    range = doc.caretRangeFromPoint(clientX, clientY);
  } else if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(clientX, clientY);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }
  if (!range) return;
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export function screenDeltaToPage(dxScreen: number, dyScreen: number, rotationDeg: number, scale: number) {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const planeDx = dxScreen * cos + dyScreen * sin;
  const planeDy = -dxScreen * sin + dyScreen * cos;
  // Page space has its origin bottom-left, so downward screen movement lowers y.
  return { dx: planeDx / scale, dy: -planeDy / scale };
}

interface OverlayLayerProps {
  page: WorkPage;
  /** Defaults to `page.overlays` — callers pass a filtered subset to split
   * rendering into layers (see EditorCanvas.tsx, which paints 'cover'
   * overlays in one pass below the watermark and everything else above it). */
  overlays?: Overlay[];
  assets: Record<string, ImageAsset>;
  scale: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Live update while dragging; history is only recorded on release. */
  onLiveChange: (id: string, patch: Partial<Overlay>) => void;
  onCommit: (id: string, patch: Partial<Overlay>) => void;
  interactive: boolean;
}

export function OverlayLayer({ page, overlays, assets, scale, selectedId, onSelect, onLiveChange, onCommit, interactive }: OverlayLayerProps) {
  return (
    <>
      {(overlays ?? page.overlays).map((overlay) => (
        <OverlayItem
          key={overlay.id}
          overlay={overlay}
          page={page}
          assets={assets}
          scale={scale}
          selected={selectedId === overlay.id}
          onSelect={onSelect}
          onLiveChange={onLiveChange}
          onCommit={onCommit}
          interactive={interactive}
        />
      ))}
    </>
  );
}

interface OverlayItemProps extends Omit<OverlayLayerProps, 'selectedId'> {
  overlay: Overlay;
  selected: boolean;
}

function OverlayItem({ overlay, page, assets, scale, selected, onSelect, onLiveChange, onCommit, interactive }: OverlayItemProps) {
  const { state, actions } = useApp();
  const box = overlayBox(overlay);
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; w: number; h: number; y: number } | null>(null);
  const [latest, setLatest] = useState<Partial<Overlay> | null>(null);
  // Suppress the position/size transition while actively dragging or resizing —
  // otherwise every pointermove would animate toward its target instead of
  // tracking the cursor immediately. The rest of the time (in particular, while
  // the page itself is smoothly resizing for a zoom change) it stays on, so the
  // overlay moves in step with the page instead of snapping to each new spot.
  const [isInteracting, setIsInteracting] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  // Hooks must run on every render, so the asset URL is resolved before any
  // kind-specific branching below.
  const imageSrc = useAssetUrl(overlay.kind === 'image' ? assets[overlay.assetId] : undefined);
  const isMovingThis = overlay.kind === 'text' && state.movingOverlayId === overlay.id;

  // The text node is intentionally left out of React's children (see the text
  // branch below) — a contentEditable div fights the caret every time React's
  // own diff decides to touch its text node, which is what caused edits to
  // revert and the second keystroke of a fresh edit to jump to the start of the
  // line. The DOM owns the live content while the user types; this effect only
  // pushes changes that came from elsewhere (undo/redo, the side panel, a fresh
  // selection) — never while the element itself is focused, so it can't fight
  // the caret it doesn't own at that moment.
  useLayoutEffect(() => {
    if (overlay.kind !== 'text') return;
    const el = textRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.textContent !== overlay.text) el.textContent = overlay.text;
  }, [overlay.kind, overlay.kind === 'text' ? overlay.text : null]);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!interactive) return;
      e.stopPropagation();
      const wasSelected = selected;
      onSelect(overlay.id);
      if (overlay.kind === 'text' && !isMovingThis) {
        // Outside of "Mover texto" mode, a press on a text overlay never starts
        // a drag — it either places a caret (handled below) or, if the pointer
        // moves, lets the browser do its own native click-drag text selection.
        // Repositioning only happens through the dedicated move mode.
        if (!wasSelected) {
          // This click is what just turned contentEditable on, so the browser's
          // own click-to-caret never had anything to land on — place it
          // ourselves once the DOM has that attribute (next tick).
          const { clientX, clientY } = e;
          setTimeout(() => {
            const el = textRef.current;
            if (el) placeCaretAt(el, clientX, clientY);
          }, 0);
        }
        return;
      }
      safeSetPointerCapture(e.target as HTMLElement, e.pointerId);
      dragState.current = { startX: e.clientX, startY: e.clientY, originX: overlay.x, originY: overlay.y };
      setIsInteracting(true);
    },
    [interactive, onSelect, overlay.id, overlay.kind, overlay.x, overlay.y, selected, isMovingThis],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (resizeState.current) {
        const { dx, dy } = screenDeltaToPage(
          e.clientX - resizeState.current.startX,
          e.clientY - resizeState.current.startY,
          page.rotation,
          scale,
        );
        const width = Math.max(8, resizeState.current.w + dx);
        const height = Math.max(8, resizeState.current.h - dy);
        // The handle sits at the box's bottom-right corner, but `y` is the box's
        // bottom edge in page space — independent of height. Left unadjusted, the
        // top edge would silently drift instead of the handle following the
        // cursor. Re-deriving y from the fixed top (y + h) keeps that corner
        // anchored, exactly as if the handle were the point being dragged.
        const top = resizeState.current.y + resizeState.current.h;
        const patch = { width, height, y: top - height } as Partial<Overlay>;
        setLatest(patch);
        onLiveChange(overlay.id, patch);
        return;
      }
      if (!dragState.current) return;
      const { dx, dy } = screenDeltaToPage(
        e.clientX - dragState.current.startX,
        e.clientY - dragState.current.startY,
        page.rotation,
        scale,
      );
      const patch = { x: dragState.current.originX + dx, y: dragState.current.originY + dy } as Partial<Overlay>;
      setLatest(patch);
      onLiveChange(overlay.id, patch);
    },
    [onLiveChange, overlay.id, page.rotation, scale],
  );

  const handlePointerUp = useCallback(() => {
    if ((dragState.current || resizeState.current) && latest) onCommit(overlay.id, latest);
    dragState.current = null;
    resizeState.current = null;
    setLatest(null);
    setIsInteracting(false);
  }, [latest, onCommit, overlay.id]);

  /**
   * The little move handle at a selected text overlay's corner — same idea as
   * TextRunPreview's own handle, now that the run has already been committed.
   * Its press always starts a drag straight away (unlike pressing the text
   * itself, which places a caret outside of "Mover texto" mode) by going
   * straight to the same drag-tracking `handlePointerDown`'s text branch
   * would only reach once already in that mode.
   */
  const handleMoveHandlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!interactive) return;
      e.stopPropagation();
      safeSetPointerCapture(e.currentTarget as HTMLElement, e.pointerId);
      dragState.current = { startX: e.clientX, startY: e.clientY, originX: overlay.x, originY: overlay.y };
      setIsInteracting(true);
    },
    [interactive, overlay.x, overlay.y],
  );

  // A press-and-drag commits the new position exactly like any other drag —
  // `handlePointerUp` already does that. A plain tap (no movement) instead
  // drops into "Mover texto" mode, so grabbing the text body itself works
  // right after, matching the handle's behavior before this run was replaced.
  const handleMoveHandlePointerUp = useCallback(() => {
    const moved = !!latest;
    handlePointerUp();
    if (!moved) actions.setMovingOverlay(overlay.id);
  }, [latest, handlePointerUp, actions, overlay.id]);

  const handleTextInput = useCallback(
    (e: ReactFormEvent<HTMLDivElement>) => {
      onLiveChange(overlay.id, { text: e.currentTarget.textContent ?? '' } as Partial<Overlay>);
    },
    [onLiveChange, overlay.id],
  );

  const handleTextBlur = useCallback(
    (e: ReactFocusEvent<HTMLDivElement>) => {
      onCommit(overlay.id, { text: e.currentTarget.textContent ?? '' } as Partial<Overlay>);
    },
    [onCommit, overlay.id],
  );

  const handleTextKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    // A bare Enter would otherwise let the browser insert a <div>/<br>, which
    // fights React's plain-text children on the next render. Inserting a literal
    // newline character keeps the DOM a single text node, matching overlay.text.
    if (e.key !== 'Enter') return;
    e.preventDefault();
    document.execCommand('insertText', false, '\n');
  }, []);

  const startResize = useCallback(
    (e: ReactPointerEvent) => {
      if (overlay.kind === 'text' || overlay.kind === 'cover') return;
      e.stopPropagation();
      safeSetPointerCapture(e.target as HTMLElement, e.pointerId);
      resizeState.current = { startX: e.clientX, startY: e.clientY, w: overlay.width, h: overlay.height, y: overlay.y };
      setIsInteracting(true);
    },
    [overlay],
  );

  // Covers are static backdrops and carry no rotation of their own.
  const ownRotation = overlay.kind === 'cover' ? 0 : overlay.rotation;

  // While the page smoothly resizes for a zoom change, the overlay's own
  // position/size follow along at the same pace instead of snapping straight
  // to each new value — that snap-vs-glide mismatch was what made edited text
  // look like it was "wobbling" during a zoom. Dragging or resizing needs the
  // opposite: zero delay, so it tracks the cursor exactly — hence gating this
  // on isInteracting rather than always applying it.
  const smoothTransition = isInteracting
    ? 'none'
    : 'left .16s ease-out, top .16s ease-out, width .16s ease-out, height .16s ease-out, font-size .16s ease-out';

  const base: CSSProperties = {
    position: 'absolute',
    left: box.x * scale,
    top: (page.height - box.y) * scale,
    transform: `rotate(${-ownRotation}deg)`,
    // Text hangs from its top-left; boxes pivot on their bottom-left corner, which
    // is the anchor pdf-lib rotates them about when the file is written.
    transformOrigin: overlay.kind === 'text' ? 'top left' : 'bottom left',
    cursor: interactive ? 'move' : 'default',
    // A box-shadow ring, not an outline — outline is painted on a separate pass
    // in some browsers and visibly lags a box that's continuously reflowing
    // (as text does while its font-size transitions during a zoom), which is
    // what made the selection ring look glitchy. box-shadow paints with the
    // box itself, so it tracks it exactly, every frame.
    boxShadow: selected ? '0 0 0 2px var(--color-accent)' : 'none',
    touchAction: 'none',
    transition: smoothTransition,
  };

  const pointerHandlers = interactive
    ? { onPointerDown: handlePointerDown, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp, onPointerCancel: handlePointerUp }
    : {};

  if (overlay.kind === 'cover') {
    return (
      <div
        style={{
          position: 'absolute',
          left: overlay.x * scale,
          top: (page.height - overlay.y - overlay.height) * scale,
          width: overlay.width * scale,
          height: overlay.height * scale,
          background: overlay.color,
          pointerEvents: 'none',
          transition: smoothTransition,
        }}
      />
    );
  }

  if (overlay.kind === 'text') {
    const family = familyByKey(overlay.fontKey);
    // Once selected (and not being dragged via "Mover texto"), the text is
    // editable right where it sits — a plain click lands the caret, so the side
    // panel's textarea is a convenience, not the only way in. The text node
    // itself is intentionally NOT passed as JSX children (see the sync effect
    // above) — it's owned by the DOM while mounted, not re-rendered from state.
    const editable = selected && interactive && !isMovingThis;
    return (
      // A plain positioning shell around the text, sized to fit it exactly
      // (no width/height of its own) — the move handle below anchors to its
      // corner via `right`/`bottom`, which tracks the text's real rendered
      // size for free, in CSS, without measuring anything in JS every time
      // the content, font or size changes.
      <div
        style={{
          position: 'absolute',
          left: base.left,
          top: base.top,
          transform: `rotate(${-overlay.rotation}deg)`,
          transformOrigin: base.transformOrigin,
          transition: smoothTransition,
        }}
      >
        <div
          {...pointerHandlers}
          onClick={(e) => e.stopPropagation()}
          ref={textRef}
          contentEditable={editable}
          suppressContentEditableWarning
          onInput={editable ? handleTextInput : undefined}
          onBlur={editable ? handleTextBlur : undefined}
          onKeyDown={editable ? handleTextKeyDown : undefined}
          style={{
            fontFamily: family.cssFamily,
            fontSize: overlay.size * scale,
            lineHeight: TEXT_LINE_HEIGHT,
            fontWeight: overlay.bold ? 700 : 400,
            fontStyle: overlay.italic ? 'italic' : 'normal',
            color: overlay.color,
            whiteSpace: 'pre',
            userSelect: editable ? 'text' : 'none',
            cursor: editable ? 'text' : base.cursor,
            boxShadow: base.boxShadow,
            touchAction: base.touchAction,
            // The wrapper transitions left/top for the same zoom-follow reason
            // — without this too, font-size would jump to each new step
            // instantly while position glides, the mismatch that made edited
            // text look like it was wobbling during a zoom.
            transition: smoothTransition,
          }}
        />
        {selected && interactive && (
          <button
            type="button"
            onPointerDown={handleMoveHandlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handleMoveHandlePointerUp}
            onPointerCancel={handleMoveHandlePointerUp}
            onClick={(e) => e.stopPropagation()}
            title={t('run.moveHandleTitle')}
            aria-label={t('run.moveHandleAria')}
            style={{
              position: 'absolute',
              right: -14,
              bottom: -14,
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
              cursor: isInteracting ? 'grabbing' : 'grab',
              boxShadow: 'var(--shadow-sm)',
              touchAction: 'none',
            }}
          >
            <Move size={14} strokeWidth={2.75} />
          </button>
        )}
      </div>
    );
  }

  if (overlay.kind === 'image') {
    return (
      <div
        {...pointerHandlers}
        onClick={(e) => e.stopPropagation()}
        style={{
          ...base,
          top: (page.height - overlay.y - overlay.height) * scale,
          width: overlay.width * scale,
          height: overlay.height * scale,
        }}
      >
        {imageSrc && <img src={imageSrc} alt="" draggable={false} style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill' }} />}
        {selected && interactive && <ResizeHandle onPointerDown={startResize} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />}
      </div>
    );
  }

  return (
    <div
      {...pointerHandlers}
      onClick={(e) => e.stopPropagation()}
      style={{
        ...base,
        top: (page.height - overlay.y - overlay.height) * scale,
        width: overlay.width * scale,
        height: overlay.height * scale,
        background: overlay.color,
        borderRadius: overlay.shape === 'circle' ? '50%' : 0,
      }}
    >
      {selected && interactive && <ResizeHandle onPointerDown={startResize} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />}
    </div>
  );
}

function ResizeHandle(props: {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
}) {
  return (
    <div
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerUp}
      style={{
        position: 'absolute',
        right: -7,
        bottom: -7,
        width: 14,
        height: 14,
        borderRadius: 3,
        background: 'var(--color-accent)',
        border: '2px solid #FFFFFF',
        cursor: 'nwse-resize',
        touchAction: 'none',
      }}
    />
  );
}

/** Object URLs for image assets, created once per asset and revoked on unmount. */
const urlCache = new Map<string, string>();

function useAssetUrl(asset: ImageAsset | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (asset ? urlCache.get(asset.id) ?? null : null));

  useEffect(() => {
    if (!asset) {
      setUrl(null);
      return;
    }
    const cached = urlCache.get(asset.id);
    if (cached) {
      setUrl(cached);
      return;
    }
    const copy = new Uint8Array(asset.bytes.length);
    copy.set(asset.bytes);
    const objectUrl = URL.createObjectURL(new Blob([copy.buffer], { type: asset.mime }));
    urlCache.set(asset.id, objectUrl);
    setUrl(objectUrl);
  }, [asset]);

  return url;
}
