import { describe, expect, it } from 'vitest';
import { BLEND_MODES, BLEND_GROUPS, blendChannel, blendRGB, compositePixel, dissolveNoise } from './blend';

describe('blend modes', () => {
  it('has all 27 Photoshop layer blend modes, grouped as Photoshop groups them', () => {
    expect(BLEND_MODES).toHaveLength(27);
    expect(new Set(BLEND_GROUPS.flat())).toEqual(new Set(BLEND_MODES));
  });

  it('matches the published formulas on sample values', () => {
    const b = 0.6,
      s = 0.3;
    expect(blendChannel('multiply', b, s)).toBeCloseTo(0.18);
    expect(blendChannel('screen', b, s)).toBeCloseTo(0.6 + 0.3 - 0.18);
    expect(blendChannel('darken', b, s)).toBe(0.3);
    expect(blendChannel('lighten', b, s)).toBe(0.6);
    expect(blendChannel('colorBurn', b, s)).toBeCloseTo(1 - Math.min(1, 0.4 / 0.3));
    expect(blendChannel('colorDodge', b, s)).toBeCloseTo(Math.min(1, 0.6 / 0.7));
    expect(blendChannel('linearBurn', b, s)).toBeCloseTo(0);
    expect(blendChannel('linearDodge', b, s)).toBeCloseTo(0.9);
    // Overlay is hard light with the layers swapped: backdrop 0.6 > 0.5 → screen(s, 2b − 1).
    expect(blendChannel('overlay', b, s)).toBeCloseTo(0.3 + 0.2 - 0.3 * 0.2);
    expect(blendChannel('hardLight', b, s)).toBeCloseTo(2 * 0.6 * 0.3);
    // Photoshop's soft light (s ≤ 0.5): 2bs + b²(1 − 2s).
    expect(blendChannel('softLight', b, s)).toBeCloseTo(2 * 0.6 * 0.3 + 0.36 * 0.4);
    expect(blendChannel('softLight', b, 0.8)).toBeCloseTo(2 * 0.6 * 0.2 + Math.sqrt(0.6) * 0.6);
    expect(blendChannel('linearLight', b, s)).toBeCloseTo(0.2);
    expect(blendChannel('pinLight', b, s)).toBeCloseTo(0.6);
    expect(blendChannel('pinLight', 0.9, s)).toBeCloseTo(0.6);
    expect(blendChannel('hardMix', b, s)).toBe(0);
    expect(blendChannel('hardMix', b, 0.5)).toBe(1);
    expect(blendChannel('difference', b, s)).toBeCloseTo(0.3);
    expect(blendChannel('exclusion', b, s)).toBeCloseTo(0.9 - 0.36);
    expect(blendChannel('subtract', b, s)).toBeCloseTo(0.3);
    expect(blendChannel('divide', b, s)).toBe(1);
    expect(blendChannel('divide', 0.15, s)).toBeCloseTo(0.5);
    expect(blendChannel('vividLight', b, s)).toBeCloseTo(1 - Math.min(1, 0.4 / 0.6));
  });

  it('keeps every separable mode in range and neutral where it should be', () => {
    for (const m of BLEND_MODES) {
      for (let i = 0; i <= 10; i++)
        for (let j = 0; j <= 10; j++) {
          const v = blendRGB(m, [i / 10, j / 10, 0.5], [j / 10, i / 10, 0.25]);
          for (const c of v) {
            expect(c).toBeGreaterThanOrEqual(-1e-9);
            expect(c).toBeLessThanOrEqual(1 + 1e-9);
          }
        }
    }
    // Multiply by white, screen with black, add black: no change.
    expect(blendRGB('multiply', [0.2, 0.4, 0.6], [1, 1, 1])).toEqual([0.2, 0.4, 0.6]);
    expect(blendRGB('screen', [0.2, 0.4, 0.6], [0, 0, 0])).toEqual([0.2, 0.4, 0.6]);
    expect(blendRGB('linearDodge', [0.2, 0.4, 0.6], [0, 0, 0])).toEqual([0.2, 0.4, 0.6]);
  });

  it('non-separable modes keep the luminosity they should', () => {
    const lum = (c: number[]) => 0.3 * c[0]! + 0.59 * c[1]! + 0.11 * c[2]!;
    const cb = [0.2, 0.5, 0.7],
      cs = [0.9, 0.3, 0.1];
    expect(lum(blendRGB('color', cb, cs))).toBeCloseTo(lum(cb), 5);
    expect(lum(blendRGB('hue', cb, cs))).toBeCloseTo(lum(cb), 5);
    expect(lum(blendRGB('saturation', cb, cs))).toBeCloseTo(lum(cb), 5);
    expect(lum(blendRGB('luminosity', cb, cs))).toBeCloseTo(lum(cs), 5);
    // Darker color picks a whole color.
    expect(blendRGB('darkerColor', cb, cs)).toEqual(lum(cb) < lum(cs) ? cb : cs);
    expect(blendRGB('lighterColor', cb, cs)).toEqual(lum(cb) > lum(cs) ? cb : cs);
  });

  it('composites with alpha like Photoshop: normal at 50 % over opaque is the average', () => {
    const d = new Float32Array([0.2, 0.4, 0.6, 1]);
    compositePixel('normal', d, 0, 1, 1, 1, 0.5);
    expect([...d].map((v) => +v.toFixed(4))).toEqual([0.6, 0.7, 0.8, 1]);
    // Over transparent, the source shows as is.
    const t = new Float32Array([0, 0, 0, 0]);
    compositePixel('multiply', t, 0, 0.3, 0.6, 0.9, 0.5);
    expect([...t].map((v) => +v.toFixed(4))).toEqual([0.3, 0.6, 0.9, 0.5]);
    // Two half-opaque layers make 75 % coverage.
    compositePixel('normal', t, 0, 0.3, 0.6, 0.9, 0.5);
    expect(t[3]).toBeCloseTo(0.75);
  });

  it('dissolve is a stable per-pixel pattern', () => {
    expect(dissolveNoise(10, 20)).toBe(dissolveNoise(10, 20));
    let on = 0;
    for (let i = 0; i < 10000; i++) if (dissolveNoise(i % 100, Math.floor(i / 100)) < 0.3) on++;
    expect(on / 10000).toBeGreaterThan(0.27);
    expect(on / 10000).toBeLessThan(0.33);
  });
});
