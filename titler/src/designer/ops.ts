// Edits to a project. Each returns a new project (the old one is kept for
// undo); layers are found by id anywhere in a composition (inside groups too).

import { cloneLayers, newComposition, newCompLayer, newGroup, uid } from '../core/build';
import { vec } from '../core/easing';
import { apply, mul, type Mat } from '../core/matrix';
import { contentSize, groupOf, layerIndex, ownMatrix, worldMatrix } from '../core/render';
import type { Composition, Layer, TitleProject, Vec2 } from '../core/types';

export function compOf(p: TitleProject, id: string): Composition {
  return p.compositions.find((c) => c.id === id) ?? p.compositions[0]!;
}

export function updateComp(p: TitleProject, id: string, fn: (c: Composition) => Composition): TitleProject {
  return { ...p, compositions: p.compositions.map((c) => (c.id === id ? fn(c) : c)) };
}

/** Change layers by id (anywhere in the composition). */
export function mapLayers(list: Layer[], fn: (l: Layer) => Layer): Layer[] {
  return list.map((l) => {
    const next = fn(l);
    return next.type === 'group' ? { ...next, children: mapLayers(next.children, fn) } : next;
  });
}

export function updateLayers(p: TitleProject, compId: string, ids: string[], fn: (l: Layer) => Layer): TitleProject {
  const set = new Set(ids);
  return updateComp(p, compId, (c) => ({ ...c, layers: mapLayers(c.layers, (l) => (set.has(l.id) ? fn(l) : l)) }));
}

export function findLayer(c: Composition, id: string): Layer | undefined {
  return layerIndex(c).get(id);
}

/** Every layer, front to back, flattened (groups before their children). */
export function flatLayers(list: Layer[]): Layer[] {
  return list.flatMap((l) => (l.type === 'group' ? [l, ...flatLayers(l.children)] : [l]));
}

function removeFrom(list: Layer[], ids: Set<string>): Layer[] {
  return list.filter((l) => !ids.has(l.id)).map((l) => (l.type === 'group' ? { ...l, children: removeFrom(l.children, ids) } : l));
}

/** Remove layers; links to them (parents, mattes) are cleared. */
export function removeLayers(p: TitleProject, compId: string, ids: string[]): TitleProject {
  const set = new Set(ids);
  return updateComp(p, compId, (c) => ({
    ...c,
    layers: mapLayers(removeFrom(c.layers, set), (l) => {
      let next = l;
      if (l.parent && set.has(l.parent)) next = { ...next, parent: null };
      if (l.matte && set.has(l.matte.layer)) next = { ...next, matte: null };
      if (l.type === 'shape' && l.fitTo && set.has(l.fitTo.layer)) next = { ...next, fitTo: null } as Layer;
      return next;
    }),
  }));
}

/** Add layers in front of `above` (or at the very front). */
export function addLayers(p: TitleProject, compId: string, layers: Layer[], above?: string | null): TitleProject {
  return updateComp(p, compId, (c) => {
    if (!above) return { ...c, layers: [...layers, ...c.layers] };
    const put = (list: Layer[]): [Layer[], boolean] => {
      const i = list.findIndex((l) => l.id === above);
      if (i >= 0) return [[...list.slice(0, i), ...layers, ...list.slice(i)], true];
      let done = false;
      const out = list.map((l) => {
        if (done || l.type !== 'group') return l;
        const [children, ok] = put(l.children);
        if (ok) done = true;
        return ok ? { ...l, children } : l;
      });
      return [out, done];
    };
    const [out, ok] = put(c.layers);
    return { ...c, layers: ok ? out : [...layers, ...c.layers] };
  });
}

/** Move layers one step toward the front (-1) or back (+1), or to the very front/back. */
export function restack(p: TitleProject, compId: string, ids: string[], how: 'forward' | 'backward' | 'front' | 'back'): TitleProject {
  const set = new Set(ids);
  const move = (list: Layer[]): Layer[] => {
    let out = list.map((l) => (l.type === 'group' ? { ...l, children: move(l.children) } : l));
    const picked = out.filter((l) => set.has(l.id));
    if (!picked.length) return out;
    if (how === 'front') return [...picked, ...out.filter((l) => !set.has(l.id))];
    if (how === 'back') return [...out.filter((l) => !set.has(l.id)), ...picked];
    out = [...out];
    if (how === 'forward') {
      for (let i = 1; i < out.length; i++) if (set.has(out[i]!.id) && !set.has(out[i - 1]!.id)) [out[i - 1], out[i]] = [out[i]!, out[i - 1]!];
    } else {
      for (let i = out.length - 2; i >= 0; i--) if (set.has(out[i]!.id) && !set.has(out[i + 1]!.id)) [out[i + 1], out[i]] = [out[i]!, out[i + 1]!];
    }
    return out;
  };
  return updateComp(p, compId, (c) => ({ ...c, layers: move(c.layers) }));
}

