import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import type { WorkPage } from '../pdf/model';
import { extractPageText, type TextItem } from '../pdf/textExtract';

/**
 * Makes the PDF's real text runs clickable so the user can rewrite one.
 *
 * PDF text is not editable in place — it lives in a content stream, not a text box.
 * Selecting a run hands its true geometry, size and font to the side panel, which
 * then covers the original and draws the replacement.
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

  return (
    <>
      {items.map((item) => {
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
            onClick={(e) => {
              e.stopPropagation();
              actions.setEditingText(selected ? null : item.id);
              actions.setTextRunTarget(selected ? null : item);
            }}
          />
        );
      })}
    </>
  );
}
