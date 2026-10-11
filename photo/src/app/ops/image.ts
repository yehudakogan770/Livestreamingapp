// The Image menu: Image Size, Canvas Size, rotating and flipping the canvas,
// Crop and Trim, bit depth and color profiles.

import { bump, current, toast, addSession } from '../state';
import { change, canvasRect, selectionMask, withSelection, flatten } from './common';
import { Raster, intersect } from '../../core/raster';
import { resize, img as mkImg, type Resample, type Img } from '../../core/img';
import { transformMask, type Mask } from '../../core/selection';
import { transformPath } from '../../core/path';
import { allLayers, updateLayer, uid } from '../../core/layers';
import { convertColor, decode, encode, rgbToRgb, apply3, type ColorProfile } from '../../core/color';
import type { Depth, Doc, Layer, Rect } from '../../core/types';
import { rerender } from '../layerContent';

/** Every raster in a layer transformed by `f` (pixels and masks). */
function mapRasters(l: Layer, f: (r: Raster, isMask: boolean) => Raster): Layer {
  let out: Layer = { ...l };
  if ('raster' in out && out.kind !== 'text' && out.kind !== 'shape' && out.kind !== 'smart') out = { ...out, raster: f(out.raster, false) } as Layer;
  if (out.mask) out = { ...out, mask: { ...out.mask, raster: f(out.mask.raster, true) } };
  if (out.kind === 'group') out = { ...out, children: out.children.map((c) => mapRasters(c, f)) };
  return out;
}

/** An affine transform of every layer: pixels resampled, vector content redrawn. */
export async function transformDoc(d: Doc, mat: number[], w: number, h: number, method: Resample, label: string): Promise<void> {
  const s = current();
  if (!s) return;
  const resampleRaster = (r: Raster, isMask: boolean): Raster => transformRaster(r, mat, method, isMask ? 1 : 4);
  const transformLayer = async (l: Layer): Promise<Layer> => {
    let out = mapRasters(l, resampleRaster);
    if (out.kind === 'group') out = { ...out, children: await Promise.all(out.children.map(transformLayer)) };
    if (out.kind === 'text') {
      const k = Math.sqrt(Math.abs(mat[0]! * mat[3]! - mat[1]! * mat[2]!));
      const [x, y] = [mat[0]! * out.text.x + mat[2]! * out.text.y + mat[4]!, mat[1]! * out.text.x + mat[3]! * out.text.y + mat[5]!];
      const text = {
        ...out.text,
        x,
        y,
        base: { ...out.text.base, size: out.text.base.size * k, leading: out.text.base.leading * k },
        runs: out.text.runs.map((r) => ({ ...r, style: r.style?.size ? { ...r.style, size: r.style.size * k } : r.style })),
        box: out.text.box ? { w: out.text.box.w * k, h: out.text.box.h * k } : undefined,
        path: out.text.path ? transformPath(out.text.path, mat) : undefined,
      };
      out = await rerender({ ...out, text }, { ...d, width: w, height: h });
    } else if (out.kind === 'shape') {
      out = await rerender({ ...out, path: transformPath(out.path, mat), stroke: out.stroke ? { ...out.stroke, width: out.stroke.width * Math.sqrt(Math.abs(mat[0]! * mat[3]!)) } : null }, { ...d, width: w, height: h });
    } else if (out.kind === 'smart') {
      const T = out.transform;
      const M = [mat[0]!, mat[2]!, mat[4]!, mat[1]!, mat[3]!, mat[5]!, 0, 0, 1];
      const nt = mul3x3(M, T);
      out = await rerender({ ...out, transform: nt }, { ...d, width: w, height: h });
    }
    if (out.vmask) out = { ...out, vmask: { ...out.vmask, path: transformPath(out.vmask.path, mat) } };
    return out;
  };
  const layers = await Promise.all(d.layers.map(transformLayer));
  const sel = selectionMask(d);
  let nextSel: Mask | null = null;
  if (sel) {
    const big = { w: Math.max(d.width, w), h: Math.max(d.height, h), data: new Uint8Array(Math.max(d.width, w) * Math.max(d.height, h)) };
    for (let y = 0; y < d.height; y++) big.data.set(sel.data.subarray(y * d.width, (y + 1) * d.width), y * big.w);
    const t = transformMask(big, mat);
    nextSel = { w, h, data: new Uint8Array(w * h) };
    for (let y = 0; y < h; y++) nextSel.data.set(t.data.subarray(y * big.w, y * big.w + w), y * w);
  }
  const channels = d.channels.map((c) => ({ ...c, raster: transformRaster(c.raster, mat, method, 1) }));
  const guides = d.guides.map((g) => ({ ...g, at: g.axis === 'x' ? mat[0]! * g.at + mat[4]! : mat[3]! * g.at + mat[5]! }));
  const next: Doc = withSelection({ ...d, width: w, height: h, layers, channels, guides }, nextSel);
  s.commit(label, 'image', next);
  s.fitted = true;
  bump();
}