/** Move a layer to just in front of another (drag in the layer list). */
export function moveBefore(p: TitleProject, compId: string, id: string, before: string | null): TitleProject {
  const c = compOf(p, compId);
  const l = findLayer(c, id);
  if (!l || id === before) return p;
  const without = removeFrom(c.layers, new Set([id]));
  const p2 = updateComp(p, compId, (cc) => ({ ...cc, layers: without }));
  if (!before) return updateComp(p2, compId, (cc) => ({ ...cc, layers: [...cc.layers, l] }));
  return addLayers(p2, compId, [l], before);
}

/** Copies of layers, a little offset, in front of the originals. */
export function duplicate(p: TitleProject, compId: string, ids: string[]): { project: TitleProject; ids: string[] } {
  const c = compOf(p, compId);
  const src = ids.map((id) => findLayer(c, id)).filter((l): l is Layer => !!l);
  const copies = cloneLayers(src).map((l) => ({ ...l, name: `${l.name} copy` }));
  return { project: addLayers(p, compId, copies, src[0]?.id), ids: copies.map((l) => l.id) };
}

/** Put layers in a group (in place of the front-most of them). */
export function group(p: TitleProject, compId: string, ids: string[]): { project: TitleProject; id: string | null } {
  const c = compOf(p, compId);
  const top = c.layers.filter((l) => ids.includes(l.id));
  if (!top.length) return { project: p, id: null };
  const g = newGroup(c, top, 'Group');
  g.start = Math.min(...top.map((l) => l.start));
  g.end = Math.max(...top.map((l) => l.end));
  const first = c.layers.findIndex((l) => ids.includes(l.id));
  const rest = c.layers.filter((l) => !ids.includes(l.id));
  const layers = [...rest];
  layers.splice(Math.min(first, rest.length), 0, g);
  return { project: updateComp(p, compId, (cc) => ({ ...cc, layers })), id: g.id };
}

/** Take layers out of a group (keeping where they appear: the group's move is folded into them if it has none). */
export function ungroup(p: TitleProject, compId: string, groupId: string): TitleProject {
  return updateComp(p, compId, (c) => {
    const i = c.layers.findIndex((l) => l.id === groupId);
    const g = c.layers[i];
    if (!g || g.type !== 'group') return c;
    const m = ownMatrix(g, 0);
    const kids = g.children.map((k) => {
      if (k.parent) return k;
      // A still, untransformed group: children keep their places as they are; otherwise parent them to a null of the group's move.
      const pos = vec(k.transform.position, 0, [0, 0]);
      const at = apply(m, pos);
      return k.transform.position.k ? k : { ...k, transform: { ...k.transform, position: { v: at } } };
    });
    return { ...c, layers: [...c.layers.slice(0, i), ...kids, ...c.layers.slice(i + 1)] };
  });
}

/** Move layers into a new composition and put that composition in their place (precompose). */
export function precompose(p: TitleProject, compId: string, ids: string[], name = 'Precomp'): { project: TitleProject; id: string | null; comp: string | null } {
  const c = compOf(p, compId);
  const top = c.layers.filter((l) => ids.includes(l.id));
  if (!top.length) return { project: p, id: null, comp: null };
  const inner = newComposition(name, c.width, c.height, c.fps, c.duration);
  inner.markers = { ...c.markers };
  inner.layers = top;
  const layer = newCompLayer(c, inner);
  layer.end = c.duration;
  const first = c.layers.findIndex((l) => ids.includes(l.id));
  const rest = c.layers.filter((l) => !ids.includes(l.id));
  rest.splice(Math.min(first, rest.length), 0, layer);
  const next = { ...p, compositions: [...p.compositions.map((x) => (x.id === compId ? { ...x, layers: rest } : x)), inner] };
  return { project: next, id: layer.id, comp: inner.id };
}

// ---- where layers are, in composition pixels ----

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A layer's four corners in composition space at time t. */
export function corners(c: Composition, l: Layer, t: number, p?: TitleProject, size?: Vec2): Vec2[] {
  const m: Mat = worldMatrix(c, l, t, layerIndex(c), groupOf(c));
  const [w, h] = size ?? contentSize(l, t, p);
  return [apply(m, [0, 0]), apply(m, [w, 0]), apply(m, [w, h]), apply(m, [0, h])];
}

