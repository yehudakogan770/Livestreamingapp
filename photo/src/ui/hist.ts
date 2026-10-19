// Histograms of what is on the canvas (from a small copy of the composite)
// or of the active layer.

import { histogram } from '../core/adjust';
import type { Session } from '../app/session';
import { hasRaster } from '../core/layers';

const cache = new WeakMap<Session, { key: string; h: Uint32Array[] }>();

/** The composite's histogram ([r, g, b, luminosity], 256 bins each). */
export function compositeHistogram(s: Session, which: 'composite' | 'layer' = 'composite'): Uint32Array[] | null {
  const key = `${which}:${s.history.index}:${s.history.steps.length}:${s.active}:${s.doc.layers.length}`;
  const hit = cache.get(s);
  if (hit && hit.key === key) return hit.h;
  let data: Float32Array | null = null;
  if (which === 'layer') {
    const l = s.activeLayer();
    if (l && hasRaster(l)) {
      const b = l.raster.contentBoundsCached();
      if (b) {
        const step = Math.max(1, Math.ceil(Math.sqrt((b.w * b.h) / 250000)));
        const px = l.raster.read(b);
        data = new Float32Array(Math.ceil((b.w * b.h) / (step * step)) * 4);
        let o = 0;
        for (let y = 0; y < b.h; y += step)
          for (let x = 0; x < b.w; x += step) {
            const i = (y * b.w + x) * 4;
            if (px[i + 3]! <= 0) continue;
            data[o++] = px[i]!;
            data[o++] = px[i + 1]!;
            data[o++] = px[i + 2]!;
            data[o++] = 1;
          }
        data = data.subarray(0, o);
      }
    }
  }
  if (!data) {
    const t = s.compositor?.thumbnail(512);
    if (!t) return null;
    data = new Float32Array(t.data.length);
    let o = 0;
    for (let i = 0; i < t.data.length; i += 4) {
      if (t.data[i + 3]! === 0) continue;
      data[o++] = t.data[i]! / 255;
      data[o++] = t.data[i + 1]! / 255;
      data[o++] = t.data[i + 2]! / 255;
      data[o++] = 1;
    }
    data = data.subarray(0, o);
  }
  const h = histogram(data, 4, 1);
  cache.set(s, { key, h });
  return h;
}
