import { describe, expect, it } from 'vitest';
import { allNodes, gradeEffect, gradeOf } from '../model/grade';
import { newClip } from '../model/types';
import {
  afterNode,
  applyLab,
  fitCurve,
  labStats,
  labToRgb,
  makePixels,
  matchColors,
  MATCH_LABEL,
  planTransfer,
  rgbToLab,
  rising,
  skinColor,
  withMatchNode,
  type Lab,
  type Pixels,
} from './colormatch';

/** A seeded random number (so the tests are the same each run). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Pixels from a function of Lab colors drawn around a center. */
function scene(n: number, center: Lab, spread: Lab, seed: number): Pixels {
  const r = rng(seed);
  const p = makePixels(n);
  for (let i = 0; i < n; i++) {
    const g = () => (r() + r() + r() - 1.5) * 1.15;
    const lab: Lab = [center[0] + g() * spread[0], center[1] + g() * spread[1], center[2] + g() * spread[2]];
    const c = labToRgb(lab);
    p.rgb.set(c, i * 3);
  }
  return p;
}

describe('Lab conversion', () => {
  it('goes there and back', () => {
    for (const c of [
      [0.2, 0.5, 0.8],
      [1, 1, 1],
      [0, 0, 0],
      [0.9, 0.3, 0.1],
    ] as [number, number, number][]) {
      const back = labToRgb(rgbToLab(c));
      for (let k = 0; k < 3; k++) expect(back[k]).toBeCloseTo(c[k] as number, 4);
    }
  });
  it('white is L 100 with no color, and gray has no color', () => {
    const w = rgbToLab([1, 1, 1]);
    expect(w[0]).toBeCloseTo(100, 1);
    expect(Math.abs(w[1])).toBeLessThan(0.01);
    const g = rgbToLab([0.5, 0.5, 0.5]);
    expect(Math.abs(g[1]) + Math.abs(g[2])).toBeLessThan(0.01);
  });
});

describe('statistics', () => {
  it('weighted mean and spread per axis', () => {
    const p = makePixels(2);
    p.rgb.set(labToRgb([30, 0, 0]), 0);
    p.rgb.set(labToRgb([70, 0, 0]), 3);
    const s = labStats(p);
    expect(s.mean[0]).toBeCloseTo(50, 1);
    expect(s.std[0]).toBeCloseTo(20, 1);
    p.weight[1] = 3;
    expect(labStats(p).mean[0]).toBeCloseTo(60, 1);
  });

  it('mean/std transfer lands the source on the reference statistics', () => {
    const src = labStats(scene(3000, [45, 5, 10], [12, 6, 6], 1));
    const ref = labStats(scene(3000, [60, -4, 25], [18, 9, 4], 2));
    const t = planTransfer(src, ref, { histogram: false, skin: false, amount: 1 });
    const moved = applyLab(src.mean, t);
    for (let k = 0; k < 3; k++) expect(moved[k]).toBeCloseTo(ref.mean[k] as number, 6);
    // A color one spread above the source's average lands one spread above the reference's.
    const up = applyLab([src.mean[0] + src.std[0], src.mean[1], src.mean[2]], t);
    expect(up[0]).toBeCloseTo(ref.mean[0] + ref.std[0], 4);
  });

  it('histogram matching maps the source quantiles onto the reference quantiles', () => {
    const src = labStats(scene(2000, [40, 0, 0], [10, 2, 2], 3));
    const ref = labStats(scene(2000, [65, 0, 0], [6, 2, 2], 4));
    const t = planTransfer(src, ref, { histogram: true, skin: false, amount: 1 });
    for (const q of [10, 50, 90]) expect(applyLab([src.quantiles[q] as number, 0, 0], t)[0]).toBeCloseTo(ref.quantiles[q] as number, 3);
  });

  it('half the amount goes half the way', () => {
    const src = labStats(scene(500, [40, 0, 0], [10, 2, 2], 5));
    const ref = labStats(scene(500, [60, 10, 0], [10, 2, 2], 6));
    const t = planTransfer(src, ref, { histogram: false, skin: false, amount: 0.5 });
    expect(applyLab(src.mean, t)[0]).toBeCloseTo((src.mean[0] + ref.mean[0]) / 2, 4);
  });
});

