import { describe, expect, it } from 'vitest';
import { interpolate, opticalFlow, sample, type Gray } from './flow';

/** A smooth, textured test picture (a few waves), moved by (dx, dy). */
function picture(w: number, h: number, dx = 0, dy = 0): Gray {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = x - dx;
      const v = y - dy;
      data[y * w + x] = 0.5 + 0.2 * Math.sin(u * 0.31 + v * 0.17) + 0.15 * Math.cos(u * 0.13 - v * 0.29) + 0.1 * Math.sin(u * 0.07 * v * 0.05 + u * 0.4);
    }
  return { w, h, data };
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] as number;

describe('optical flow', () => {
  it('finds a picture moved a few pixels', () => {
    const w = 96;
    const h = 64;
    const a = picture(w, h);
    const b = picture(w, h, 3, 2);
    const f = opticalFlow(a, b);
    const xs: number[] = [];
    const ys: number[] = [];
    // Away from the edges (where the picture runs out).
    for (let y = 10; y < h - 10; y++)
      for (let x = 10; x < w - 10; x++) {
        xs.push(f.data[(y * w + x) * 2] as number);
        ys.push(f.data[(y * w + x) * 2 + 1] as number);
      }
    expect(median(xs)).toBeCloseTo(3, 0);
    expect(median(ys)).toBeCloseTo(2, 0);
    expect(Math.abs(median(xs) - 3)).toBeLessThan(0.35);
    expect(Math.abs(median(ys) - 2)).toBeLessThan(0.35);
  });

  it('makes the frame half way between (better than blending the two)', () => {
    const w = 96;
    const h = 64;
    const a = picture(w, h);
    const b = picture(w, h, 4, 0);
    const truth = picture(w, h, 2, 0);
    const f = opticalFlow(a, b);
    const warped = interpolate(a, b, f, 0.5);
    let errFlow = 0;
    let errBlend = 0;
    for (let y = 12; y < h - 12; y++)
      for (let x = 12; x < w - 12; x++) {
        const i = y * w + x;
        errFlow += Math.abs((warped.data[i] as number) - (truth.data[i] as number));
        errBlend += Math.abs(((a.data[i] as number) + (b.data[i] as number)) / 2 - (truth.data[i] as number));
      }
    expect(errFlow).toBeLessThan(errBlend * 0.35);
  });

  it('reads between pixels', () => {
    const g: Gray = { w: 2, h: 1, data: new Float32Array([0, 1]) };
    expect(sample(g, 0.25, 0)).toBeCloseTo(0.25, 9);
    expect(sample(g, 5, 0)).toBe(1);
  });
});
