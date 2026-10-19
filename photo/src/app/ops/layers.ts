// The Layer menu and the Layers panel's buttons.

import { bump, current, toast, app } from '../state';
import { change, flattenRaster, canvasRect, selectionMask, need, withSelection, flatten } from './common';
import {
  allLayers,
  baseLayer,
  duplicateLayer,
  findLayer,
  findParent,
  groupLayer,
  insertLayers,
  layerBounds,
  moveLayer,
  nextName,
  pixelLayer,
  removeLayers,
  siblingsOf,
  updateLayer,
  idsWithin,
  hasRaster,
  uid,
} from '../../core/layers';
import { Raster, TileEdit, intersect } from '../../core/raster';
import { defaultParams, ADJUSTMENT_NAMES, type AdjustmentType } from '../../core/adjust';
import { maskToRaster, rasterToMask, allMask, emptyMask } from '../../core/selection';
import type { AdjustmentLayer, Doc, FillContent, FillLayer, Layer, LayerMask, PixelLayer, Rect, SmartLayer } from '../../core/types';
import { fgToBg } from '../../core/gradient';

/** Select a layer (and make it the one worked on). */
export function selectLayer(id: string, mode: 'only' | 'toggle' | 'range' = 'only'): void {
  const s = current();
  if (!s) return;
  if (mode === 'toggle') {
    s.selected = s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id];
    if (!s.selected.length) s.selected = [id];
    s.active = id;
  } else if (mode === 'range' && s.active) {
    const flat = allLayers(s.doc.layers).map((l) => l.id);
    const a = flat.indexOf(s.active),
      b = flat.indexOf(id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    s.selected = flat.slice(lo, hi + 1);
  } else {
    s.selected = [id];
    s.active = id;
  }
  s.editMask = false;
  bump();
}

function insertAboveActive(d: Doc, layers: Layer[], activeId: string | null): Doc {
  return { ...d, layers: insertLayers(d.layers, layers, activeId, 'above') };
}

export function newLayer(name?: string, raster?: Raster, label = 'New Layer'): PixelLayer | null {
  const s = current();
  if (!s) return null;
  const l = pixelLayer(name ?? nextName(s.doc), raster ?? new Raster(s.doc.depth, 4));
  change(label, 'layer', (d) => insertAboveActive(d, [l], s.active));
  s.active = l.id;
  s.selected = [l.id];
  bump();
  return l;
}

export function newGroup(): void {
  const s = current();
  if (!s) return;
  const g = groupLayer(nextName(s.doc, 'Group'));
  change('New Group', 'group', (d) => insertAboveActive(d, [g], s.active));
  s.active = g.id;
  s.selected = [g.id];
  bump();
}

/** Put the selected layers in a new group (Ctrl+G). */
export function groupSelected(): void {
  const s = current();
  if (!s || !s.selected.length) return;
  const ids = new Set(s.selected);
  const chosen = allLayers(s.doc.layers).filter((l) => ids.has(l.id));
  // Only top-most chosen layers (not ones inside a chosen group).
  const tops = chosen.filter((l) => !chosen.some((g) => g !== l && g.kind === 'group' && idsWithin(g).includes(l.id)));
  if (!tops.length) return;
  const g = groupLayer(nextName(s.doc, 'Group'), tops);
  const anchor = tops[tops.length - 1]!.id;
  change('Group Layers', 'group', (d) => {
    const placed = insertLayers(d.layers, [g], anchor, 'above');
    return { ...d, layers: removeLayers(placed, new Set(tops.map((t) => t.id))) };
  });
  s.active = g.id;
  s.selected = [g.id];
  bump();
}

export function ungroup(): void {
  const s = current();
  const g = s?.activeLayer();
  if (!s || !g || g.kind !== 'group') return;
  change('Ungroup Layers', 'group', (d) => {
    const placed = insertLayers(d.layers, g.children, g.id, 'below');
    return { ...d, layers: removeLayers(placed, new Set([g.id])) };
  });
  s.active = g.children[g.children.length - 1]?.id ?? null;
  s.selected = s.active ? [s.active] : [];
  bump();
}

