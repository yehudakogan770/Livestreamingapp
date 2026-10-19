// The CPU compositor: the document's layers flattened over a rectangle.
// The GPU compositor (gpu/compositor.ts) does the same on screen; this one
// is the reference for tests, the fallback where WebGL2 is missing, and what
// file writers use for a document's composite when no GPU is at hand.
// Layer styles are drawn only by the GPU compositor.

import { blendRGB, compositePixel, type BlendMode } from './blend';
import { pixelFn, type AdjustContext } from './adjust';
import { sampleGradient, gradientT } from './gradient';
import { getPattern, patternAt } from './patterns';
import { pathMask } from './selection';
import type { Doc, Layer, LayerBase, Rect, FillContent } from './types';

export interface CompositeOptions {
  /** Layers to leave out (by id). */
  hide?: Set<string>;
  /** Draw only these root-level layers. */
  only?: Set<string>;
  /** Background under everything (default transparent). */
  background?: [number, number, number, number] | null;
}

/** The pixels of `r` (RGBA floats, straight alpha). */
export function compositeRect(doc: Doc, r: Rect, opts: CompositeOptions = {}): Float32Array {
  const out = new Float32Array(r.w * r.h * 4);
  if (opts.background) for (let i = 0; i < out.length; i += 4) out.set(opts.background, i);
  const ctx: AdjustContext = { trc: doc.depth === 32 ? { type: 'linear' } : doc.profile.trc };
  const layers = opts.only ? doc.layers.filter((l) => opts.only!.has(l.id)) : doc.layers;
  drawList(doc, layers, out, r, opts, ctx);
  return out;
}

export function compositeAll(doc: Doc, opts: CompositeOptions = {}): Float32Array {
  return compositeRect(doc, { x: 0, y: 0, w: doc.width, h: doc.height }, opts);
}

function drawList(doc: Doc, layers: Layer[], dst: Float32Array, r: Rect, opts: CompositeOptions, ctx: AdjustContext): void {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i]!;
    if (l.clip) continue; // drawn with its base
    // A clipping group: this layer and the clipped ones right above it.
    const clipped: Layer[] = [];
    for (let j = i + 1; j < layers.length && layers[j]!.clip; j++) clipped.push(layers[j]!);
    if (!visible(l, opts)) continue;
    if (clipped.some((c) => visible(c, opts))) {
      drawClipGroup(doc, l, clipped, dst, r, opts, ctx);
      continue;
    }
    drawLayer(doc, l, dst, r, opts, ctx);
  }
}

const visible = (l: Layer, opts: CompositeOptions) => l.visible && !opts.hide?.has(l.id);

/** The base layer drawn alone, the clipped layers inside its pixels, then all of it over the backdrop. */
function drawClipGroup(doc: Doc, base: Layer, clipped: Layer[], dst: Float32Array, r: Rect, opts: CompositeOptions, ctx: AdjustContext): void {
  const own = new Float32Array(dst.length);
  drawLayer(doc, { ...base, blend: 'normal', opacity: 1 } as Layer, own, r, opts, ctx);
  const baseAlpha = new Float32Array(r.w * r.h);
  for (let i = 0; i < baseAlpha.length; i++) baseAlpha[i] = own[i * 4 + 3]!;
  for (const c of clipped) {
    if (!visible(c, opts)) continue;
    const before = own.slice();
    drawLayer(doc, c, own, r, opts, ctx);
    // Keep the base's alpha: the clipped layer shows only where the base has pixels.
    for (let i = 0; i < baseAlpha.length; i++) {
      const o = i * 4;
      const a = baseAlpha[i]!;
      if (a <= 0) {
        own[o] = before[o]!;
        own[o + 1] = before[o + 1]!;
        own[o + 2] = before[o + 2]!;
        own[o + 3] = 0;
        continue;
      }
      own[o + 3] = a;
    }
  }
  const op = base.opacity;
  for (let i = 0; i < baseAlpha.length; i++) {
    const o = i * 4;
    compositePixel(base.blend, dst, o, own[o]!, own[o + 1]!, own[o + 2]!, own[o + 3]! * op, r.x + (i % r.w), r.y + Math.floor(i / r.w));
  }
}

/** The layer's mask coverage over `r` (null: no mask). */
export function maskCoverage(doc: Doc, l: LayerBase, r: Rect): Float32Array | null {
  let cov: Float32Array | null = null;
  if (l.mask && l.mask.enabled) {
    const m = l.mask;
    cov = m.raster.read(r, undefined, 0);
    if (m.background) {
      // Pixels outside the mask's tiles take the background value.
      const filled = m.raster.read(r, undefined, -1);
      for (let i = 0; i < cov.length; i++) if (filled[i] === -1) cov[i] = m.background;
    }
    if (m.density < 1) for (let i = 0; i < cov.length; i++) cov[i] = 1 - m.density * (1 - cov[i]!);
  }
  if (l.vmask && l.vmask.enabled) {
    const pm = pathMask(doc.width, doc.height, l.vmask.path, true);
    const v = new Float32Array(r.w * r.h);
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        const dx = r.x + x,
          dy = r.y + y;
        v[y * r.w + x] = dx >= 0 && dy >= 0 && dx < doc.width && dy < doc.height ? pm.data[dy * doc.width + dx]! / 255 : 0;
      }
    if (cov) for (let i = 0; i < cov.length; i++) cov[i] = cov[i]! * v[i]!;
    else cov = v;
  }
  return cov;
}