export function boundsOf(pts: Vec2[]): Box {
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Line selected layers up with each other (or with the composition when one is selected). */
export function align(p: TitleProject, compId: string, ids: string[], how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom', t: number, boxOf: (l: Layer) => Box | null): TitleProject {
  const c = compOf(p, compId);
  const items = ids.map((id) => findLayer(c, id)).filter((l): l is Layer => !!l && l.type !== 'group');
  const boxes = items.map((l) => [l, boxOf(l)] as const).filter((x): x is readonly [Layer, Box] => !!x[1]);
  if (!boxes.length) return p;
  const all: Box = boxes.length === 1 ? { x: 0, y: 0, w: c.width, h: c.height } : boundsOf(boxes.flatMap(([, b]) => [[b.x, b.y] as Vec2, [b.x + b.w, b.y + b.h] as Vec2]));
  let next = p;
  for (const [l, b] of boxes) {
    let dx = 0;
    let dy = 0;
    if (how === 'left') dx = all.x - b.x;
    if (how === 'hcenter') dx = all.x + all.w / 2 - (b.x + b.w / 2);
    if (how === 'right') dx = all.x + all.w - (b.x + b.w);
    if (how === 'top') dy = all.y - b.y;
    if (how === 'vcenter') dy = all.y + all.h / 2 - (b.y + b.h / 2);
    if (how === 'bottom') dy = all.y + all.h - (b.y + b.h);
    next = updateLayers(next, compId, [l.id], (x) => nudge(x, dx, dy, t));
  }
  return next;
}

/** Spread three or more layers evenly (their centers) across or down. */
export function distribute(p: TitleProject, compId: string, ids: string[], axis: 'x' | 'y', t: number, boxOf: (l: Layer) => Box | null): TitleProject {
  const c = compOf(p, compId);
  const boxes = ids
    .map((id) => findLayer(c, id))
    .filter((l): l is Layer => !!l)
    .map((l) => [l, boxOf(l)] as const)
    .filter((x): x is readonly [Layer, Box] => !!x[1]);
  if (boxes.length < 3) return p;
  const mid = (b: Box) => (axis === 'x' ? b.x + b.w / 2 : b.y + b.h / 2);
  boxes.sort((a, b) => mid(a[1]) - mid(b[1]));
  const first = mid(boxes[0]![1]);
  const step = (mid(boxes[boxes.length - 1]![1]) - first) / (boxes.length - 1);
  let next = p;
  boxes.forEach(([l, b], i) => {
    const d = first + step * i - mid(b);
    next = updateLayers(next, compId, [l.id], (x) => nudge(x, axis === 'x' ? d : 0, axis === 'y' ? d : 0, t));
  });
  return next;
}

/** Move a layer by (dx, dy) composition pixels at time t (a key there if position is animated). */
export function nudge(l: Layer, dx: number, dy: number, t: number): Layer {
  const pos = l.transform.position;
  if (pos.k) {
    const at = vec(pos, t, [0, 0]);
    const k = pos.k.filter((x) => Math.abs(x.t - t) > 1e-6);
    const had = pos.k.find((x) => Math.abs(x.t - t) <= 1e-6);
    k.push({ ...(had ?? { t }), v: [at[0] + dx, at[1] + dy] });
    k.sort((a, b) => a.t - b.t);
    return { ...l, transform: { ...l.transform, position: { k } } };
  }
  const v = pos.v ?? [0, 0];
  return { ...l, transform: { ...l.transform, position: { v: [v[0] + dx, v[1] + dy] } } };
}

/** Make a layer the child of another, keeping where it is now. */
export function setParent(p: TitleProject, compId: string, id: string, parent: string | null, t: number): TitleProject {
  const c = compOf(p, compId);
  const l = findLayer(c, id);
  if (!l) return p;
  // No loops: the new parent may not be (a child of) this layer.
  const idx = layerIndex(c);
  for (let cur = parent ? idx.get(parent) : undefined; cur; cur = cur.parent ? idx.get(cur.parent) : undefined) if (cur.id === id) return p;
  const before = worldMatrix(c, l, t);
  const pm = parent ? worldMatrix(c, idx.get(parent)!, t) : ([1, 0, 0, 1, 0, 0] as Mat);
  const inv = invertMat(pm);
  if (!inv) return updateLayers(p, compId, [id], (x) => ({ ...x, parent }));
  // The layer's own matrix that keeps it in place: inverse(parent) · before.
  const own = mul(inv, before);
  const anchor = vec(l.transform.anchor, t, [0, 0]);
  const at = apply(own, anchor);
  const rot = (Math.atan2(own[1], own[0]) * 180) / Math.PI;
  const sx = Math.hypot(own[0], own[1]) * 100;
  const sy = Math.hypot(own[2], own[3]) * 100;
  return updateLayers(p, compId, [id], (x) =>
    x.transform.position.k || x.transform.rotation.k || x.transform.scale.k
      ? { ...x, parent }
      : { ...x, parent, transform: { ...x.transform, position: { v: at }, rotation: { v: round(rot) }, scale: { v: [round(sx), round(sy)] } } },
  );
}

const round = (v: number) => Math.round(v * 1000) / 1000;

function invertMat(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

/** A new id for every layer of a project's compositions that clashes with another (after a paste). */
export const freshId = () => uid();
