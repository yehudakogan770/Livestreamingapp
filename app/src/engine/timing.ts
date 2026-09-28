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
  let pos = playback.playing ? playback.posS + Math.max(0, now - playback.at) / 1000 : playback.posS;
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

/** 0 → 1 as a blank (or panic) fades in; 1 → 0 as it fades out. */
export function fadeAmount(on: boolean, changedAt: number, now: number): number {
  const k = Math.min(1, Math.max(0, (now - changedAt) / BLANK_FADE_MS));
  return on ? k : 1 - k;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** How the incoming and outgoing pictures look at progress `p` of a transition. */
export interface Mix {
  /** Opacity of the incoming picture. */
  inOpacity: number;
  /** Opacity of the outgoing picture. */
  outOpacity: number;
  /** Black drawn over both (dip). */
  black: number;
  /** CSS clip-path for the incoming picture (wipe). */
  inClip?: string;
  /** Horizontal offsets in % (slide). */
  inShift?: number;
  outShift?: number;
}

export function mixAt(kind: TransitionKind, p: number): Mix {
  const x = Math.min(1, Math.max(0, p));
  switch (kind) {
    case 'cut':
      return { inOpacity: x >= 1 ? 1 : 0, outOpacity: 1, black: 0 };
    case 'fade':
      return { inOpacity: x, outOpacity: 1, black: 0 };
    case 'merge':
      return { inOpacity: smooth(x), outOpacity: 1 - smooth(x) * 0.35, black: 0 };
    case 'dip':
      return x < 0.5 ? { inOpacity: 0, outOpacity: 1, black: smooth(x * 2) } : { inOpacity: 1, outOpacity: 0, black: smooth((1 - x) * 2) };
    case 'wipe':
      return { inOpacity: 1, outOpacity: 1, black: 0, inClip: `inset(0 ${((1 - x) * 100).toFixed(3)}% 0 0)` };
    case 'slide': {
      const e = smooth(x);
      return { inOpacity: 1, outOpacity: 1, black: 0, inShift: (1 - e) * 100, outShift: -e * 100 };
    }
  }
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

/** Whether the countdown's numbers show right now (after zero, "take it off" hides them). */
export function countdownVisible(c: Countdown, now: number): boolean {
  return !(countdownFinished(c, now) && c.atZero.type !== 'hold' && c.atZero.type !== 'showText');
}
