import { segmentValue } from './interp';
import type { Anim, Ease, Key, Param } from './types';

export const isAnim = (p: Param | undefined): p is Anim => typeof p === 'object' && p !== null && Array.isArray(p.k);

/** The value at a frame (from the clip's start). */
export function valueAt(p: Param | undefined, t: number, fallback = 0): number {
  if (p === undefined) return fallback;
  if (!isAnim(p)) return p;
  const k = p.k;
  if (k.length === 0) return fallback;
  const first = k[0] as Key;
  if (t <= first.t) return first.v;
  for (let i = 0; i < k.length - 1; i++) {
    const b = k[i + 1] as Key;
    if (t < b.t) return segmentValue(k, i, t);
  }
  return (k[k.length - 1] as Key).v;
}

/** A keyframe at a frame (replacing one already there). */
export function setKey(p: Param | undefined, t: number, v: number, e: Ease = 'linear'): Anim {
  const k = isAnim(p) ? p.k.filter((x) => x.t !== t) : [];
  // A key already there keeps how it moves on (and its handles).
  const had = isAnim(p) ? p.k.find((x) => x.t === t) : undefined;
  k.push(had ? { ...had, v } : { t, v, e });
  k.sort((a, b) => a.t - b.t);
  return { k };
}

/** Change the value at a frame: a keyframe there if it moves, otherwise the whole value. */
export function setValue(p: Param | undefined, t: number, v: number): Param {
  return isAnim(p) ? setKey(p, t, v) : v;
}

export function removeKey(p: Param, t: number): Param {
  if (!isAnim(p)) return p;
  const k = p.k.filter((x) => x.t !== t);
  return k.length === 0 ? valueAt(p, t) : { k };
}

/** Turn keyframes on (one at the frame, with the current value) or off (the value at the frame stays). */
export function toggleAnim(p: Param | undefined, t: number, fallback: number): Param {
  if (isAnim(p)) return valueAt(p, t, fallback);
  return { k: [{ t, v: p ?? fallback, e: 'linear' }] };
}

export const keyTimes = (p: Param | undefined): number[] => (isAnim(p) ? p.k.map((x) => x.t) : []);

/** Keyframes moved along (a clip cut in two: the second part's keyframes start earlier). */
export function shiftKeys(p: Param, by: number): Param {
  if (!isAnim(p)) return p;
  return { k: p.k.map((x) => ({ ...x, t: x.t + by })) };
}

/** Keyframes stretched when a clip's speed changes. */
export function scaleKeys(p: Param, by: number): Param {
  if (!isAnim(p)) return p;
  const h = (x: [number, number] | undefined): [number, number] | undefined => (x ? [x[0] * by, x[1]] : undefined);
  return { k: p.k.map((x) => ({ ...x, t: Math.round(x.t * by), ...(x.i ? { i: h(x.i) } : {}), ...(x.o ? { o: h(x.o) } : {}) })) };
}

export function setEase(p: Param, t: number, e: Ease): Param {
  if (!isAnim(p)) return p;
  return { k: p.k.map((x) => (x.t === t ? { ...x, e } : x)) };
}
