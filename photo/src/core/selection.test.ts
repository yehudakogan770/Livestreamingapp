import { describe, expect, it } from 'vitest';
import {
  allMask,
  borderMask,
  colorRange,
  combine,
  ellipseMask,
  featherMask,
  growMask,
  invertMask,
  magicWand,
  maskBounds,
  maskOutline,
  maskToRaster,
  pathMask,
  quickSelect,
  rasterToMask,
  rectMask,
  refineEdge,
  emptyMask,
} from './selection';
import { rectPath, ellipsePath } from './path';

const count = (m: { data: Uint8Array }) => m.data.reduce((n, v) => n + v / 255, 0);

describe('selections', () => {
  it('rectangles and ellipses cover the right area', () => {
    const r = rectMask(100, 100, { x: 10, y: 20, w: 30, h: 40 });
    expect(count(r)).toBe(1200);
    expect(maskBounds(r)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    const e = ellipseMask(200, 200, { x: 0, y: 0, w: 200, h: 200 });
    expect(count(e)).toBeCloseTo(Math.PI * 100 * 100, -2);
  });

  it('antialiased edges are partial', () => {
    const r = rectMask(20, 20, { x: 2.5, y: 2, w: 10, h: 10 }, true);
    expect(r.data[5 * 20 + 2]).toBeGreaterThan(100);
    expect(r.data[5 * 20 + 2]).toBeLessThan(160);
    expect(r.data[5 * 20 + 5]).toBe(255);
  });

  it('add, subtract, intersect and invert', () => {
    const a = rectMask(50, 50, { x: 0, y: 0, w: 30, h: 50 });
    const b = rectMask(50, 50, { x: 20, y: 0, w: 30, h: 50 });
    expect(count(combine(a, b, 'add'))).toBe(2500);
    expect(count(combine(a, b, 'subtract'))).toBe(1000);
    expect(count(combine(a, b, 'intersect'))).toBe(500);
    expect(count(invertMask(a))).toBe(1000);
  });

  it('grow, shrink, border and feather', () => {
    const a = rectMask(100, 100, { x: 40, y: 40, w: 20, h: 20 });
    const g = growMask(a, 5);
    expect(maskBounds(g)).toEqual({ x: 35, y: 35, w: 30, h: 30 });
    const s = growMask(a, -5);
    expect(maskBounds(s)).toEqual({ x: 45, y: 45, w: 10, h: 10 });
    const f = featherMask(a, 6);
    expect(count(f)).toBeCloseTo(400, -1);
    expect(f.data[50 * 100 + 40]).toBeGreaterThan(60);
    expect(f.data[50 * 100 + 40]).toBeLessThan(200);
    const bd = borderMask(a, 4);
    expect(bd.data[50 * 100 + 50]).toBe(0);
    expect(bd.data[50 * 100 + 40]).toBeGreaterThan(100);
  });

  it('magic wand fills the clicked color, contiguous or not', () => {
    const w = 20,
      h = 10;
    const px = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const red = x < 5 || x >= 15;
        px.set(red ? [1, 0, 0, 1] : [0, 0, 1, 1], (y * w + x) * 4);
      }
    const c = magicWand({ w, h, data: px }, 1, 1, 10, true, false);
    expect(count(c)).toBe(50);
    const all = magicWand({ w, h, data: px }, 1, 1, 10, false, false);
    expect(count(all)).toBe(100);
  });

  it('color range picks a hue', () => {
    const px = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0.9, 0.1, 0.1, 1]);
    const m = colorRange({ w: 3, h: 1, data: px }, 'reds', [], 40);
    expect(m.data[0]).toBe(255);
    expect(m.data[1]).toBe(0);
    expect(m.data[2]).toBeGreaterThan(200);
  });

  it('quick selection grows over similar colors and stops at an edge', () => {
    const w = 60,
      h = 40;
    const px = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(x < 30 ? [0.8, 0.2, 0.2, 1] : [0.1, 0.4, 0.9, 1], (y * w + x) * 4);
    const seeds = rectMask(w, h, { x: 10, y: 15, w: 4, h: 4 });
    const m = quickSelect({ w, h, data: px }, seeds, 40);
    expect(m.data[20 * w + 25]).toBe(255);
    expect(m.data[20 * w + 35]).toBe(0);
  });

  it('refine edge keeps the solid inside and outside', () => {
    const w = 40,
      h = 40;
    const px = new Float32Array(w * h * 4);
    for (let i = 0; i < w * h; i++) px.set([0.5, 0.5, 0.5, 1], i * 4);
    const m = rectMask(w, h, { x: 10, y: 10, w: 20, h: 20 });
    const r = refineEdge({ w, h, data: px }, m, { radius: 3, smooth: 0, feather: 0, contrast: 0, shiftEdge: 0 });
    expect(r.data[20 * w + 20]).toBe(255);
    expect(r.data[2 * w + 2]).toBe(0);
  });

  it('round trips through tiles, sharing full tiles', () => {
    const big = allMask(1000, 600);
    const r = maskToRaster(big);
    const tiles = [...r.tiles.values()];
    // Fully selected inner tiles are one shared tile.
    expect(new Set(tiles.map((t) => t.data)).size).toBeLessThan(tiles.length);
    expect(count(rasterToMask(r, 1000, 600))).toBe(600000);
    expect(maskToRaster(emptyMask(300, 300)).tiles.size).toBe(0);
  });

  it('paths become selections and selections become outlines', () => {
    const m = pathMask(100, 100, rectPath(10, 10, 50, 30));
    expect(count(m)).toBeCloseTo(1500, -1);
    const e = pathMask(100, 100, ellipsePath(50, 50, 30, 30));
    expect(count(e)).toBeCloseTo(Math.PI * 900, -1);
    const outline = maskOutline(rectMask(50, 50, { x: 10, y: 10, w: 20, h: 20 }));
    expect(outline.length).toBe(1);
  });
});
