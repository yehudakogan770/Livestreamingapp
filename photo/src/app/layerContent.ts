// Layers whose pixels are drawn from something else: text (from its words
// and settings), shapes (from their paths), smart objects (from their source,
// filters and transform). Each change draws the layer's raster again.

import { Raster } from '../core/raster';
import { decode } from '../core/color';
import type { Doc, Layer, ShapeLayer, SmartLayer, TextLayer, Rect } from '../core/types';
import { drawText, drawnBounds } from './textRender';
import { pathBounds, pathToSvg } from '../core/path';
import { gradientRamp } from '../core/gradient';
import type { Img } from '../core/img';
import { warpProjective } from '../core/warp';
import { runFilterChain } from '../core/filters/registry';

function canvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Canvas pixels (8-bit, straight) into a raster at the document's depth. */
function fromCanvas(c: OffscreenCanvas | HTMLCanvasElement, r: Rect, doc: Pick<Doc, 'depth' | 'profile'>, aliased = false): Raster {
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const data = ctx.getImageData(0, 0, r.w, r.h).data;
  const f = new Float32Array(data.length);
  const linear = doc.depth === 32;
  for (let i = 0; i < data.length; i += 4) {
    let a = data[i + 3]! / 255;
    if (aliased) a = a >= 0.5 ? 1 : 0;
    f[i + 3] = a;
    if (a <= 0) continue;
    for (let k = 0; k < 3; k++) {
      const v = data[i + k]! / 255;
      f[i + k] = linear ? decode(doc.profile.trc, v) : v;
    }
  }
  return Raster.fromFloats(doc.depth, 4, r, f);
}

export function renderTextRaster(l: TextLayer, doc: Pick<Doc, 'depth' | 'profile' | 'width' | 'height'>): Raster {
  const b = drawnBounds(l.text);
  // Never more than a few canvases' worth (huge text far off the canvas is clipped).
  const lim = { x: -doc.width, y: -doc.height, w: doc.width * 3, h: doc.height * 3 };
  const x0 = Math.max(b.x, lim.x),
    y0 = Math.max(b.y, lim.y);
  const x1 = Math.min(b.x + b.w, lim.x + lim.w),
    y1 = Math.min(b.y + b.h, lim.y + lim.h);
  if (x1 <= x0 || y1 <= y0) return new Raster(doc.depth, 4);
  const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const c = canvas(r.w, r.h);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingQuality = 'high';
  drawText(ctx, l.text, { x: r.x, y: r.y });
  let raster = fromCanvas(c, r, doc, l.text.antialias === 'none');
  if (l.text.warp && l.text.warp.bend !== 0) raster = warpText(raster, l.text.warp.style, l.text.warp.bend);
  return raster;
}

/** Warp Text: bend the drawn text (Arc, Arch, Bulge, Flag, Wave, Rise). */
function warpText(r: Raster, style: string, bend: number): Raster {
  const b = r.contentBounds();
  if (!b) return r;
  const pad = Math.ceil(Math.max(b.w, b.h) * Math.abs(bend) * 0.5) + 2;
  const src = r.read(b);
  const out = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
  const px = new Float32Array(out.w * out.h * 4);
  const sample = (sx: number, sy: number, o: number) => {
    const x0 = Math.floor(sx),
      y0 = Math.floor(sy);
    const fx = sx - x0,
      fy = sy - y0;
    const at = (x: number, y: number, k: number) => (x < 0 || y < 0 || x >= b.w || y >= b.h ? 0 : src[(y * b.w + x) * 4 + k]!);
    for (let k = 0; k < 4; k++)
      px[o + k] = at(x0, y0, k) * (1 - fx) * (1 - fy) + at(x0 + 1, y0, k) * fx * (1 - fy) + at(x0, y0 + 1, k) * (1 - fx) * fy + at(x0 + 1, y0 + 1, k) * fx * fy;
  };
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      // Normalized position in the text box: u, v in −1..1.
      const u = ((x + out.x - b.x) / b.w) * 2 - 1;
      const v = ((y + out.y - b.y) / b.h) * 2 - 1;
      let su = u,
        sv = v;
      if (style === 'arc') sv = v + bend * (1 - u * u) * 1.0;
      else if (style === 'arch') sv = v + bend * (1 - u * u) * (1 - v) * 0.5;
      else if (style === 'bulge') sv = v / (1 + bend * (1 - u * u) * 0.8);
      else if (style === 'flag') sv = v + bend * Math.sin(u * Math.PI) * 0.6;
      else if (style === 'wave') sv = v + bend * Math.sin(u * Math.PI * 2) * 0.4;
      else if (style === 'rise') sv = v + bend * u * 0.8;
      su = u;
      const sx = ((su + 1) / 2) * b.w - 0.5,
        sy = ((sv + 1) / 2) * b.h - 0.5;
      sample(sx, sy, (y * out.w + x) * 4);
    }
  return Raster.fromFloats(r.depth, 4, out, px);
}

