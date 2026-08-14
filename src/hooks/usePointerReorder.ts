import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const DRAG_THRESHOLD = 6;

/**
 * Drag-to-reorder for a flat list, driven by Pointer Events instead of native
 * HTML5 drag-and-drop (`draggable`). Native drag-and-drop only ever fires from
 * mouse input — most mobile browsers deliver no drag events at all for a touch
 * gesture, so anything built on `draggable`/`onDragStart` is simply unusable
 * on a phone. Pointer Events fire the same way for mouse, touch and pen alike.
 *
 * Spread `itemProps(index)` onto each reorderable element: it wires up the
 * press-to-drag gesture and tags the element so `pointermove` can tell, via
 * `elementFromPoint`, which item the pointer is currently over — pointer
 * capture keeps delivering move/up events to the element the drag started on
 * even once the finger or cursor has physically left it.
 */
export function usePointerReorder(onReorder: (from: number, to: number) => void) {
  const dragRef = useRef<{ index: number; startX: number; startY: number; moved: boolean; el: HTMLElement; pointerId: number } | null>(
    null,
  );
  const overRef = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndexState] = useState<number | null>(null);

  const setOverIndex = useCallback((v: number | null) => {
    overRef.current = v;
    setOverIndexState(v);
  }, []);

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        drag.moved = true;
        setDragIndex(drag.index);
        // Capture is deferred until a real drag is confirmed, not set on every
        // press — capturing a plain tap makes the browser retarget the click it
        // generates on release to this item's own root instead of wherever the
        // tap actually landed, which broke selecting anything but already-active
        // items when a click handler on a child (e.g. picking a page) depended on
        // that click reaching it normally.
        try {
          drag.el.setPointerCapture(drag.pointerId);
        } catch {
          /* a rejected capture just means move/up fall back to whatever they'd normally target — not fatal */
        }
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const targetEl = el?.closest<HTMLElement>('[data-reorder-index]') ?? null;
      setOverIndex(targetEl ? Number(targetEl.dataset.reorderIndex) : null);
    },
    [setOverIndex],
  );

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    const over = overRef.current;
    if (drag?.moved && over !== null && over !== drag.index) onReorder(drag.index, over);
    setDragIndex(null);
    setOverIndex(null);
  }, [onReorder, setOverIndex]);

  const handlePointerDown = useCallback(
    (index: number) => (e: ReactPointerEvent) => {
      dragRef.current = {
        index,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        el: e.currentTarget as HTMLElement,
        pointerId: e.pointerId,
      };
    },
    [],
  );

  /** Everything a reorderable item needs — spread directly onto its root element. */
  const itemProps = (index: number) => ({
    'data-reorder-index': index,
    onPointerDown: handlePointerDown(index),
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerUp,
    style: { touchAction: 'none' as const },
  });

  return { dragIndex, overIndex, itemProps };
}
