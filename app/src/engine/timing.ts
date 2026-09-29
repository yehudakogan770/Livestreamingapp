// Time calculations every window does on its own, so they all agree without
// asking the engine 60 times a second. These mirror crates/engine/src/timing.rs
// exactly; the tests in timing.test.ts use the same cases as the Rust tests.

import type { ScreenState } from './types/ScreenState';
import type { Source } from './types/Source';
import type { TransitionKind } from './types/TransitionKind';
import type { Countdown } from './types/Countdown';
import type { TimerFormat } from './types/TimerFormat';

/** How long a blank fades in or out (engine BLANK_FADE_MS). */
export const BLANK_FADE_MS = 300;
/** How long the monitor flash lasts (engine FLASH_MS). */
export const FLASH_MS = 2400;

/** Current playback position of a video, in seconds. Non-videos are at 0. */
export function sourcePosition(src: Source, now: number): number {
  if (src.kind.type !== 'video') return 0;
  const { durationS, playback } = src.kind;
  const speed = src.speed ?? 1;
  let pos = playback.playing ? playback.posS + (Math.max(0, now - playback.at) / 1000) * speed : playback.posS;
  if (durationS > 0) {
    pos = src.looping ? ((pos % durationS) + durationS) % durationS : Math.min(pos, durationS);
  }
  return Math.max(0, pos);
}

/** True when a non-looping video has played to its end. */
export function sourceEnded(src: Source, now: number): boolean {
  if (src.kind.type !== 'video') return false;
  const d = src.kind.durationS;
  return !src.looping && d > 0 && sourcePosition(src, now) >= d - 0.05;
}

/** Progress of a screen's current transition: 0 just started, 1 finished. */
export function transitionProgress(screen: ScreenState, now: number): number {
  const t = screen.transition;
  if (!t) return 1;
  if (screen.previous === null || t.kind === 'cut' || t.durationMs === 0) return 1;
  return Math.min(1, Math.max(0, (now - t.startedAt) / t.durationMs));
}

