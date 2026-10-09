// Expressions on properties: arithmetic on numbers and pairs, wiggle (smooth,
// repeatable), loops of keyframes, time, links to other layers, and safety
// (anything not understood keeps the value; nothing is ever run as code).

import { describe, expect, it } from 'vitest';
import { keys, setKey, setValue, toggleKeys, valueAt } from './easing';
import { exprProblem, noise1 } from './expr';
import { newProject, newShape, newText } from './build';
import { renderFrame, exprScopeFor, worldMatrix, layerIndex, groupOf } from './render';
import { setExprScope } from './expr';
import type { Prop, Vec2 } from './types';
import { canvas, env } from '../test/nodeCanvas';

const at = <T extends number | Vec2>(p: Prop<T>, t: number, fallback: T) => valueAt(p, t, fallback);

describe('expressions', () => {
  it('works on the value, the time, and pairs part by part', () => {
    expect(at({ v: 10, x: 'value * 2 + 1' }, 0, 0)).toBe(21);
    expect(at({ v: [100, 50], x: 'value + [10, -5]' }, 0, [0, 0])).toEqual([110, 45]);
    expect(at({ v: [100, 50], x: '[value[1], value[0]]' }, 0, [0, 0])).toEqual([50, 100]);
    expect(at({ v: 0, x: 'time * 90' }, 2, 0)).toBe(180);
    expect(at({ v: 0, x: 'time > 1 ? 100 : 0' }, 1.5, 0)).toBe(100);
    expect(at({ v: 0, x: 'linear(time, 0, 2, 0, 100)' }, 0.5, 0)).toBe(25);
    expect(at({ v: 0, x: 'ease(time, 0, 2, 0, 100)' }, 1, 0)).toBe(50);
    expect(at({ v: 0, x: 'clamp(time * 100, 0, 30)' }, 5, 0)).toBe(30);
    expect(at({ v: [3, 4], x: '7' }, 0, [0, 0])).toEqual([7, 7]);
  });

  it('wiggle: within its size, smooth, and the same every time it is drawn', () => {
    const p: Prop = { v: 50, x: 'wiggle(3, 10)' };
    const samples = Array.from({ length: 200 }, (_, i) => at(p, i / 60, 0));
    expect(Math.max(...samples)).toBeLessThanOrEqual(60);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(40);
    expect(new Set(samples.map((x) => x.toFixed(3))).size).toBeGreaterThan(100);
    for (let i = 1; i < samples.length; i++) expect(Math.abs(samples[i]! - samples[i - 1]!)).toBeLessThan(3);
    expect(at(p, 1.234, 0)).toBe(at(p, 1.234, 0));
    // A pair wiggles on both axes, differently.
    const v = at({ v: [0, 0], x: 'wiggle(2, 20)' } as Prop<Vec2>, 0.7, [0, 0]);
    expect(v[0]).not.toBe(v[1]);
    expect(Math.abs(noise1(3.5, 1))).toBeLessThanOrEqual(1);
  });

  it('loops the keyframes after the last one (cycle, ping-pong, offset) and before the first', () => {
    const k = keys<number>([0, 0], [1, 100]);
    expect(at({ ...k, x: 'loopOut()' }, 1.25, 0)).toBeCloseTo(25);
    expect(at({ ...k, x: 'loopOut("pingpong")' }, 1.25, 0)).toBeCloseTo(75);
    expect(at({ ...k, x: 'loopOut("offset")' }, 2.5, 0)).toBeCloseTo(250);
    expect(at({ ...k, x: 'loopIn()' }, -0.25, 0)).toBeCloseTo(75);
    // Inside the keys: the keys as they are.
    expect(at({ ...k, x: 'loopOut()' }, 0.5, 0)).toBeCloseTo(50);
  });

  it('keeps the value for anything it can’t work out, and says why', () => {
    for (const bad of ['alert(1)', 'value +', 'nope', 'constructor', '"a" * ', '[1,2', 'window.x']) {
      expect(at({ v: 7, x: bad }, 0, 0)).toBe(7);
    }
    expect(exprProblem('wiggle(2, 8)')).toBeNull();
    expect(exprProblem('value +')).toMatch(/ends too soon/);
    expect(exprProblem('a $ b')).toMatch(/Not understood/);
  });

  it('the expression stays when the property is changed (keys added or removed)', () => {
    const p: Prop = { v: 5, x: 'value + 1' };
    expect(setValue(p, 0, 9)).toEqual({ v: 9, x: 'value + 1' });
    const animated = toggleKeys(p, 0, 0);
    expect(animated.x).toBe('value + 1');
    expect(setKey(animated, 1, 20).x).toBe('value + 1');
  });

  it('links to another layer’s property (drawing, and the designer’s hit tests)', () => {
    const p = newProject();
    const c = p.compositions[0]!;
    const leader = { ...newShape(c, 'rect', [300, 200]), name: 'Leader' };
    leader.transform.position = keys<Vec2>([0, [100, 100]], [1, [500, 100]]);
    const follower = { ...newText(c, 'Follows'), name: 'Follower' };
    follower.transform.position = { v: [0, 0], x: 'link("Leader", "transform.position") + [0, 80]' };
    c.layers = [follower, leader];
    const before = setExprScope(exprScopeFor(p));
    try {
      const m = worldMatrix(c, follower, 0.5, layerIndex(c), groupOf(c));
      expect([m[4], m[5]]).toEqual([300 - follower.transform.anchor.v![0], 180 - follower.transform.anchor.v![1]]);
    } finally {
      setExprScope(before);
    }
    // Drawing sets the links up by itself.
    const cv = canvas(192, 108);
    expect(() => renderFrame(cv.getContext('2d') as unknown as CanvasRenderingContext2D, p, { time: 0.5, env, width: 192, height: 108 })).not.toThrow();
    // A link to a layer that isn't there keeps the value.
    expect(at({ v: 4, x: 'link("Nobody", "transform.opacity")' }, 0, 0)).toBe(4);
  });
});
