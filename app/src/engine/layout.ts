// How the main screen is arranged (Settings → Arrange the screen): which part
// goes where, and how big. Remembered on this computer.

import { useSyncExternalStore } from 'react';

export type TopPart = 'next' | 'controls' | 'program';
export type BottomPart = 'inputs' | 'mixer';
export type PresetsPlace = 'left' | 'right' | 'hidden';

export interface ScreenLayout {
  /** The monitors and the switch buttons, left to right. */
  top: TopPart[];
  /** The inputs and the sound mixer, left to right. */
  bottom: BottomPart[];
  presets: PresetsPlace;
  /** The share of the height for the monitors (null: worked out by itself). */
  stage: number | null;
  /** The mixer's width in pixels (null: its own). */
  mixer: number | null;
}

export const DEFAULT_LAYOUT: ScreenLayout = { top: ['next', 'controls', 'program'], bottom: ['inputs', 'mixer'], presets: 'left', stage: null, mixer: null };

const KEY = 'lumora.layout';
const same = <T>(a: T[], b: T[]) => a.length === b.length && b.every((x) => a.includes(x));

/** A saved layout, checked (anything odd falls back to the standard one). */
export function cleanLayout(v: unknown): ScreenLayout {
  const l = (v && typeof v === 'object' ? v : {}) as Partial<ScreenLayout>;
  const num = (x: unknown, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : null);
  return {
    top: Array.isArray(l.top) && same(l.top, DEFAULT_LAYOUT.top) ? [...l.top] : [...DEFAULT_LAYOUT.top],
    bottom: Array.isArray(l.bottom) && same(l.bottom, DEFAULT_LAYOUT.bottom) ? [...l.bottom] : [...DEFAULT_LAYOUT.bottom],
    presets: l.presets === 'right' || l.presets === 'hidden' ? l.presets : 'left',
    stage: num(l.stage, 0.25, 0.85),
    mixer: num(l.mixer, 220, 900),
  };
}

function load(): ScreenLayout {
  try {
    return cleanLayout(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return cleanLayout(null);
  }
}

let current = load();
const listeners = new Set<() => void>();

export function setLayout(change: Partial<ScreenLayout> | ((l: ScreenLayout) => Partial<ScreenLayout>)): void {
  current = cleanLayout({ ...current, ...(typeof change === 'function' ? change(current) : change) });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Not remembered, but still used until Lumora closes.
  }
  listeners.forEach((f) => f());
}

export function useLayout(): ScreenLayout {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => current,
  );
}

/** Swap two parts in a row. */
export function swapped<T>(list: T[], a: T, b: T): T[] {
  const i = list.indexOf(a);
  const j = list.indexOf(b);
  if (i < 0 || j < 0) return list;
  const out = [...list];
  out[i] = b;
  out[j] = a;
  return out;
}