/** A gradient fill's start and end points (document pixels). */
export function gradientEnds(content: Extract<FillContent, { type: 'gradient' }>, doc: { width: number; height: number }): [number, number, number, number] {
  if (content.p0 && content.p1) return [content.p0[0], content.p0[1], content.p1[0], content.p1[1]];
  const cx = doc.width / 2 + content.ox,
    cy = doc.height / 2 + content.oy;
  const a = (content.angle * Math.PI) / 180;
  const half = (Math.abs(Math.cos(a)) * doc.width + Math.abs(Math.sin(a)) * doc.height) / 2;
  const len = half * content.scale;
  const centered = content.style !== 'linear';
  return [centered ? cx : cx - Math.cos(a) * len, centered ? cy : cy + Math.sin(a) * len, cx + Math.cos(a) * len, cy - Math.sin(a) * len];
}

export function fillPixel(content: FillContent, x: number, y: number, doc: { width: number; height: number }, out: number[]): void {
  if (content.type === 'solid') {
    out[0] = content.color[0];
    out[1] = content.color[1];
    out[2] = content.color[2];
    out[3] = content.color[3];
    return;
  }
  if (content.type === 'pattern') {
    patternAt(getPattern(content.pattern), x - content.ox, y - content.oy, content.scale, out);
    return;
  }
  const [x0, y0, x1, y1] = gradientEnds(content, doc);
  let t = gradientT(content.style, x + 0.5, y + 0.5, x0, y0, x1, y1);
  if (content.reverse) t = 1 - t;
  const c = sampleGradient(content.gradient, t);
  out[0] = c[0];
  out[1] = c[1];
  out[2] = c[2];
  out[3] = c[3];
}

function drawLayer(doc: Doc, l: Layer, dst: Float32Array, r: Rect, opts: CompositeOptions, ctx: AdjustContext): void {
  const n = r.w * r.h;
  const cov = maskCoverage(doc, l, r);
  const blend: BlendMode = l.blend;
  if (l.kind === 'group') {
    if (l.passThrough && l.blend === 'normal' && l.opacity >= 1 && !cov) {
      drawList(doc, l.children, dst, r, opts, ctx);
      return;
    }
    if (l.passThrough) {
      // Pass through with opacity or a mask: draw onto a copy of the backdrop, then mix.
      const copy = dst.slice();
      drawList(doc, l.children, copy, r, opts, ctx);
      for (let i = 0; i < n; i++) {
        const k = l.opacity * (cov ? cov[i]! : 1);
        const o = i * 4;
        for (let c = 0; c < 4; c++) dst[o + c] = dst[o + c]! + (copy[o + c]! - dst[o + c]!) * k;
      }
      return;
    }
    const own = new Float32Array(dst.length);
    drawList(doc, l.children, own, r, opts, ctx);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const a = own[o + 3]! * l.opacity * (cov ? cov[i]! : 1);
      compositePixel(blend, dst, o, own[o]!, own[o + 1]!, own[o + 2]!, a, r.x + (i % r.w), r.y + ((i / r.w) | 0));
    }
    return;
  }
  if (l.kind === 'adjust') {
    const fn = pixelFn(l.adjust, l.params, ctx);
    const res = [0, 0, 0];
    const lin = doc.depth === 32;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const k = l.opacity * l.fill * (cov ? cov[i]! : 1);
      if (k <= 0 || dst[o + 3]! <= 0) continue;
      let cr = dst[o]!,
        cg = dst[o + 1]!,
        cb = dst[o + 2]!;
      if (lin) {
        cr = Math.pow(Math.max(0, Math.min(1, cr)), 1 / 2.2);
        cg = Math.pow(Math.max(0, Math.min(1, cg)), 1 / 2.2);
        cb = Math.pow(Math.max(0, Math.min(1, cb)), 1 / 2.2);
      }
      fn(cr, cg, cb, res);
      let a0 = res[0]!,
        a1 = res[1]!,
        a2 = res[2]!;
      if (lin) {
        a0 = Math.pow(a0, 2.2);
        a1 = Math.pow(a1, 2.2);
        a2 = Math.pow(a2, 2.2);
      }
      // The adjusted backdrop mixed in with the layer's mode, opacity and mask (alpha unchanged).
      if (blend !== 'normal') {
        const B = blendRGB(
          blend,
          [Math.min(1, Math.max(0, dst[o]!)), Math.min(1, Math.max(0, dst[o + 1]!)), Math.min(1, Math.max(0, dst[o + 2]!))],
          [a0, a1, a2],
        );
        a0 = B[0]!;
        a1 = B[1]!;
        a2 = B[2]!;
      }
      dst[o] = dst[o]! + (a0 - dst[o]!) * k;
      dst[o + 1] = dst[o + 1]! + (a1 - dst[o + 1]!) * k;
      dst[o + 2] = dst[o + 2]! + (a2 - dst[o + 2]!) * k;
    }
    return;
  }
  const px = [0, 0, 0, 0];
  let src: Float32Array | null = null;
  if (l.kind !== 'fill') src = l.raster.read(r);
  const op = l.opacity * l.fill;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const x = r.x + (i % r.w),
      y = r.y + ((i / r.w) | 0);
    if (src) {
      px[0] = src[o]!;
      px[1] = src[o + 1]!;
      px[2] = src[o + 2]!;
      px[3] = src[o + 3]!;
    } else if (l.kind === 'fill') fillPixel(l.content, x, y, doc, px);
    const a = px[3]! * op * (cov ? cov[i]! : 1);
    if (a <= 0) continue;
    compositePixel(blend, dst, o, px[0]!, px[1]!, px[2]!, a, x, y);
  }
}
