import { describe, expect, it } from 'vitest';
import { newComposition, newProject, newShape, newText } from '../core/build';
import { keys, valueAt, vec } from '../core/easing';
import { worldMatrix } from '../core/render';
import { apply } from '../core/matrix';
import type { Layer, TitleProject, Vec2 } from '../core/types';
import {
  addLayers,
  align,
  compOf,
  distribute,
  duplicate,
  findLayer,
  group,
  moveBefore,
  nudge,
  precompose,
  removeLayers,
  restack,
  setParent,
  ungroup,
  type Box,
} from './ops';
import { getProp, propsOf, withProp, layerKeyTimes } from './props';
import { Store } from './store';
import { moveKeys } from './Timeline';
import { frameTimes } from './renderVideo';
import { applyStyle, styleOf } from './styles';

function setup(): { p: TitleProject; c: string; a: Layer; b: Layer; d: Layer } {
  const p = newProject();
  const comp = p.compositions[0]!;
  const a = newShape(comp, 'rect', [100, 100], [100, 50]);
  const b = newShape(comp, 'rect', [400, 300], [100, 50]);
  const d = newShape(comp, 'rect', [1000, 500], [100, 50]);
  comp.layers = [a, b, d];
  return { p, c: comp.id, a, b, d };
}

// Boxes without measuring: a shape's position and size.
const boxOf =
  (p: () => TitleProject, c: string) =>
  (l: Layer): Box | null => {
    const x = findLayer(compOf(p(), c), l.id);
    if (!x || x.type !== 'shape') return null;
    const pos = vec(x.transform.position, 0, [0, 0]);
    const size = vec(x.size, 0, [0, 0]);
    return { x: pos[0], y: pos[1], w: size[0], h: size[1] };
  };

describe('layer edits', () => {
  it('adds in front of the selected layer, removes and clears links', () => {
    const { p, c, a, b } = setup();
    const t = newText(null, 'Hi');
    let q = addLayers(p, c, [t], b.id);
    expect(compOf(q, c).layers.map((l) => l.id)).toEqual([a.id, t.id, b.id, compOf(p, c).layers[2]!.id]);
    q = {
      ...q,
      compositions: q.compositions.map((x) => ({
        ...x,
        layers: x.layers.map((l) => (l.id === t.id ? { ...l, parent: a.id, matte: { layer: a.id, mode: 'alpha' as const } } : l)),
      })),
    };
    q = removeLayers(q, c, [a.id]);
    const left = findLayer(compOf(q, c), t.id)!;
    expect(left.parent).toBeNull();
    expect(left.matte).toBeNull();
  });

  it('changes the order: forward, back, front, and by dragging', () => {
    const { p, c, a, b, d } = setup();
    const ids = (q: TitleProject) => compOf(q, c).layers.map((l) => l.id);
    expect(ids(restack(p, c, [b.id], 'forward'))).toEqual([b.id, a.id, d.id]);
    expect(ids(restack(p, c, [a.id], 'back'))).toEqual([b.id, d.id, a.id]);
    expect(ids(restack(p, c, [d.id], 'front'))).toEqual([d.id, a.id, b.id]);
    expect(ids(moveBefore(p, c, d.id, a.id))).toEqual([d.id, a.id, b.id]);
  });

  it('duplicates with new ids, groups and ungroups, precomposes', () => {
    const { p, c, a, b } = setup();
    const dup = duplicate(p, c, [a.id]);
    expect(dup.ids.length).toBe(1);
    expect(dup.ids[0]).not.toBe(a.id);
    expect(findLayer(compOf(dup.project, c), dup.ids[0]!)!.name).toBe('Rectangle copy');
    const g = group(p, c, [a.id, b.id]);
    const gl = compOf(g.project, c).layers[0]!;
    expect(gl.type).toBe('group');
    expect(gl.type === 'group' && gl.children.map((x) => x.id)).toEqual([a.id, b.id]);
    const un = ungroup(g.project, c, g.id!);
    expect(
      compOf(un, c)
        .layers.map((l) => l.id)
        .slice(0, 2),
    ).toEqual([a.id, b.id]);
    const pre = precompose(p, c, [a.id, b.id], 'Inner');
    expect(pre.project.compositions.length).toBe(2);
    const inner = pre.project.compositions.find((x) => x.id === pre.comp)!;
    expect(inner.layers.map((l) => l.id)).toEqual([a.id, b.id]);
    expect(compOf(pre.project, c).layers[0]!.type).toBe('comp');
  });

  it('aligns to each other, to the frame when alone, and distributes', () => {
    const s = setup();
    let p = s.p;
    p = align(
      p,
      s.c,
      [s.a.id, s.b.id],
      'left',
      0,
      boxOf(() => p, s.c),
    );
    expect(vec(findLayer(compOf(p, s.c), s.b.id)!.transform.position, 0, [0, 0])[0]).toBe(100);
    p = align(
      p,
      s.c,
      [s.d.id],
      'hcenter',
      0,
      boxOf(() => p, s.c),
    );
    expect(vec(findLayer(compOf(p, s.c), s.d.id)!.transform.position, 0, [0, 0])[0]).toBe(910);
    let q = s.p;
    q = distribute(
      q,
      s.c,
      [s.a.id, s.b.id, s.d.id],
      'x',
      0,
      boxOf(() => q, s.c),
    );
    const xs = [s.a, s.b, s.d].map((l) => vec(findLayer(compOf(q, s.c), l.id)!.transform.position, 0, [0, 0])[0] + 50);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!);
  });

  it('nudging an animated position adds a key there', () => {
    const { a } = setup();
    const moving = { ...a, transform: { ...a.transform, position: keys<Vec2>([0, [0, 0]], [2, [100, 0]]) } };
    const n = nudge(moving, 0, 10, 1);
    expect(n.transform.position.k!.length).toBe(3);
    expect(valueAt(n.transform.position, 1, [0, 0])).toEqual([50, 10]);
  });

  it('parenting keeps the layer where it is', () => {
    const { p, c, a, b } = setup();
    const turned = { ...a, transform: { ...a.transform, rotation: { v: 30 } } };
    const q0 = { ...p, compositions: p.compositions.map((x) => ({ ...x, layers: x.layers.map((l) => (l.id === a.id ? turned : l)) })) };
    const before = apply(worldMatrix(compOf(q0, c), b, 0), [10, 10]);
    const q = setParent(q0, c, b.id, a.id, 0);
    const child = findLayer(compOf(q, c), b.id)!;
    expect(child.parent).toBe(a.id);
    const after = apply(worldMatrix(compOf(q, c), child, 0), [10, 10]);
    expect(after[0]).toBeCloseTo(before[0], 3);
    expect(after[1]).toBeCloseTo(before[1], 3);
    // Never a loop.
    expect(setParent(q, c, a.id, b.id, 0)).toBe(q);
  });
});

