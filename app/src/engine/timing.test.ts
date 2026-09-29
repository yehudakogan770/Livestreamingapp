import { defaultFilters } from './audio';
import type { TransitionKind } from './types/TransitionKind';
import { defaultAdjust } from './chroma';
import { describe, expect, it } from 'vitest';
import { clock, fadeAmount, mixAt, sourceEnded, sourcePosition, transitionProgress } from './timing';
import type { Source } from './types/Source';
import type { ScreenState } from './types/ScreenState';

const video = (durationS: number, looping: boolean, playing: boolean, posS: number, at: number): Source => ({
  id: 'v',
  name: 'Video',
  kind: { type: 'video', path: '', durationS, playback: { playing, posS, at } },
  volume: 1,
  muted: false,
  looping,
  fit: 'contain',
  audio: { follow: true, toMaster: true, toA: true, toB: true, delayMs: 0, filters: defaultFilters() },
  key: { enabled: false, color: '#00b140', similarity: 0.4, smoothness: 0.08, spill: 0.3 },
  adjust: defaultAdjust(),
});

const screen = (over: Partial<ScreenState> = {}): ScreenState => ({
  preview: null,
  program: 'b',
  previous: 'a',
  transition: { kind: 'fade', durationMs: 1000, startedAt: 10_000 },
  tbar: 0,
  blank: false,
  blankChangedAt: 0,
  blankFadeMs: 0,
  flashAt: 0,
  ...over,
});

// Same cases as crates/engine/src/timing.rs.
describe('sourcePosition', () => {
  it('a paused video stays put', () => expect(sourcePosition(video(30, false, false, 12, 1000), 99_000)).toBe(12));
  it('a playing video advances with the clock', () => expect(sourcePosition(video(30, false, true, 2, 1000), 4500)).toBeCloseTo(5.5));
  it('a looping video wraps around', () => {
    const v = video(10, true, true, 8, 0);
    expect(sourcePosition(v, 5000)).toBeCloseTo(3);
    expect(sourceEnded(v, 5000)).toBe(false);
  });
  it('a one-shot video stops at its end', () => {
    const v = video(10, false, true, 8, 0);
    expect(sourcePosition(v, 5000)).toBe(10);
    expect(sourceEnded(v, 5000)).toBe(true);
  });
});

describe('transitionProgress', () => {
  it('runs from 0 to 1 over the duration', () => {
    expect(transitionProgress(screen(), 10_000)).toBe(0);
    expect(transitionProgress(screen(), 10_500)).toBe(0.5);
    expect(transitionProgress(screen(), 12_000)).toBe(1);
  });
  it('is finished for cuts and when nothing was on air before', () => {
    expect(transitionProgress(screen({ transition: { kind: 'cut', durationMs: 100, startedAt: 10_000 } }), 10_000)).toBe(1);
    expect(transitionProgress(screen({ previous: null }), 10_000)).toBe(1);
  });
});

describe('mixAt', () => {
  it('fades the new picture in over the old one', () => {
    expect(mixAt('fade', 0.25)).toMatchObject({ inOpacity: 0.25, outOpacity: 1, black: 0 });
  });
  it('dips through full black at the midpoint, never showing both', () => {
    const early = mixAt('dip', 0.25);
    const mid = mixAt('dip', 0.5);
    const late = mixAt('dip', 0.75);
    expect(early.inOpacity).toBe(0);
    expect(mid.black).toBe(1);
    expect(late.outOpacity).toBe(0);
  });
  it('wipes and slides reach exactly the new picture at the end', () => {
    expect(mixAt('wipe', 1).inClip).toBe('inset(0.000% 0.000% 0.000% 0.000%)');
    expect(mixAt('slide', 1)).toMatchObject({ inShift: 0, outShift: -100 });
  });

  it('every transition starts on the old picture and ends on the new one', () => {
    const kinds: TransitionKind[] = [
      'fade',
      'merge',
      'dip',
      'flash',
      'wipe',
      'wipeLeft',
      'wipeDown',
      'wipeUp',
      'split',
      'splitVertical',
      'iris',
      'diamond',
      'slide',
      'slideRight',
      'slideDown',
      'slideUp',
      'cover',
      'reveal',
      'zoom',
      'zoomOut',
      'blur',
    ];
    for (const k of kinds) {
      const end = mixAt(k, 1);
      expect(end.inOpacity, k).toBeCloseTo(1);
      expect(end.black, k).toBeCloseTo(0);
      expect(end.white ?? 0, k).toBeCloseTo(0);
      expect(end.inShift ?? 0, k).toBeCloseTo(0);
      expect(end.inShiftY ?? 0, k).toBeCloseTo(0);
      expect(end.inScale ?? 1, k).toBeCloseTo(1);
      expect(end.inBlur ?? 0, k).toBeCloseTo(0);
      // The old picture is gone or covered.
      if (end.outOnTop) expect(end.outOpacity === 0 || Math.abs(end.outShift ?? 0) >= 100, k).toBe(true);
      const start = mixAt(k, 0);
      const hidden =
        (start.outOnTop && start.outOpacity === 1 && !start.outShift) ||
        start.inOpacity === 0 ||
        Math.abs(start.inShift ?? 0) >= 100 ||
        Math.abs(start.inShiftY ?? 0) >= 100 ||
        !!start.inShape;
      expect(hidden, k).toBe(true);
    }
    expect(mixAt('iris', 0.5).inClip).toMatch(/^circle\(/);
    expect(mixAt('diamond', 1).inClip).toBe('polygon(50% -50.000%, 150.000% 50%, 50% 150.000%, -50.000% 50%)');
    expect(mixAt('split', 0).inClip).toBe('inset(0.000% 50.000% 0.000% 50.000%)');
  });
  it('clamps out-of-range progress', () => {
    expect(mixAt('fade', 2).inOpacity).toBe(1);
    expect(mixAt('fade', -1).inOpacity).toBe(0);
  });
});

describe('helpers', () => {
  it('fades blank in and out over 300 ms', () => {
    expect(fadeAmount(true, 1000, 1150)).toBeCloseTo(0.5);
    expect(fadeAmount(false, 1000, 1300)).toBe(0);
  });
  it('formats clock times', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(75.9)).toBe('1:15');
    expect(clock(3725)).toBe('1:02:05');
  });
});
