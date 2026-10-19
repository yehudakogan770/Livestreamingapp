// Fill Path and Stroke Path (the Paths panel): fill a path's shape with a
// color, or run the current brush along it.

import { app, current, bump } from '../state';
import { paintTarget } from '../tools/paintTools';
import { paintOp } from '../tools/paintOps';
import { BrushStroke } from '../../core/brush';
import { pathMask } from '../../core/selection';
import { flatten as flattenPath, type VectorPath } from '../../core/path';
import { TileEdit, intersect } from '../../core/raster';
import { compositePixel } from '../../core/blend';
import { canvasRect } from './common';
import { updateLayer } from '../../core/layers';
import type { Layer } from '../../core/types';

function finish(label: string, layerId: string | null, swaps: (ReturnType<TileEdit['commit']> | null)[]): void {
  const s = current();
  const list = swaps.filter((x): x is ReturnType<TileEdit['commit']> => !!x);
  if (!s || !list.length) return;
  let next = { ...s.doc };
  if (layerId) next = { ...next, layers: updateLayer(next.layers, layerId, (l) => ({ ...l }) as Layer) };
  s.commit(label, 'path', next, list);
  bump();
}

export function fillPath(p: VectorPath, color: [number, number, number]): void {
  const s = current();
  const t = paintTarget();
  if (!s || !t) return;
  const m = pathMask(s.doc.width, s.doc.height, p);
  let box: { x: number; y: number; w: number; h: number } | null = null;
  for (const sp of flattenPath(p)) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (let i = 0; i < sp.pts.length; i += 2) {
      x0 = Math.min(x0, sp.pts[i]!);
      x1 = Math.max(x1, sp.pts[i]!);
      y0 = Math.min(y0, sp.pts[i + 1]!);
      y1 = Math.max(y1, sp.pts[i + 1]!);
    }
    const r = { x: Math.floor(x0) - 1, y: Math.floor(y0) - 1, w: Math.ceil(x1 - x0) + 3, h: Math.ceil(y1 - y0) + 3 };
    box = box ? { x: Math.min(box.x, r.x), y: Math.min(box.y, r.y), w: Math.max(box.x + box.w, r.x + r.w) - Math.min(box.x, r.x), h: Math.max(box.y + box.h, r.y + r.h) - Math.min(box.y, r.y) } : r;
  }
  const r = box && intersect(box, canvasRect(s.doc));
  if (!r) return;
  const px = t.raster.read(r);
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const k = m.data[(r.y + y) * s.doc.width + r.x + x]! / 255;
      if (k <= 0) continue;
      const i = (y * r.w + x) * t.channels;
      if (t.channels === 1) px[i] = px[i]! + (1 - px[i]!) * k;
      else compositePixel('normal', px, i, color[0], color[1], color[2], k, r.x + x, r.y + y);
    }
  const e = new TileEdit(t.raster);
  t.raster.write(r, px, e);
  finish('Fill Path', t.layerId, [e.commit()]);
}

export function strokePath(p: VectorPath): void {
  const s = current();
  const t = paintTarget();
  if (!s || !t) return;
  const o = app.get().opts.brush;
  const swaps = [];
  for (const sp of flattenPath(p)) {
    if (sp.pts.length < 2) continue;
    const st = new BrushStroke(t.raster, paintOp(app.get().fg, o.mode, t.channels, t.lockAlpha), { tip: { ...o.tip, smoothing: 0 }, flow: o.flow, opacity: o.opacity, bounds: canvasRect(s.doc), seed: 7 });
    const pts = sp.closed ? [...sp.pts, sp.pts[0]!, sp.pts[1]!] : sp.pts;
    for (let i = 0; i < pts.length - 2; i += 2) st.add({ x: pts[i]!, y: pts[i + 1]!, pressure: 1 });
    st.end({ x: pts[pts.length - 2]!, y: pts[pts.length - 1]!, pressure: 1 });
    st.flush();
    swaps.push(st.commit());
  }
  finish('Stroke Path', t.layerId, swaps);
}