export function deleteLayers(): void {
  const s = current();
  if (!s || !s.selected.length) return;
  const ids = new Set(s.selected);
  const flat = allLayers(s.doc.layers);
  const idx = flat.findIndex((l) => l.id === s.active);
  change('Delete Layer', 'delete', (d) => ({ ...d, layers: removeLayers(d.layers, ids) }));
  const left = allLayers(s.doc.layers);
  const next = left[Math.max(0, Math.min(left.length - 1, idx - 1))] ?? null;
  s.active = next?.id ?? null;
  s.selected = next ? [next.id] : [];
  bump();
}

export function setLayer(id: string, patch: Partial<Layer>, label = 'Layer Properties', icon = 'layer', merge = false): void {
  const s = current();
  if (!s) return;
  const next = { ...s.doc, layers: updateLayer(s.doc.layers, id, (l) => ({ ...l, ...patch }) as Layer) };
  // Runs of the same change (dragging a slider) become one step.
  const last = s.history.steps[s.history.index - 1];
  if (merge && last && last.label === label && Date.now() - last.time < 1500) {
    s.amend(next);
    last.time = Date.now();
  } else s.commit(label, icon, next);
  bump();
}

export function toggleVisible(id: string, solo = false): void {
  const s = current();
  if (!s) return;
  const l = findLayer(s.doc.layers, id);
  if (!l) return;
  if (solo) {
    // Alt+click: show only this layer (again: show all).
    const siblings = siblingsOf(s.doc.layers, id);
    const others = siblings.filter((x) => x.id !== id);
    const allHidden = others.every((x) => !x.visible);
    change(allHidden ? 'Show All Layers' : 'Show Only This Layer', 'eye', (d) => {
      let layers = d.layers;
      for (const o of others) layers = updateLayer(layers, o.id, (x) => ({ ...x, visible: allHidden }));
      layers = updateLayer(layers, id, (x) => ({ ...x, visible: true }));
      return { ...d, layers };
    });
    return;
  }
  change(l.visible ? 'Hide Layer' : 'Show Layer', 'eye', (d) => ({ ...d, layers: updateLayer(d.layers, id, (x) => ({ ...x, visible: !x.visible })) }));
}

/** Ctrl+J: the selected pixels (or the whole layer) as a new layer; with `cut`, cut out. */
export function layerVia(cut = false): void {
  const s = current();
  const l = s?.activeLayer();
  if (!s || !l) return;
  const sel = selectionMask(s.doc);
  if (!sel || !hasRaster(l)) {
    if (cut) return;
    const copy = duplicateLayer(l);
    change('Duplicate Layer', 'layer', (d) => ({ ...d, layers: insertLayers(d.layers, [copy], l.id, 'above') }));
    s.active = copy.id;
    s.selected = [copy.id];
    bump();
    return;
  }
  const r = intersect(s.doc.selection!.bounds!, l.raster.tileBounds() ?? canvasRect(s.doc));
  if (!r) {
    toast('The selected area is empty.');
    return;
  }
  const px = l.raster.read(r);
  const W = s.doc.width;
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const dx = r.x + x,
        dy = r.y + y;
      const m = dx >= 0 && dy >= 0 && dx < W && dy < s.doc.height ? sel.data[dy * W + dx]! / 255 : 0;
      px[(y * r.w + x) * 4 + 3]! *= m;
    }
  const nl = pixelLayer(nextName(s.doc), Raster.fromFloats(s.doc.depth, 4, r, px));
  const swaps = [];
  if (cut) {
    const e = new TileEdit(l.raster);
    const cur = l.raster.read(r);
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        const dx = r.x + x,
          dy = r.y + y;
        const m = dx >= 0 && dy >= 0 && dx < W && dy < s.doc.height ? sel.data[dy * W + dx]! / 255 : 0;
        cur[(y * r.w + x) * 4 + 3]! *= 1 - m;
      }
    l.raster.write(r, cur, e);
    swaps.push(e.commit());
  }
  change(cut ? 'Layer Via Cut' : 'Layer Via Copy', 'layer', (d) => ({ ...d, layers: insertLayers(d.layers, [nl], l.id, 'above') }), swaps);
  s.active = nl.id;
  s.selected = [nl.id];
  bump();
}

export function duplicate(): void {
  const s = current();
  if (!s) return;
  const ids = s.selected.length ? s.selected : s.active ? [s.active] : [];
  let doc = s.doc;
  const made: string[] = [];
  for (const id of ids) {
    const l = findLayer(doc.layers, id);
    if (!l) continue;
    const copy = duplicateLayer(l);
    made.push(copy.id);
    doc = { ...doc, layers: insertLayers(doc.layers, [copy], id, 'above') };
  }
  s.commit('Duplicate Layer', 'layer', doc);
  s.selected = made;
  s.active = made[made.length - 1] ?? s.active;
  bump();
}

