import { describe, expect, it } from 'vitest';
import {
  ADJUSTMENT_ORDER,
  applyCompiled,
  autoLevels,
  compile,
  curveTable,
  defaultParams,
  histogram,
  isIdentity,
  parseCube,
  pixelFn,
  writeCube,
  type ParamsMap,
} from './adjust';

const run = <T extends keyof ParamsMap>(t: T, p: Partial<ParamsMap[T]>, c: number[]) => {
  const o = [0, 0, 0];
  pixelFn(t, { ...defaultParams(t), ...p })(c[0]!, c[1]!, c[2]!, o);
  return o;
};

describe('adjustments', () => {
  it('offers the 16 Photoshop adjustment layers', () => {
    expect(ADJUSTMENT_ORDER).toHaveLength(16);
  });

  it('default settings change nothing (and are skipped when drawing)', () => {
    for (const t of ADJUSTMENT_ORDER) {
      if (['invert', 'posterize', 'threshold', 'gradientMap', 'blackWhite', 'photoFilter'].includes(t)) continue;
      expect(isIdentity(t, defaultParams(t))).toBe(true);
      const o = run(t, {}, [0.2, 0.5, 0.8]);
      expect(o[0]).toBeCloseTo(0.2, 2);
      expect(o[1]).toBeCloseTo(0.5, 2);
      expect(o[2]).toBeCloseTo(0.8, 2);
    }
  });

  it('levels map the input range and gamma', () => {
    const lv = defaultParams('levels');
    lv.rgb = { inBlack: 0.2, inWhite: 0.8, gamma: 1, outBlack: 0, outWhite: 1 };
    const o = [0, 0, 0];
    pixelFn('levels', lv)(0.2, 0.5, 0.8, o);
    expect(o[0]).toBeCloseTo(0);
    expect(o[1]).toBeCloseTo(0.5);
    expect(o[2]).toBeCloseTo(1);
    lv.rgb = { inBlack: 0, inWhite: 1, gamma: 2, outBlack: 0, outWhite: 1 };
    pixelFn('levels', lv)(0.25, 0.25, 0.25, o);
    expect(o[0]).toBeCloseTo(0.5);
  });

  it('curves pass through their points and stay smooth', () => {
    const t = curveTable(
      [
        [0, 0],
        [0.5, 0.7],
        [1, 1],
      ],
      1001,
    );
    expect(t[500]).toBeCloseTo(0.7, 3);
    expect(t[0]).toBe(0);
    expect(t[1000]).toBe(1);
    for (let i = 1; i < 1001; i++) expect(t[i]!).toBeGreaterThanOrEqual(t[i - 1]! - 1e-6);
  });

  it('invert, posterize and threshold', () => {
    expect(run('invert', {}, [0.2, 0.5, 1])).toEqual([0.8, 0.5, 0]);
    expect(run('posterize', { levels: 2 }, [0.4, 0.6, 1])).toEqual([0, 1, 1]);
    expect(run('threshold', { level: 128 }, [0.6, 0.6, 0.6])).toEqual([1, 1, 1]);
    expect(run('threshold', { level: 128 }, [0.4, 0.4, 0.4])).toEqual([0, 0, 0]);
  });

  it('hue/saturation turns a color around the wheel and desaturates', () => {
    const o = run('hueSaturation', { master: { hue: 120, sat: 0, light: 0 } }, [1, 0, 0]);
    expect(o[0]).toBeCloseTo(0);
    expect(o[1]).toBeCloseTo(1);
    const g = run('hueSaturation', { master: { hue: 0, sat: -100, light: 0 } }, [1, 0, 0]);
    expect(g[0]).toBeCloseTo(g[1]!);
    expect(g[1]).toBeCloseTo(g[2]!);
  });

  it('black & white uses the color sliders', () => {
    // Pure red with Reds at 40 % → 0.4 gray.
    expect(run('blackWhite', {}, [1, 0, 0])[0]).toBeCloseTo(0.4);
    expect(run('blackWhite', { reds: 100 }, [1, 0, 0])[0]).toBeCloseTo(1);
    // Yellow (r = g = 1) uses the Yellows slider.
    expect(run('blackWhite', {}, [1, 1, 0])[0]).toBeCloseTo(0.6);
    // Gray stays gray.
    expect(run('blackWhite', {}, [0.5, 0.5, 0.5])[0]).toBeCloseTo(0.5);
  });

  it('channel mixer and exposure', () => {
    const o = run('channelMixer', { r: [0, 100, 0, 0] }, [0.1, 0.7, 0.3]);
    expect(o[0]).toBeCloseTo(0.7);
    const e = run('exposure', { exposure: 1 }, [0.5, 0.5, 0.5]);
    // One stop up in linear light: 0.214 → 0.428 linear → 0.686 sRGB.
    expect(e[0]).toBeCloseTo(0.686, 2);
  });

  it('gradient map follows the gradient by luminance', () => {
    const o = run('gradientMap', {}, [1, 1, 1]);
    expect(o.map((v) => +v.toFixed(6))).toEqual([1, 1, 1]);
    const r = run('gradientMap', { reverse: true }, [1, 1, 1]);
    expect(r.map((v) => Math.abs(+v.toFixed(6)))).toEqual([0, 0, 0]);
  });

  it('selective color: adding cyan to reds lowers red only in red pixels', () => {
    const p = defaultParams('selectiveColor');
    p.ranges.reds = { c: 50, m: 0, y: 0, k: 0 };
    const o = [0, 0, 0];
    pixelFn('selectiveColor', p)(0.9, 0.1, 0.1, o);
    expect(o[0]).toBeLessThan(0.9);
    pixelFn('selectiveColor', p)(0.1, 0.1, 0.9, o);
    expect(o).toEqual([0.1, 0.1, 0.9].map((v) => expect.closeTo(v, 5)));
  });

  it('the GPU tables match the exact functions', () => {
    const cases: [keyof ParamsMap, unknown][] = [
      [
        'curves',
        {
          ...defaultParams('curves'),
          rgb: [
            [0, 0],
            [0.3, 0.45],
            [1, 1],
          ],
        },
      ],
      ['hueSaturation', { ...defaultParams('hueSaturation'), master: { hue: 30, sat: 20, light: 5 } }],
      ['colorBalance', { ...defaultParams('colorBalance'), midtones: [20, -10, 15] }],
      ['vibrance', { vibrance: 40, saturation: 10 }],
      ['brightnessContrast', { brightness: 30, contrast: 25, legacy: false }],
      ['blackWhite', defaultParams('blackWhite')],
    ];
    const exact = [0, 0, 0],
      table = [0, 0, 0];
    for (const [t, p] of cases) {
      const c = compile(t, p as never);
      const f = pixelFn(t, p as never);
      let worst = 0;
      for (let i = 0; i < 300; i++) {
        const r = (i * 0.37) % 1,
          g = (i * 0.61) % 1,
          b = (i * 0.83) % 1;
        f(r, g, b, exact);
        applyCompiled(c, r, g, b, table);
        for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(exact[k]! - table[k]!));
      }
      expect(worst, t).toBeLessThan(0.03);
    }
  });

  it('reads and writes .cube LUTs', () => {
    const size = 2;
    const text = `TITLE "Swap"\nLUT_3D_SIZE ${size}\n` + [0, 1].flatMap((b) => [0, 1].flatMap((g) => [0, 1].map((r) => `${b} ${g} ${r}`))).join('\n');
    const lut = parseCube(text);
    expect(lut.name).toBe('Swap');
    const o = [0, 0, 0];
    pixelFn('colorLookup', { lut })(1, 0, 0, o);
    expect(o).toEqual([0, 0, 1]);
    expect(parseCube(writeCube(lut)).data).toEqual(lut.data);
    expect(() => parseCube('LUT_3D_SIZE 3\n0 0 0')).toThrow(/27/);
  });

  it('auto contrast stretches the histogram', () => {
    const px = new Float32Array(1000 * 4);
    for (let i = 0; i < 1000; i++) px.set([0.3 + (i / 1000) * 0.4, 0.3 + (i / 1000) * 0.4, 0.3 + (i / 1000) * 0.4, 1], i * 4);
    const lv = autoLevels(histogram(px), 'contrast', 0);
    expect(lv.rgb.inBlack).toBeCloseTo(0.3, 1);
    expect(lv.rgb.inWhite).toBeCloseTo(0.7, 1);
  });
});
