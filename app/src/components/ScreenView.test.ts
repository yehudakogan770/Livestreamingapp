import { describe, expect, it } from 'vitest';
import { programLayers, screenMoving } from './ScreenView';
import { demoApply } from '../engine/demo';
import { emptyShow } from '../engine/client';
import type { Action } from '../engine/types/Action';

const base = [
  { type: 'addSource', source: { id: 'a', name: 'A', kind: { type: 'color', color: '#ff0000' } } },
  { type: 'addSource', source: { id: 'b', name: 'B', kind: { type: 'pattern' } } },
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
