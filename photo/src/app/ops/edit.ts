// The Edit menu: undo and redo, the clipboard, Fill, Stroke, Clear.

import { app, bump, current, toast } from '../state';
import { change, flatten, selectionMask, canvasRect, workRect, withSelection } from './common';
import { newLayer } from './layers';
import { Raster, TileEdit, intersect } from '../../core/raster';
import { compositePixel, type BlendMode } from '../../core/blend';
import { growMask, combine, maskToRaster, type Mask } from '../../core/selection';
import { getPattern, patternAt } from '../../core/patterns';
import { hasRaster, nextName, pixelLayer, insertLayers } from '../../core/layers';
import type { Doc, Layer, PixelLayer, Rect } from '../../core/types';
import { encodePNG } from '../../core/io/png';

export function undo(): void {
  const s = current();
  if (!s) return;
  const st = s.history.undo();
  if (st) s.restore(st);
  bump();
}

export function redo(): void {
  const s = current();
  if (!s) return;
  const st = s.history.redo();
  if (st) s.restore(st);
  bump();
}

/** Ctrl+Z toggles the last step (Photoshop's default since 2019 is multiple undo; we follow that). */
export function goToStep(count: number): void {
  const s = current();
  if (!s) return;
  const st = s.history.goTo(count);
  if (st) s.restore(st);
  bump();
}

// ---- clipboard ----

interface Clip {
  raster: Raster;
  rect: Rect;
  depth: Doc['depth'];
}

let clip: Clip | null = null;

/** Copy (merged: what is visible) the selection or the layer. */
export async function copy(merged = false, cut = false): Promise<void> {
  const s = current();
  const l = s?.activeLayer();
  if (!s) return;
  const sel = selectionMask(s.doc);
  const r = workRect(s.doc);
  let px: Float32Array;
  if (merged || !l || !hasRaster(l)) px = flatten(s.doc, r);
  else px = l.raster.read(r);
  if (sel) applyMaskAlpha(px, r, sel, s.doc.width);
  clip = { raster: Raster.fromFloats(s.doc.depth, 4, { x: 0, y: 0, w: r.w, h: r.h }, px), rect: r, depth: s.doc.depth };
  // The system clipboard gets a PNG too (other apps can paste it).
  try {
    if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      const b8 = new Uint8Array(r.w * r.h * 4);
      for (let i = 0; i < b8.length; i++) b8[i] = Math.round(Math.min(1, Math.max(0, px[i]!)) * 255);
      const png = await encodePNG(r.w, r.h, b8, { depth: 8, alpha: true });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as BlobPart], { type: 'image/png' }) })]);
    }
  } catch {
    /* the system clipboard may be blocked: the internal copy still works */
  }
  if (cut && l && hasRaster(l)) clearPixels('Cut');
}

function applyMaskAlpha(px: Float32Array, r: Rect, m: Mask, W: number): void {
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const dx = r.x + x,
        dy = r.y + y;
      const v = dx >= 0 && dy >= 0 && dx < W && dy < m.h ? m.data[dy * W + dx]! / 255 : 0;
      px[(y * r.w + x) * 4 + 3]! *= v;
    }
}

/** Paste the internal clipboard as a new layer (centered, or in place). */
export function paste(inPlace = false): boolean {
  const s = current();
  if (!s || !clip) return false;
  const b = clip.raster.tileBounds();
  if (!b) return false;
  let ox = clip.rect.x,
    oy = clip.rect.y;
  if (!inPlace) {
    const target = s.doc.selection?.bounds ?? canvasRect(s.doc);
    ox = Math.round(target.x + (target.w - clip.rect.w) / 2);
    oy = Math.round(target.y + (target.h - clip.rect.h) / 2);
  }
  let r = clip.raster.shifted(ox, oy);
  if (clip.depth !== s.doc.depth) r = r.convert(s.doc.depth);
  newLayer(nextName(s.doc), r, 'Paste');
  return true;
}

export function hasClip(): boolean {
  return !!clip;
}

