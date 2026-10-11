// 3D layers: turned about their anchor point and seen through the
// composition's camera (perspective), drawn smoothly; through Lottie too.

import { beforeAll, describe, expect, it } from 'vitest';
import { newCamera, newProject, newShape } from './build';
import { is3d, projector, renderFrame, sceneCamera } from './render';
import { parseProject } from './validate';
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
const alpha = (cv: ReturnType<typeof canvas>, x: number, y: number) =>
  (cv.getContext('2d') as unknown as CanvasRenderingContext2D).getImageData(x, y, 1, 1).data[3]!;

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

  it('a camera orbiting turns 3D layers (not flat ones), moving away makes them smaller, and is not drawn', () => {
    const p = card(0, 0);
    const c = p.compositions[0]!;
    const flat = newShape(c, 'rect', [0, 380], [400, 20], '#ffffff');
    const cam = newCamera(c);
    cam.transform.rotationY = { v: 60 };
    c.layers = [cam, ...c.layers, flat];
    const cv = draw(p);
    expect(width(cv)).toBeGreaterThan(80);
    expect(width(cv)).toBeLessThan(130);
    // The flat bar along the bottom is as it was.
    expect(width(cv, 390)).toBe(400);
    cam.transform.rotationY = { v: 0 };
    cam.transform.z = { v: 2000 };
    expect(width(draw(p))).toBeLessThan(110);
    expect(width(draw(p), 390)).toBe(400);
    // The camera at rest changes nothing.
    cam.transform.z = { v: 0 };
    expect(width(draw(p))).toBe(200);
    expect(sceneCamera(c, 1).moved).toBe(false);
  });

  it('an extruded layer shows its sides, darker than its face, and they come back from a file', () => {
    const plain = card(0, 50);
    const deep = card(0, 50);
    deep.compositions[0]!.layers[0]!.extrude = { depth: 80 };
    const a = draw(plain);
    const b = draw(deep);
    expect(width(b)).toBeGreaterThan(width(a) + 20);
    // A pixel covered only by the sides is darker than the white face.
    const ctx = b.getContext('2d') as unknown as CanvasRenderingContext2D;
    let side: number[] | null = null;
    for (let x = 0; x < 400 && !side; x++)
      if (alpha(a, x, 200) < 10 && alpha(b, x, 200) > 200) side = [...ctx.getImageData(x, 200, 1, 1).data];
    expect(side).not.toBeNull();
    expect(side![0]!).toBeLessThan(200);
    const back = parseProject(JSON.stringify(deep)).project!.compositions[0]!.layers[0]!;
    expect(back.extrude).toEqual({ depth: 80 });
  });

  it('3D layers next to each other are drawn far ones first', () => {
    const p = newProject('Depth', 400, 400);
    const c = p.compositions[0]!;
    const near = newShape(c, 'rect', [100, 100], [200, 200], '#ff0000');
    near.transform = { ...near.transform, anchor: { v: [100, 100] }, position: { v: [200, 200] }, rotationX: { v: 0 }, rotationY: { v: 0 }, z: { v: -100 } };
    const far = newShape(c, 'rect', [100, 100], [200, 200], '#0000ff');
    far.transform = { ...far.transform, anchor: { v: [100, 100] }, position: { v: [200, 200] }, rotationX: { v: 0 }, rotationY: { v: 0 }, z: { v: 300 } };
    // Listed in front, but farther away: it is hidden behind the near one.
    c.layers = [far, near];
    const px = (draw(p).getContext('2d') as unknown as CanvasRenderingContext2D).getImageData(200, 200, 1, 1).data;
    expect(px[0]).toBeGreaterThan(200);
    expect(px[2]).toBeLessThan(50);
  });

  it('keeps the camera through a file', () => {
    const p = card(0, 0);
    p.compositions[0]!.layers.unshift(newCamera(p.compositions[0]!));
    const back = parseProject(JSON.stringify(p)).project!.compositions[0]!.layers[0]!;
    expect(back.type === 'null' && back.camera).toBe(true);
    expect(back.transform.rotationY).toEqual({ v: 0 });
  });

  it('keeps X and Y rotation through Lottie', () => {
    const back = fromLottie(toLottie(card(20, 40)).json).project.compositions[0]!.layers[0]!;
    expect(back.transform.rotationX).toEqual({ v: 20 });
    expect(back.transform.rotationY).toEqual({ v: 40 });
  });
});