function mul3x3(a: number[], b: number[]): number[] {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k]! * b[k * 3 + j]!;
  return r;
}

/** Resample a raster through an affine matrix (document → document). */
export function transformRaster(r: Raster, mat: number[], method: Resample, channels: 1 | 4): Raster {
  const b = r.tileBounds();
  if (!b) return new Raster(r.depth, r.channels);
  const [a, bb, c, d, e, f] = mat as [number, number, number, number, number, number];
  // Pure scale: use the separable resize (best quality).
  if (Math.abs(bb) < 1e-9 && Math.abs(c) < 1e-9 && a > 0 && d > 0) {
    const src = { w: b.w, h: b.h, c: channels, data: r.read(b) } as Img;
    const nw = Math.max(1, Math.round(b.w * a)),
      nh = Math.max(1, Math.round(b.h * d));
    const out = resize(src, nw, nh, method);
    const x = Math.round(b.x * a + e),
      y = Math.round(b.y * d + f);
    const res = new Raster(r.depth, r.channels);
    res.write({ x, y, w: nw, h: nh }, out.data, null, true);
    res.prune();
    return res;
  }
  // Exact quarter turns and flips: move pixels without resampling.
  const corners = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ].map(([x, y]) => [a * x! + c * y! + e, bb * x! + d * y! + f]);
  const xs = corners.map((p) => p[0]!),
    ys = corners.map((p) => p[1]!);
  const ob = { x: Math.floor(Math.min(...xs)), y: Math.floor(Math.min(...ys)), w: Math.ceil(Math.max(...xs)) - Math.floor(Math.min(...xs)), h: Math.ceil(Math.max(...ys)) - Math.floor(Math.min(...ys)) };
  const src = r.read(b);
  const det = a * d - bb * c;
  const ia = d / det,
    ib = -bb / det,
    ic = -c / det,
    id = a / det;
  const ie = -(ia * e + ic * f),
    iff = -(ib * e + id * f);
  const integral = [a, bb, c, d].every((v) => Math.abs(v - Math.round(v)) < 1e-9) && Math.abs(e - Math.round(e)) < 1e-9 && Math.abs(f - Math.round(f)) < 1e-9;
  const out = new Float32Array(ob.w * ob.h * channels);
  const tmp = new Float32Array(channels);
  const srcImg = { w: b.w, h: b.h, c: channels, data: src } as Img;
  for (let y = 0; y < ob.h; y++)
    for (let x = 0; x < ob.w; x++) {
      const px = ob.x + x + 0.5,
        py = ob.y + y + 0.5;
      const sx = ia * px + ic * py + ie - b.x,
        sy = ib * px + id * py + iff - b.y;
      if (integral) {
        const ix = Math.floor(sx),
          iy = Math.floor(sy);
        if (ix < 0 || iy < 0 || ix >= b.w || iy >= b.h) continue;
        for (let k = 0; k < channels; k++) out[(y * ob.w + x) * channels + k] = src[(iy * b.w + ix) * channels + k]!;
      } else {
        sampleBorder(srcImg, sx, sy, tmp);
        for (let k = 0; k < channels; k++) out[(y * ob.w + x) * channels + k] = tmp[k]!;
      }
    }
  const res = new Raster(r.depth, r.channels);
  res.write(ob, out, null, true);
  res.prune();
  return res;
}