describe('curve fitting', () => {
  it('rising: pools values that go down', () => {
    expect(rising([1, 3, 2, 4], [1, 1, 1, 1])).toEqual([1, 2.5, 2.5, 4]);
  });
  it('fits a known channel change', () => {
    const n = 2000;
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    const ws = new Float32Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      xs[i] = i / (n - 1);
      ys[i] = Math.min(1, 0.05 + (xs[i] as number) * 0.8);
    }
    const pts = fitCurve(xs, ys, ws);
    for (let i = 1; i < pts.length; i++) expect((pts[i] as [number, number])[1]).toBeGreaterThanOrEqual((pts[i - 1] as [number, number])[1]);
    const mid = pts.find(([x]) => Math.abs(x - 0.5) < 0.1) as [number, number];
    expect(mid[1]).toBeCloseTo(0.05 + mid[0] * 0.8, 2);
  });
});

describe('matching as a grade node', () => {
  it('the node brings the target close to the reference in Lab', () => {
    const target = scene(4000, [42, 8, -6], [14, 7, 7], 11);
    const reference = scene(4000, [58, 2, 18], [16, 6, 9], 12);
    const { node } = matchColors(target, reference, { histogram: false, skin: false, amount: 1 });
    expect(node.label).toBe(MATCH_LABEL);
    expect(node.curves).not.toBeNull();
    const before = labStats(target);
    const after = labStats(afterNode(node, target));
    const ref = labStats(reference);
    // Much closer than it was, for every axis' average.
    for (let k = 0; k < 3; k++) {
      expect(Math.abs((after.mean[k] as number) - (ref.mean[k] as number))).toBeLessThan(
        Math.max(2.5, Math.abs((before.mean[k] as number) - (ref.mean[k] as number)) * 0.35),
      );
    }
    expect(Math.abs(after.std[0] - ref.std[0])).toBeLessThan(3);
  });

  it('matching a picture to itself changes almost nothing', () => {
    const p = scene(2000, [50, 5, 5], [15, 8, 8], 21);
    const { node } = matchColors(p, p, { histogram: true, skin: false, amount: 1 });
    const after = labStats(afterNode(node, p));
    const before = labStats(p);
    for (let k = 0; k < 3; k++) expect(Math.abs((after.mean[k] as number) - (before.mean[k] as number))).toBeLessThan(1.5);
  });

  it('skin-tone aware: skin is pulled toward the reference skin', () => {
    const mk = (skinLab: Lab, seed: number) => {
      const bg = scene(1500, [50, -10, -10], [10, 5, 5], seed);
      const sk = scene(500, skinLab, [4, 2, 2], seed + 1);
      const p = makePixels(2000);
      p.rgb.set(bg.rgb, 0);
      p.rgb.set(sk.rgb, 1500 * 3);
      for (let i = 1500; i < 2000; i++) p.skin[i] = 1;
      return p;
    };
    const target = mk([60, 22, 12], 31);
    const reference = mk([62, 14, 22], 41);
    const plain = matchColors(target, reference, { histogram: false, skin: false, amount: 1 });
    const aware = matchColors(target, reference, { histogram: false, skin: true, amount: 1 });
    const skinOf = (p: Pixels) => labStats(p, (i) => p.skin[i] === 1).mean;
    const want = skinOf(reference);
    const dist = (node: typeof plain.node) => {
      const m = skinOf(afterNode(node, target));
      return Math.hypot(m[1] - want[1], m[2] - want[2]);
    };
    expect(dist(aware.node)).toBeLessThan(dist(plain.node));
  });

  it('skin by color', () => {
    expect(skinColor([0.85, 0.65, 0.5])).toBe(true);
    expect(skinColor([0.1, 0.4, 0.9])).toBe(false);
  });

  it('goes at the end of the clip grade, and replaces an earlier match', () => {
    const c = newClip('v1', 0, 100, { kind: 'color', color: '#000' }, 'x');
    const target = scene(500, [40, 0, 0], [10, 3, 3], 51);
    const reference = scene(500, [60, 5, 5], [10, 3, 3], 52);
    const { node } = matchColors(target, reference, { histogram: false, skin: false, amount: 1 });
    const once = withMatchNode(c, node);
    expect(allNodes(gradeOf(gradeEffect(once))).length).toBe(1);
    const again = withMatchNode(once, { ...node, id: 'other' });
    const nodes = allNodes(gradeOf(gradeEffect(again)));
    expect(nodes.length).toBe(1);
    expect(nodes[0]?.label).toBe(MATCH_LABEL);
  });
});
