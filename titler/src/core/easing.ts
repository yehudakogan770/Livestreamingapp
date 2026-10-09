// Keyframe interpolation: temporal bezier easing (like CSS cubic-bezier),
// hold keys, and motion paths (spatial bezier, walked at even speed).

import { applyExpr } from './expr';
import type { Keyframe, Prop, Value, Vec2 } from './types';

/** The expression a property carries, to keep on a changed property. */
const keepX = (p: Prop<Value> | undefined) => (p?.x ? { x: p.x } : {});

export const LINEAR_OUT: Vec2 = [0, 0];
export const LINEAR_IN: Vec2 = [1, 1];

/** Named easing presets: the leaving key's handle and the arriving key's. */
export const EASES: { id: string; name: string; o: Vec2; i: Vec2 }[] = [
  { id: 'linear', name: 'Linear', o: [0, 0], i: [1, 1] },
  { id: 'ease', name: 'Ease', o: [0.25, 0.1], i: [0.25, 1] },
  { id: 'easeIn', name: 'Ease in', o: [0.42, 0], i: [1, 1] },
  { id: 'easeOut', name: 'Ease out', o: [0, 0], i: [0.58, 1] },
  { id: 'easeInOut', name: 'Ease in and out', o: [0.42, 0], i: [0.58, 1] },
  { id: 'smooth', name: 'Smooth (broadcast)', o: [0.33, 0], i: [0.12, 1] },
  { id: 'snap', name: 'Snap', o: [0.7, 0], i: [0.2, 1] },
  { id: 'overshoot', name: 'Overshoot', o: [0.34, 1.4], i: [0.64, 1] },
  { id: 'anticipate', name: 'Anticipate', o: [0.36, -0.4], i: [0.66, 1] },
];

export const easeById = (id: string) => EASES.find((e) => e.id === id) ?? EASES[0]!;

const bez = (a: number, b: number, c: number, d: number, s: number) => {
  const u = 1 - s;
  return u * u * u * a + 3 * u * u * s * b + 3 * u * s * s * c + s * s * s * d;
};
const bezD = (a: number, b: number, c: number, d: number, s: number) => {
  const u = 1 - s;
  return 3 * u * u * (b - a) + 6 * u * s * (c - b) + 3 * s * s * (d - c);
};

/** cubic-bezier(x1, y1, x2, y2) at x (0–1): the eased progress. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx1 = Math.min(1, Math.max(0, x1));
  const cx2 = Math.min(1, Math.max(0, x2));
  let s = x;
  for (let n = 0; n < 8; n++) {
    const err = bez(0, cx1, cx2, 1, s) - x;
    if (Math.abs(err) < 1e-7) return bez(0, y1, y2, 1, s);
    const d = bezD(0, cx1, cx2, 1, s);
    if (Math.abs(d) < 1e-6) break;
    s -= err / d;
    if (s < 0 || s > 1) break;
  }
  let lo = 0;
  let hi = 1;
  s = x;
  for (let n = 0; n < 50; n++) {
    const v = bez(0, cx1, cx2, 1, s);
    if (Math.abs(v - x) < 1e-9) break;
    if (v < x) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return bez(0, y1, y2, 1, s);
}

/** Eased progress (0–1, may overshoot) between key a and key b at a linear fraction f. */
export function segmentProgress(a: Keyframe<Value>, b: Keyframe<Value>, f: number): number {
  if (a.hold) return 0;
  const o = a.o ?? LINEAR_OUT;
  const i = b.i ?? LINEAR_IN;
  if (o[0] === 0 && o[1] === 0 && i[0] === 1 && i[1] === 1) return f;
  return cubicBezier(o[0], o[1], i[0], i[1], f);
}

export const isAnimated = <T extends Value>(p: Prop<T> | undefined): p is { k: Keyframe<T>[] } => !!p && Array.isArray(p.k);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Point on a cubic bezier in 2D. */
function bez2(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, s: number): Vec2 {
  return [bez(p0[0], p1[0], p2[0], p3[0], s), bez(p0[1], p1[1], p2[1], p3[1], s)];
}

/** The curve parameter that is fraction `f` of the way along a motion path's length. */
function arcParam(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, f: number): number {
  const N = 32;
  const table = [0];
  let prev = p0;
  let len = 0;
  for (let n = 1; n <= N; n++) {
    const q = bez2(p0, p1, p2, p3, n / N);
    len += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    table.push(len);
    prev = q;
  }
  if (len <= 0) return f;
  const want = f * len;
  for (let n = 1; n <= N; n++) {
    if (table[n]! >= want) {
      const l0 = table[n - 1]!;
      const seg = table[n]! - l0;
      return (n - 1 + (seg > 0 ? (want - l0) / seg : 0)) / N;
    }
  }
  return 1;
}

