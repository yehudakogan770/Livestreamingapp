import { expect, test } from 'vitest';
import { area, bounds, dirtyRects, MAX_RECTS, Pacer } from './overlayDirty';

const W = 100;
const H = 70;
const blank = () => new Uint32Array(W * H);
const set = (img: Uint32Array, x: number, y: number, v = 0xff0000ff) => {
  img[y * W + x] = v;
  return img;
};

test('nothing changed: nothing to send', () => {
  const a = set(blank(), 5, 5);
  expect(dirtyRects(a, a.slice(), W, H)).toEqual([]);
  // A new plane with nothing drawn on it sends nothing either.
  expect(dirtyRects(null, blank(), W, H)).toEqual([]);
});

test('one changed pixel sends its tile only', () => {
  const r = dirtyRects(blank(), set(blank(), 40, 10), W, H, 32);
  expect(r).toEqual([{ x: 32, y: 0, w: 32, h: 32 }]);
});

test('tiles at the edge are cut to the picture', () => {
  const r = dirtyRects(null, set(blank(), 99, 69), W, H, 32);
  expect(r).toEqual([{ x: 96, y: 64, w: 4, h: 6 }]);
});

test('neighbouring tiles join along a row and down a column', () => {
  const next = blank();
  // A 2 × 2 block of tiles changed (pixels in each).
  for (const [x, y] of [
    [1, 1],
    [40, 1],
    [1, 40],
    [40, 40],
  ] as const)
    set(next, x, y);
  expect(dirtyRects(blank(), next, W, H, 32)).toEqual([{ x: 0, y: 0, w: 64, h: 64 }]);
  // Two separate places stay two rectangles.
  const two = set(set(blank(), 1, 1), 70, 50);
  expect(dirtyRects(blank(), two, W, H, 32)).toEqual([
    { x: 0, y: 0, w: 32, h: 32 },
    { x: 64, y: 32, w: 32, h: 32 },
  ]);
});

test('too many rectangles become their bounding box', () => {
  const next = blank();
  // A checkerboard of changed 4-pixel tiles.
  for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) set(next, x, y);
  const r = dirtyRects(blank(), next, W, H, 4);
  expect(r.length).toBe(1);
  expect(r[0]).toEqual({ x: 0, y: 0, w: 100, h: 68 });
  expect(MAX_RECTS).toBeGreaterThan(1);
});

test('bounds and area', () => {
  const rs = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 20, y: 5, w: 5, h: 20 },
  ];
  expect(bounds(rs)).toEqual({ x: 0, y: 0, w: 25, h: 25 });
  expect(area(rs)).toBe(200);
});

test('frame pacing: full rate while things change, a few looks a second otherwise', () => {
  const p = new Pacer(60, 15, 600);
  const draws = (from: number, to: number) => {
    let n = 0;
    for (let t = from; t < to; t++) if (p.due(t)) n++;
    return n;
  };
  // Nothing happening: about 15 a second.
  expect(draws(0, 1000)).toBeGreaterThanOrEqual(14);
  expect(draws(1000, 2000)).toBeLessThanOrEqual(16);
  // The show changed: the screen's rate for a while…
  p.wake(2000);
  const busy = draws(2000, 2600);
  expect(busy).toBeGreaterThanOrEqual(34);
  expect(busy).toBeLessThanOrEqual(42);
  // …then back to looking now and then.
  expect(draws(3000, 4000)).toBeLessThanOrEqual(16);
});

test('a frame on its way holds the next one back', () => {
  const p = new Pacer(60);
  p.wake(0);
  expect(p.due(0)).toBe(true);
  p.sending(true);
  expect(p.due(100)).toBe(false);
  expect(p.due(200)).toBe(false);
  p.sending(false);
  expect(p.due(201)).toBe(true);
});
