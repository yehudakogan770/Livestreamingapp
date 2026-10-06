// Working with several keyframes at once (the graph editor): move, scale in
// time, change how they move on, copy and paste; and the speed of a value.
import { handlesOf } from './interp';
import { isAnim, valueAt } from './anim';
import type { Anim, Ease, Key, Param } from './types';

/** Keys at the same frame: the later one in the list wins; sorted by frame. */
function tidy(k: Key[]): Anim {
  const by = new Map<number, Key>();
  for (const x of k) by.set(x.t, x);
  return { k: [...by.values()].sort((a, b) => a.t - b.t) };
}

/** Move the keys at `times` by `dt` frames and `dv` in value (moved keys replace any they land on). */
export function moveKeys(p: Param, times: number[], dt: number, dv = 0): Param {
  if (!isAnim(p)) return p;
  const sel = new Set(times);
  const d = Math.round(dt);
  const moved = p.k.filter((x) => sel.has(x.t)).map((x) => ({ ...x, t: x.t + d, v: x.v + dv }));
  const landing = new Set(moved.map((x) => x.t));
  const stay = p.k.filter((x) => !sel.has(x.t) && !landing.has(x.t));
  return tidy([...stay, ...moved]);
}

/** Stretch the keys at `times` in time around a frame (2 = twice as long); bezier handles stretch with them. */
export function scaleKeyTimes(p: Param, times: number[], pivot: number, factor: number): Param {
  if (!isAnim(p) || !(factor > 0)) return p;
  const sel = new Set(times);
  const h = (x: [number, number] | undefined) => (x ? ([x[0] * factor, x[1]] as [number, number]) : undefined);
  const moved = p.k
    .filter((x) => sel.has(x.t))
    .map((x) => ({ ...x, t: Math.round(pivot + (x.t - pivot) * factor), ...(x.i ? { i: h(x.i) } : {}), ...(x.o ? { o: h(x.o) } : {}) }));
  const landing = new Set(moved.map((x) => x.t));
  return tidy([...p.k.filter((x) => !sel.has(x.t) && !landing.has(x.t)), ...moved]);
}

/** Scale the values of the keys at `times` around a value. */
export function scaleKeyValues(p: Param, times: number[], pivot: number, factor: number): Param {
  if (!isAnim(p)) return p;
  const sel = new Set(times);
  return { k: p.k.map((x) => (sel.has(x.t) ? { ...x, v: pivot + (x.v - pivot) * factor } : x)) };
}

/**
 * Change how the keys at `times` move on. Turning a key to custom bezier starts its handles where the curve
 * already is, so nothing jumps.
 */
export function setEases(p: Param, times: number[], e: Ease): Param {
  if (!isAnim(p)) return p;
  const sel = new Set(times);
  const k = p.k.map((x, i) => {
    if (!sel.has(x.t)) return x;
    if (e !== 'bezier') return { ...x, e };
    const h = handlesOf(p.k, i);
    return x.e === 'bezier' ? x : { ...x, e, ...(h.o ? { o: h.o } : {}) };
  });
  // The next key's in handle, where it has none yet, follows the curve as it was.
  const out = k.map((x, i) => {
    const prev = k[i - 1];
    const was = p.k[i - 1];
    if (!prev || !sel.has(prev.t) || e !== 'bezier' || was?.e === 'bezier') return x;
    const h = handlesOf(p.k, i);
    return h.i ? { ...x, i: h.i } : x;
  });
  return { k: out };
}

/** Set a key's bezier handles (and make its segment custom bezier). */
export function setHandle(p: Param, t: number, side: 'i' | 'o', h: [number, number]): Param {
  if (!isAnim(p)) return p;
  const idx = p.k.findIndex((x) => x.t === t);
  if (idx < 0) return p;
  return {
    k: p.k.map((x, i) => {
      if (i === idx) return { ...x, [side]: h, ...(side === 'o' ? { e: 'bezier' as Ease } : {}) };
      // An in handle belongs to the segment the previous key starts.
      if (side === 'i' && i === idx - 1) return { ...x, e: 'bezier' as Ease };
      return x;
    }),
  };
}

export function removeKeys(p: Param, times: number[], at: number): Param {
  if (!isAnim(p)) return p;
  const sel = new Set(times);
  const k = p.k.filter((x) => !sel.has(x.t));
  return k.length === 0 ? valueAt(p, at) : { k };
}

/** Copied keyframes: frames from the first one. */
export type KeyClip = Key[];

let clipboard: KeyClip | null = null;

export function copyKeys(p: Param, times: number[]): KeyClip {
  if (!isAnim(p)) return [];
  const sel = new Set(times);
  const k = p.k.filter((x) => sel.has(x.t));
  const first = k[0]?.t ?? 0;
  const out = k.map((x) => ({ ...x, t: x.t - first }));
  clipboard = out;
  return out;
}

export const copiedKeys = (): KeyClip | null => clipboard;

/** Paste keyframes with the first at frame `at` (replacing keys there); a plain value becomes keyframes. */
export function pasteKeys(p: Param | undefined, at: number, keys: KeyClip | null = clipboard): Param | undefined {
  if (!keys?.length) return p;
  const pasted = keys.map((x) => ({ ...x, t: x.t + Math.round(at) }));
  const landing = new Set(pasted.map((x) => x.t));
  const base = isAnim(p) ? p.k.filter((x) => !landing.has(x.t)) : [];
  return tidy([...base, ...pasted]);
}

/** How fast a value changes at a frame (units per second). */
export function speedAt(p: Param | undefined, t: number, fps: number, h = 0.05): number {
  if (!isAnim(p)) return 0;
  return ((valueAt(p, t + h) - valueAt(p, t - h)) / (2 * h)) * fps;
}

/** The keys inside a box on the graph (frames and values). */
export function keysInBox(p: Param | undefined, t0: number, t1: number, v0: number, v1: number): number[] {
  if (!isAnim(p)) return [];
  const [ta, tb] = t0 < t1 ? [t0, t1] : [t1, t0];
  const [va, vb] = v0 < v1 ? [v0, v1] : [v1, v0];
  return p.k.filter((x) => x.t >= ta && x.t <= tb && x.v >= va && x.v <= vb).map((x) => x.t);
}
