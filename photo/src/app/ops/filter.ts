// Running filters and pixel adjustments on the active layer: inside the
// selection (feathered edges blend), in workers, with a live preview on the
// canvas while a dialog is open. On a smart object the filter is added as a
// smart filter instead (kept as settings, editable later).

import { current, bump, toast, busy, requestFrame } from '../state';
import { change } from './common';
import { selectionMask, workRect, canvasRect } from './common';
import { filterById } from '../../core/filters/registry';
import { defaults, type Params } from '../../core/filters/types';
import { runFilterAsync } from '../workers';
import { Raster, TileEdit, expand, intersect } from '../../core/raster';
import { updateLayer, uid } from '../../core/layers';
import { rerender } from '../layerContent';
import type { Rect, SmartLayer, Layer } from '../../core/types';

/** The last filter run (Filter ▸ Last Filter, Ctrl+Alt+F). */
export let lastFilter: { id: string; params: Params } | null = null;

function target(): { l: Layer & { raster: Raster }; kind: 'pixel' | 'smart' | 'mask' } | null {
  const s = current();
  const l = s?.activeLayer();
  if (!s || !l) return null;
  if (s.editMask && l.mask) return { l: { ...l, raster: l.mask.raster } as Layer & { raster: Raster }, kind: 'mask' };
  if (l.kind === 'pixel') return { l, kind: 'pixel' };
  if (l.kind === 'smart') return { l, kind: 'smart' };
  return null;
}

export function canFilter(): boolean {
  return !!target();
}

/** Where a filter works and what it reads around that. */
function regions(reach: number): { work: Rect; read: Rect } | null {
  const s = current()!;
  const work = workRect(s.doc);
  const read = Number.isFinite(reach) ? (intersect(expand(work, Math.ceil(reach)), canvasRect(s.doc)) ?? work) : canvasRect(s.doc);
  return { work, read };
}

/** The filtered pixels of the active layer's work area (selection-blended), at full size. */
async function filtered(id: string, params: Params, raster: Raster, onProgress?: (p: number) => void): Promise<{ rect: Rect; data: Float32Array } | null> {
  const s = current();
  const def = filterById(id);
  if (!s || !def) return null;
  const p = { ...defaults(def), ...params };
  const reg = regions(def.reach(p, { width: s.doc.width, height: s.doc.height }));
  if (!reg) return null;
  const { work, read } = reg;
  const channels = raster.channels;
  let src = raster.read(read);
  // Masks are 1 channel: run the filter on gray.
  if (channels === 1) {
    const rgba = new Float32Array(read.w * read.h * 4);
    for (let i = 0; i < read.w * read.h; i++) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = src[i]!;
      rgba[i * 4 + 3] = 1;
    }
    src = rgba;
  }
  const out = await runFilterAsync(
    id,
    { w: read.w, h: read.h, c: 4, data: src.slice() },
    p,
    { width: s.doc.width, height: s.doc.height, ox: read.x, oy: read.y },
    onProgress,
  );
  const sel = selectionMask(s.doc);
  const res = new Float32Array(work.w * work.h * channels);
  for (let y = 0; y < work.h; y++)
    for (let x = 0; x < work.w; x++) {
      const dx = work.x + x,
        dy = work.y + y;
      const si = ((dy - read.y) * read.w + (dx - read.x)) * 4;
      const k = sel ? sel.data[dy * s.doc.width + dx]! / 255 : 1;
      const o = (y * work.w + x) * channels;
      if (channels === 1) {
        const a = src[si]!;
        res[o] = a + (out.data[si]! - a) * k;
      } else
        for (let c = 0; c < 4; c++) {
          const a = src[si + c]!;
          res[o + c] = a + (out.data[si + c]! - a) * k;
        }
    }
  return { rect: work, data: res };
}

/** Show a filter's result on the canvas (a dialog's preview); null clears it. */
let previewToken = 0;
export async function previewFilter(id: string | null, params: Params = {}): Promise<void> {
  const s = current();
  const t = target();
  if (!s || !t) return;
  const token = ++previewToken;
  const ov = s.overrides;
  if (!id) {
    ov.rasters?.delete(t.l.id);
    s.compositor?.invalidate();
    requestFrame();
    return;
  }
  if (t.kind === 'mask') return;
  try {
    const raster = t.kind === 'smart' ? t.l.raster : t.l.raster;
    const r = await filtered(id, params, raster);
    if (!r || token !== previewToken) return;
    const copy = raster.clone();
    const e = new TileEdit(copy);
    copy.write(r.rect, r.data, e);
    e.commit(false);
    ov.rasters = ov.rasters ?? new Map();
    ov.rasters.set(t.l.id, copy);
    s.compositor?.invalidate(r.rect);
    requestFrame();
  } catch (err) {
    console.error(err);
  }
}

export function clearPreview(): void {
  void previewFilter(null);
}

/** Apply a filter for good. */
export async function applyFilter(id: string, params: Params = {}, label?: string): Promise<void> {
  const s = current();
  const t = target();
  const def = filterById(id);
  if (!s || !def) return;
  if (!t) {
    toast('Filters work on a pixel layer, a smart object or a layer mask. Rasterize this layer first.');
    return;
  }
  clearPreview();
  lastFilter = { id, params };
  const name = label ?? def.name;
  if (t.kind === 'smart' && def.smart !== false) {
    const l = t.l as unknown as SmartLayer;
    const next: SmartLayer = {
      ...l,
      filters: [...l.filters, { id: uid('sf'), filter: id, params: { ...defaults(def), ...params }, visible: true, blend: 'normal', opacity: 1 }],
      filtersVisible: true,
    };
    const drawn = await busy(`${name}…`, () => rerender(next, s.doc));
    change(name, 'filter', (d) => ({ ...d, layers: updateLayer(d.layers, l.id, () => drawn) }));
    return;
  }
  const raster = t.kind === 'mask' ? (s.activeLayer()!.mask!.raster as Raster) : t.l.raster;
  if (t.l.locks.all || t.l.locks.pixels) {
    toast('This layer is locked.');
    return;
  }
  try {
    const r = await busy(`${name}…`, (progress) => filtered(id, params, raster, progress));
    if (!r) return;
    const e = new TileEdit(raster);
    raster.write(r.rect, r.data, e);
    change(name, 'filter', (d) => ({ ...d }), [e.commit()]);
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), 'error');
  }
  bump();
}

export async function repeatLastFilter(): Promise<void> {
  if (!lastFilter) return;
  await applyFilter(lastFilter.id, lastFilter.params);
}