export function arrange(dir: 'up' | 'down' | 'top' | 'bottom'): void {
  const s = current();
  const id = s?.active;
  if (!s || !id) return;
  const list = siblingsOf(s.doc.layers, id);
  const idx = list.findIndex((l) => l.id === id);
  const delta = dir === 'up' ? 1 : dir === 'down' ? -1 : dir === 'top' ? list.length - 1 - idx : -idx;
  change(dir === 'up' ? 'Bring Forward' : dir === 'down' ? 'Send Backward' : dir === 'top' ? 'Bring to Front' : 'Send to Back', 'arrange', (d) => ({
    ...d,
    layers: moveLayer(d.layers, id, delta),
  }));
}

/** Drag and drop in the Layers panel: put `id` above/below/into `target`. */
export function moveTo(ids: string[], target: string, where: 'above' | 'below' | 'into'): void {
  const s = current();
  if (!s) return;
  if (ids.includes(target)) return;
  // Never into itself.
  const t = findLayer(s.doc.layers, target);
  for (const id of ids) {
    const l = findLayer(s.doc.layers, id);
    if (l && t && l.kind === 'group' && idsWithin(l).includes(target)) return;
  }
  const moving = ids.map((id) => findLayer(s.doc.layers, id)).filter((x): x is Layer => !!x);
  change('Move Layers', 'arrange', (d) => {
    const removed = removeLayers(d.layers, new Set(ids));
    return { ...d, layers: insertLayers(removed, moving, target, where) };
  });
}

export function mergeDown(): void {
  const s = current();
  const l = s?.activeLayer();
  if (!s || !l) return;
  const pos = findParent(s.doc.layers, l.id);
  const list = pos?.parent ? pos.parent.children : s.doc.layers;
  const below = list[pos!.index - 1];
  if (!below) {
    toast('There is no layer below to merge into.');
    return;
  }
  if (below.kind === 'adjust' || below.kind === 'fill' || below.kind === 'group') {
    toast('Merge Down needs a pixel layer below. Rasterize it first.');
    return;
  }
  mergeLayers([below, l], below, 'Merge Down');
}

function mergeLayers(layers: Layer[], keep: Layer, label: string): void {
  const s = need();
  let r: Rect | null = null;
  for (const x of layers) {
    const b = layerBounds(x, s.doc);
    if (b) r = r ? unionR(r, b) : b;
  }
  r = r ? intersect(r, canvasRect(s.doc)) : null;
  const raster = r
    ? flattenRaster(
        s.doc,
        r,
        layers.map((x) => ({ ...x, visible: true, clip: false })),
      )
    : new Raster(s.doc.depth, 4);
  const merged: PixelLayer = { ...pixelLayer(keep.name, raster), id: keep.id, locks: keep.locks };
  const drop = new Set(layers.filter((x) => x.id !== keep.id).map((x) => x.id));
  change(label, 'merge', (d) => ({ ...d, layers: updateLayer(removeLayers(d.layers, drop), keep.id, () => merged) }));
  s.active = keep.id;
  s.selected = [keep.id];
  bump();
}

