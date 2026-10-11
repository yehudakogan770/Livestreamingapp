// The layer tree: finding, walking and changing layers immutably (every
// change returns a new tree that shares the untouched branches).

import { Raster } from './raster';
import type { Doc, GroupLayer, Layer, LayerBase, PixelLayer, Rect } from './types';
import { styleReach } from './styles';

let counter = 0;
export const uid = (prefix = 'l') => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export function baseLayer(name: string): Omit<LayerBase, 'id'> & { id: string } {
  return { id: uid(), name, visible: true, opacity: 1, fill: 1, blend: 'normal', clip: false, locks: {} };
}

export function pixelLayer(name: string, raster: Raster): PixelLayer {
  return { ...baseLayer(name), kind: 'pixel', raster };
}

export function groupLayer(name: string, children: Layer[] = []): GroupLayer {
  return { ...baseLayer(name), kind: 'group', children, open: true, passThrough: true };
}

/** Every layer, depth first, bottom to top (children before their group). */
export function walk(layers: Layer[], f: (l: Layer, parent: GroupLayer | null, depth: number) => void, parent: GroupLayer | null = null, depth = 0): void {
  for (const l of layers) {
    if (l.kind === 'group') walk(l.children, f, l, depth + 1);
    f(l, parent, depth);
  }
}

export function allLayers(layers: Layer[]): Layer[] {
  const out: Layer[] = [];
  walk(layers, (l) => out.push(l));
  return out;
}

export function findLayer(layers: Layer[], id: string): Layer | null {
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.kind === 'group') {
      const f = findLayer(l.children, id);
      if (f) return f;
    }
  }
  return null;
}

export function findParent(layers: Layer[], id: string, parent: GroupLayer | null = null): { parent: GroupLayer | null; index: number } | null {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i]!;
    if (l.id === id) return { parent, index: i };
    if (l.kind === 'group') {
      const f = findParent(l.children, id, l);
      if (f) return f;
    }
  }
  return null;
}

/** The tree with one layer replaced by `f(layer)`. */
export function updateLayer(layers: Layer[], id: string, f: (l: Layer) => Layer): Layer[] {
  let changed = false;
  const out = layers.map((l) => {
    if (l.id === id) {
      changed = true;
      return f(l);
    }
    if (l.kind === 'group') {
      const kids = updateLayer(l.children, id, f);
      if (kids !== l.children) {
        changed = true;
        return { ...l, children: kids };
      }
    }
    return l;
  });
  return changed ? out : layers;
}

export function removeLayers(layers: Layer[], ids: Set<string>): Layer[] {
  const out: Layer[] = [];
  let changed = false;
  for (const l of layers) {
    if (ids.has(l.id)) {
      changed = true;
      continue;
    }
    if (l.kind === 'group') {
      const kids = removeLayers(l.children, ids);
      if (kids !== l.children) {
        changed = true;
        out.push({ ...l, children: kids });
        continue;
      }
    }
    out.push(l);
  }
  return changed ? out : layers;
}

/**
 * Insert layers above `anchorId` (in the same list), or at the top of the
 * root when there is no anchor; into a group when `into` is set.
 */
export function insertLayers(layers: Layer[], add: Layer[], anchorId: string | null, where: 'above' | 'below' | 'into' = 'above'): Layer[] {
  if (!anchorId) return [...layers, ...add];
  const pos = findParent(layers, anchorId);
  if (!pos) return [...layers, ...add];
  if (where === 'into') {
    return updateLayer(layers, anchorId, (g) => (g.kind === 'group' ? { ...g, children: [...g.children, ...add], open: true } : g));
  }
  const insertAt = where === 'above' ? pos.index + 1 : pos.index;
  if (!pos.parent) {
    const out = layers.slice();
    out.splice(insertAt, 0, ...add);
    return out;
  }
  return updateLayer(layers, pos.parent.id, (g) => {
    if (g.kind !== 'group') return g;
    const kids = g.children.slice();
    kids.splice(insertAt, 0, ...add);
    return { ...g, children: kids };
  });
}

/** The list (root or a group's children) holding a layer. */
export function siblingsOf(layers: Layer[], id: string): Layer[] {
  const pos = findParent(layers, id);
  return pos?.parent ? pos.parent.children : layers;
}

/** Move a layer by `delta` within its list (+1 = up one). */
export function moveLayer(layers: Layer[], id: string, delta: number): Layer[] {
  const pos = findParent(layers, id);
  if (!pos) return layers;
  const list = pos.parent ? pos.parent.children : layers;
  const to = Math.max(0, Math.min(list.length - 1, pos.index + delta));
  if (to === pos.index) return layers;
  const next = list.slice();
  const [l] = next.splice(pos.index, 1);
  next.splice(to, 0, l!);
  if (!pos.parent) return next;
  return updateLayer(layers, pos.parent.id, (g) => (g.kind === 'group' ? { ...g, children: next } : g));
}

/** Layers with pixels of their own (what painting tools act on). */
export const hasRaster = (l: Layer): l is Extract<Layer, { raster: Raster }> => 'raster' in l;

/** Bounds of what a layer draws (document coordinates), including effects. */
export function layerBounds(l: Layer, doc: { width: number; height: number }): Rect | null {
  const canvas = { x: 0, y: 0, w: doc.width, h: doc.height };
  let r: Rect | null;
  switch (l.kind) {
    case 'group': {
      r = null;
      for (const c of l.children) {
        const b = c.visible ? layerBounds(c, doc) : null;
        if (b) r = r ? unionRect(r, b) : b;
      }
      break;
    }
    case 'adjust':
    case 'fill':
      r = canvas;
      break;
    default:
      r = l.raster.contentBoundsCached();
  }
  if (r && l.styles) {
    const reach = styleReach(l.styles);
    if (reach) r = { x: r.x - reach, y: r.y - reach, w: r.w + 2 * reach, h: r.h + 2 * reach };
  }
  return r;
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** A copy of a layer (and its children) with new ids; rasters shared (they copy on write). */
export function duplicateLayer(l: Layer, suffix = ' copy'): Layer {
  const base = { ...l, id: uid(), name: l.name + suffix };
  if (base.kind === 'group') return { ...base, children: base.children.map((c) => duplicateLayer(c, '')) } as Layer;
  if ('raster' in base) {
    const out = { ...base, raster: (base.raster as Raster).clone() } as Layer;
    if (out.mask) out.mask = { ...out.mask, raster: out.mask.raster.clone() };
    return out;
  }
  if (base.mask) base.mask = { ...base.mask, raster: base.mask.raster.clone() };
  return base as Layer;
}

/** Ids of a layer and everything inside it. */
export function idsWithin(l: Layer): string[] {
  const out = [l.id];
  if (l.kind === 'group') for (const c of l.children) out.push(...idsWithin(c));
  return out;
}

/** Unique layer name ("Layer 3"). */
export function nextName(doc: Doc, base = 'Layer'): string {
  const names = new Set(allLayers(doc.layers).map((l) => l.name));
  for (let i = 1; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}