function sampleBorder(a: Img, x: number, y: number, out: Float32Array): void {
  // Bilinear, transparent outside, premultiplied for RGBA.
  const x0 = Math.floor(x - 0.5),
    y0 = Math.floor(y - 0.5);
  const fx = x - 0.5 - x0,
    fy = y - 0.5 - y0;
  const c = a.c;
  const at = (xx: number, yy: number, k: number) => (xx < 0 || yy < 0 || xx >= a.w || yy >= a.h ? 0 : a.data[(yy * a.w + xx) * c + k]!);
  const w00 = (1 - fx) * (1 - fy),
    w10 = fx * (1 - fy),
    w01 = (1 - fx) * fy,
    w11 = fx * fy;
  if (c === 1) {
    out[0] = at(x0, y0, 0) * w00 + at(x0 + 1, y0, 0) * w10 + at(x0, y0 + 1, 0) * w01 + at(x0 + 1, y0 + 1, 0) * w11;
    return;
  }
  const a00 = at(x0, y0, 3) * w00,
    a10 = at(x0 + 1, y0, 3) * w10,
    a01 = at(x0, y0 + 1, 3) * w01,
    a11 = at(x0 + 1, y0 + 1, 3) * w11;
  const al = a00 + a10 + a01 + a11;
  for (let k = 0; k < 3; k++) out[k] = al > 1e-6 ? (at(x0, y0, k) * a00 + at(x0 + 1, y0, k) * a10 + at(x0, y0 + 1, k) * a01 + at(x0 + 1, y0 + 1, k) * a11) / al : 0;
  out[3] = al;
}

export async function imageSize(w: number, h: number, method: Resample, resolution?: number): Promise<void> {
  const s = current();
  if (!s) return;
  const d = s.doc;
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (w === d.width && h === d.height) {
    if (resolution && resolution !== d.resolution) change('Image Size', 'image', (x) => ({ ...x, resolution }));
    return;
  }
  await transformDoc({ ...d, resolution: resolution ?? d.resolution }, [w / d.width, 0, 0, h / d.height, 0, 0], w, h, method, 'Image Size');
}

/** Canvas Size: more (or less) room around the picture; the anchor says where it stays. */
export function canvasSize(w: number, h: number, ax: number, ay: number, fill: [number, number, number, number] | null): void {
  const s = current();
  if (!s) return;
  const d = s.doc;
  const dx = Math.round((w - d.width) * ax),
    dy = Math.round((h - d.height) * ay);
  const layers = d.layers.map((l) => shiftLayer(l, dx, dy));
  // The Background grows with the canvas extension color.
  const bgIdx = layers.findIndex((l) => l.name === 'Background' && l.kind === 'pixel');
  if (bgIdx >= 0 && fill) {
    const bgL = layers[bgIdx]!;
    if (bgL.kind === 'pixel') {
      const ext = Raster.filled(d.depth, 4, { x: 0, y: 0, w, h }, fill);
      const old = bgL.raster.read({ x: dx, y: dy, w: d.width, h: d.height });
      ext.write(intersect({ x: dx, y: dy, w: d.width, h: d.height }, { x: 0, y: 0, w, h }) ?? { x: 0, y: 0, w: 0, h: 0 }, cropF(old, d.width, d.height, dx, dy, w, h), null);
      layers[bgIdx] = { ...bgL, raster: ext };
    }
  }
  const sel = selectionMask(d);
  let nsel: Mask | null = null;
  if (sel) {
    nsel = { w, h, data: new Uint8Array(w * h) };
    for (let y = 0; y < d.height; y++)
      for (let x = 0; x < d.width; x++) {
        const X = x + dx,
          Y = y + dy;
        if (X >= 0 && Y >= 0 && X < w && Y < h) nsel.data[Y * w + X] = sel.data[y * d.width + x]!;
      }
  }
  const next = withSelection({ ...d, width: w, height: h, layers, channels: d.channels.map((c) => ({ ...c, raster: c.raster.shifted(dx, dy) })), guides: d.guides.map((g) => ({ ...g, at: g.at + (g.axis === 'x' ? dx : dy) })) }, nsel);
  s.commit('Canvas Size', 'image', next);
  s.fitted = true;
  bump();
}