function unionR(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function mergeSelected(): void {
  const s = current();
  if (!s) return;
  if (s.selected.length < 2) return mergeDown();
  const ids = new Set(s.selected);
  const layers = allLayers(s.doc.layers).filter((l) => ids.has(l.id));
  const top = layers[layers.length - 1]!;
  const raster = flattenRaster(
    s.doc,
    canvasRect(s.doc),
    layers.map((l) => ({ ...l, visible: true })),
  );
  const merged = pixelLayer(top.name, raster);
  change('Merge Layers', 'merge', (d) => {
    const placed = insertLayers(d.layers, [merged], top.id, 'above');
    return { ...d, layers: removeLayers(placed, ids) };
  });
  s.active = merged.id;
  s.selected = [merged.id];
  bump();
}

export function mergeVisible(): void {
  const s = current();
  if (!s) return;
  const raster = flattenRaster(s.doc, canvasRect(s.doc));
  const keepHidden = s.doc.layers.filter((l) => !l.visible);
  const merged = pixelLayer('Merged', raster);
  change('Merge Visible', 'merge', (d) => ({ ...d, layers: [merged, ...keepHidden] }));
  s.active = merged.id;
  s.selected = [merged.id];
  bump();
}

/** Ctrl+Alt+Shift+E: the visible picture as a new layer on top, layers kept. */
export function stampVisible(): void {
  const s = current();
  if (!s) return;
  const raster = flattenRaster(s.doc, canvasRect(s.doc));
  newLayer(nextName(s.doc), raster, 'Stamp Visible');
}

export function flattenImage(): void {
  const s = current();
  if (!s) return;
  const raster = flattenRaster(s.doc, canvasRect(s.doc));
  // Flattening fills transparency with white, as Photoshop does.
  const px = raster.read(canvasRect(s.doc));
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3]!;
    px[i] = px[i]! * a + (1 - a);
    px[i + 1] = px[i + 1]! * a + (1 - a);
    px[i + 2] = px[i + 2]! * a + (1 - a);
    px[i + 3] = 1;
  }
  const bgL = { ...pixelLayer('Background', Raster.fromFloats(s.doc.depth, 4, canvasRect(s.doc), px)), locks: { position: true } };
  change('Flatten Image', 'merge', (d) => ({ ...d, layers: [bgL] }));
  s.active = bgL.id;
  s.selected = [bgL.id];
  bump();
}

export function rasterize(id?: string): void {
  const s = current();
  const l = id ? findLayer(s?.doc.layers ?? [], id) : s?.activeLayer();
  if (!s || !l) return;
  if (l.kind === 'pixel' || l.kind === 'group' || l.kind === 'adjust') return;
  let raster: Raster;
  if (l.kind === 'fill')
    raster = flattenRaster(s.doc, canvasRect(s.doc), [
      { ...l, blend: 'normal', opacity: 1, fill: 1, mask: undefined, vmask: undefined, styles: undefined, clip: false },
    ]);
  else raster = l.raster.clone();
  const { kind: _k, ...base } = l as Layer & Record<string, unknown>;
  const pl: PixelLayer = {
    id: l.id,
    name: l.name,
    visible: l.visible,
    opacity: l.opacity,
    fill: l.fill,
    blend: l.blend,
    clip: l.clip,
    locks: l.locks,
    mask: l.mask,
    styles: l.styles,
    tag: l.tag,
    kind: 'pixel',
    raster,
  };
  void base;
  change('Rasterize Layer', 'layer', (d) => ({ ...d, layers: updateLayer(d.layers, l.id, () => pl) }));
}

/** Rasterize layer styles into the pixels (Layer ▸ Rasterize ▸ Layer Style). */
export function rasterizeStyle(): void {
  const s = current();
  const l = s?.activeLayer();
  if (!s || !l || !l.styles || l.kind === 'group' || l.kind === 'adjust') return;
  const raster = flattenRaster(s.doc, canvasRect(s.doc), [{ ...l, blend: 'normal', opacity: 1, clip: false } as Layer]);
  const pl = { ...pixelLayer(l.name, raster), id: l.id, blend: l.blend, opacity: l.opacity, visible: l.visible, clip: l.clip };
  change('Rasterize Layer Style', 'fx', (d) => ({ ...d, layers: updateLayer(d.layers, l.id, () => pl) }));
}

export function toggleClip(): void {
  const s = current();
  const l = s?.activeLayer();
  if (!s || !l) return;
  setLayer(l.id, { clip: !l.clip }, l.clip ? 'Release Clipping Mask' : 'Create Clipping Mask', 'clip');
}

// ---- masks ----

export function addMask(how: 'reveal' | 'hide' | 'selection' | 'hideSelection'): void {
  const s = current();
  const l = s?.activeLayer();
  if (!s || !l) return;
  if (l.mask) {
    toast('This layer has a mask already.');
    return;
  }
  const W = s.doc.width,
    H = s.doc.height;
  let raster: Raster;
  let background = 1;
  const sel = selectionMask(s.doc);
  if ((how === 'selection' || how === 'hideSelection') && sel) {
    const m = how === 'selection' ? sel : { ...sel, data: sel.data.map((v) => 255 - v) };
    raster = maskToRaster(m);
    background = 0;
  } else if (how === 'hide') {
    raster = new Raster(8, 1);
    background = 0;
  } else {
    raster = maskToRaster(allMask(W, H));
    background = 1;
  }
  const mask: LayerMask = { raster, background, enabled: true, linked: true, density: 1, feather: 0 };
  change('Add Layer Mask', 'mask', (d) => ({
    ...(how === 'selection' || how === 'hideSelection' ? withSelection(d, null) : d),
    layers: updateLayer(d.layers, l.id, (x) => ({ ...x, mask }) as Layer),
  }));
  s.editMask = true;
  bump();
}

