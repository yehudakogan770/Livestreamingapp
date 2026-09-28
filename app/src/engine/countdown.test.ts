import { describe, expect, it } from 'vitest';
import { demoApply, demoTick } from './demo';
import { countdownTarget, mainCountdown, timerOf } from './countdowns';
import { defaultCountdown, emptyShow } from './client';
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

const withCd = (extra: [Action, number][] = []) =>
  run(emptyShow(), [[{ type: 'addSource', source: { id: 'cd', name: 'Countdown', kind: { type: 'countdown', background: '#000000', timer: defaultCountdown() } } }, 0], ...extra]);
const t = (s: Show, id = 'cd') => timerOf(s, id)!;

describe('countdown rules (same as the engine)', () => {
  it('adding time in the last seconds carries on from the new time', () => {
    const s = withCd([
      [{ type: 'setCountdownLength', id: 'cd', lengthMs: MIN }, 0],
      [{ type: 'startCountdown', id: 'cd' }, 0],
      [{ type: 'addCountdownTime', id: 'cd', ms: MIN }, 55_000],
    ]);
    expect(countdownRemaining(t(s), 55_000)).toBe(65_000);
  });

  it('at zero it holds on 0, then switches the screen it is on once, and the numbers can come off', () => {
    let s = withCd([
      [{ type: 'addSource', source: { id: 'open', name: 'Opening', kind: { type: 'pattern' } } }, 0],
      [{ type: 'updateCountdown', id: 'cd', patch: { atZero: { type: 'cutTo', sourceId: 'open' } } }, 0],
      [{ type: 'setCountdownLength', id: 'cd', lengthMs: 5_000 }, 0],
      [{ type: 'cutTo', screen: 'live', sourceId: 'cd' }, 0],
    ]);
    expect(demoTick(s, 4_000)).toBeNull();
    expect(demoTick(s, 5_000)).toBeNull(); // on 0: holds a moment first
    expect(countdownVisible(t(s), 5_500)).toBe(true); // the 0 is still showing
    s = demoTick(s, 6_500)!;
    expect(s.screens.live.program).toBe('open');
    expect(demoTick(s, 8_000)).toBeNull();
    expect(countdownVisible(t(s), 8_000)).toBe(false);
  });

  it('“go to black” at zero blanks only the screens showing that countdown', () => {
    let s = withCd([
      [{ type: 'cutTo', screen: 'back', sourceId: 'cd' }, 0],
      [{ type: 'updateCountdown', id: 'cd', patch: { atZero: { type: 'blank' } } }, 0],
      [{ type: 'setCountdownLength', id: 'cd', lengthMs: 1_000 }, 0],
      [{ type: 'startCountdown', id: 'cd' }, 0],
    ]);
    s = demoTick(s, 2_500)!;
    expect(s.screens.back.blank).toBe(true);
    expect(s.screens.live.blank).toBe(false);
  });

  it('“show the end text” keeps it on screen at zero', () => {
    const s = withCd([
      [{ type: 'updateCountdown', id: 'cd', patch: { atZero: { type: 'showText' } } }, 0],
      [{ type: 'setCountdownLength', id: 'cd', lengthMs: 1_000 }, 0],
      [{ type: 'startCountdown', id: 'cd' }, 0],
    ]);
    expect(countdownVisible(t(s), 2_000)).toBe(true);
  });

  it('can be moved to any second: jump, nudge by 10 s', () => {
    const s = withCd([
      [{ type: 'startCountdown', id: 'cd' }, 0],
      [{ type: 'setCountdownRemaining', id: 'cd', ms: 30_000 }, 1_000],
      [{ type: 'addCountdownTime', id: 'cd', ms: -10_000 }, 1_000],
    ]);
    expect(countdownRemaining(t(s), 1_000)).toBe(20_000);
  });

  it('a countdown prepared in Next changes on its own while another is on air', () => {
    const s = withCd([
      [{ type: 'addSource', source: { id: 'nx', name: 'Countdown 2', kind: { type: 'countdown', background: '#000000', timer: defaultCountdown() } } }, 0],
      [{ type: 'cutTo', screen: 'live', sourceId: 'cd' }, 0],
      [{ type: 'setPreview', screen: 'live', sourceId: 'nx' }, 1_000],
      [{ type: 'setCountdownLength', id: 'nx', lengthMs: 10 * MIN }, 2_000],
    ]);
    expect(countdownTarget(s, 'live')).toEqual({ id: 'nx', where: 'next' });
    expect(countdownRemaining(t(s, 'cd'), 2_000)).toBe(5 * MIN - 2_000); // on air: untouched, counting
    expect(countdownRemaining(t(s, 'nx'), 60_000)).toBe(10 * MIN); // in Next: waiting
  });

  it('after the first TAKE, Next is left empty', () => {
    const s = withCd([
      [{ type: 'setPreview', screen: 'live', sourceId: 'cd' }, 0],
      [{ type: 'take', screen: 'live' }, 0],
    ]);
    expect(s.screens.live.program).toBe('cd');
    expect(s.screens.live.preview).toBeNull();
    expect(mainCountdown(s)).toBe('cd');
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
