// Time remapping: a clip's speed over its length (keyframes make ramps, 0 is a
// freeze, below 0 plays backwards). Where the clip is in its file at a frame
// is the speed added up frame by frame. Frames the file doesn't have (slow
// motion) are made from the nearest, blended, or interpolated by optical flow.
import { isAnim, setKey, valueAt } from './anim';
import type { Clip, Key, Param, TimeRemap } from './types';

export const SAMPLINGS: [TimeRemap['sampling'], string][] = [
  ['nearest', 'Nearest frame'],
  ['blend', 'Frame blending'],
  ['flow', 'Optical flow'],
];

/** The speed (1 = normal) at a frame of the clip. */
export const remapSpeed = (r: TimeRemap, f: number, length: number): number => valueAt(r.speed, Math.max(0, Math.min(length - 1, f)), 100) / 100;

interface Sums {
  speed: Param;
  length: number;
  /** pos[f]: source frames moved by the start of clip frame f (f = 0 … length). */
  pos: Float64Array;
}
const cache = new WeakMap<TimeRemap, Sums>();

function sums(r: TimeRemap, length: number): Float64Array {
  const have = cache.get(r);
  if (have && have.length === length && have.speed === r.speed) return have.pos;
  const n = Math.max(1, length);
  const pos = new Float64Array(n + 1);
  for (let f = 0; f < n; f++) pos[f + 1] = (pos[f] as number) + remapSpeed(r, f, n);
  cache.set(r, { speed: r.speed, length, pos });
  return pos;
}

/**
 * How far into its source (in frames of normal speed from the clip's `in`) a clip is at frame `f` of the clip.
 * Frame f shows where the speed has carried it by then; before the start and past the end it carries on at the
 * edge's speed (spare footage for transitions).
 */
export function remapPosition(r: TimeRemap, length: number, f: number): number {
  const n = Math.max(1, length);
  const pos = sums(r, n);
  if (f <= 0) return f * remapSpeed(r, 0, n);
  if (f >= n) return (pos[n] as number) + (f - n) * remapSpeed(r, n - 1, n);
  const i = Math.floor(f);
  const a = pos[i] as number;
  const b = pos[i + 1] as number;
  return a + (b - a) * (f - i);
}

/** Seconds into the clip's file at frame `into` of the clip, with remapping. */
export function remapSourceAt(c: Clip, r: TimeRemap, into: number, fps: number): number {
  return ('in' in c.source ? c.source.in : 0) + (remapPosition(r, c.length, into) * c.speed) / fps;
}

/** How fast the file plays at a frame of the clip (1 = normal, negative = backwards, 0 = frozen). */
export function rateAt(c: Clip, into: number): number {
  if (c.remap) return remapSpeed(c.remap, into, c.length) * c.speed;
  return c.speed * (c.reverse ? -1 : 1);
}

/** The first clip frame (from `from`) that shows a given source position, or -1 (for going from file time to clip frame). */
export function clipFrameOf(r: TimeRemap, length: number, position: number, from = 0): number {
  const n = Math.max(1, length);
  for (let f = Math.max(0, from); f < n; f++) {
    const a = remapPosition(r, n, f);
    const b = remapPosition(r, n, f + 1);
    if ((position >= a && position < b) || (position <= a && position > b) || Math.abs(position - a) < 1e-9) return f;
  }
  return -1;
}