export function deleteMask(apply = false): void {
  const s = current();
  const l = s?.activeLayer();
  if (!s || !l || !l.mask) return;
  if (apply && hasRaster(l) && l.kind === 'pixel') {
    const b = l.raster.tileBounds();
    const out = new Raster(s.doc.depth, 4);
    if (b) {
      const px = l.raster.read(b);
      const m = l.mask.raster.read(b, undefined, -1);
      for (let i = 0; i < b.w * b.h; i++) {
        const v = m[i] === -1 ? l.mask.background : m[i]!;
        px[i * 4 + 3]! *= 1 - l.mask.density * (1 - v);
      }
      out.write(b, px, null, true);
      out.prune();
    }
    change('Apply Layer Mask', 'mask', (d) => ({ ...d, layers: updateLayer(d.layers, l.id, (x) => ({ ...x, raster: out, mask: undefined }) as Layer) }));
  } else change('Delete Layer Mask', 'mask', (d) => ({ ...d, layers: updateLayer(d.layers, l.id, (x) => ({ ...x, mask: undefined }) as Layer) }));
  s.editMask = false;
  bump();
}

export function toggleMaskEnabled(): void {
  const l = current()?.activeLayer();
  if (!l?.mask) return;
  setLayer(l.id, { mask: { ...l.mask, enabled: !l.mask.enabled } }, l.mask.enabled ? 'Disable Layer Mask' : 'Enable Layer Mask', 'mask');
}

/** The mask as a selection (Ctrl+click its thumbnail). */
export function maskToSelection(id: string, op: 'replace' | 'add' | 'subtract' | 'intersect' = 'replace'): void {
  const s = current();
  const l = findLayer(s?.doc.layers ?? [], id);
  if (!s || !l?.mask) return;
  const m = rasterToMask(l.mask.raster, s.doc.width, s.doc.height);
  if (l.mask.background) {
    const filled = l.mask.raster.read(canvasRect(s.doc), undefined, -1);
    for (let i = 0; i < m.data.length; i++) if (filled[i] === -1) m.data[i] = Math.round(l.mask.background * 255);
  }
  void op;
  change('Load Selection', 'select', (d) => withSelection(d, m));
}

/** The layer's transparency as a selection (Ctrl+click its thumbnail). */
export function transparencyToSelection(id: string): void {
  const s = current();
  const l = findLayer(s?.doc.layers ?? [], id);
  if (!s || !l) return;
  let px: Float32Array;
  const r = canvasRect(s.doc);
  if (hasRaster(l)) px = l.raster.read(r);
  else px = flatten(s.doc, r, [{ ...l, visible: true } as Layer]);
  const m = emptyMask(s.doc.width, s.doc.height);
  for (let i = 0; i < m.data.length; i++) m.data[i] = Math.round(px[i * 4 + 3]! * 255);
  change('Load Selection', 'select', (d) => withSelection(d, m));
}

// ---- new fill and adjustment layers ----

export function newAdjustment(type: AdjustmentType): AdjustmentLayer | null {
  const s = current();
  if (!s) return null;
  const sel = selectionMask(s.doc);
  const l: AdjustmentLayer = { ...baseLayer(`${ADJUSTMENT_NAMES[type]} 1`), kind: 'adjust', adjust: type, params: defaultParams(type) };
  const names = new Set(allLayers(s.doc.layers).map((x) => x.name));
  for (let i = 1; names.has(l.name); i++) l.name = `${ADJUSTMENT_NAMES[type]} ${i + 1}`;
  if (type === 'gradientMap') (l.params as ReturnType<typeof defaultParams<'gradientMap'>>).gradient = fgToBg(app.get().fg, app.get().bg);
  l.mask = sel
    ? { raster: maskToRaster(sel), background: 0, enabled: true, linked: true, density: 1, feather: 0 }
    : { raster: maskToRaster(allMask(s.doc.width, s.doc.height)), background: 1, enabled: true, linked: true, density: 1, feather: 0 };
  change(`New ${ADJUSTMENT_NAMES[type]} Layer`, 'adjust', (d) => insertAboveActive(withSelection(d, null), [l], s.active));
  s.active = l.id;
  s.selected = [l.id];
  bump();
  return l;
}