/** The part of `old` (a d.width × d.height block now at dx, dy) that lands inside w × h. */
function cropF(old: Float32Array, ow: number, oh: number, dx: number, dy: number, w: number, h: number): Float32Array {
  const r = intersect({ x: dx, y: dy, w: ow, h: oh }, { x: 0, y: 0, w, h });
  if (!r) return new Float32Array(0);
  const out = new Float32Array(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) out.set(old.subarray(((r.y - dy + y) * ow + (r.x - dx)) * 4, ((r.y - dy + y) * ow + (r.x - dx) + r.w) * 4), y * r.w * 4);
  return out;
}

function shiftLayer(l: Layer, dx: number, dy: number): Layer {
  if (!dx && !dy) return l;
  let out: Layer = mapRasters(l, (r) => r.shifted(dx, dy));
  if (out.kind === 'group') out = { ...out, children: out.children.map((c) => shiftLayer(c, dx, dy)) };
  const m = [1, 0, 0, 1, dx, dy];
  if (out.kind === 'text') out = { ...out, raster: out.raster.shifted(dx, dy), text: { ...out.text, x: out.text.x + dx, y: out.text.y + dy, path: out.text.path ? transformPath(out.text.path, m) : undefined } };
  if (out.kind === 'shape') out = { ...out, raster: out.raster.shifted(dx, dy), path: transformPath(out.path, m) };
  if (out.kind === 'smart') {
    const T = out.transform;
    out = { ...out, raster: out.raster.shifted(dx, dy), transform: [T[0]! + dx * T[6]!, T[1]! + dx * T[7]!, T[2]! + dx * T[8]!, T[3]! + dy * T[6]!, T[4]! + dy * T[7]!, T[5]! + dy * T[8]!, T[6]!, T[7]!, T[8]!] };
  }
  if (out.kind === 'fill' && out.content.type !== 'solid') out = { ...out, content: { ...out.content, ox: out.content.ox + dx, oy: out.content.oy + dy } };
  if (out.vmask) out = { ...out, vmask: { ...out.vmask, path: transformPath(out.vmask.path, m) } };
  return out;
}

export { shiftLayer };

export async function rotateCanvas(deg: number): Promise<void> {
  const s = current();
  if (!s) return;
  const d = s.doc;
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r),
    sin = Math.sin(r);
  const exact = deg % 90 === 0;
  const C = exact ? Math.round(cos) : cos,
    S = exact ? Math.round(sin) : sin;
  const w = Math.round(Math.abs(C) * d.width + Math.abs(S) * d.height),
    h = Math.round(Math.abs(S) * d.width + Math.abs(C) * d.height);
  // Rotate about the old center, then move to the new center.
  const mat = [C, S, -S, C, w / 2 - (C * d.width / 2 - S * d.height / 2), h / 2 - (S * d.width / 2 + C * d.height / 2)];
  await transformDoc(d, mat, w, h, 'bicubic', deg === 180 ? 'Rotate 180°' : deg === 90 ? 'Rotate 90° Clockwise' : deg === -90 || deg === 270 ? 'Rotate 90° Counter Clockwise' : 'Rotate Canvas');
  // Arbitrary angles leave transparent corners on the Background: fill them with the background color.
}

export async function flipCanvas(horizontal: boolean): Promise<void> {
  const s = current();
  if (!s) return;
  const d = s.doc;
  const mat = horizontal ? [-1, 0, 0, 1, d.width, 0] : [1, 0, 0, -1, 0, d.height];
  await transformDoc(d, mat, d.width, d.height, 'nearest', horizontal ? 'Flip Canvas Horizontal' : 'Flip Canvas Vertical');
}