/** Paste pixels from outside (a dropped or pasted picture) as a new layer. */
export function pasteRaster(r: Raster, name: string): void {
  const s = current();
  if (!s) return;
  const b = r.tileBounds();
  const target = canvasRect(s.doc);
  let placed = r;
  if (b) {
    const cb = r.contentBounds() ?? b;
    placed = r.shifted(Math.round(target.w / 2 - (cb.x + cb.w / 2)), Math.round(target.h / 2 - (cb.y + cb.h / 2)));
  }
  newLayer(name, placed.depth === s.doc.depth ? placed : placed.convert(s.doc.depth), 'Paste');
}

// ---- Fill, Stroke, Clear ----

export type FillUse = 'fg' | 'bg' | 'color' | 'pattern' | 'black' | 'white' | 'gray' | 'history' | 'contentAware';

export interface FillOptions {
  use: FillUse;
  color?: [number, number, number];
  pattern?: string;
  mode: BlendMode;
  opacity: number;
  preserveTransparency: boolean;
}

/** Edit ▸ Fill (Shift+F5): the selection (or the layer) filled. */
export function fillSelection(o: FillOptions): void {
  const s = current();
  const l = s?.activeLayer();
  if (!s || !l) return;
  if (!hasRaster(l) || l.kind !== 'pixel') {
    toast('Fill works on a pixel layer. Rasterize this layer first.');
    return;
  }
  if (o.use === 'contentAware') {
    void import('./heal').then((m) => m.contentAwareFill());
    return;
  }
  const sel = selectionMask(s.doc);
  const r = workRect(s.doc);
  const px = l.raster.read(r);
  const c =
    o.use === 'fg'
      ? app.get().fg
      : o.use === 'bg'
        ? app.get().bg
        : o.use === 'black'
          ? [0, 0, 0]
          : o.use === 'white'
            ? [1, 1, 1]
            : o.use === 'gray'
              ? [0.5, 0.5, 0.5]
              : (o.color ?? [0, 0, 0]);
  const pat = o.use === 'pattern' ? getPattern(o.pattern ?? 'paper') : null;
  const tmp = [0, 0, 0, 0];
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const dx = r.x + x,
        dy = r.y + y;
      const k = sel ? sel.data[dy * s.doc.width + dx]! / 255 : 1;
      if (k <= 0) continue;
      const i = (y * r.w + x) * 4;
      const a0 = px[i + 3]!;
      let cr = c[0]!,
        cg = c[1]!,
        cb = c[2]!,
        ca = 1;
      if (pat) {
        patternAt(pat, dx, dy, 1, tmp);
        cr = tmp[0]!;
        cg = tmp[1]!;
        cb = tmp[2]!;
        ca = tmp[3]!;
      }
      compositePixel(o.mode, px, i, cr, cg, cb, ca * o.opacity * k, dx, dy);
      if (o.preserveTransparency || l.locks.transparency) px[i + 3] = a0;
    }
  const e = new TileEdit(l.raster);
  l.raster.write(r, px, e, true);
  change('Fill', 'fill', (d) => ({ ...d }), [e.commit()]);
}

export interface StrokeOptions {
  width: number;
  color: [number, number, number];
  location: 'inside' | 'center' | 'outside';
  mode: BlendMode;
  opacity: number;
  preserveTransparency: boolean;
}

/** Edit ▸ Stroke: a line along the selection's edge. */
export function strokeSelection(o: StrokeOptions): void {
  const s = current();
  const l = s?.activeLayer();
  const sel = s ? selectionMask(s.doc) : null;
  if (!s || !l || !sel) {
    toast('Stroke needs a selection.');
    return;
  }
  if (!hasRaster(l) || l.kind !== 'pixel') {
    toast('Stroke works on a pixel layer. Rasterize this layer first.');
    return;
  }
  const w = Math.max(1, o.width);
  const outer = o.location === 'inside' ? sel : growMask(sel, o.location === 'center' ? Math.ceil(w / 2) : w);
  const inner = o.location === 'outside' ? sel : growMask(sel, -(o.location === 'center' ? Math.floor(w / 2) : w));
  const band = combine(outer, inner, 'subtract');
  const b = intersect(expandR(s.doc.selection!.bounds!, w + 2), canvasRect(s.doc));
  if (!b) return;
  const px = l.raster.read(b);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const dx = b.x + x,
        dy = b.y + y;
      const k = band.data[dy * s.doc.width + dx]! / 255;
      if (k <= 0) continue;
      const i = (y * b.w + x) * 4;
      const a0 = px[i + 3]!;
      compositePixel(o.mode, px, i, o.color[0], o.color[1], o.color[2], o.opacity * k, dx, dy);
      if (o.preserveTransparency || l.locks.transparency) px[i + 3] = a0;
    }
  const e = new TileEdit(l.raster);
  l.raster.write(b, px, e, true);
  change('Stroke', 'stroke', (d) => ({ ...d }), [e.commit()]);
}

