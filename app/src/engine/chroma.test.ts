import { describe, expect, it } from 'vitest';
import { autoBalance, balanceGains, cropped, defaultAdjust, isAdjusted } from './chroma';

describe('picture adjustments', () => {
  it('the plain settings change nothing; an effect counts only when on', () => {
    expect(isAdjusted(defaultAdjust())).toBe(false);
    expect(isAdjusted({ ...defaultAdjust(), blur: { on: false, amount: 80 } })).toBe(false);
    expect(isAdjusted({ ...defaultAdjust(), blur: { on: true, amount: 80 } })).toBe(true);
    expect(isAdjusted({ ...defaultAdjust(), contrast: 10 })).toBe(true);
  });
  it('5600 K is neutral, warmer adds red', () => {
    expect(balanceGains(5600, 0)).toEqual([1, 1, 1]);
    const [r, , b] = balanceGains(7000, 0);
    expect(r).toBeGreaterThan(1);
    expect(b).toBeLessThan(1);
  });
  it('auto white balance makes a color cast grey', () => {
    const cast: [number, number, number] = [0.6, 0.5, 0.4];
    const { temperature, tint } = autoBalance(cast);
    const g = balanceGains(temperature, tint);
    const out = cast.map((c, i) => c * g[i]!);
    expect(Math.abs(out[0]! - out[2]!)).toBeLessThan(0.02);
    expect(Math.abs(out[1]! - (out[0]! + out[2]!) / 2)).toBeLessThan(0.03);
  });
  it('crop keeps the right share of the picture', () => {
    expect(cropped({ ...defaultAdjust(), cropLeft: 10, cropRight: 15, cropTop: 5 })).toEqual([0.75, 0.95]);
  });
});
