import { describe, expect, it } from 'vitest';
import { blur, expand, finish, floodSelect, invert, pack, toMattePixels, unpack, type Matte } from './matte';

/** A round blob of "in" in the middle of an empty matte. */
function disc(w: number, h: number, r: number): Matte {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = Math.hypot(x - w / 2 + 0.5, y - h / 2 + 0.5) <= r ? 255 : 0;
  return { w, h, data };
}
const area = (m: Matte) => m.data.reduce((s, v) => s + v / 255, 0);
const at = (m: Matte, x: number, y: number) => m.data[y * m.w + x] as number;

describe('matte edges', () => {
  it('grows and shrinks by about the amount asked, staying round', () => {
    const m = disc(120, 120, 30);
    const big = expand(m, 10);
    const small = expand(m, -10);
    // The radius along a row and along a diagonal (round, not square).
    const radius = (x: Matte, dx: number, dy: number) => {
      let r = 0;
      while (at(x, Math.round(60 + r * dx), Math.round(60 + r * dy)) > 127) r++;
      return r * Math.hypot(dx, dy);
    };
    expect(radius(big, 1, 0)).toBeGreaterThanOrEqual(39);
    expect(radius(big, 1, 0)).toBeLessThanOrEqual(41);
    expect(Math.abs(radius(big, 1, 1) - 40)).toBeLessThan(2.5);
    expect(Math.abs(radius(small, 1, 0) - 20)).toBeLessThanOrEqual(1);
    expect(Math.abs(radius(small, 1, 1) - 20)).toBeLessThan(2.5);
    // Growing then shrinking the same amount gives the shape back.
    expect(Math.abs(area(expand(big, -10)) - area(m))).toBeLessThan(area(m) * 0.03);
  });

  it('nothing changes for no amount', () => {
    const m = disc(40, 40, 10);
    expect(expand(m, 0)).toBe(m);
    expect(blur(m, 0)).toBe(m);
  });

  it('feathers the edge without moving it', () => {
    const m = disc(120, 120, 30);
    const soft = blur(m, 4);
    // Inside stays in, outside stays out, the edge is half way, and nothing is gained or lost.
    expect(at(soft, 60, 60)).toBe(255);
    expect(at(soft, 2, 2)).toBe(0);
    expect(at(soft, 90, 60)).toBeGreaterThan(90);
    expect(at(soft, 90, 60)).toBeLessThan(165);
    expect(Math.abs(area(soft) - area(m))).toBeLessThan(area(m) * 0.01);
    // A soft ramp a few pixels wide where the hard edge was.
    const ramp = [84, 87, 90, 93, 96].map((x) => at(soft, x, 60));
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeLessThan(ramp[i - 1] as number);
  });

  it('turns inside out', () => {
    const m = disc(20, 20, 5);
    const i = invert(m);
    expect(at(i, 10, 10)).toBe(0);
    expect(at(i, 0, 0)).toBe(255);
  });

  it('sizes amounts to the matte (1/1080ths of the picture height)', () => {
    expect(toMattePixels({ w: 640, h: 360, data: new Uint8Array(0) }, 30)).toBeCloseTo(10);
  });

  it('finishes with grow, feather and invert together', () => {
    const m = disc(120, 120, 30);
    const f = finish(m, { expand: 30, feather: 0, invert: false });
    expect(area(f)).toBeGreaterThan(area(m));
    const g = finish(m, { expand: 0, feather: 0, invert: true });
    expect(area(g)).toBeCloseTo(120 * 120 - area(m));
  });
});

describe('matte packing', () => {
  it('packs small and unpacks exactly', () => {
    const m = blur(disc(200, 100, 30), 3);
    const p = pack(m);
    expect(p.length).toBeLessThan(m.data.length / 2);
    const back = unpack(p, 200, 100);
    expect(back?.data).toEqual(m.data);
    expect(unpack(p, 200, 99)).toBeNull();
  });
});

describe('select by color (no AI model)', () => {
  it('takes the connected region of the clicked color', () => {
    const w = 40;
    const h = 30;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4;
        // A red square on blue, and a separate red square far away.
        const red = (x >= 5 && x < 15 && y >= 5 && y < 15) || (x >= 30 && y >= 20);
        rgba.set(red ? [200, 30, 30, 255] : [20, 40, 200, 255], k);
      }
    const m = floodSelect(rgba, w, h, 9, 9, 20);
    expect(area(m)).toBe(100);
    expect(at(m, 32, 25)).toBe(0);
  });
});