describe('properties and keyframes', () => {
  it('reads and writes properties by path, making parents as needed', () => {
    const l = newText(null, 'x');
    const r = withProp(l, 'reveal.left', { v: 40 });
    expect(getProp(r, 'reveal.left')).toEqual({ v: 40 });
    expect(getProp(r, 'reveal.right')).toEqual({ v: 0 });
    expect(l.reveal).toBeUndefined();
    expect(propsOf(r).some((x) => x.path === 'reveal.left')).toBe(true);
    const k = withProp(l, 'transform.opacity', keys<number>([0, 0], [1, 100]));
    expect(layerKeyTimes(k)).toEqual([0, 1]);
  });

  it('moves selected keyframes in time', () => {
    const p = newProject();
    const comp = p.compositions[0]!;
    const l = newText(comp, 'x');
    l.transform.opacity = keys<number>([0, 0], [1, 100]);
    comp.layers = [l];
    const q = moveKeys(p, comp.id, [{ layer: l.id, path: 'transform.opacity', t: 1 }], 0.5);
    expect(findLayer(compOf(q, comp.id), l.id)!.transform.opacity.k!.map((k) => k.t)).toEqual([0, 1.5]);
  });
});

describe('the editor store', () => {
  it('undoes and redoes, with a drag as one step', () => {
    const s = new Store(newProject('A'));
    s.edit('Rename', (p) => ({ ...p, name: 'B' }));
    s.begin('Drag');
    s.edit('Drag', (p) => ({ ...p, name: 'C' }));
    s.edit('Drag', (p) => ({ ...p, name: 'D' }));
    s.end();
    expect(s.get().project.name).toBe('D');
    s.undo();
    expect(s.get().project.name).toBe('B');
    s.undo();
    expect(s.get().project.name).toBe('A');
    expect(s.canUndo()).toBe(false);
    s.redo();
    s.redo();
    expect(s.get().project.name).toBe('D');
    expect(s.get().dirty).toBe(true);
  });

  it('opening another project starts a new history', () => {
    const s = new Store(newProject('A'));
    s.edit('x', (p) => ({ ...p, name: 'B' }));
    s.load(newProject('Other'));
    expect(s.canUndo()).toBe(false);
    expect(s.get().dirty).toBe(false);
  });
});

describe('rendering and styles', () => {
  it('a film has one frame per frame time', () => {
    expect(frameTimes({ from: 0, to: 1, fps: 30 }).length).toBe(30);
    expect(frameTimes({ from: 2, to: 2.5, fps: 50 })[1]).toBeCloseTo(2.02);
  });

  it('a layer style carries the look, not the words or place', () => {
    const a = newText(newComposition(), 'One', [10, 10]);
    a.style = { ...a.style, size: 99, fill: { type: 'solid', color: '$accent' } };
    const b = newText(newComposition(), 'Two', [500, 500]);
    const st = styleOf(a)!;
    const c = applyStyle(b, st) as typeof b;
    expect(c.style.size).toBe(99);
    expect(c.text).toBe('Two');
    expect(vec(c.transform.position, 0, [0, 0])).toEqual([500, 500]);
    expect(applyStyle(newShape(null), st).type).toBe('shape');
  });
});
