import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Engine } from '../player/engine';

/** The playhead (updates every frame while playing). */
export function usePlayhead(engine: Engine): number {
  return useSyncExternalStore(engine.subscribe, () => Math.floor(engine.time));
}

export function usePlaying(engine: Engine): boolean {
  return useSyncExternalStore(engine.subscribe, () => engine.isPlaying);
}

/** The keyboard belongs to typing while a text box has it. */
export function typing(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}

/** An element's size, kept up to date. */
export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Drag with the mouse: `move` gets how far it went; `done` when let go. */
export function drag(e: React.PointerEvent | PointerEvent, move: (dx: number, dy: number, ev: PointerEvent) => void, done?: (ev: PointerEvent) => void) {
  const x0 = e.clientX;
  const y0 = e.clientY;
  const onMove = (ev: PointerEvent) => move(ev.clientX - x0, ev.clientY - y0, ev);
  const onUp = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    done?.(ev);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
