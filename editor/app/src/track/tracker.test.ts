import { describe, expect, it } from 'vitest';
import { fitSimilarity, gray, lucasKanade, matchTemplate, ncc, patch, pyramid, robustSimilarity, sample, simAngle, simScale, type Gray } from './math';
import { PlanarTracker, PointTracker } from './tracker';

// A made-up scene with detail everywhere: soft blobs at fixed places, so a
// picture of it can be moved, sized and turned exactly.
const blobs = (() => {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 220 }, () => ({ x: rnd() * 400 - 40, y: rnd() * 300 - 40, r: 3 + rnd() * 7, v: rnd() * 2 - 1 }));
})();
const scene = (x: number, y: number): number => {
  let s = 120;
  for (const b of blobs) {
    const d = ((x - b.x) ** 2 + (y - b.y) ** 2) / (b.r * b.r);
    if (d < 9) s += 90 * b.v * Math.exp(-d);
  }
  return s;
};

/** The scene seen moved by (dx, dy), sized by k and turned by `deg` around (ox, oy). */
function frame(w: number, h: number, dx: number, dy: number, k = 1, deg = 0, ox = w / 2, oy = h / 2): Gray {
  const g = gray(w, h);
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // Where this pixel was in the scene (the inverse of the move).
      const px = x - ox - dx;
      const py = y - oy - dy;
      const ux = (c * px + s * py) / k + ox;
      const uy = (-s * px + c * py) / k + oy;
      g.data[y * w + x] = scene(ux, uy);
    }
  return g;
}

describe('picture arithmetic', () => {
  it('reads between pixels', () => {
    const g = gray(2, 2, [0, 10, 20, 30]);
    expect(sample(g, 0.5, 0.5)).toBeCloseTo(15);
    expect(sample(g, 1, 0)).toBeCloseTo(10);
    expect(sample(g, -5, 9)).toBeCloseTo(20);
  });

  it('says how alike two patches are, whatever the brightness', () => {
    const a = [1, 2, 3, 4, 5];
    expect(
      ncc(
        a,
        a.map((v) => v * 2 + 40),
      ),
    ).toBeCloseTo(1);
    expect(
      ncc(
        a,
        a.map((v) => -v),
      ),
    ).toBeCloseTo(-1);
  });

  it('finds a patch that moved, with Lucas–Kanade', () => {
    const a = frame(160, 120, 0, 0);
    const b = frame(160, 120, 6.3, -4.6);
    const f = lucasKanade(pyramid(a, 4), pyramid(b, 4), 80, 60, 9);
    expect(f.ok).toBe(true);
    expect(f.x).toBeCloseTo(86.3, 0);
    expect(f.y).toBeCloseTo(55.4, 0);
    expect(Math.hypot(f.x - 86.3, f.y - 55.4)).toBeLessThan(0.15);
  });

  it('finds a template by searching (for big moves)', () => {
    const a = frame(160, 120, 0, 0);
    const b = frame(160, 120, 17, 11);
    const tpl = patch(a, 70, 50, 8);
    const m = matchTemplate(b, tpl, 8, 70, 50, 24, 2);
    expect(Math.hypot(m.x - 87, m.y - 61)).toBeLessThan(0.6);
    expect(m.score).toBeGreaterThan(0.95);
  });

  it('fits a move, size and turn to points', () => {
    const from: [number, number][] = [
      [0, 0],
      [10, 0],
      [0, 10],
      [7, 3],
    ];
    const a = (20 * Math.PI) / 180;
    const to = from.map(([x, y]) => [1.5 * (x * Math.cos(a) - y * Math.sin(a)) + 4, 1.5 * (x * Math.sin(a) + y * Math.cos(a)) - 2] as [number, number]);
    const s = fitSimilarity(from, to);
    expect(s).not.toBeNull();
    expect(simScale(s!)).toBeCloseTo(1.5, 6);
    expect(simAngle(s!)).toBeCloseTo(20, 6);
    expect(s!.tx).toBeCloseTo(4, 6);
    expect(s!.ty).toBeCloseTo(-2, 6);
  });

  it('ignores points that disagree', () => {
    const from: [number, number][] = Array.from({ length: 12 }, (_, i) => [i * 3, (i * 7) % 11] as [number, number]);
    const to = from.map(([x, y]) => [x + 5, y + 1] as [number, number]);
    to[3] = [90, 90];
    to[8] = [-40, 2];
    const r = robustSimilarity(from, to);
    expect(r!.inliers[3]).toBe(false);
    expect(r!.inliers[8]).toBe(false);
    expect(r!.sim.tx).toBeCloseTo(5, 5);
    expect(simScale(r!.sim)).toBeCloseTo(1, 5);
  });
});

describe('point tracker', () => {
  it('follows a spot moving across the picture, to a part of a pixel', () => {
    const w = 200;
    const h = 150;
    const at = (i: number): [number, number] => [i * 2.35, Math.sin(i / 4) * 6 + i * 0.7];
    const t = new PointTracker(frame(w, h, 0, 0), 70, 60);
    let worst = 0;
    for (let i = 1; i <= 24; i++) {
      const [dx, dy] = at(i);
      const p = t.step(frame(w, h, dx, dy));
      expect(p.ok).toBe(true);
      worst = Math.max(worst, Math.hypot(p.x - (70 + dx), p.y - (60 + dy)));
    }
    expect(worst).toBeLessThan(0.35);
  });

  it('follows backward just as well', () => {
    const w = 160;
    const h = 120;
    const t = new PointTracker(frame(w, h, 20, 10), 80, 60);
    for (let i = 1; i <= 10; i++) {
      const p = t.step(frame(w, h, 20 - i * 2, 10 - i));
      expect(Math.hypot(p.x - (80 - i * 2), p.y - (60 - i))).toBeLessThan(0.3);
    }
  });

  it('survives a sudden jump', () => {
    const t = new PointTracker(frame(160, 120, 0, 0), 80, 60);
    const p = t.step(frame(160, 120, 19, -14));
    expect(p.ok).toBe(true);
    expect(Math.hypot(p.x - 99, p.y - 46)).toBeLessThan(0.6);
  });

  it('says when the spot is lost', () => {
    const t = new PointTracker(frame(160, 120, 0, 0), 80, 60);
    const blank = gray(160, 120);
    blank.data.fill(100);
    expect(t.step(blank).ok).toBe(false);
  });
});

describe('region tracker', () => {
  it('follows position, size and turn of a region', () => {
    const w = 220;
    const h = 170;
    const ox = 110;
    const oy = 85;
    const t = new PlanarTracker(frame(w, h, 0, 0, 1, 0, ox, oy), { x: ox, y: oy, w: 80, h: 60 });
    expect(t.points.length).toBeGreaterThan(10);
    let last = null as ReturnType<PlanarTracker['step']> | null;
    for (let i = 1; i <= 15; i++) {
      last = t.step(frame(w, h, i * 1.2, -i * 0.6, 1 + i * 0.01, i * 0.8, ox, oy));
      expect(last.ok).toBe(true);
    }
    // The region's center moves with the picture; its size and turn follow too.
    expect(Math.hypot(last!.x - (ox + 18), last!.y - (oy - 9))).toBeLessThan(0.6);
    expect(last!.scale).toBeCloseTo(1.15, 2);
    expect(last!.angle).toBeCloseTo(12, 0);
    expect(Math.abs(last!.angle - 12)).toBeLessThan(0.4);
  });
});
