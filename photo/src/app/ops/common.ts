// Helpers every document operation uses: the current session, committing a
// change, flattening layers (on the GPU when there is one), selections as
// dense masks.

import { app, bump, current, toast } from '../state';
import type { Session } from '../session';
import type { Doc, Layer, Rect } from '../../core/types';
import type { TileSwap } from '../../core/raster';
import { Raster, intersect } from '../../core/raster';
import { compositeRect } from '../../core/composite';
import { Compositor, type Overrides } from '../../gpu/compositor';
import type { View } from '../../gpu/view';
import { maskToRaster, rasterToMask, maskBounds, type Mask } from '../../core/selection';

let view: View | null = null;
export const setView = (v: View | null) => {
  view = v;
};
export const getView = () => view;

export function need(): Session {
  const s = current();
  if (!s) throw new Error('No document is open.');
  return s;
}

/** Change the current document and record the step. */
export function change(label: string, icon: string, f: (d: Doc) => Doc | null | void, swaps: TileSwap[] = []): void {
  const s = current();
  if (!s) return;
  const next = f(s.doc);
  if (!next && !swaps.length) return;
  s.commit(label, icon, next ?? { ...s.doc }, swaps);
  bump();
}

/** The layers' pixels composited over `r` (straight alpha floats). */
export function flatten(doc: Doc, r: Rect, layers?: Layer[], ov: Overrides = {}): Float32Array {
  const d: Doc = layers ? { ...doc, layers } : doc;
  if (view) {
    const c = new Compositor(view.gpu);
    try {
      return c.read(d, r, ov);
    } finally {
      c.dispose();
    }
  }
  return compositeRect(d, r);
}

/** Flatten into a raster at the document's depth. */
export function flattenRaster(doc: Doc, r: Rect, layers?: Layer[]): Raster {
  const out = new Raster(doc.depth, 4);
  const band = 1024;
  for (let y = r.y; y < r.y + r.h; y += band) {
    const rr = { x: r.x, y, w: r.w, h: Math.min(band, r.y + r.h - y) };
    out.write(rr, flatten(doc, rr, layers), null, true);
  }
  out.prune();
  return out;
}

export const canvasRect = (d: { width: number; height: number }): Rect => ({ x: 0, y: 0, w: d.width, h: d.height });

/** The selection as a dense mask (null: nothing selected). */
export function selectionMask(doc: Doc): Mask | null {
  if (!doc.selection) return null;
  return rasterToMask(doc.selection.mask, doc.width, doc.height);
}

export function withSelection(doc: Doc, m: Mask | null): Doc {
  if (!m) return { ...doc, selection: null };
  const b = maskBounds(m);
  if (!b) return { ...doc, selection: null };
  return { ...doc, selection: { mask: maskToRaster(m), bounds: b } };
}

/** The selection's bounds clipped to the canvas, or the canvas. */
export function workRect(doc: Doc): Rect {
  const c = canvasRect(doc);
  return doc.selection?.bounds ? (intersect(doc.selection.bounds, c) ?? c) : c;
}

export function guard<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
    return undefined;
  }
}

export function fg(): [number, number, number] {
  return app.get().fg;
}

export function bg(): [number, number, number] {
  return app.get().bg;
}