export function newFill(content: FillContent, name: string): FillLayer | null {
  const s = current();
  if (!s) return null;
  const sel = selectionMask(s.doc);
  const l: FillLayer = { ...baseLayer(name), kind: 'fill', content };
  l.mask = sel
    ? { raster: maskToRaster(sel), background: 0, enabled: true, linked: true, density: 1, feather: 0 }
    : { raster: maskToRaster(allMask(s.doc.width, s.doc.height)), background: 1, enabled: true, linked: true, density: 1, feather: 0 };
  change(`New ${name} Layer`, 'fill', (d) => insertAboveActive(withSelection(d, null), [l], s.active));
  s.active = l.id;
  s.selected = [l.id];
  bump();
  return l;
}

/** The background layer becomes a normal layer (double-click, or Layer ▸ New ▸ Layer from Background). */
export function layerFromBackground(): void {
  const s = current();
  const l = s?.activeLayer();
  if (!s || !l || l.name !== 'Background') return;
  setLayer(l.id, { name: 'Layer 0', locks: {} }, 'Layer from Background');
}

export function convertToSmart(): void {
  const s = current();
  if (!s || !s.selected.length) return;
  const ids = new Set(s.selected);
  const layers = allLayers(s.doc.layers).filter((l) => ids.has(l.id));
  const top = layers[layers.length - 1]!;
  let raster: Raster;
  if (layers.length === 1 && layers[0]!.kind === 'pixel' && !layers[0]!.mask && !layers[0]!.styles) raster = (layers[0] as PixelLayer).raster.clone();
  else
    raster = flattenRaster(
      s.doc,
      canvasRect(s.doc),
      layers.map((l) => ({ ...l, visible: true })),
    );
  const smart: SmartLayer = {
    ...baseLayer(layers.length === 1 ? top.name : 'Smart Object'),
    kind: 'smart',
    source: { kind: 'raster', width: s.doc.width, height: s.doc.height, raster: raster.clone(), name: top.name },
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    filters: [],
    filtersVisible: true,
    raster,
  };
  if (layers.length === 1) {
    smart.opacity = top.opacity;
    smart.blend = top.blend;
    smart.mask = top.mask;
    smart.styles = top.styles;
  }
  change('Convert to Smart Object', 'smart', (d) => {
    const placed = insertLayers(d.layers, [smart], top.id, 'above');
    return { ...d, layers: removeLayers(placed, ids) };
  });
  s.active = smart.id;
  s.selected = [smart.id];
  bump();
}

/** Align the selected layers (to the selection, or to each other / the canvas). */
export function align(edge: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'): void {
  const s = current();
  if (!s) return;
  const layers = s.selected.map((id) => findLayer(s.doc.layers, id)).filter((l): l is Layer => !!l && hasRaster(l) && l.kind === 'pixel');
  if (!layers.length) return;
  const boxes = layers.map((l) => (l as PixelLayer).raster.contentBounds());
  let ref: Rect | null = s.doc.selection?.bounds ?? null;
  if (!ref) {
    if (layers.length === 1) ref = canvasRect(s.doc);
    else for (const b of boxes) if (b) ref = ref ? unionR(ref, b) : b;
  }
  if (!ref) return;
  const R = ref;
  change('Align', 'align', (d) => {
    let ls = d.layers;
    layers.forEach((l, i) => {
      const b = boxes[i];
      if (!b) return;
      let dx = 0,
        dy = 0;
      if (edge === 'left') dx = R.x - b.x;
      else if (edge === 'right') dx = R.x + R.w - (b.x + b.w);
      else if (edge === 'hcenter') dx = Math.round(R.x + R.w / 2 - (b.x + b.w / 2));
      else if (edge === 'top') dy = R.y - b.y;
      else if (edge === 'bottom') dy = R.y + R.h - (b.y + b.h);
      else dy = Math.round(R.y + R.h / 2 - (b.y + b.h / 2));
      if (!dx && !dy) return;
      ls = updateLayer(ls, l.id, (x) => ({ ...x, raster: (x as PixelLayer).raster.shifted(dx, dy) }) as Layer);
    });
    return { ...d, layers: ls };
  });
}

export function setLayerColorTag(id: string, tag: Layer['tag']): void {
  setLayer(id, { tag }, 'Layer Color');
}

export { uid };
