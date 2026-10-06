// Phones and touch: which layout to show, reordering by dragging a handle
// (mouse, pen or finger alike), and the Back button closing a full-screen sheet.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useDevice } from './device';

/** The phone layout: a phone (see device.ts), not merely a narrow window. */
export const usePhone = (): boolean => useDevice() === 'phone';

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

/** How far the list follows the finger, and how far it must be pulled to refresh. */
export const PULL_MAX = 88;
export const PULL_AT = 64;

/** Pulled `dy` pixels down from the top: how far the list moves (it resists, then stops). */
export function pullDistance(dy: number): number {
  return dy <= 0 ? 0 : Math.min(PULL_MAX, Math.round(dy * 0.5));
}

/**
 * Pull down from the top of a scrolling page to refresh it (touch only). The
 * page's element gets `ref`; `dist` is how far it is pulled now, and
 * `busy` is true while refreshing.
 */
export function usePullToRefresh<T extends HTMLElement>(refresh: () => unknown, enabled: boolean) {
  const ref = useRef<T | null>(null);
  const [dist, setDist] = useState(0);
  const [busy, setBusy] = useState(false);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: number | null = null;
    let now = 0;
    let running = false;
    const down = (e: TouchEvent) => {
      start = !running && el.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0]!.clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (start === null) return;
      now = pullDistance(e.touches[0]!.clientY - start);
      if (now > 0 && el.scrollTop <= 0) {
        // The page itself does not move or bounce while pulled.
        if (e.cancelable) e.preventDefault();
        setDist(now);
      } else if (now <= 0) setDist(0);
    };
    const up = () => {
      if (start === null) return;
      start = null;
      if (now < PULL_AT) {
        now = 0;
        setDist(0);
        return;
      }
      now = 0;
      running = true;
      setBusy(true);
      setDist(PULL_AT * 0.75);
      Promise.resolve()
        .then(() => refreshRef.current())
        .catch(() => {})
        .finally(() => {
          running = false;
          setBusy(false);
          setDist(0);
        });
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    return () => {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
    };
  }, [enabled]);
  return { ref, dist, busy };
}
