// Masks and paths edited by hand: points and handles moved, the box typed
// in, and the change of form over time (keys of the whole outline).

import { describe, expect, it } from 'vitest';
import { newShape } from '../core/build';
import { rectPath } from '../core/paths';
import type { Layer, ShapeLayer } from '../core/types';
import {
  animateOutline,
  fitOutlines,
  isMorphing,
  moveOutline,
  moveOutlineKey,
  moveTangent,
  moveVertex,
  outlineKeyTimes,
  outlineRefs,
  outlinesAt,
  outlinesBox,
  removeOutlineKey,
  setOutlinesAt,
} from './outlines';

const masked = (): Layer => ({
  ...newShape(null, 'rect', [0, 0], [400, 200]),
  masks: [{ id: 'm', name: 'Mask 1', path: rectPath(100, 50, 0), mode: 'add' }],
});

describe('outlines', () => {
  it('a mask point is moved, a handle pulled out (mirrored, or on its own), the whole mask moved', () => {
    const o = rectPath(100, 50, 0);
    const a = moveVertex(o, 2, [120, 60]);
    expect(a.v[2]!.p).toEqual([120, 60]);
    const b = moveTangent(a, 0, 'o', [20, 0]);
    expect(b.v[0]!.o).toEqual([20, 0]);
    expect(b.v[0]!.i).toEqual([-20, -0]);
    const c = moveTangent(b, 0, 'i', [0, 10], true);
    expect(c.v[0]!.i).toEqual([0, 10]);
    expect(c.v[0]!.o).toEqual([20, 0]);
    expect(moveOutline(o, [5, -5]).v[0]!.p).toEqual([5, -5]);
  });

  it('the box is typed in: points and handles scaled to it', () => {
    const list = [rectPath(100, 50, 10)];
    const [f] = fitOutlines(list, { x: 10, y: 20, w: 200, h: 100 });
    expect(outlinesBox([f!])).toEqual({ x: 10, y: 20, w: 200, h: 100 });
  });

  it('a mask changes form over time: a key where it starts, an edit later makes another; keys move and go', () => {
    let l = masked();
    const ref = outlineRefs(l)[0]!;
    expect(isMorphing(l, ref)).toBe(false);
    l = animateOutline(l, ref, 0, true);
    expect(outlineKeyTimes(l, ref)).toEqual([0]);
    const wide = fitOutlines(outlinesAt(l, ref, 1), { x: 0, y: 0, w: 400, h: 200 });
    l = setOutlinesAt(l, ref, 1, wide);
    expect(outlineKeyTimes(l, ref)).toEqual([0, 1]);
    // Halfway, halfway between the two.
    expect(outlinesBox(outlinesAt(l, ref, 0.5)).w).toBeCloseTo(250);
    // Edited where a key is: that key changes, no new one.
    l = setOutlinesAt(l, ref, 1, fitOutlines(outlinesAt(l, ref, 1), { x: 0, y: 0, w: 300, h: 200 }));
    expect(outlineKeyTimes(l, ref)).toEqual([0, 1]);
    l = moveOutlineKey(l, ref, 1, 2);
    expect(outlineKeyTimes(l, ref)).toEqual([0, 2]);
    expect(moveOutlineKey(l, ref, 2, 0)).toBe(l);
    l = removeOutlineKey(l, ref, 0);
    expect(outlineKeyTimes(l, ref)).toEqual([2]);
    // The last key gone: it keeps that form and stops changing.
    l = removeOutlineKey(l, ref, 2);
    expect(isMorphing(l, ref)).toBe(false);
    expect(outlinesBox(outlinesAt(l, ref, 0)).w).toBeCloseTo(300);
  });

  it('a path shape: its outline and further outlines, animated and stopped', () => {
    const s: ShapeLayer = { ...newShape(null, 'path', [0, 0], [0, 0]), path: rectPath(10, 10, 0), subpaths: [rectPath(4, 4, 0)] };
    const ref = outlineRefs(s).find((r) => r.kind === 'path')!;
    expect(outlinesAt(s, ref, 0)).toHaveLength(2);
    let l: Layer = animateOutline(s, ref, 0.5, true);
    l = setOutlinesAt(l, ref, 1, outlinesAt(l, ref, 1).map((o) => moveOutline(o, [10, 0])));
    expect(outlinesAt(l, ref, 1)[1]!.v[0]!.p).toEqual([10, 0]);
    l = animateOutline(l, ref, 1, false);
    expect(l.type === 'shape' && l.morph).toBeNull();
    expect(l.type === 'shape' && l.subpaths?.[0]!.v[0]!.p).toEqual([10, 0]);
  });
});
