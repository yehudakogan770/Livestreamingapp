// Keyframe interpolation: how a value moves from one keyframe to the next.
// The original modes (linear, ease, hold) are computed exactly as before; the
// others are cubic bezier curves in (frame, value) space, solved for the frame.
import type { Ease, Key } from './types';

export const smooth = (x: number): number => x * x * (3 - 2 * x);

/** Every interpolation, with a name for menus. */
export const EASES: [Ease, string][] = [
  ['linear', 'Linear'],
  ['hold', 'Hold'],
  ['ease', 'Ease in and out'],
  ['easeIn', 'Ease in (slow into the next key)'],
  ['easeOut', 'Ease out (leave slowly)'],
  ['auto', 'Auto bezier'],
  ['bezier', 'Custom bezier'],
];

const bez = (a: number, b: number, c: number, d: number, s: number): number => {
  const u = 1 - s;
  return u * u * u * a + 3 * u * u * s * b + 3 * u * s * s * c + s * s * s * d;
};
const bezD = (a: number, b: number, c: number, d: number, s: number): number => {
  const u = 1 - s;
  return 3 * u * u * (b - a) + 6 * u * s * (c - b) + 3 * s * s * (d - c);
};

/**
 * The curve parameter where a cubic bezier with x control points 0, x1, x2, 1 (x1, x2 in [0, 1], so x only
 * grows) reaches x. Newton steps, with bisection when they stall.
 */
export function solveBezierX(x1: number, x2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let s = x;
  for (let i = 0; i < 8; i++) {
    const err = bez(0, x1, x2, 1, s) - x;
    if (Math.abs(err) < 1e-7) return s;
    const d = bezD(0, x1, x2, 1, s);
    if (Math.abs(d) < 1e-6) break;
    s -= err / d;
    if (s < 0 || s > 1) break;
  }
  let lo = 0;
  let hi = 1;
  s = x;
  for (let i = 0; i < 60; i++) {
    const v = bez(0, x1, x2, 1, s);
    if (Math.abs(v - x) < 1e-9) break;
    if (v < x) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return s;
}

/** The value of a cubic bezier (x from 0 to 1, y from y0 to y3) at x. */
export function bezierAt(x1: number, y1: number, x2: number, y2: number, y0: number, y3: number, x: number): number {
  const s = solveBezierX(Math.max(0, Math.min(1, x1)), Math.max(0, Math.min(1, x2)), x);
  return bez(y0, y1, y2, y3, s);
}

/** The automatic slope (value per frame) at a key: through its neighbors, flat at the ends and at peaks and dips (no overshoot). */
export function autoSlope(k: Key[], i: number): number {
  const a = k[i - 1];
  const b = k[i];
  const c = k[i + 1];
  if (!a || !b || !c) return 0;
  if ((b.v - a.v) * (c.v - b.v) <= 0) return 0;
  return (c.v - a.v) / Math.max(1e-9, c.t - a.t);
}

/** A key's handles for the segment it starts (out) and ends (in), as [frames, value] offsets, whatever its mode. */
export function handlesOf(k: Key[], i: number): { o: [number, number] | null; i: [number, number] | null } {
  const cur = k[i] as Key;
  const next = k[i + 1];
  const prev = k[i - 1];
  const seg = (a: Key, b: Key, idx: number) => segmentHandles(k, idx, a, b);
  return {
    o: next
      ? (() => {
          const h = seg(cur, next, i);
          return [h.x1 * (next.t - cur.t), h.y1 - cur.v] as [number, number];
        })()
      : null,
    i: prev
      ? (() => {
          const h = seg(prev, cur, i - 1);
          return [(h.x2 - 1) * (cur.t - prev.t), h.y2 - cur.v] as [number, number];
        })()
      : null,
  };
}

/** The bezier control points of the segment from key `idx` (a) to the next (b), normalized in time. */
export function segmentHandles(k: Key[], idx: number, a: Key, b: Key): { x1: number; y1: number; x2: number; y2: number } {
  const dt = Math.max(1e-9, b.t - a.t);
  const dv = b.v - a.v;
  const lin = { x1: 1 / 3, y1: a.v + dv / 3, x2: 2 / 3, y2: b.v - dv / 3 };
  const autoOut = a.v + (autoSlope(k, idx) * dt) / 3;
  const autoIn = b.v - (autoSlope(k, idx + 1) * dt) / 3;
  switch (a.e) {
    case 'easeIn':
      return { ...lin, y2: b.v };
    case 'easeOut':
      return { ...lin, y1: a.v };
    case 'ease':
      return { ...lin, y1: a.v, y2: b.v };
    case 'auto':
      return { x1: 1 / 3, y1: autoOut, x2: 2 / 3, y2: autoIn };
    case 'bezier':
      return {
        x1: a.o ? Math.max(0, Math.min(1, a.o[0] / dt)) : 1 / 3,
        y1: a.o ? a.v + a.o[1] : autoOut,
        x2: b.i ? Math.max(0, Math.min(1, 1 + b.i[0] / dt)) : 2 / 3,
        y2: b.i ? b.v + b.i[1] : autoIn,
      };
    default:
      return lin;
  }
}

/** The value between key `idx` and the next at frame t (a.t <= t < b.t). */
export function segmentValue(k: Key[], idx: number, t: number): number {
  const a = k[idx] as Key;
  const b = k[idx + 1] as Key;
  if (a.e === 'hold') return a.v;
  const x = (t - a.t) / (b.t - a.t);
  // The original modes, exactly as they always were.
  if (a.e === 'linear' || !a.e) return a.v + (b.v - a.v) * x;
  if (a.e === 'ease') return a.v + (b.v - a.v) * smooth(x);
  const h = segmentHandles(k, idx, a, b);
  return bezierAt(h.x1, h.y1, h.x2, h.y2, a.v, b.v, x);
}
