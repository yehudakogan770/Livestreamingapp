import { describe, expect, it } from 'vitest';
import { demoApply, demoTick } from './demo';
import { emptyShow } from './client';
import { countdownRemaining, countdownVisible, formatCountdown } from './timing';
import { nextClockTime, parseLength } from '../views/CountdownDialog';
import type { Action } from './types/Action';
import type { Show } from './types/Show';

const MIN = 60_000;
const run = (show: Show, steps: [Action, number][]) => steps.reduce((s, [a, t]) => demoApply(s, a, t), show);

describe('countdown text', () => {
  it('reads like a broadcast clock: rounds up, seconds only in the last minute', () => {
    expect(formatCountdown(5 * MIN, 'auto')).toBe('5:00');
    expect(formatCountdown(59_001, 'auto')).toBe('1:00');
    expect(formatCountdown(59_000, 'auto')).toBe('59');
    expect(formatCountdown(9_200, 'auto')).toBe('10');
    expect(formatCountdown(1, 'auto')).toBe('1');
    expect(formatCountdown(0, 'auto')).toBe('0');
    expect(formatCountdown(3_725_000, 'auto')).toBe('1:02:05');
    expect(formatCountdown(90 * MIN, 'minSec')).toBe('90:00');
    expect(formatCountdown(65_000, 'hourMinSec')).toBe('0:01:05');
  });
});

describe('countdown rules (same as the engine)', () => {
  it('adding time in the last seconds carries on from the new time', () => {
    const s = run(emptyShow(), [
      [{ type: 'setCountdownLength', lengthMs: MIN }, 0],
      [{ type: 'startCountdown' }, 0],
      [{ type: 'addCountdownTime', ms: MIN }, 55_000],
    ]);
    expect(countdownRemaining(s.countdown, 55_000)).toBe(65_000);
  });

  it('at zero it switches the Live Screen once, and the numbers can come off', () => {
    let s = run(emptyShow(), [
      [{ type: 'addSource', source: { id: 'open', name: 'Opening', kind: { type: 'pattern' } } }, 0],
      [{ type: 'updateCountdown', patch: { atZero: { type: 'cutTo', sourceId: 'open' } } }, 0],
      [{ type: 'setCountdownLength', lengthMs: 5_000 }, 0],
      [{ type: 'startCountdown' }, 0],
    ]);
    expect(demoTick(s, 4_000)).toBeNull();
    s = demoTick(s, 5_000)!;
    expect(s.screens.live.program).toBe('open');
    expect(demoTick(s, 6_000)).toBeNull();
    expect(countdownVisible(s.countdown, 6_000)).toBe(false);
  });

  it('“go to black” at zero blanks only the screens showing the countdown', () => {
    let s = run(emptyShow(), [
      [{ type: 'addSource', source: { id: 'cd', name: 'Countdown', kind: { type: 'countdown', background: '#000000' } } }, 0],
      [{ type: 'cutTo', screen: 'back', sourceId: 'cd' }, 0],
      [{ type: 'updateCountdown', patch: { atZero: { type: 'blank' } } }, 0],
      [{ type: 'setCountdownLength', lengthMs: 1_000 }, 0],
      [{ type: 'startCountdown' }, 0],
    ]);
    s = demoTick(s, 1_000)!;
    expect(s.screens.back.blank).toBe(true);
    expect(s.screens.live.blank).toBe(false);
  });

  it('“show the end text” keeps it on screen at zero', () => {
    const s = run(emptyShow(), [
      [{ type: 'updateCountdown', patch: { atZero: { type: 'showText' } } }, 0],
      [{ type: 'setCountdownLength', lengthMs: 1_000 }, 0],
      [{ type: 'startCountdown' }, 0],
    ]);
    expect(countdownVisible(s.countdown, 2_000)).toBe(true);
  });

  it('can be moved to any second: jump, nudge by 10 s', () => {
    const s = run(emptyShow(), [
      [{ type: 'startCountdown' }, 0],
      [{ type: 'setCountdownRemaining', ms: 30_000 }, 1_000],
      [{ type: 'addCountdownTime', ms: -10_000 }, 1_000],
    ]);
    expect(countdownRemaining(s.countdown, 1_000)).toBe(20_000);
  });
});

describe('countdown set-up helpers', () => {
  it('understands lengths typed as minutes, m:ss or h:mm:ss', () => {
    expect(parseLength('5')).toBe(5 * MIN);
    expect(parseLength('7:30')).toBe(450_000);
    expect(parseLength('1:05:00')).toBe(65 * MIN);
    expect(parseLength('')).toBeNull();
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('0')).toBeNull();
  });

  it('counts down to the next time the clock shows that time', () => {
    const now = new Date(2026, 8, 28, 19, 0, 0);
    expect(nextClockTime('19:30', now)).toBe(new Date(2026, 8, 28, 19, 30).getTime());
    expect(nextClockTime('18:00', now)).toBe(new Date(2026, 8, 29, 18, 0).getTime());
    expect(nextClockTime('nope', now)).toBeNull();
  });
});
