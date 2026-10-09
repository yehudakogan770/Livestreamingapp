// The RAM preview cache: an edit throws away only the frames it changes,
// memory stays within its cap, and the cached runs feed the timeline's bar.

import { describe, expect, it } from 'vitest';
import { newComposition, newCompLayer, newProject, newShape, newText } from '../core/build';
import type { TitleProject } from '../core/types';
import { affectedSpans, FrameCache, merge } from './frameCache';
import { addLayers, restack, updateComp, updateLayers } from './ops';

function scene(): { p: TitleProject; a: string; b: string; box: string } {
  let p = newProject();
  const c = p.compositions[0]!;
  const a = { ...newText(c, 'Name'), start: 0, end: 3 };
  const b = { ...newText(c, 'Role'), start: 4, end: 8 };
  const box = { ...newShape(c, 'rect'), start: 4, end: 8, parent: null as string | null };
  p = addLayers(p, c.id, [a, b, box]);
  return { p, a: a.id, b: b.id, box: box.id };
}

const frame = (w = 10, h = 10) => ({ width: w, height: h, closed: false, close() {
  this.closed = true;
} });

describe('RAM preview cache', () => {
  it('an edit to one layer changes only its time span', () => {
    const { p, a, b } = scene();
    const id = p.main;
    const moved = updateLayers(p, id, [a], (l) => ({ ...l, name: l.name, transform: { ...l.transform, opacity: { v: 50 } } }));
    expect(affectedSpans(p, moved, id)).toEqual([{ from: 0, to: 3 }]);
    // Lengthening a bar: the old and the new span.
    const longer = updateLayers(p, id, [b], (l) => ({ ...l, end: 9 }));
    expect(affectedSpans(p, longer, id)).toEqual([{ from: 4, to: 9 }]);
  });

  it('markers, cues and guides change no frames; size, colors and layer order change all', () => {
    const { p } = scene();
    const id = p.main;
    expect(affectedSpans(p, updateComp(p, id, (c) => ({ ...c, cues: [{ id: 'q', t: 1, name: 'Cue' }] })), id)).toBeNull();
    expect(affectedSpans(p, updateComp(p, id, (c) => ({ ...c, markers: { ...c.markers, inEnd: 0.5 } })), id)).toBeNull();
    expect(affectedSpans(p, updateComp(p, id, (c) => ({ ...c, width: 1280 })), id)).toBe('all');
    expect(affectedSpans(p, { ...p, tokens: { ...p.tokens, accent: '#00ff00' } }, id)).toBe('all');
    const c = p.compositions[0]!;
    expect(affectedSpans(p, restack(p, id, [c.layers[2]!.id], 'front'), id)).toBe('all');
  });

  it('layers that move with, are seen through or fit to a changed layer change too', () => {
    const { p, a, box } = scene();
    const id = p.main;
    const linked = updateLayers(p, id, [box], (l) => ({ ...l, parent: a }));
    const moved = updateLayers(linked, id, [a], (l) => ({ ...l, transform: { ...l.transform, rotation: { v: 10 } } }));
    expect(affectedSpans(linked, moved, id)).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 8 },
    ]);
  });

  it('a change inside a precomp changes the frames where it is placed', () => {
    let { p } = scene();
    const inner = newComposition('Inner', 400, 200, 30, 2);
    p = { ...p, compositions: [...p.compositions, inner] };
    const place = { ...newCompLayer(p.compositions[0]!, inner), start: 5, end: 7 };
    p = addLayers(p, p.main, [place]);
    const edited = addLayers(p, inner.id, [newShape(inner, 'ellipse')]);
    expect(affectedSpans(p, edited, p.main)).toEqual([{ from: 5, to: 7 }]);
  });

  it('frames are dropped in the changed spans only, and the cache keeps within its memory', () => {
    const cache = new FrameCache(10 * 10 * 4 * 5);
    const made = Array.from({ length: 8 }, () => frame());
    for (let n = 0; n < 5; n++) expect(cache.put(n, made[n]!)).toBe(true);
    expect(cache.usedBytes).toBe(2000);
    // A sixth frame: the one used longest ago goes.
    cache.get(0);
    cache.put(5, made[5]!);
    expect(cache.has(1)).toBe(false);
    expect(made[1]!.closed).toBe(true);
    expect(cache.has(0)).toBe(true);
    expect(cache.runs()).toEqual([
      [0, 0],
      [2, 5],
    ]);
    // An edit at 0.11 s – 0.12 s (30 fps): the frames within a frame of it (3 and 4) go.
    cache.invalidate([{ from: 0.11, to: 0.12 }], 30);
    expect(cache.runs()).toEqual([
      [0, 0],
      [2, 2],
      [5, 5],
    ]);
    cache.invalidate('all', 30);
    expect(cache.size).toBe(0);
    expect(cache.usedBytes).toBe(0);
    // A new key (other values or size) starts again.
    cache.put(1, made[6]!);
    cache.setKey('other');
    expect(cache.size).toBe(0);
  });

  it('overlapping spans are joined', () => {
    expect(
      merge([
        { from: 4, to: 6 },
        { from: 0, to: 1 },
        { from: 5, to: 9 },
      ]),
    ).toEqual([
      { from: 0, to: 1 },
      { from: 4, to: 9 },
    ]);
  });
});
