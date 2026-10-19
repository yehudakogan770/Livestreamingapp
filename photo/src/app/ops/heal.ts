// Content-aware commands: Content-Aware Fill (Edit ▸ Fill), the Spot Healing
// Brush and Remove tool (filling what was brushed), the Patch tool, and
// Content-Aware Scale. The work runs in a worker when one is available.

import { busy, current, toast } from '../state';
import { change, selectionMask, canvasRect, flatten } from './common';
import { TileEdit, intersect, type Raster } from '../../core/raster';
import { hasRaster, updateLayer } from '../../core/layers';
import type { Layer } from '../../core/types';
import { inpaint, healBlend, type Field } from '../../core/inpaint';
import { contentAwareScale } from '../../core/seams';
import { runInWorker } from '../workers';
import type { Mask } from '../../core/selection';
import type { Rect } from '../../core/types';

/** Fill `hole` (document mask) on a raster from its surroundings. Returns the tile swap. */
export async function inpaintRaster(
  r: Raster,
  hole: Mask,
  docW: number,
  docH: number,
  sampleAll: Float32Array | null = null,
  margin?: number,
): Promise<ReturnType<TileEdit['commit']> | null> {
  let hb: Rect | null = null;
  for (let y = 0; y < hole.h; y++)
    for (let x = 0; x < hole.w; x++)
      if (hole.data[y * hole.w + x]! > 127) {
        if (!hb) hb = { x, y, w: 1, h: 1 };
        else {
          const x1 = Math.max(hb.x + hb.w, x + 1),
            y1 = Math.max(hb.y + hb.h, y + 1);
          hb.x = Math.min(hb.x, x);
          hb.y = Math.min(hb.y, y);
          hb.w = x1 - hb.x;
          hb.h = y1 - hb.y;
        }
      }
  if (!hb) return null;
  const m = margin ?? Math.max(48, Math.round(Math.max(hb.w, hb.h) * 1.2));
  const reg = intersect({ x: hb.x - m, y: hb.y - m, w: hb.w + 2 * m, h: hb.h + 2 * m }, { x: 0, y: 0, w: docW, h: docH })!;
  const px = sampleAll ?? r.read(reg);
  const f: Field = { w: reg.w, h: reg.h, c: new Float32Array(reg.w * reg.h * 3) };
  const holeR = new Uint8Array(reg.w * reg.h);
  const valid = new Uint8Array(reg.w * reg.h);
  for (let y = 0; y < reg.h; y++)
    for (let x = 0; x < reg.w; x++) {
      const i = y * reg.w + x;
      const H = hole.data[(reg.y + y) * hole.w + reg.x + x]! > 127;
      holeR[i] = H ? 1 : 0;
      valid[i] = !H && px[i * 4 + 3]! > 0.5 ? 1 : 0;
      for (let k = 0; k < 3; k++) f.c[i * 3 + k] = px[i * 4 + k]!;
    }
  const res = await runInWorker<Field>('inpaint', { f, hole: holeR, valid }, () => inpaint(f, holeR, valid));
  const cur = r.read(reg);
  for (let i = 0; i < reg.w * reg.h; i++) {
    if (!holeR[i]) continue;
    // Soft edge: the hole mask's own coverage.
    const k = hole.data[(reg.y + Math.floor(i / reg.w)) * hole.w + reg.x + (i % reg.w)]! / 255;
    for (let c = 0; c < 3; c++) cur[i * 4 + c] = cur[i * 4 + c]! + (res.c[i * 3 + c]! - cur[i * 4 + c]!) * k;
    cur[i * 4 + 3] = Math.max(cur[i * 4 + 3]!, k);
  }
  const e = new TileEdit(r);
  r.write(reg, cur, e);
  return e.commit();
}

export async function contentAwareFill(): Promise<void> {
  const s = current();
  const l = s?.activeLayer();
  const sel = s ? selectionMask(s.doc) : null;
  if (!s || !l || !sel) {
    toast('Select what to remove first, then use Content-Aware Fill.');
    return;
  }
  if (!hasRaster(l) || l.kind !== 'pixel') {
    toast('Content-Aware Fill works on a pixel layer.');
    return;
  }
  const sw = await busy('Filling from the surroundings…', () => inpaintRaster(l.raster, sel, s.doc.width, s.doc.height));
  if (sw) change('Content-Aware Fill', 'heal', (d) => ({ ...d }), [sw]);
}

/** Heal `hole` on the raster using pixels copied from `src` (same document coordinates). */
export function healWithSource(r: Raster, hole: Mask, src: Float32Array, reg: Rect): ReturnType<TileEdit['commit']> {
  const cur = r.read(reg);
  const n = reg.w * reg.h;
  const T: Field = { w: reg.w, h: reg.h, c: new Float32Array(n * 3) },
    S: Field = { w: reg.w, h: reg.h, c: new Float32Array(n * 3) };
  const H = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      T.c[i * 3 + k] = cur[i * 4 + k]!;
      S.c[i * 3 + k] = src[i * 4 + k]!;
    }
    H[i] = hole.data[(reg.y + Math.floor(i / reg.w)) * hole.w + reg.x + (i % reg.w)]! > 0 ? 1 : 0;
  }
  const res = healBlend(T, S, H);
  for (let i = 0; i < n; i++) {
    if (!H[i]) continue;
    const k = hole.data[(reg.y + Math.floor(i / reg.w)) * hole.w + reg.x + (i % reg.w)]! / 255;
    for (let c = 0; c < 3; c++) cur[i * 4 + c] = cur[i * 4 + c]! + (res.c[i * 3 + c]! - cur[i * 4 + c]!) * k;
  }
  const e = new TileEdit(r);
  r.write(reg, cur, e);
  return e.commit();
}

/** Edit ▸ Content-Aware Scale for the active layer (or the selection) to a new size. */
export async function contentAwareScaleLayer(w: number, h: number, protectSkin: boolean, amount = 1): Promise<void> {
  const s = current();
  const l = s?.activeLayer();
  if (!s || !l || !hasRaster(l) || l.kind !== 'pixel') {
    toast('Content-Aware Scale works on a pixel layer.');
    return;
  }
  const b = l.raster.contentBounds();
  if (!b) return;
  const src = { w: b.w, h: b.h, c: 4 as const, data: l.raster.read(b) };
  let protect: Float32Array | null = null;
  if (protectSkin) {
    protect = new Float32Array(b.w * b.h);
    for (let i = 0; i < b.w * b.h; i++) {
      const r = src.data[i * 4]!,
        g = src.data[i * 4 + 1]!,
        bb = src.data[i * 4 + 2]!;
      // A simple skin-tone test (red over green over blue, moderate saturation).
      protect[i] = r > 0.35 && r > g && g > bb && r - bb > 0.08 && r - bb < 0.6 ? 1 : 0;
    }
  }
  const res = await busy('Scaling by content…', async () => contentAwareScale(src, w, h, protect, amount));
  const { Raster: R } = await import('../../core/raster');
  const out = R.fromFloats(s.doc.depth, 4, { x: b.x + Math.round((b.w - w) / 2), y: b.y + Math.round((b.h - h) / 2), w, h }, res.data);
  change('Content-Aware Scale', 'transform', (d) => ({ ...d, layers: replaceRaster(d.layers, l.id, out) }));
}

function replaceRaster(layers: Layer[], id: string, r: Raster): Layer[] {
  return updateLayer(layers, id, (x) => ({ ...x, raster: r }) as Layer);
}

export { canvasRect, flatten };
