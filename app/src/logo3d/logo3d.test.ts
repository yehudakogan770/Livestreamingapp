import { describe, expect, it } from 'vitest';
import { defaultLogo3d } from '../engine/logo3d';
import { logoPose } from './renderer';
import { keepsTransparency } from './export';

describe('3D logo motion', () => {
  const base = { ...defaultLogo3d(), seconds: 4, angle: 0 };
  it('a full spin goes all the way round once per turn', () => {
    const l = { ...base, motion: 'spin' as const };
    expect(logoPose(l, 0).angle).toBeCloseTo(0);
    expect(logoPose(l, 1000).angle).toBeCloseTo(90);
    expect(Math.abs(logoPose(l, 2000).angle)).toBeCloseTo(180);
    expect(logoPose(l, 4000).angle).toBeCloseTo(0);
  });
  it('back and forth stays within the swing, and pauses hold at each end', () => {
    const ease = { ...base, motion: 'swing' as const, swing: 30, ends: 'ease' as const };
    expect(logoPose(ease, 1000).angle).toBeCloseTo(30);
    expect(logoPose(ease, 3000).angle).toBeCloseTo(-30);
    const pause = { ...ease, ends: 'pause' as const };
    expect(logoPose(pause, 800).angle).toBeCloseTo(30);
    expect(logoPose(pause, 1200).angle).toBeCloseTo(30);
    for (let t = 0; t < 4000; t += 97) expect(Math.abs(logoPose({ ...ease, ends: 'bounce' }, t).angle)).toBeLessThanOrEqual(30.0001);
  });
  it('stands still at its angle when stopped', () => {
    expect(logoPose({ ...base, playing: false, angle: 25 }, 1234)).toEqual({ angle: 25, bob: 0 });
  });
  it('knows which formats can be see-through', () => {
    expect(keepsTransparency('mp4')).toBe(false);
    expect(keepsTransparency('mov')).toBe(true);
    expect(keepsTransparency('webm')).toBe(true);
  });
});
