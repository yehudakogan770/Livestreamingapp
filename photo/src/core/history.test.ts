import { describe, expect, it } from 'vitest';
import { History, stateOf } from './history';
import { blankDoc } from './doc';
import { SRGB } from './color';
import { Raster, TileEdit } from './raster';
import { pixelLayer, updateLayer } from './layers';
import type { Doc, PixelLayer } from './types';

const make = () => blankDoc({ name: 't', width: 600, height: 400, depth: 8, resolution: 72, profile: SRGB, background: 'white' });

function paint(doc: Doc, color: number[]): ReturnType<TileEdit['commit']> {
  const l = doc.layers[0] as PixelLayer;
  const e = new TileEdit(l.raster);
  const r = { x: 10, y: 10, w: 20, h: 20 };
  const px = new Float32Array(r.w * r.h * 4);
  for (let i = 0; i < px.length; i += 4) px.set(color, i);
  l.raster.write(r, px, e);
  return e.commit();
}

describe('history', () => {
  it('undoes and redoes pixel edits without copying untouched tiles', () => {
    const doc = make();
    const h = new History(stateOf(doc));
    const l = doc.layers[0] as PixelLayer;
    const before = l.raster.pixel(15, 15);
    const sw = paint(doc, [1, 0, 0, 1]);
    expect(sw.before.size).toBe(1);
    h.push('Brush', 'brush', stateOf(doc), stateOf(doc), [sw]);
    expect([...l.raster.pixel(15, 15)]).toEqual([1, 0, 0, 1]);
    h.undo();
    expect([...l.raster.pixel(15, 15)]).toEqual([...before]);
    h.redo();
    expect([...l.raster.pixel(15, 15)]).toEqual([1, 0, 0, 1]);
  });

  it('keeps layer trees by reference and goes to any step', () => {
    const doc = make();
    const h = new History(stateOf(doc));
    const s0 = stateOf(doc);
    const added = { ...s0, layers: [...s0.layers, pixelLayer('Layer 1', new Raster(8, 4))] };
    h.push('New Layer', 'layer', s0, added);
    const renamed = { ...added, layers: updateLayer(added.layers, added.layers[1]!.id, (l) => ({ ...l, name: 'Sky' })) };
    h.push('Rename', 'layer', added, renamed);
    expect(h.goTo(0)!.layers).toHaveLength(1);
    expect(h.goTo(2)!.layers[1]!.name).toBe('Sky');
    expect(h.undo()!.layers[1]!.name).toBe('Layer 1');
    // A new step drops the redo steps.
    h.push('Other', 'x', added, added);
    expect(h.canRedo).toBe(false);
    expect(h.steps).toHaveLength(2);
  });

  it('snapshots restore pixels and can themselves be undone', () => {
    const doc = make();
    const h = new History(stateOf(doc));
    const l = doc.layers[0] as PixelLayer;
    h.push('Red', 'brush', stateOf(doc), stateOf(doc), [paint(doc, [1, 0, 0, 1])]);
    const snap = h.snapshot(stateOf(doc), 'Red');
    h.push('Blue', 'brush', stateOf(doc), stateOf(doc), [paint(doc, [0, 0, 1, 1])]);
    expect([...l.raster.pixel(15, 15)]).toEqual([0, 0, 1, 1]);
    h.restore(snap, stateOf(doc));
    expect([...l.raster.pixel(15, 15)]).toEqual([1, 0, 0, 1]);
    h.undo();
    expect([...l.raster.pixel(15, 15)]).toEqual([0, 0, 1, 1]);
    // The opening state is always a snapshot.
    expect(h.snapshots[0]!.name).toBe('Open');
  });

  it('gives the History Brush the tiles of an earlier step', () => {
    const doc = make();
    const h = new History(stateOf(doc));
    const l = doc.layers[0] as PixelLayer;
    h.push('Red', 'brush', stateOf(doc), stateOf(doc), [paint(doc, [1, 0, 0, 1])]);
    h.push('Blue', 'brush', stateOf(doc), stateOf(doc), [paint(doc, [0, 0, 1, 1])]);
    const tiles = h.tilesAt(l.raster, 1);
    const r = new Raster(8, 4, tiles);
    expect([...r.pixel(15, 15)]).toEqual([1, 0, 0, 1]);
    expect([...new Raster(8, 4, h.tilesAt(l.raster, 0)).pixel(15, 15)]).toEqual([1, 1, 1, 1]);
  });

  it('lets old steps go past the limit', () => {
    const doc = make();
    const h = new History(stateOf(doc), 5);
    for (let i = 0; i < 12; i++) h.push(`Step ${i}`, 'x', stateOf(doc), stateOf(doc));
    expect(h.steps).toHaveLength(5);
    expect(h.steps[0]!.label).toBe('Step 7');
  });
});
