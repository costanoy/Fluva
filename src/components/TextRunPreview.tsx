import { useLayoutEffect, useRef, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { Move } from 'lucide-react';
import { TEXT_BASELINE_RATIO, TEXT_LINE_HEIGHT } from '../pdf/build';
import { familyByKey } from '../pdf/fonts';
import type { Rect, WorkPage } from '../pdf/model';
import { useApp } from '../state/AppContext';

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
  const handleMove = (e: MouseEvent) => {
    e.stopPropagation();
    actions.replaceTextRun(bounds, draft.text, draft.fontKey, draft.size, draft.bold, draft.italic, true);
  };

  const coverX = target.x - 1;
  const coverY = target.y - 1;
  const coverW = target.width + 2;
  const coverH = target.height + 2;

  const textX = target.x;
  // Same recovery as replaceTextRun: target.y is the original run's own top
  // (baseline minus 20% of ITS font size), not the new draft's. Reconstructing
  // the real baseline and re-adding the draft's own drop keeps the preview
  // anchored exactly where the original glyphs sat, instead of sliding down
  // by a font size's worth on the very first click.
  const originalBaseline = target.y + target.height / 6;
  const textY = originalBaseline + draft.size * TEXT_BASELINE_RATIO;
  const family = familyByKey(draft.fontKey);
  // Matches OverlayLayer's overlays, so the preview keeps pace with the page
  // during a zoom instead of jumping to each new size a beat behind it.
  const smoothTransition = 'left .16s ease-out, top .16s ease-out, width .16s ease-out, height .16s ease-out, font-size .16s ease-out';

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
        onPointerDown={stopClick}
        onClick={handleMove}
        title="Mover texto"
        aria-label="Mover texto"
        style={{
          position: 'absolute',
          left: (coverX + coverW) * scale - 9,
          top: (page.height - coverY) * scale - 9,
          width: 20,
          height: 20,
          padding: 0,
          borderRadius: '50%',
          border: '2px solid #FFFFFF',
          background: 'var(--color-accent)',
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'grab',
          boxShadow: 'var(--shadow-sm)',
          transition: smoothTransition,
        }}
      >
        <Move size={11} strokeWidth={2.75} />
      </button>
    </>
  );
}