/** Crop to a rectangle (document pixels), keeping pixels outside unless `deleteCropped`. */
export function cropTo(r: Rect, deleteCropped = true): void {
  const s = current();
  if (!s) return;
  const d = s.doc;
  const x = Math.round(r.x),
    y = Math.round(r.y),
    w = Math.max(1, Math.round(r.w)),
    h = Math.max(1, Math.round(r.h));
  let layers = d.layers.map((l) => shiftLayer(l, -x, -y));
  if (deleteCropped) {
    const clip = (l: Layer): Layer => {
      let out = mapRasters(l, (rr) => {
        const b = intersect(rr.tileBounds() ?? { x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w, h });
        if (!b) return new Raster(rr.depth, rr.channels);
        return Raster.fromFloats(rr.depth, rr.channels, b, rr.read(b));
      });
      if (out.kind === 'group') out = { ...out, children: out.children.map(clip) };
      return out;
    };
    layers = layers.map(clip);
  }
  const sel = selectionMask(d);
  let nsel: Mask | null = null;
  if (sel) {
    nsel = { w, h, data: new Uint8Array(w * h) };
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const X = xx + x,
          Y = yy + y;
        if (X >= 0 && Y >= 0 && X < d.width && Y < d.height) nsel.data[yy * w + xx] = sel.data[Y * d.width + X]!;
      }
  }
  const next = withSelection({ ...d, width: w, height: h, layers, channels: d.channels.map((c) => ({ ...c, raster: c.raster.shifted(-x, -y) })), guides: d.guides.map((g) => ({ ...g, at: g.at - (g.axis === 'x' ? x : y) })) }, nsel);
  s.commit('Crop', 'crop', next);
  s.fitted = true;
  bump();
}

export function cropToSelection(): void {
  const s = current();
  const b = s?.doc.selection?.bounds;
  if (!s || !b) {
    toast('Make a selection to crop to.');
    return;
  }
  cropTo(b);
}

