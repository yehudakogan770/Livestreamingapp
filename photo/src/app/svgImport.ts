// SVG files open as a smart object: drawn by the browser at a generous size
// (so scaling up later stays sharp), the SVG itself kept with the layer.

import { Raster } from '../core/raster';
import { baseLayer, uid } from '../core/layers';
import { SRGB } from '../core/color';
import type { Doc, SmartLayer } from '../core/types';

function svgSize(text: string): { w: number; h: number } {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg') throw new Error('This SVG file could not be read.');
  const num = (v: string | null) => (v && /^[\d.]+(px)?$/.test(v.trim()) ? parseFloat(v) : NaN);
  let w = num(svg.getAttribute('width')),
    h = num(svg.getAttribute('height'));
  const vb = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  if ((!w || !h) && vb && vb.length === 4) {
    w = w || vb[2]!;
    h = h || vb[3]!;
  }
  return { w: Math.max(1, Math.round(w || 512)), h: Math.max(1, Math.round(h || 512)) };
}

/** Draw an SVG to 8-bit RGBA at a size. */
export async function rasterizeSvg(text: string, w: number, h: number): Promise<Uint8ClampedArray> {
  // Give the SVG an explicit size so it scales cleanly.
  const sized = text.replace(/<svg\b([^>]*)>/i, (m, attrs: string) => {
    let a = attrs.replace(/\swidth="[^"]*"/i, '').replace(/\sheight="[^"]*"/i, '');
    a += ` width="${w}" height="${h}"`;
    if (!/viewBox=/i.test(a)) {
      const s = svgSize(text);
      a += ` viewBox="0 0 ${s.w} ${s.h}"`;
    }
    return `<svg${a}>`;
  });
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function docFromSvg(name: string, text: string): Promise<Doc> {
  const { w, h } = svgSize(text);
  // Drawn at up to 4× (and at most 8192 px) so it stays sharp when enlarged.
  const k = Math.max(1, Math.min(4, 8192 / Math.max(w, h)));
  const W = Math.round(w * k),
    H = Math.round(h * k);
  const px = await rasterizeSvg(text, W, H);
  const raster = Raster.fromRGBA8(8, W, H, px);
  const layer: SmartLayer = {
    ...baseLayer(name),
    kind: 'smart',
    source: { kind: 'svg', width: W, height: H, raster, svg: text, name: `${name}.svg` },
    transform: [1 / k, 0, 0, 0, 1 / k, 0, 0, 0, 1],
    filters: [],
    filtersVisible: true,
    raster: new Raster(8, 4),
  };
  const { renderSmartRaster } = await import('./layerContent');
  const doc: Doc = { id: uid('doc'), name, width: w, height: h, depth: 8, profile: SRGB, resolution: 72, layers: [layer], selection: null, channels: [], paths: [], guides: [], comps: [], artboards: [], slices: [] };
  layer.raster = renderSmartRaster(layer, doc);
  return doc;
}
