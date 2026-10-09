// Easing typed as numbers: speeds and influences (After Effects' Keyframe
// Velocity) and CSS cubic-bezier, both ways.

import { describe, expect, it } from 'vitest';
import { fromVelocity, parseCubicBezier, toVelocity, valueAt } from './easing';
import type { Keyframe, Value } from './types';

const a: Keyframe<Value> = { t: 0, v: 0, o: [0.33, 0] };
const b: Keyframe<Value> = { t: 2, v: 100, i: [0.67, 1] };

describe('keyframe velocity', () => {
  it('reads the usual ease as 0 speed at both ends with a third of influence', () => {
    const v = toVelocity(a, b);
    expect(v.outSpeed).toBeCloseTo(0);
    expect(v.inSpeed).toBeCloseTo(0);
    expect(v.outInfluence).toBeCloseTo(33);
    expect(v.inInfluence).toBeCloseTo(33);
  });

  it('a linear segment moves at its average speed', () => {
    const v = toVelocity({ t: 0, v: [0, 0] }, { t: 1, v: [30, 40] });
    expect(v.outSpeed).toBeCloseTo(50);
    expect(v.inSpeed).toBeCloseTo(50);
  });

  it('typed speeds come back the same, and the curve leaves at that speed', () => {
    const h = fromVelocity(a, b, { outSpeed: 120, outInfluence: 50, inSpeed: 10, inInfluence: 20 });
    const v = toVelocity({ ...a, o: h.o }, { ...b, i: h.i });
    expect(v.outSpeed).toBeCloseTo(120, 3);
    expect(v.outInfluence).toBeCloseTo(50, 3);
    expect(v.inSpeed).toBeCloseTo(10, 3);
    expect(v.inInfluence).toBeCloseTo(20, 3);
    const p = {
      k: [
        { ...a, o: h.o },
        { ...b, i: h.i },
      ],
    } as { k: Keyframe<number>[] };
    const dt = 0.001;
    expect((valueAt(p, dt, 0) - valueAt(p, 0, 0)) / dt).toBeCloseTo(120, -1);
  });
});

describe('CSS easing', () => {
  it('reads cubic-bezier, the named eases and four numbers', () => {
    expect(parseCubicBezier('cubic-bezier(0.4, 0, 0.2, 1)')).toEqual({ o: [0.4, 0], i: [0.2, 1] });
    expect(parseCubicBezier('ease-in-out')).toEqual({ o: [0.42, 0], i: [0.58, 1] });
    expect(parseCubicBezier('0.1 0.7 0.1 1')).toEqual({ o: [0.1, 0.7], i: [0.1, 1] });
    expect(parseCubicBezier('cubic-bezier(2, 0, 0, 1)')).toBeNull();
    expect(parseCubicBezier('bounce')).toBeNull();
  });
});
