import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import type { Overlay, WorkPage } from '../pdf/model';
import { extractPageText, type TextItem } from '../pdf/textExtract';

/**
 * A run counts as already replaced once a 'cover' overlay sits over its exact
 * spot — that's the same ±1pt padding `buildTextReplacementOverlays` gives the
 * cover it draws. Without this check, the original PDF text stays clickable
 * forever underneath its own replacement: clicking it again would hand the
 * panel the stale original text instead of what the overlay now actually shows.
 */
function isRunReplaced(item: TextItem, overlays: Overlay[]): boolean {
  return overlays.some((o) => {
    if (o.kind !== 'cover') return false;
    return (
      Math.abs(o.x - (item.x - 1)) < 2 &&
      Math.abs(o.y - (item.y - 1)) < 2 &&
      Math.abs(o.width - (item.width + 2)) < 2 &&
      Math.abs(o.height - (item.height + 2)) < 2
    );
  });
}

/**
 * Makes the PDF's real text runs clickable so the user can rewrite one.
 *
 * PDF text is not editable in place — it lives in a content stream, not a text box.
 * Selecting a run hands its true geometry, size and font to the side panel, which
 * then covers the original and draws the replacement. Once a run has been
 * replaced, further edits happen on the overlay itself (inline, on the canvas)
 * rather than through this layer — see `isRunReplaced` above.
 */
export function TextRunLayer({ page, scale }: { page: WorkPage; scale: number }) {
  const { state, actions } = useApp();
  const [items, setItems] = useState<TextItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    extractPageText(state.doc, page)
      .then((found) => {
        if (!cancelled) setItems(found);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [state.doc, page]);

  const visibleItems = items.filter((item) => !isRunReplaced(item, page.overlays));

  return (
    <>
      {visibleItems.map((item) => {
        const selected = state.editingTextId === item.id;
        return (
          <button
            key={item.id}
            className={`text-run${selected ? ' text-run-selected' : ''}`}
            title={`${item.originalFont} · ${Math.round(item.fontSize)}pt — clique para substituir`}
            style={{
              left: item.x * scale,
              top: (page.height - item.y - item.height) * scale,
              width: Math.max(6, item.width * scale),
              height: Math.max(6, item.height * scale),
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              // Switching to a different run (or closing this one) leaves
              // whatever was being edited — save it first, same as clicking away.
              actions.commitPendingTextRunEdit();
              actions.setEditingText(selected ? null : item.id);
              actions.setTextRunTarget(selected ? null : item);
            }}
          />
        );
      })}
    </>
  );
}
