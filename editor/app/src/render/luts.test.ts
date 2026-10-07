import { describe, expect, it } from 'vitest';
import { newGradeEffect, newNode } from '../model/grade';
import { newClip, type Effect } from '../model/types';
import { parseCube } from './color';
import { bandOf, falseColor, lumaPercent, zebra } from './exposure';
import { gradePx, planGrade, type RGB } from './grade';
import { gradeAt } from '../model/grade';
import { BUILTIN_LUTS, builtinCube, gradeToCube, logTo709, makeCube, sampleCube } from './luts';

const close = (a: RGB, b: RGB, digits = 3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i] as number, digits));

describe('LUT files', () => {
  it('writes .cube files of 17, 33 and 65 that read back the same', () => {
    for (const size of [17, 33, 65]) {
      const text = makeCube('Warm', size, ([r, g, b]) => [Math.min(1, r * 1.1), g, b * 0.9]);
      expect(text).toMatch(new RegExp(`LUT_3D_SIZE ${size}`));
      const cube = parseCube(text);
      expect(cube.size).toBe(size);
      expect(cube.title).toBe('Warm');
      close(sampleCube(cube, [0.5, 0.5, 0.5]), [0.55, 0.5, 0.45]);
    }
  });

  it('samples between points (trilinear)', () => {
    const cube = parseCube(makeCube('Same', 17, (c) => c));
    close(sampleCube(cube, [0.123, 0.456, 0.789]), [0.123, 0.456, 0.789], 5);
    close(sampleCube(cube, [-1, 2, 0.5]), [0, 1, 0.5], 5);
  });
});

describe('a grade as a LUT', () => {
  const clipWith = (effects: Effect[]) => ({ ...newClip('v1', 0, 50, { kind: 'media', media: 'm', in: 0 }, 'Shot 4'), effects });

  it('matches the grade, color for color', () => {
    const node = { ...newNode(), p: { exposure: 0.5, saturation: 130 } };
    const fx = newGradeEffect({ steps: [{ kind: 'serial', node }] });
    const made = gradeToCube(clipWith([fx]), 0, 33, () => null);
    expect(made.notes).toEqual([]);
    const cube = parseCube(made.text);
    const plan = planGrade(gradeAt({ steps: [{ kind: 'serial', node }] }, 0));
    for (const c of [
      [0.25, 0.5, 0.75],
      [0.9, 0.1, 0.2],
    ] as RGB[])
      close(sampleCube(cube, c), gradePx(plan, c).map((v) => Math.max(0, Math.min(1, v))) as RGB, 1);
  });

  it('leaves windows out and says so; mixes LUT effects by their amount', () => {
    const node = { ...newNode(), p: { exposure: 1 }, window: { shape: 'circle' as const, x: 0.5, y: 0.5, w: 0.3, h: 0.3, soft: 10, invert: false } };
    const lut: Effect = { id: 'l', type: 'lut', on: true, p: { mix: 50 }, d: { path: 'builtin:none-such', name: 'x' } };
    const half: Effect = { id: 'h', type: 'lut', on: true, p: { mix: 50 }, d: { path: 'invert.cube', name: 'Invert' } };
    const invert = parseCube(makeCube('Invert', 17, ([r, g, b]) => [1 - r, 1 - g, 1 - b]));
    const made = gradeToCube(clipWith([newGradeEffect({ steps: [{ kind: 'serial', node }] }), lut]), 0, 17, () => null);
    expect(made.notes.join(' ')).toMatch(/Windows/);
    expect(made.notes.join(' ')).toMatch(/could not be read/);
    const mixed = parseCube(gradeToCube(clipWith([half]), 0, 17, (p) => (p === 'invert.cube' ? invert : null)).text);
    close(sampleCube(mixed, [0.2, 0.2, 0.2]), [0.5, 0.5, 0.5]);
  });

  it('says when there is nothing to save', () => {
    expect(gradeToCube(clipWith([]), 0, 17, () => null).notes.join(' ')).toMatch(/no color changes/);
  });
});

describe('camera log to Rec.709', () => {
  // Each camera's middle gray (18%) code value, from the makers' published curves.
  const grays: [string, number][] = [
    ['slog3', 420 / 1023],
    ['logc3', 0.391],
    ['vlog', 0.423],
    ['flog', 0.459],
    ['applelog', 0.4884],
  ];
  it('puts middle gray where video expects it, neutral', () => {
    for (const [id, code] of grays) {
      const [r, g, b] = logTo709(id, [code, code, code]);
      expect(g, id).toBeGreaterThan(0.39);
      expect(g, id).toBeLessThan(0.43);
      expect(Math.abs(r - g), id).toBeLessThan(0.01);
      expect(Math.abs(b - g), id).toBeLessThan(0.01);
    }
  });

  it('rolls highlights off instead of clipping, and keeps black at black', () => {
    const [w] = logTo709('slog3', [0.75, 0.75, 0.75]);
    expect(w).toBeGreaterThan(0.85);
    expect(w).toBeLessThan(1);
    expect(logTo709('slog3', [95 / 1023, 95 / 1023, 95 / 1023])[1]).toBeCloseTo(0, 2);
  });

  it('makes a built-in LUT for each camera, once', () => {
    expect(BUILTIN_LUTS.map((x) => x.id)).toEqual(['slog3', 'logc3', 'vlog', 'flog', 'applelog']);
    const a = builtinCube('builtin:slog3');
    expect(a?.size).toBe(33);
    expect(builtinCube('builtin:slog3')).toBe(a);
    expect(builtinCube('C:/Looks/teal.cube')).toBeNull();
    expect(builtinCube('builtin:nope')).toBeNull();
  });
});

describe('exposure overlays', () => {
  const px = (...values: number[]) => new Uint8Array(values.flatMap((v) => [v, v, v, 255]));

  it('puts each brightness in its band', () => {
    expect(lumaPercent(255, 255, 255)).toBeCloseTo(100);
    expect(bandOf(1).label).toBe('Crushed black');
    expect(bandOf(41).label).toBe('Middle gray (18%)');
    expect(bandOf(54).label).toMatch(/Skin/);
    expect(bandOf(100).label).toBe('Clipped');
  });

  it('false color: bands in color, the rest in gray', () => {
    const out = new Uint8ClampedArray(12);
    falseColor(px(0, 105, 255), out);
    expect([...out.slice(0, 3)]).toEqual([120, 40, 170]);
    expect([...out.slice(4, 7)]).toEqual([60, 170, 80]);
    expect([...out.slice(8, 11)]).toEqual([220, 40, 40]);
    const gray = new Uint8ClampedArray(4);
    falseColor(px(180), gray);
    expect(gray[0]).toBe(gray[1]);
  });

  it('zebra: stripes only over pixels at or above the level', () => {
    const w = 8;
    const picture = px(...Array.from({ length: 16 }, (_, i) => (i < 8 ? 250 : 100)));
    const out = new Uint8ClampedArray(picture.length);
    expect(zebra(picture, w, 95, out)).toBe(8);
    const striped = [...Array(16).keys()].filter((i) => out[i * 4 + 3]! > 0);
    expect(striped.every((i) => i < 8)).toBe(true);
    expect(striped.length).toBe(4);
  });
});
