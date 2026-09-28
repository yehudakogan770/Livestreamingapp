import { describe, expect, it } from 'vitest';
import { programLayers, screenMoving, transitionKeyframes } from './ScreenView';
import { demoApply } from '../engine/demo';
import { emptyShow } from '../engine/client';
import type { Action } from '../engine/types/Action';

const base = [
  {
    type: 'addSource',
    source: { id: 'a', name: 'A', kind: { type: 'color', color: '#ff0000' } },
  },
  {
    type: 'addSource',
    source: { id: 'b', name: 'B', kind: { type: 'pattern' } },
  },
  { type: 'cutTo', screen: 'live', sourceId: 'a' },
  { type: 'setPreview', screen: 'live', sourceId: 'b' },
] satisfies Action[];
const show = () => base.reduce((s, a) => demoApply(s, a, 0), emptyShow());

describe('programLayers', () => {
  it('shows just what is on air when nothing is moving', () => {
    expect(programLayers(show(), 'live', 1000).layers).toEqual([{ id: 'a', opacity: 1 }]);
  });

  it('draws both pictures while a TAKE runs, keyed by source so video keeps playing', () => {
    const s = demoApply(show(), { type: 'take', screen: 'live' }, 1000);
    const mid = programLayers(s, 'live', 1400);
    expect(mid.layers.map((l) => l.id)).toEqual(['a', 'b']);
    expect(mid.layers[1]!.opacity).toBeCloseTo(0.5);
    expect(screenMoving(s, 'live', 1400)).toBe(true);
    expect(programLayers(s, 'live', 2000).layers).toEqual([{ id: 'b', opacity: 1 }]);
    expect(screenMoving(s, 'live', 2500)).toBe(false);
  });

  it('shows the manual T-bar mix of on air and next', () => {
    const s = demoApply(show(), { type: 'setTbar', screen: 'live', value: 0.3 }, 1000);
    const { layers } = programLayers(s, 'live', 5000);
    expect(layers.map((l) => [l.id, l.opacity])).toEqual([
      ['a', 1],
      ['b', 0.3],
    ]);
  });
});

describe('transitionKeyframes', () => {
  it('fades the incoming picture in from nothing to full', () => {
    const f = transitionKeyframes('fade', 'in');
    expect(f[0]).toMatchObject({ offset: 0, opacity: 0 });
    expect(f[f.length - 1]).toMatchObject({
      offset: 1,
      opacity: 1,
      clipPath: 'none',
    });
  });

  it('dips through black and wipes and slides the whole way', () => {
    const black = transitionKeyframes('dip', 'black').map((k) => k.opacity as number);
    expect(black[0]).toBe(0);
    expect(Math.max(...black)).toBeCloseTo(1);
    expect(black[black.length - 1]).toBeCloseTo(0);
    const wipe = transitionKeyframes('wipe', 'in');
    expect(wipe[0]!.clipPath).toBe('inset(0 100.000% 0 0)');
    expect(wipe[wipe.length - 1]!.clipPath).toBe('inset(0 0.000% 0 0)');
    const out = transitionKeyframes('slide', 'out');
    expect(out[out.length - 1]!.transform).toBe('translateX(-100%)');
  });
});