export function renderShapeRaster(l: ShapeLayer, doc: Pick<Doc, 'depth' | 'profile' | 'width' | 'height'>): Raster {
  const pb = pathBounds(l.path);
  if (!pb) return new Raster(doc.depth, 4);
  const sw = l.stroke ? l.stroke.width : 0;
  const pad = Math.ceil(sw + 2);
  const r = { x: Math.floor(pb.x - pad), y: Math.floor(pb.y - pad), w: Math.ceil(pb.w + 2 * pad) + 1, h: Math.ceil(pb.h + 2 * pad) + 1 };
  if (r.w * r.h > 400_000_000 || r.w <= 0 || r.h <= 0) return new Raster(doc.depth, 4);
  const c = canvas(r.w, r.h);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.translate(-r.x, -r.y);
  const p = new Path2D(pathToSvg(l.path));
  const rule: CanvasFillRule = l.path.rule === 'evenodd' ? 'evenodd' : 'nonzero';
  const css = (c3: readonly number[], a = 1) =>
    `rgba(${c3
      .slice(0, 3)
      .map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255))
      .join(',')},${a})`;
  if (l.fillGradient) {
    const g = l.fillGradient;
    const a = (g.angle * Math.PI) / 180;
    const cx = pb.x + pb.w / 2,
      cy = pb.y + pb.h / 2;
    const half = (Math.abs(Math.cos(a)) * pb.w + Math.abs(Math.sin(a)) * pb.h) / 2;
    const grad =
      g.style === 'radial'
        ? ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(pb.w, pb.h) / 2)
        : ctx.createLinearGradient(cx - Math.cos(a) * half, cy + Math.sin(a) * half, cx + Math.cos(a) * half, cy - Math.sin(a) * half);
    const ramp = gradientRamp(g.gradient, 32);
    for (let i = 0; i < 32; i++) grad.addColorStop(i / 31, css([ramp[i * 4]!, ramp[i * 4 + 1]!, ramp[i * 4 + 2]!], ramp[i * 4 + 3]!));
    ctx.fillStyle = grad;
    ctx.fill(p, rule);
  } else if (l.fillColor) {
    ctx.fillStyle = css(l.fillColor, l.fillColor[3] ?? 1);
    ctx.fill(p, rule);
  }
  if (l.stroke && l.stroke.width > 0) {
    const s = l.stroke;
    ctx.strokeStyle = css(s.color, s.color[3] ?? 1);
    ctx.lineCap = s.cap;
    ctx.lineJoin = s.join;
    ctx.setLineDash(s.dash.map((d) => d * s.width));
    if (s.align === 'center') {
      ctx.lineWidth = s.width;
      ctx.stroke(p);
    } else if (s.align === 'inside') {
      ctx.save();
      ctx.clip(p, rule);
      ctx.lineWidth = s.width * 2;
      ctx.stroke(p);
      ctx.restore();
    } else {
      // Outside: a doubled stroke with the inside cut out, drawn behind the fill.
      const c2 = canvas(r.w, r.h);
      const x2 = c2.getContext('2d') as CanvasRenderingContext2D;
      x2.translate(-r.x, -r.y);
      x2.strokeStyle = ctx.strokeStyle;
      x2.lineCap = s.cap;
      x2.lineJoin = s.join;
      x2.setLineDash(s.dash.map((d) => d * s.width));
      x2.lineWidth = s.width * 2;
      x2.stroke(p);
      x2.globalCompositeOperation = 'destination-out';
      x2.fill(p, rule);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'destination-over';
      ctx.drawImage(c2 as CanvasImageSource, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  return fromCanvas(c, r, doc);
}

/** A smart object's pixels: its source, through its filters, through its transform. */
export function renderSmartRaster(l: SmartLayer, doc: Pick<Doc, 'depth' | 'profile' | 'width' | 'height'>): Raster {
  const src = l.source;
  const sr = { x: 0, y: 0, w: src.width, h: src.height };
  let img: Img = { w: sr.w, h: sr.h, c: 4, data: src.raster.read(sr) };
  if (l.filtersVisible && l.filters.some((f) => f.visible)) {
    const filtered = runFilterChain(img, l.filters, { width: src.width, height: src.height });
    if (l.filterMask) {
      // White in the filter mask shows the filters.
      const m = l.filterMask.read(sr, undefined, 1);
      for (let i = 0; i < m.length; i++) {
        const k = m[i]!;
        for (let c = 0; c < 4; c++) filtered.data[i * 4 + c] = img.data[i * 4 + c]! + (filtered.data[i * 4 + c]! - img.data[i * 4 + c]!) * k;
      }
    }
    img = filtered;
  }
  const { rect, data } = warpProjective(img, l.transform, { x: -doc.width, y: -doc.height, w: doc.width * 3, h: doc.height * 3 });
  if (!rect) return new Raster(doc.depth, 4);
  return Raster.fromFloats(doc.depth, 4, rect, data);
}

/** The layer with its pixels drawn again. */
export async function rerender<T extends Layer>(l: T, doc: Pick<Doc, 'depth' | 'profile' | 'width' | 'height'>): Promise<T> {
  if (l.kind === 'text') return { ...l, raster: renderTextRaster(l, doc) };
  if (l.kind === 'shape') return { ...l, raster: renderShapeRaster(l, doc) };
  if (l.kind === 'smart') return { ...l, raster: renderSmartRaster(l, doc) };
  return l;
}

export function rerenderSync<T extends Layer>(l: T, doc: Pick<Doc, 'depth' | 'profile' | 'width' | 'height'>): T {
  if (l.kind === 'text') return { ...l, raster: renderTextRaster(l, doc) };
  if (l.kind === 'shape') return { ...l, raster: renderShapeRaster(l, doc) };
  if (l.kind === 'smart') return { ...l, raster: renderSmartRaster(l, doc) };
  return l;
}