/** Trim transparent (or top-left colored) edges. */
export function trim(based: 'transparent' | 'topLeft' | 'bottomRight'): void {
  const s = current();
  if (!s) return;
  const px = flatten(s.doc, canvasRect(s.doc));
  const W = s.doc.width,
    H = s.doc.height;
  const ref = based === 'topLeft' ? 0 : (W * H - 1) * 4;
  const same = (i: number) =>
    based === 'transparent' ? px[i * 4 + 3]! <= 0.002 : Math.abs(px[i * 4]! - px[ref]!) < 0.004 && Math.abs(px[i * 4 + 1]! - px[ref + 1]!) < 0.004 && Math.abs(px[i * 4 + 2]! - px[ref + 2]!) < 0.004 && Math.abs(px[i * 4 + 3]! - px[ref + 3]!) < 0.004;
  let x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (!same(y * W + x)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) {
    toast('There is nothing to trim to.');
    return;
  }
  cropTo({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
}

/** Reveal All: grow the canvas to show every layer's pixels. */
export function revealAll(): void {
  const s = current();
  if (!s) return;
  let r: Rect = canvasRect(s.doc);
  for (const l of allLayers(s.doc.layers)) {
    if (!('raster' in l)) continue;
    const b = l.raster.contentBounds();
    if (b) {
      const x = Math.min(r.x, b.x),
        y = Math.min(r.y, b.y);
      r = { x, y, w: Math.max(r.x + r.w, b.x + b.w) - x, h: Math.max(r.y + r.h, b.y + b.h) - y };
    }
  }
  if (r.x === 0 && r.y === 0 && r.w === s.doc.width && r.h === s.doc.height) return;
  cropTo(r, false);
}

// ---- mode ----

/** Image ▸ Mode: 8, 16 or 32 bits per channel. 32-bit documents are linear light. */
export function setDepth(depth: Depth): void {
  const s = current();
  if (!s || s.doc.depth === depth) return;
  const d = s.doc;
  const toLinear = depth === 32 && d.depth !== 32;
  const fromLinear = d.depth === 32 && depth !== 32;
  const trc = d.profile.trc;
  const conv = (r: Raster, isMask: boolean): Raster => {
    if (isMask) return r;
    if (!toLinear && !fromLinear) return r.convert(depth);
    const out = new Raster(depth, r.channels);
    const b = r.tileBounds();
    if (!b) return out;
    for (let y = b.y; y < b.y + b.h; y += 256) {
      const rr = { x: b.x, y, w: b.w, h: Math.min(256, b.y + b.h - y) };
      const px = r.read(rr);
      // A table keeps this fast.
      for (let i = 0; i < px.length; i++) {
        if ((i & 3) === 3) continue;
        px[i] = toLinear ? decode(trc, px[i]!) : encode(trc, Math.min(1, Math.max(0, px[i]!)));
      }
      out.write(rr, px, null, true);
    }
    out.prune();
    return out;
  };
  const convLayer = (l: Layer): Layer => {
    let out = mapRasters(l, conv);
    if (out.kind === 'group') out = { ...out, children: out.children.map(convLayer) };
    if (out.kind === 'text' || out.kind === 'shape' || out.kind === 'smart') out = { ...out, raster: conv(out.raster, false) } as Layer;
    if (out.kind === 'smart') out = { ...out, source: { ...out.source, raster: conv(out.source.raster, false) } };
    return out;
  };
  const next = { ...d, depth, layers: d.layers.map(convLayer) };
  s.commit(`${depth} Bits/Channel`, 'image', next);
  if (fromLinear) toast('Converted from linear 32-bit to the document’s tone curve (values above white are clipped).');
  bump();
}

/** Edit ▸ Convert to Profile: the colors stay the same, the numbers change. */
export function convertProfile(to: ColorProfile): void {
  const s = current();
  if (!s) return;
  const d = s.doc;
  const linear = d.depth === 32;
  const M = rgbToRgb(d.profile, to);
  const conv = (r: Raster, isMask: boolean): Raster => {
    if (isMask) return r;
    const out = new Raster(d.depth, r.channels);
    const b = r.tileBounds();
    if (!b) return out;
    for (let y = b.y; y < b.y + b.h; y += 256) {
      const rr = { x: b.x, y, w: b.w, h: Math.min(256, b.y + b.h - y) };
      const px = r.read(rr);
      for (let i = 0; i < px.length; i += 4) {
        if (linear) {
          const v = apply3(M, [px[i]!, px[i + 1]!, px[i + 2]!]);
          px[i] = v[0];
          px[i + 1] = v[1];
          px[i + 2] = v[2];
        } else {
          const v = convertColor([px[i]!, px[i + 1]!, px[i + 2]!], d.profile, to);
          px[i] = v[0];
          px[i + 1] = v[1];
          px[i + 2] = v[2];
        }
      }
      out.write(rr, px, null, true);
    }
    out.prune();
    return out;
  };
  const convLayer = (l: Layer): Layer => {
    let out = mapRasters(l, conv);
    if (out.kind === 'group') out = { ...out, children: out.children.map(convLayer) };
    if (out.kind === 'text' || out.kind === 'shape' || out.kind === 'smart') out = { ...out, raster: conv(out.raster, false) } as Layer;
    return out;
  };
  s.commit(`Convert to ${to.name}`, 'image', { ...d, profile: { ...to, icc: undefined }, layers: d.layers.map(convLayer) });
  bump();
}

/** Edit ▸ Assign Profile: the numbers stay, the colors they mean change. */
export function assignProfile(to: ColorProfile): void {
  change(`Assign ${to.name}`, 'image', (d) => ({ ...d, profile: to }));
}

export function duplicateDoc(name?: string): void {
  const s = current();
  if (!s) return;
  const d = s.doc;
  const copy: Doc = { ...d, id: uid('doc'), name: name ?? `${d.name} copy`, file: null, layers: d.layers.map((l) => l) };
  addSession(copy);
}

/** A float image of the composite (for filters that need the whole picture). */
export function compositeImg(d: Doc): { w: number; h: number; c: 4; data: Float32Array } {
  const px = flatten(d, canvasRect(d));
  return { w: d.width, h: d.height, c: 4, data: px };
}

export { mkImg };
