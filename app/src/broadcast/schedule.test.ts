import { describe, expect, it } from 'vitest';
import { due, nextAt } from './schedule';

describe('go live at a set time', () => {
  it('picks today, or tomorrow when the time has passed', () => {
    const now = new Date(2026, 9, 5, 18, 0);
    expect(new Date(nextAt('19:30', now)!).getDate()).toBe(5);
    expect(new Date(nextAt('17:00', now)!).getDate()).toBe(6);
    expect(nextAt('7pm', now)).toBeNull();
  });
  it('starts the stream early with the countdown, then it is time', () => {
    const s = { at: 100 * 60_000, earlyMin: 10 };
    expect(due(s, 80 * 60_000)).toBe('wait');
    expect(due(s, 91 * 60_000)).toBe('start');
    expect(due(s, 100 * 60_000)).toBe('time');
  });
});