function expandR(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

/** Delete: the selected pixels cleared (the Background fills with the background color). */
export function clearPixels(label = 'Clear'): void {
  const s = current();
  const l = s?.activeLayer();
  if (!s || !l) return;
  if (s.editMask && l.mask) {
    // In a mask: fill the selection with black.
    const sel = selectionMask(s.doc);
    const r = workRect(s.doc);
    const m = l.mask.raster.read(r);
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        const k = sel ? sel.data[(r.y + y) * s.doc.width + r.x + x]! / 255 : 1;
        m[y * r.w + x] = m[y * r.w + x]! * (1 - k);
      }
    const e = new TileEdit(l.mask.raster);
    l.mask.raster.write(r, m, e);
    change(label, 'mask', (d) => ({ ...d }), [e.commit(false)]);
    return;
  }
  if (!hasRaster(l) || l.kind !== 'pixel') {
    if (!s.doc.selection) return;
    toast('Clear works on a pixel layer.');
    return;
  }
  const sel = selectionMask(s.doc);
  if (!sel) {
    if (label === 'Cut') return;
    toast('Make a selection first, or delete the layer.');
    return;
  }
  const r = workRect(s.doc);
  const px = l.raster.read(r);
  const isBg = l.name === 'Background' && l.locks.position;
  const bgc = app.get().bg;
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const k = sel.data[(r.y + y) * s.doc.width + r.x + x]! / 255;
      if (k <= 0) continue;
      const i = (y * r.w + x) * 4;
      if (isBg || l.locks.transparency) {
        px[i] = px[i]! + (bgc[0] - px[i]!) * k;
        px[i + 1] = px[i + 1]! + (bgc[1] - px[i + 1]!) * k;
        px[i + 2] = px[i + 2]! + (bgc[2] - px[i + 2]!) * k;
      } else px[i + 3] = px[i + 3]! * (1 - k);
    }
  const e = new TileEdit(l.raster);
  l.raster.write(r, px, e, true);
  change(label, 'erase', (d) => ({ ...d }), [e.commit()]);
}

/** Edit ▸ Define Pattern: the selection (or the picture) as a pattern. */
export async function definePattern(name: string): Promise<void> {
  const s = current();
  if (!s) return;
  const r = workRect(s.doc);
  if (r.w > 2048 || r.h > 2048) {
    toast('A pattern can be up to 2048 × 2048 pixels. Select a smaller area.');
    return;
  }
  const px = flatten(s.doc, r);
  const { addPattern } = await import('../../core/patterns');
  addPattern(name, { w: r.w, h: r.h, c: 4, data: px });
  toast(`Pattern “${name}” added.`);
  bump();
}

/** Paste Into: the clipboard as a layer masked by the selection. */
export function pasteInto(): void {
  const s = current();
  if (!s || !clip) return;
  const sel = selectionMask(s.doc);
  if (!sel || !s.doc.selection?.bounds) {
    paste();
    return;
  }
  const b = s.doc.selection.bounds;
  const r = clip.raster.shifted(Math.round(b.x + (b.w - clip.rect.w) / 2), Math.round(b.y + (b.h - clip.rect.h) / 2));
  const l: PixelLayer = pixelLayer(nextName(s.doc), r.depth === s.doc.depth ? r : r.convert(s.doc.depth));
  l.mask = { raster: maskToRaster(sel), background: 0, enabled: true, linked: false, density: 1, feather: 0 };
  change('Paste Into', 'layer', (d) => ({ ...withSelection(d, null), layers: insertLayers(d.layers, [l as Layer], s.active, 'above') }));
  s.active = l.id;
  s.selected = [l.id];
  bump();
}
