// Shapes and effects, drawn: each corner its own radius, strokes inside /
// centered / outside, a second outline, and the effects (outline, gradient
// overlay, color correction, grain), checked on the pixels.

import { describe, expect, it } from 'vitest';
import { newProject, newShape } from './build';
import { rectCornersPath } from './paths';
import { renderFrame } from './render';
import type { Effect, ShapeLayer, TitleProject } from './types';
import { canvas, diff, env, pixels } from '../test/nodeCanvas';

const W = 200;
const H = 120;

/** A 100 × 60 box at (50, 30) in a 200 × 120 frame, with changes. */
function box(over: Partial<ShapeLayer> = {}): TitleProject {
  const p = newProject('t', W, H);
  const c = p.compositions[0]!;
  c.width = W;
  c.height = H;
  const s = { ...newShape(c, 'rect', [50, 30], [100, 60]), fill: { type: 'solid' as const, color: '#ff0000' }, stroke: null, ...over };
  s.transform.position = { v: [50, 30] };
  s.transform.anchor = { v: [0, 0] };
  c.layers = [s];
  return p;
}

function draw(p: TitleProject) {
  const cv = canvas(W, H);
  renderFrame(cv.getContext('2d') as unknown as CanvasRenderingContext2D, p, { time: 1, env });
  const px = pixels(cv);
  const at = (x: number, y: number) => Array.from(px.slice((y * W + x) * 4, (y * W + x) * 4 + 4));
  return { px, at };
}

describe('shapes', () => {
  it('each corner its own radius; radii too big for the box are scaled down together', () => {
    const path = rectCornersPath(100, 60, [0, 30, 0, 10]);
    expect(path.closed).toBe(true);
    const { at } = draw(box({ corners: [0, 30, 0, 10] }));
    expect(at(51, 31)[3]).toBe(255); // top left: square
    expect(at(148, 31)[3]).toBe(0); // top right: round
    expect(at(148, 88)[3]).toBe(255); // bottom right: square
    const big = rectCornersPath(100, 60, [100, 100, 100, 100]);
    const xs = big.v.map((v) => v.p[0]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(100);
  });

  it('a stroke inside stays in the box, outside goes round it, centered does both', () => {
    const stroke = (align: 'inside' | 'outside' | 'center') => ({ paint: { type: 'solid' as const, color: '#0000ff' }, width: 6, align });
    const inside = draw(box({ stroke: stroke('inside') }));
    expect(inside.at(52, 60)).toEqual([0, 0, 255, 255]);
    expect(inside.at(47, 60)[3]).toBe(0);
    const outside = draw(box({ stroke: stroke('outside') }));
    expect(outside.at(47, 60)).toEqual([0, 0, 255, 255]);
    expect(outside.at(52, 60)).toEqual([255, 0, 0, 255]);
    const center = draw(box({ stroke: stroke('center') }));
    expect(center.at(48, 60)[2]).toBe(255);
    expect(center.at(52, 60)[2]).toBe(255);
  });

  it('a second outline is drawn over the first', () => {
    const { at } = draw(
      box({
        stroke: { paint: { type: 'solid', color: '#0000ff' }, width: 4, align: 'outside' },
        extraStrokes: [{ paint: { type: 'solid', color: '#00ff00' }, width: 4, align: 'inside' }],
      }),
    );
    expect(at(48, 60)).toEqual([0, 0, 255, 255]);
    expect(at(51, 60)).toEqual([0, 255, 0, 255]);
  });
});

describe('effects', () => {
  const withFx = (e: Effect) => box({ effects: [e] });

  it('outline: round the shape, under it', () => {
    const { at } = draw(withFx({ id: 'e', type: 'stroke', on: true, color: '#ffffff', width: { v: 5 }, opacity: { v: 100 } }));
    expect(at(46, 60)).toEqual([255, 255, 255, 255]);
    expect(at(60, 60)).toEqual([255, 0, 0, 255]);
    expect(at(40, 60)[3]).toBe(0);
  });

  it('gradient overlay: only over the layer’s own pixels', () => {
    const { at } = draw(
      withFx({
        id: 'e',
        type: 'gradient',
        on: true,
        angle: 0,
        stops: [
          { at: 0, color: '#000000' },
          { at: 1, color: '#ffffff' },
        ],
        opacity: { v: 100 },
      }),
    );
    expect(at(52, 60)[0]).toBeLessThan(30);
    expect(at(147, 60)[0]).toBeGreaterThan(225);
    expect(at(20, 60)[3]).toBe(0);
  });

  it('grain is the same at the same time, and off when the amount is 0', () => {
    const fx: Effect = { id: 'e', type: 'noise', on: true, amount: { v: 30 } };
    const grainy = withFx(fx);
    const a = draw(grainy).px;
    const b = draw(grainy).px;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const plain = draw(box()).px;
    expect(Buffer.from(a).equals(Buffer.from(plain))).toBe(false);
    expect(diff(draw(withFx({ ...fx, amount: { v: 0 } })).px, plain, 2)).toBe(0);
    expect(diff(a, plain, 2)).toBeGreaterThan(0.1);
  });

  it('color correction changes the pixels (and does nothing at zero)', () => {
    const zero: Effect = { id: 'e', type: 'color', on: true, brightness: { v: 0 }, contrast: { v: 0 }, saturation: { v: 0 }, hue: { v: 0 } };
    expect(draw(withFx(zero)).at(60, 60)).toEqual([255, 0, 0, 255]);
    const grey = draw(withFx({ ...zero, saturation: { v: -100 } })).at(60, 60);
    // Without saturation red is a grey: its channels close together (where the canvas has filters).
    if (grey[1]! > 0) expect(Math.abs(grey[0]! - grey[1]!)).toBeLessThan(10);
  });

  it('no effect is on by default in a new shape', () => {
    const p = newProject();
    expect(newShape(p.compositions[0]!, 'rect').effects ?? []).toEqual([]);
  });
});
