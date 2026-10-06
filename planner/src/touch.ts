// Phones and touch: which layout to show, reordering by dragging a handle
// (mouse, pen or finger alike), and the Back button closing a full-screen sheet.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** Phones: narrow windows, and phones on their side (short and touch). Keep in step with planner.css. */
export const PHONE_QUERY = '(max-width: 760px), (pointer: coarse) and (max-height: 500px)';

/** Whether a media query matches now (false where there is no matchMedia, as in tests). */
export function useMedia(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [query]);
  return on;
}

export const usePhone = (): boolean => useMedia(PHONE_QUERY);

/** A drag in progress: the row picked up, and the gap it would drop into (0 = before the first row). */
export interface Drag {
  from: number;
  slot: number;
}

function scrollBox(el: HTMLElement | null): HTMLElement | null {
  for (let e = el; e; e = e.parentElement) {
    const o = getComputedStyle(e).overflowY;
    if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) return e;
  }
  return null;
}

/**
 * Reorder rows by dragging a handle. Rows to drop between carry `data-reorder`
 * inside the element `listRef` points at. Works with pointer events, so a
 * finger on the handle drags (the handle has `touch-action: none`) while the
 * rest of the row still scrolls the list.
 */
export function useReorder<T extends HTMLElement>(count: number, move: (from: number, to: number) => void, enabled: boolean) {
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const listRef = useRef<T | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  const slotAt = (y: number): number => {
    const rows = listRef.current ? Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-reorder]')) : [];
    for (let i = 0; i < rows.length; i++) {
      const b = rows[i]!.getBoundingClientRect();
      if (y < b.top + b.height / 2) return i;
    }
    return rows.length;
  };
  const autoscroll = (y: number) => {
    const box = scrollBox(listRef.current);
    if (!box) return;
    const b = box.getBoundingClientRect();
    const edge = 48;
    if (y < b.top + edge) box.scrollTop -= Math.ceil((b.top + edge - y) / 4);
    else if (y > b.bottom - edge) box.scrollTop += Math.ceil((y - (b.bottom - edge)) / 4);
  };

  const handle = (i: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Not captured: moves still arrive while the pointer stays over the handle.
      }
      setDrag({ from: i, slot: i });
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      autoscroll(e.clientY);
      const slot = slotAt(e.clientY);
      if (slot !== d.slot) setDrag({ ...d, slot });
    },
    onPointerUp: () => {
      const d = dragRef.current;
      if (!d) return;
      setDrag(null);
      const to = d.slot > d.from ? d.slot - 1 : d.slot;
      if (to !== d.from && to >= 0 && to < count) move(d.from, to);
    },
    onPointerCancel: () => setDrag(null),
    onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  });

  /** Classes for row i while dragging: the row picked up, and the line where it would land. */
  const rowClass = (i: number): string => {
    if (!drag) return '';
    if (drag.from === i) return ' is-dragging';
    if (drag.slot === drag.from || drag.slot === drag.from + 1) return '';
    if (drag.slot === i) return ' drop-before';
    if (drag.slot === count && i === count - 1) return ' drop-after';
    return '';
  };

  return { listRef, drag, handle, rowClass };
}

type SheetState = { plannerSheet?: boolean } | null;

/**
 * While `open`, the browser's Back (and Android's back gesture) closes it
 * instead of leaving the page: opening adds a history entry, closing removes it.
 */
export function useBackToClose(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    history.pushState({ ...(history.state as object | null), plannerSheet: true }, '');
    let popped = false;
    const pop = () => {
      // Landing on another sheet entry (React's development double run) is not a close.
      if ((history.state as SheetState)?.plannerSheet) return;
      popped = true;
      closeRef.current();
    };
    window.addEventListener('popstate', pop);
    return () => {
      window.removeEventListener('popstate', pop);
      if (!popped && (history.state as SheetState)?.plannerSheet) history.back();
    };
  }, [open]);
}
