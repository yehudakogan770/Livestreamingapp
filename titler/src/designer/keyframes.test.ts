// Keyframes copied and pasted across layers, animations saved as presets,
// and staggering.

import { beforeEach, describe, expect, it } from 'vitest';
import { keys } from '../core/easing';
import { newProject, newShape, newText } from '../core/build';
import type { Layer, TitleProject, Vec2 } from '../core/types';
import { addLayers, findLayer } from './ops';
import { copyKeys, inStackOrder, loadAnimPresets, pasteKeys, removeAnimPreset, saveAnimPreset, stagger } from './keyframes';

beforeEach(() => localStorage.clear());

function scene(): { p: TitleProject; a: string; b: string; c: string } {
  let p = newProject();
  const comp = p.compositions[0]!;
  const a = newText(comp, 'A');
  a.transform.opacity = keys<number>([0.5, 0, 'easeOut'], [1, 100]);
  a.transform.position = keys<Vec2>([0.5, [0, 40]], [1, [0, 0]]);
  const b = newShape(comp, 'rect');
  const c = newText(comp, 'C');
  p = addLayers(p, comp.id, [a, b, c]);
  return { p, a: a.id, b: b.id, c: c.id };
}
const layer = (p: TitleProject, id: string) => findLayer(p.compositions[0]!, id)!;
const times = (l: Layer, path: 'opacity' | 'position') => (l.transform[path] as { k?: { t: number }[] }).k?.map((k) => k.t);

describe('keyframes across layers', () => {
  it('copies keyframes (timed from the first) and pastes them on other layers at the playhead, eases kept', () => {
    const { p, a, b } = scene();
    const clip = copyKeys(layer(p, a))!;
    expect(clip.items.map((x) => x.path).sort()).toEqual(['transform.opacity', 'transform.position']);
    expect(clip.items[0]!.keys[0]!.t).toBe(0);
    const next = pasteKeys(p, p.main, [b], clip, 2);
    expect(times(layer(next, b), 'opacity')).toEqual([2, 2.5]);
    expect((layer(next, b).transform.opacity as { k: { o?: number[] }[] }).k[0]!.o).toEqual([0, 0]);
  });

  it('copies only the selected keys when asked', () => {
    const { p, a } = scene();
    const clip = copyKeys(layer(p, a), [{ layer: a, path: 'transform.opacity', t: 1 }])!;
    expect(clip.items).toMatchObject([{ path: 'transform.opacity', keys: [{ t: 0, v: 100 }] }]);
    expect(clip.items[0]!.keys).toHaveLength(1);
  });

  it('saves an animation as a preset and gives it to other layers', () => {
    const { p, a, c } = scene();
    const saved = saveAnimPreset(layer(p, a), 'Rise in')!;
    expect(loadAnimPresets().map((x) => x.name)).toEqual(['Rise in']);
    const next = pasteKeys(p, p.main, [c], saved.clip, 0.25);
    expect(times(layer(next, c), 'position')).toEqual([0.25, 0.75]);
    expect(removeAnimPreset(saved.id)).toEqual([]);
    const other = scene();
    expect(saveAnimPreset(layer(other.p, other.b), 'Nothing')).toBeNull();
  });

  it('staggers layers in stacking order, a few frames apart (bars too when asked)', () => {
    let { p, a, b, c } = scene();
    const clip = copyKeys(layer(p, a))!;
    p = pasteKeys(p, p.main, [b, c], clip, 0.5);
    const order = inStackOrder(p, p.main, [c, a, b]);
    expect(order).toEqual([a, b, c]);
    const step = 3 / 30;
    const next = stagger(p, p.main, order, step, true);
    expect(times(layer(next, a), 'opacity')).toEqual([0.5, 1]);
    expect(times(layer(next, b), 'opacity')!.map((t) => +t.toFixed(4))).toEqual([0.6, 1.1]);
    expect(times(layer(next, c), 'opacity')!.map((t) => +t.toFixed(4))).toEqual([0.7, 1.2]);
    expect(layer(next, c).start).toBeCloseTo(layer(p, c).start + 2 * step);
  });
});
