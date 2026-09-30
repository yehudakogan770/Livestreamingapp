// How things come on screen (titles, the Pesukim bar, each new word): one
// set of effects, worked out here so the screens and the recording match.

import { useEffect, useRef, useState } from 'react';
import type { TextEntrance } from './types/TextEntrance';

export type EffectKind = TextEntrance | 'none';

/** The effects to choose from, in order, with their names. */
export const EFFECTS: [TextEntrance, string][] = [
  ['build', 'Build'],
  ['fade', 'Fade'],
  ['slide', 'Slide'],
  ['rise', 'Rise'],
  ['drop', 'Drop'],
  ['pop', 'Pop'],
  ['zoom', 'Zoom'],
  ['flip', 'Flip'],
  ['blur', 'Focus'],
  ['wipe', 'Wipe'],
  ['typewriter', 'Typewriter'],
  ['bounce', 'Bounce'],
  ['spin', 'Spin'],
  ['shine', 'Shine'],
];

/** Where an effect is at a moment. Moves are in parts of the frame (width for dx, height for dy and blur). */
export interface EffectState {
  alpha: number;
  dx: number;
  dy: number;
  scale: number;
  scaleY: number;
  /** Degrees. */
  rotate: number;
  blur: number;
  /** How much is shown from its start side (1: all). */
  reveal: number;
  /** A light sweeping across (0 – 1 along), or null. */
  shine: number | null;
}

export const STILL: EffectState = { alpha: 1, dx: 0, dy: 0, scale: 1, scaleY: 1, rotate: 0, blur: 0, reveal: 1, shine: null };

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - (1 - x) ** 3;
/** Past the end and back (a bounce). */
const backOut = (x: number) => {
  const c = 2.2;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
};

/** How long an effect takes, ms (typewriter: by the number of letters). */
export function effectMs(kind: EffectKind, letters = 12): number {
  if (kind === 'typewriter') return Math.min(2500, Math.max(500, letters * 45));
  if (kind === 'shine') return 1300;
  if (kind === 'bounce' || kind === 'spin') return 800;
  return kind === 'none' || kind === 'build' ? 0 : 600;
}

/** Where the effect is `t` ms after it started. `letters`: for the typewriter. */
export function effectAt(kind: EffectKind, t: number, letters = 12): EffectState {
  const dur = effectMs(kind, letters);
  if (dur === 0 || t >= dur) return STILL;
  const p = clamp(t / dur);
  const e = easeOut(p);
  switch (kind) {
    case 'fade':
      return { ...STILL, alpha: e };
    case 'slide':
      return { ...STILL, alpha: e, dx: -(1 - e) * 0.08 };
    case 'rise':
      return { ...STILL, alpha: e, dy: (1 - e) * 0.06 };
    case 'drop':
      return { ...STILL, alpha: e, dy: -(1 - e) * 0.08 };
    case 'pop':
      return { ...STILL, alpha: e, scale: 0.85 + 0.15 * e };
    case 'zoom':
      return { ...STILL, alpha: e, scale: 1.45 - 0.45 * e };
    case 'flip':
      return { ...STILL, alpha: clamp(p * 2), scaleY: Math.max(0.02, e) };
    case 'blur':
      return { ...STILL, alpha: e, blur: (1 - e) * 0.02 };
    case 'wipe':
      return { ...STILL, reveal: e };
    case 'typewriter':
      return { ...STILL, reveal: Math.min(1, Math.ceil(p * letters) / Math.max(1, letters)) };
    case 'bounce':
      return { ...STILL, alpha: clamp(p * 3), dy: (1 - backOut(p)) * 0.07 };
    case 'spin':
      return { ...STILL, alpha: e, rotate: -(1 - e) * 14, scale: 0.7 + 0.3 * e };
    case 'shine': {
      const inT = clamp(t / 400);
      const sweep = (t - 400) / 800;
      return { ...STILL, alpha: easeOut(inT), shine: sweep >= 0 && sweep <= 1 ? sweep : null };
    }
    default:
      return STILL;
  }
}

/** Milliseconds since this was first shown, updated every frame while an effect runs. */
export function useEffectClock(kind: EffectKind, letters = 12, restart: unknown = null): number {
  const [t, setT] = useState(0);
  const start = useRef(0);
  useEffect(() => {
    const dur = effectMs(kind, letters);
    start.current = performance.now();
    setT(0);
    if (!dur) return;
    let raf = requestAnimationFrame(function tick() {
      const now = performance.now() - start.current;
      setT(now);
      if (now < dur) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [kind, letters, restart]);
  return t;
}

/**
 * CSS for an effect's state (screens), in container units of the frame.
 * `origin`: where it grows from, `fromEnd`: slides and wipes from the right.
 */
export function effectStyle(s: EffectState, fromEnd = false): React.CSSProperties {
  if (s === STILL) return {};
  const dir = fromEnd ? -1 : 1;
  const tf = [
    s.dx || s.dy ? `translate(${s.dx * dir * 100}cqw, ${s.dy * 100}cqh)` : '',
    s.scale !== 1 ? `scale(${s.scale})` : '',
    s.scaleY !== 1 ? `scaleY(${s.scaleY})` : '',
    s.rotate ? `rotate(${s.rotate * dir}deg)` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const hide = `${(1 - s.reveal) * 100}%`;
  return {
    opacity: s.alpha,
    transform: tf || undefined,
    filter: s.blur ? `blur(${s.blur * 100}cqh)` : undefined,
    clipPath: s.reveal < 1 ? (fromEnd ? `inset(0 0 0 ${hide})` : `inset(0 ${hide} 0 0)`) : undefined,
  };
}

/** The effect a word change uses (the Pesukim's words). */
export const wordEffect = (w: string): EffectKind => (w === 'cut' ? 'none' : (w as EffectKind));