function mix(a: Keyframe<Value>, b: Keyframe<Value>, e: number): Value {
  if (typeof a.v === 'number') return lerp(a.v, b.v as number, e);
  const av = a.v;
  const bv = b.v as Vec2;
  const ka = a as Keyframe<Vec2>;
  const kb = b as Keyframe<Vec2>;
  if (ka.so || kb.si) {
    // A motion path: the eased progress walks along the curve at even speed.
    const p1: Vec2 = [av[0] + (ka.so?.[0] ?? 0), av[1] + (ka.so?.[1] ?? 0)];
    const p2: Vec2 = [bv[0] + (kb.si?.[0] ?? 0), bv[1] + (kb.si?.[1] ?? 0)];
    const s = e < 0 || e > 1 ? e : arcParam(av, p1, p2, bv, e);
    return bez2(av, p1, p2, bv, s);
  }
  return [lerp(av[0], bv[0], e), lerp(av[1], bv[1], e)];
}

/** A property's value at time t (seconds), with its expression if it has one. */
export function valueAt<T extends Value>(p: Prop<T> | undefined, t: number, fallback: T): T {
  const v = keyedValueAt(p, t, fallback);
  if (!p?.x) return v;
  return applyExpr(p.x, p, t, v, (tt) => keyedValueAt(p, tt, fallback));
}

/** The keyframed (or still) value at time t, before any expression. */
export function keyedValueAt<T extends Value>(p: Prop<T> | undefined, t: number, fallback: T): T {
  if (!p) return fallback;
  if (!isAnimated(p)) return (p.v ?? fallback) as T;
  const k = p.k;
  if (k.length === 0) return fallback;
  const first = k[0]!;
  if (t <= first.t) return first.v;
  const last = k[k.length - 1]!;
  if (t >= last.t) return last.v;
  // Binary search for the segment.
  let lo = 0;
  let hi = k.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (k[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = k[lo]!;
  const b = k[hi]!;
  const span = b.t - a.t;
  const f = span > 0 ? (t - a.t) / span : 1;
  const e = segmentProgress(a, b, f);
  return mix(a, b, e) as T;
}

export const num = (p: Prop | undefined, t: number, fallback = 0): number => valueAt(p, t, fallback);
export const vec = (p: Prop<Vec2> | undefined, t: number, fallback: Vec2): Vec2 => valueAt(p, t, fallback);

/** A still property. */
export const still = <T extends Value>(v: T): Prop<T> => ({ v });

/** A keyframed property from [time, value, ease id] triples. */
export function keys<T extends Value>(...list: [number, T, string?][]): Prop<T> {
  return {
    k: list.map(([t, v, ease], n) => {
      const out: Keyframe<T> = { t, v };
      const e = easeById(ease ?? 'linear');
      if (ease === 'hold') out.hold = true;
      else if (e.id !== 'linear') out.o = [...e.o];
      // The arriving handle belongs to the next key.
      const prev = list[n - 1];
      if (prev && prev[2] && prev[2] !== 'linear' && prev[2] !== 'hold') out.i = [...easeById(prev[2]).i];
      return out;
    }),
  };
}

/** Set (or add) a key at time t, keeping the property's other keys. */
export function setKey<T extends Value>(p: Prop<T> | undefined, t: number, v: T): Prop<T> {
  const list = isAnimated(p) ? p.k.filter((x) => Math.abs(x.t - t) > 1e-6) : [];
  const had = isAnimated(p) ? p.k.find((x) => Math.abs(x.t - t) <= 1e-6) : undefined;
  list.push(had ? { ...had, v } : { t, v });
  list.sort((a, b) => a.t - b.t);
  return { k: list, ...keepX(p) };
}

/** Change a value at time t: a key there when it is keyframed, the still value otherwise. */
export function setValue<T extends Value>(p: Prop<T> | undefined, t: number, v: T): Prop<T> {
  return isAnimated(p) ? setKey(p, t, v) : { v, ...keepX(p) };
}

/** Keyframes on (one key now with the current value) or off (the value now stays). */
export function toggleKeys<T extends Value>(p: Prop<T> | undefined, t: number, fallback: T): Prop<T> {
  if (isAnimated(p)) return { v: keyedValueAt(p, t, fallback), ...keepX(p) };
  return { k: [{ t, v: (p?.v ?? fallback) as T }], ...keepX(p) };
}

export function removeKey<T extends Value>(p: Prop<T>, t: number, fallback: T): Prop<T> {
  if (!isAnimated(p)) return p;
  const k = p.k.filter((x) => Math.abs(x.t - t) > 1e-6);
  return k.length ? { k, ...keepX(p) } : { v: keyedValueAt(p, t, fallback), ...keepX(p) };
}

/** Give the segment leaving the key at t (and arriving at the next) a preset ease. */
export function setEase<T extends Value>(p: Prop<T>, t: number, easeId: string): Prop<T> {
  if (!isAnimated(p)) return p;
  const e = easeById(easeId);
  const idx = p.k.findIndex((x) => Math.abs(x.t - t) <= 1e-6);
  if (idx < 0) return p;
  const k = p.k.map((x) => ({ ...x }));
  const a = k[idx]!;
  delete a.hold;
  if (easeId === 'hold') a.hold = true;
  else a.o = [...e.o];
  const b = k[idx + 1];
  if (b && easeId !== 'hold') b.i = [...e.i];
  return { k, ...keepX(p) };
}

export const keyTimes = (p: Prop<Value> | undefined): number[] => (isAnimated(p) ? p.k.map((x) => x.t) : []);
