// IN / HOLD / OUT: where a graphic is on its timeline while it is on air.
//
// A composition's timeline has three parts split by two markers:
//   IN   0 … inEnd          plays once when the graphic is taken
//   HOLD inEnd … outStart   stays on the hold frame (inEnd), or repeats the
//                           loop section if there is one
//   OUT  outStart … end     plays once when the graphic is taken off
// The same rules drive Lumora's overlays (on / off) and Studio's title clips
// (the clip's start is IN, its last OUT-length seconds are OUT).

import type { Composition, Markers } from './types';

export type Phase = 'in' | 'hold' | 'out' | 'done';

/** Markers kept in order inside the composition. */
export function cleanMarkers(m: Markers, duration: number): Markers {
  const d = Math.max(0.04, duration);
  const inEnd = clamp(m.inEnd, 0, d);
  const outStart = clamp(Math.max(inEnd, m.outStart), inEnd, d);
  let loop = m.loop ?? null;
  if (loop) {
    const s = clamp(loop.start, 0, d);
    const e = clamp(loop.end, s, d);
    loop = e - s >= 1 / 120 ? { start: s, end: e } : null;
  }
  return { inEnd, outStart, loop };
}

function clamp(v: number, lo: number, hi: number) {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}

/** How long OUT takes. */
export const outLength = (c: Composition) => Math.max(0, c.duration - c.markers.outStart);
export const inLength = (c: Composition) => Math.max(0, c.markers.inEnd);

/**
 * The composition time to draw `sinceIn` seconds after the graphic was taken
 * (and `sinceOut` seconds after it was taken off, or null while on air).
 */
export function cueTime(c: Composition, sinceIn: number, sinceOut: number | null): { t: number; phase: Phase } {
  const { inEnd, outStart, loop } = c.markers;
  if (sinceOut !== null) {
    const t = outStart + Math.max(0, sinceOut);
    return t >= c.duration ? { t: c.duration, phase: 'done' } : { t, phase: 'out' };
  }
  const s = Math.max(0, sinceIn);
  if (s < inEnd) return { t: s, phase: 'in' };
  if (loop && loop.end > loop.start) {
    // Play on from the IN to the loop's start, then go round the loop.
    if (s < loop.start) return { t: s, phase: 'hold' };
    const len = loop.end - loop.start;
    return { t: loop.start + ((s - loop.start) % len), phase: 'hold' };
  }
  // The hold part plays once (anything animated in it), then holds.
  return { t: Math.min(s, outStart), phase: 'hold' };
}

/**
 * A title clip in an edit: `local` seconds into a clip `length` seconds long.
 * The IN plays from the clip's start; OUT ends with the clip.
 */
export function clipTime(c: Composition, local: number, length: number): { t: number; phase: Phase } {
  const out = outLength(c);
  const outAt = Math.max(Math.min(inLength(c), length), length - out);
  if (local >= outAt) return cueTime(c, outAt, local - outAt);
  return cueTime(c, local, null);
}

/** Seconds to keep an overlay on screen after it is taken off (its OUT). */
export const outMs = (c: Composition) => Math.round(outLength(c) * 1000);