/** 0 → 1 as a blank (or panic) fades in; 1 → 0 as it fades out. `ms`: its length (0: the usual). */
export function fadeAmount(on: boolean, changedAt: number, now: number, ms = 0): number {
  const k = Math.min(1, Math.max(0, (now - changedAt) / (ms || BLANK_FADE_MS)));
  return on ? k : 1 - k;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** The part of the incoming picture that shows (fractions of the frame). */
export type Shape =
  /** A rectangle: how much is cut off at the top, right, bottom and left. */
  | { type: 'rect'; t: number; r: number; b: number; l: number }
  /** A circle from the middle; 1 covers the corners. */
  | { type: 'circle'; r: number }
  /** A diamond from the middle; 1 covers the corners. */
  | { type: 'diamond'; r: number };

/** How the incoming and outgoing pictures look at progress `p` of a transition. */
export interface Mix {
  /** Opacity of the incoming picture. */
  inOpacity: number;
  /** Opacity of the outgoing picture. */
  outOpacity: number;
  /** Black drawn over both (dip). */
  black: number;
  /** White drawn over both (flash). */
  white?: number;
  /** The visible part of the incoming picture (wipes, iris…). */
  inShape?: Shape;
  /** The same as a CSS clip-path. */
  inClip?: string;
  /** Offsets in % of the frame (slides). */
  inShift?: number;
  outShift?: number;
  inShiftY?: number;
  outShiftY?: number;
  /** Size, 1 = as is (zooms). */
  inScale?: number;
  outScale?: number;
  /** Blur, as a fraction of the frame height. */
  inBlur?: number;
  outBlur?: number;
  /** The outgoing picture is drawn over the incoming one (reveal, zoom out). */
  outOnTop?: boolean;
}

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

/** A shape as a CSS clip-path. */
export function clipPath(s: Shape): string {
  switch (s.type) {
    case 'rect':
      return `inset(${pct(s.t)} ${pct(s.r)} ${pct(s.b)} ${pct(s.l)})`;
    case 'circle':
      // CSS measures circle radii against the diagonal ÷ √2; half the diagonal covers the corners.
      return `circle(${pct(s.r * Math.SQRT1_2)} at 50% 50%)`;
    case 'diamond':
      return `polygon(50% ${pct(0.5 - s.r)}, ${pct(0.5 + s.r)} 50%, 50% ${pct(0.5 + s.r)}, ${pct(0.5 - s.r)} 50%)`;
  }
}

const rect = (t: number, r: number, b: number, l: number): Shape => ({ type: 'rect', t, r, b, l });

/** How blurred the pictures get in the middle of a blur transition. */
const BLUR = 0.03;

function mixOf(kind: TransitionKind, x: number): Mix {
  const e = smooth(x);
  const whole: Mix = { inOpacity: 1, outOpacity: 1, black: 0 };
  switch (kind) {
    case 'cut':
      return { inOpacity: x >= 1 ? 1 : 0, outOpacity: 1, black: 0 };
    case 'fade':
      return { inOpacity: x, outOpacity: 1, black: 0 };
    case 'merge':
      return { inOpacity: e, outOpacity: 1 - e * 0.35, black: 0 };
    case 'dip':
      return x < 0.5 ? { inOpacity: 0, outOpacity: 1, black: smooth(x * 2) } : { inOpacity: 1, outOpacity: 0, black: smooth((1 - x) * 2) };
    case 'flash':
      return x < 0.5 ? { inOpacity: 0, outOpacity: 1, black: 0, white: smooth(x * 2) } : { inOpacity: 1, outOpacity: 0, black: 0, white: smooth((1 - x) * 2) };
    case 'wipe':
      return { ...whole, inShape: rect(0, 1 - x, 0, 0) };
    case 'wipeLeft':
      return { ...whole, inShape: rect(0, 0, 0, 1 - x) };
    case 'wipeDown':
      return { ...whole, inShape: rect(0, 0, 1 - x, 0) };
    case 'wipeUp':
      return { ...whole, inShape: rect(1 - x, 0, 0, 0) };
    case 'split':
      return { ...whole, inShape: rect(0, (1 - x) / 2, 0, (1 - x) / 2) };
    case 'splitVertical':
      return { ...whole, inShape: rect((1 - x) / 2, 0, (1 - x) / 2, 0) };
    case 'iris':
      return { ...whole, inShape: { type: 'circle', r: e } };
    case 'diamond':
      return { ...whole, inShape: { type: 'diamond', r: e } };
    case 'slide':
      return { ...whole, inShift: (1 - e) * 100, outShift: -e * 100 };
    case 'slideRight':
      return { ...whole, inShift: -(1 - e) * 100, outShift: e * 100 };
    case 'slideDown':
      return { ...whole, inShiftY: -(1 - e) * 100, outShiftY: e * 100 };
    case 'slideUp':
      return { ...whole, inShiftY: (1 - e) * 100, outShiftY: -e * 100 };
    case 'cover':
      return { ...whole, inShift: (1 - e) * 100 };
    case 'reveal':
      return { ...whole, outShift: -e * 100, outOnTop: true };
    case 'zoom':
      return { inOpacity: e, outOpacity: 1, black: 0, inScale: 0.6 + 0.4 * e };
    case 'zoomOut':
      return { inOpacity: 1, outOpacity: 1 - e, black: 0, outScale: 1 + 0.6 * e, outOnTop: true };
    case 'stinger1':
    case 'stinger2':
      // The stinger covers the switch; programLayers cuts at its own point.
      return { inOpacity: x >= 0.5 ? 1 : 0, outOpacity: 1, black: 0 };
    case 'blur': {
      const b = Math.sin(Math.PI * x) * BLUR;
      return { inOpacity: smooth(Math.min(1, Math.max(0, (x - 0.3) / 0.4))), outOpacity: 1, black: 0, inBlur: b, outBlur: b };
    }
  }
}

/** Which stinger slot a transition plays, or null. */
export function stingerSlot(kind: TransitionKind): number | null {
  return kind === 'stinger1' ? 0 : kind === 'stinger2' ? 1 : null;
}

export function mixAt(kind: TransitionKind, p: number): Mix {
  const m = mixOf(kind, Math.min(1, Math.max(0, p)));
  if (m.inShape) m.inClip = clipPath(m.inShape);
  return m;
}

/** Format seconds as m:ss (or h:mm:ss). */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// ---- countdown (mirrors crates/engine/src/stage.rs) ----

/** Time left on the countdown at `now`, in ms. */
export function countdownRemaining(c: Countdown, now: number): number {
  return c.endsAt !== null ? Math.max(0, c.endsAt - now) : c.remainingMs;
}

/** Running and reached zero. */
export function countdownFinished(c: Countdown, now: number): boolean {
  return c.endsAt !== null && countdownRemaining(c, now) === 0;
}

/**
 * The countdown as text. Seconds are rounded up, so it reads 0:01 until the
 * very end and 0:00 only at zero, like every broadcast clock.
 */
export function formatCountdown(ms: number, format: TimerFormat): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  switch (format) {
    case 'hourMinSec':
      return `${h}:${String(m).padStart(2, '0')}:${ss}`;
    case 'minSec':
      return `${Math.floor(total / 60)}:${ss}`;
    case 'auto':
      if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
      if (total < 60) return String(total);
      return `${m}:${ss}`;
  }
}

/** How long the countdown holds on 0 before it fades and its at-zero action runs (engine ZERO_HOLD_MS). */
export const ZERO_HOLD_MS = 1500;

/** Reached zero and has held on 0 long enough: time to fade to what comes next. */
export function countdownDue(c: Countdown, now: number): boolean {
  return c.endsAt !== null && now >= c.endsAt + ZERO_HOLD_MS;
}

/** Whether the numbers show right now: they land on 0, hold, then fade unless "stay on 0" or words were chosen. */
export function countdownVisible(c: Countdown, now: number): boolean {
  return !(countdownDue(c, now) && c.atZero.type !== 'hold' && c.atZero.type !== 'showText');
}
