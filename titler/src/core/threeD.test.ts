// 3D layers: turned about their anchor point and seen through the
// composition's camera (perspective), drawn smoothly; through Lottie too.

import { beforeAll, describe, expect, it } from 'vitest';
import { newProject, newShape } from './build';
import { is3d, projector, renderFrame } from './render';
import { toLottie } from './lottieExport';
import { fromLottie } from './lottie';
import { canvas, env, registerTestFont, TEST_FONT } from '../test/nodeCanvas';
import type { Layer, TitleProject } from './types';

function card(rx: number, ry: number, z = 0) {
  const p = newProject('3D', 400, 400);
  const c = p.compositions[0]!;
  const s = newShape(c, 'rect', [200, 200], [200, 200], '#ffffff');
  s.transform = { ...s.transform, anchor: { v: [100, 100] }, rotationX: { v: rx }, rotationY: { v: ry }, z: { v: z } };
  c.layers = [s];
  return p;
}

function draw(p: TitleProject) {
  const cv = canvas(400, 400);
  renderFrame(cv.getContext('2d') as unknown as CanvasRenderingContext2D, p, { time: 1, env, brand: { font: TEST_FONT }, width: 400, height: 400 });
  return cv;
}
const alpha = (cv: ReturnType<typeof canvas>, x: number, y: number) => (cv.getContext('2d') as unknown as CanvasRenderingContext2D).getImageData(x, y, 1, 1).data[3]!;

/** The drawn box's width along the middle row. */
function width(cv: ReturnType<typeof canvas>, y = 200) {
  let lo = -1;
  let hi = -1;
  for (let x = 0; x < 400; x++)
    if (alpha(cv, x, y) > 128) {
      if (lo < 0) lo = x;
      hi = x;
    }
  return lo < 0 ? 0 : hi - lo + 1;
}

beforeAll(() => registerTestFont());

describe('3D layers', () => {
  it('flat when not turned', () => {
    expect(is3d(card(0, 0).compositions[0]!.layers[0] as Layer)).toBe(false);
    expect(width(draw(card(0, 0)))).toBe(200);
  });

  it('turning across (Y) narrows it, with the near edge taller than the far one', () => {
    const cv = draw(card(0, 60));
    const w = width(cv);
    expect(w).toBeGreaterThan(80);
    expect(w).toBeLessThan(130);
    // Column heights at the two sides: perspective makes them differ.
    const colHeight = (x: number) => {
      let n = 0;
      for (let y = 0; y < 400; y++) if (alpha(cv, x, y) > 128) n++;
      return n;
    };
    let lo = 0;
    while (alpha(cv, lo, 200) < 128) lo++;
    let hi = 399;
    while (alpha(cv, hi, 200) < 128) hi--;
    expect(Math.abs(colHeight(lo + 2) - colHeight(hi - 2))).toBeGreaterThan(8);
  });

  it('edge-on (90°) it all but disappears; X turns it up and down; nearer is bigger', () => {
    expect(width(draw(card(0, 90)))).toBeLessThan(4);
    const cv = draw(card(60, 0));
    expect(width(cv)).toBeGreaterThan(150);
    let h = 0;
    for (let y = 0; y < 400; y++) if (alpha(cv, 200, y) > 128) h++;
    expect(h).toBeLessThan(130);
    expect(width(draw(card(0, 0, -500)))).toBeGreaterThan(240);
  });

  it('no seams between the pieces it is drawn in', () => {
    const cv = draw(card(25, 35));
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D;
    const d = ctx.getImageData(150, 150, 100, 100).data;
    for (let k = 3; k < d.length; k += 4) expect(d[k]).toBe(255);
  });

  it('projects behind the camera to nothing', () => {
    const l = card(0, 0, -2500).compositions[0]!.layers[0]!;
    expect(projector(l, 0, [0, 0], 2000)(10, 10)).toBeNull();
  });

  it('keeps X and Y rotation through Lottie', () => {
    const back = fromLottie(toLottie(card(20, 40)).json).project.compositions[0]!.layers[0]!;
    expect(back.transform.rotationX).toEqual({ v: 20 });
    expect(back.transform.rotationY).toEqual({ v: 40 });
  });
});
