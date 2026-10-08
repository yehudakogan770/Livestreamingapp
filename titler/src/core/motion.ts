// Ready-made moves for layers: the IN and OUT animations templates and the
// designer's "Animate" presets use. Each writes keyframes on the layer.

import { keys, num, vec } from './easing';
import type { Composition, Layer, Prop, Reveal, TextAnimator, TextLayer, Vec2 } from './types';
import { uid } from './build';

export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface Move {
  /** Seconds. */
  at: number;
  dur: number;
  ease?: string;
}

const pos = (l: Layer): Vec2 => vec(l.transform.position, 0, [0, 0]);

/** Join keyframes for one property from several moves (sorted, later wins on the same time). */
function merge<T extends number | Vec2>(prev: Prop<T>, next: Prop<T>): Prop<T> {
  if (!prev.k) return next;
  if (!next.k) return prev;
  const all = [...prev.k.filter((a) => !next.k!.some((b) => Math.abs(a.t - b.t) < 1e-6)), ...next.k];
  all.sort((a, b) => a.t - b.t);
  return { k: all };
}

/** Fade in (or out when `out`). */
export function fade(l: Layer, m: Move, out = false): Layer {
  const full = num(l.transform.opacity, 0, 100);
  const k = out ? keys<number>([m.at, full, m.ease ?? 'easeIn'], [m.at + m.dur, 0]) : keys<number>([m.at, 0, m.ease ?? 'easeOut'], [m.at + m.dur, full]);
  l.transform.opacity = merge(l.transform.opacity, k);
  return l;
}

/** Slide by (dx, dy) px into place (or away from it when `out`). */
export function slide(l: Layer, d: Vec2, m: Move, out = false): Layer {
  const p = pos(l);
  const away: Vec2 = [p[0] + d[0], p[1] + d[1]];
  const k = out ? keys<Vec2>([m.at, p, m.ease ?? 'easeIn'], [m.at + m.dur, away]) : keys<Vec2>([m.at, away, m.ease ?? 'smooth'], [m.at + m.dur, p]);
  l.transform.position = merge(l.transform.position, k);
  return l;
}

const zero = () => ({ v: 0 });

/** Wipe the layer on from a side (its box revealed), or off (covered starting from that side). */
export function wipe(l: Layer, from: Side, m: Move, out = false): Layer {
  const r: Reveal = l.reveal ?? { left: zero(), right: zero(), top: zero(), bottom: zero() };
  // Wiping on from the left: the right side starts fully covered.
  const covered: Side = from === 'left' ? 'right' : from === 'right' ? 'left' : from === 'top' ? 'bottom' : 'top';
  const side = out ? from : covered;
  const k = out ? keys<number>([m.at, 0, m.ease ?? 'easeIn'], [m.at + m.dur, 100]) : keys<number>([m.at, 100, m.ease ?? 'smooth'], [m.at + m.dur, 0]);
  r[side] = merge(r[side], k);
  l.reveal = r;
  return l;
}

/** Grow from nothing (scale), around the anchor. */
export function grow(l: Layer, m: Move, out = false, axis: 'both' | 'x' | 'y' = 'both'): Layer {
  const s = vec(l.transform.scale, 0, [100, 100]);
  const small: Vec2 = [axis === 'y' ? s[0] : 0, axis === 'x' ? s[1] : 0];
  const k = out ? keys<Vec2>([m.at, s, m.ease ?? 'easeIn'], [m.at + m.dur, small]) : keys<Vec2>([m.at, small, m.ease ?? 'smooth'], [m.at + m.dur, s]);
  l.transform.scale = merge(l.transform.scale, k);
  return l;
}

/** Letters, words or lines come in one after another (fading and rising a little). */
export function reveal(l: TextLayer, by: TextAnimator['by'], m: Move, rise = 0, out = false): TextLayer {
  const a: TextAnimator = {
    id: uid('a'),
    name: out ? `Out by ${by}` : `In by ${by}`,
    by,
    start: out ? keys<number>([m.at, 0, 'easeIn'], [m.at + m.dur, 100]) : keys<number>([m.at, 0, m.ease ?? 'easeOut'], [m.at + m.dur, 100]),
    end: { v: 100 },
    offset: { v: 0 },
    shape: 'square',
    opacity: { v: 0 },
    ...(rise ? { position: { v: [0, rise] as Vec2 } } : {}),
  };
  if (out) {
    // Out: the selection grows from the first unit on, taking each away.
    a.start = { v: 0 };
    a.end = keys<number>([m.at, 0, 'easeIn'], [m.at + m.dur, 100]);
  }
  l.animators = [...(l.animators ?? []), a];
  return l;
}

/** The time markers for a composition: IN over by `inEnd`, OUT taking `out` seconds. */
export function setPhases(c: Composition, inEnd: number, out: number, loop?: { start: number; end: number }): Composition {
  c.markers = { inEnd, outStart: Math.max(inEnd, c.duration - out), loop: loop ?? null };
  return c;
}