/** The range of the file a remapped clip uses (frames of normal speed from `in`). */
export function remapSpan(r: TimeRemap, length: number): { min: number; max: number } {
  const n = Math.max(1, length);
  let min = 0;
  let max = 0;
  for (let f = 0; f <= n; f++) {
    const v = remapPosition(r, n, f);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return { min, max };
}

/** Turn time remapping on: the clip keeps playing as it did (its speed and direction become the remap's). */
export function enableRemap(c: Clip, fps: number): Clip {
  if (c.remap) return c;
  const speed = c.reverse ? -100 : 100;
  // A reversed clip started from its far end: the remap starts there and runs backwards.
  const shift = c.reverse ? ((c.length - 1) * c.speed) / fps : 0;
  const source = 'in' in c.source && shift ? { ...c.source, in: c.source.in + shift } : c.source;
  return { ...c, source, reverse: false, remap: { speed, sampling: 'blend', pitch: true } };
}

/** Turn time remapping off (the clip plays forwards from where the remap started). */
export function disableRemap(c: Clip): Clip {
  return c.remap ? { ...c, remap: null } : c;
}

/** Speed keys that run `value` from `from` for `length` frames, then go back to what was there (a hold either side). */
function holdSpan(p: Param, from: number, length: number, value: number): Param {
  const to = from + length;
  const after = valueAt(p, to, 100);
  const keys: Key[] = isAnim(p) ? p.k.filter((x) => x.t < from || x.t > to).map((x) => ({ ...x })) : [{ t: 0, v: typeof p === 'number' ? p : 100, e: 'hold' }];
  const k = keys.filter((x) => x.t !== from && x.t !== to);
  // The key just before the span holds, so the change is instant.
  const lastBefore = [...k].reverse().find((x) => x.t < from);
  if (lastBefore) lastBefore.e = 'hold';
  k.push({ t: from, v: value, e: 'hold' }, { t: to, v: after, e: 'hold' });
  return { k: k.sort((a, b) => a.t - b.t) };
}

/** A freeze: the picture at `at` stays for `length` frames (later parts of the clip move on). */
export function addFreeze(r: TimeRemap, at: number, length: number): TimeRemap {
  return { ...r, speed: holdSpan(r.speed, at, Math.max(1, Math.round(length)), 0) };
}

/** A part played backwards at the speed it had (or normal speed). */
export function addReverse(r: TimeRemap, at: number, length: number, clipLength: number): TimeRemap {
  const here = Math.abs(remapSpeed(r, at, clipLength) * 100) || 100;
  return { ...r, speed: holdSpan(r.speed, at, Math.max(1, Math.round(length)), -here) };
}

/** A smooth speed ramp from the speed at `at` to `to` percent over `length` frames. */
export function addRamp(r: TimeRemap, at: number, length: number, to: number, clipLength: number): TimeRemap {
  const from = remapSpeed(r, at, clipLength) * 100;
  let p = setKey(r.speed, at, from, 'auto');
  p = setKey(p, at + Math.max(1, Math.round(length)), to, 'auto');
  return { ...r, speed: { k: p.k.map((x) => (x.t === at ? { ...x, e: 'ease' } : x)) } };
}

/**
 * What to show for a position in the file: the frame (or the two either side, and how far between them) on the
 * file's own frame grid, for a sampling mode.
 */
export function sampleFrames(time: number, fileFps: number, sampling: TimeRemap['sampling']): { time: number; next: number | null; mix: number } {
  const x = Math.max(0, time) * fileFps;
  if (sampling === 'nearest') return { time: Math.round(x + 1e-6) / fileFps, next: null, mix: 0 };
  const i = Math.floor(x + 1e-6);
  const mix = x - i;
  if (mix < 0.02) return { time: i / fileFps, next: null, mix: 0 };
  if (mix > 0.98) return { time: (i + 1) / fileFps, next: null, mix: 0 };
  return { time: i / fileFps, next: (i + 1) / fileFps, mix };
}

/**
 * The clip's frames [f0, f1) cut into pieces the sound can play at one speed: where the direction changes,
 * freezes (silent), and every few frames along a ramp.
 */
export function soundPieces(
  c: Clip,
  f0: number,
  f1: number,
  fps: number,
  maxLen = Math.max(2, Math.round(fps / 6)),
): { from: number; to: number; rate: number }[] {
  const out: { from: number; to: number; rate: number }[] = [];
  let start = f0;
  const rateOf = (f: number) => rateAt(c, f - c.start);
  for (let f = f0 + 1; f <= f1; f++) {
    const a = rateOf(start);
    const b = f < f1 ? rateOf(f) : NaN;
    const cut = f === f1 || Math.sign(a) !== Math.sign(b) || Math.abs(b - a) > 0.02 * Math.max(0.05, Math.abs(a)) || (f - start >= maxLen && b !== a);
    if (!cut) continue;
    out.push({ from: start, to: f, rate: a });
    start = f;
  }
  return out;
}
