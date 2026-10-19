// Float images (straight alpha, 0..1, 1 or 4 channels): what filters,
// selections and the CPU compositor work on. Includes the blurs everything
// else builds on and resampling.

export interface Img {
  w: number;
  h: number;
  c: 1 | 4;
  data: Float32Array;
}

export const img = (w: number, h: number, c: 1 | 4 = 4, data?: Float32Array): Img => ({ w, h, c, data: data ?? new Float32Array(w * h * c) });

export const cloneImg = (a: Img): Img => ({ w: a.w, h: a.h, c: a.c, data: a.data.slice() });

/** Gaussian kernel (normalized) for a standard deviation. */
export function gaussKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(r * 2 + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i]! /= sum;
  return k;
}

/**
 * Blur each channel along rows (dir 0) or columns (dir 1) with a kernel,
 * edges clamped. Colors are weighted by alpha (premultiplied) so transparent
 * pixels don't darken edges.
 */
function convolve1D(src: Img, k: Float32Array, dir: 0 | 1, premul: boolean): Img {
  const { w, h, c } = src;
  const out = img(w, h, c);
  const r = (k.length - 1) >> 1;
  const s = src.data,
    d = out.data;
  const n = dir === 0 ? w : h;
  const lines = dir === 0 ? h : w;
  const buf = new Float32Array(n * c);
  for (let line = 0; line < lines; line++) {
    // Gather the line.
    for (let i = 0; i < n; i++) {
      const p = (dir === 0 ? line * w + i : i * w + line) * c;
      if (c === 4 && premul) {
        const a = s[p + 3]!;
        buf[i * 4] = s[p]! * a;
        buf[i * 4 + 1] = s[p + 1]! * a;
        buf[i * 4 + 2] = s[p + 2]! * a;
        buf[i * 4 + 3] = a;
      } else for (let ch = 0; ch < c; ch++) buf[i * c + ch] = s[p + ch]!;
    }
    for (let i = 0; i < n; i++) {
      const p = (dir === 0 ? line * w + i : i * w + line) * c;
      for (let ch = 0; ch < c; ch++) {
        let acc = 0;
        for (let j = -r; j <= r; j++) {
          let q = i + j;
          if (q < 0) q = 0;
          else if (q >= n) q = n - 1;
          acc += buf[q * c + ch]! * k[j + r]!;
        }
        d[p + ch] = acc;
      }
    }
    if (c === 4 && premul) {
      for (let i = 0; i < n; i++) {
        const p = (dir === 0 ? line * w + i : i * w + line) * 4;
        const a = d[p + 3]!;
        if (a > 1e-6) {
          d[p] = d[p]! / a;
          d[p + 1] = d[p + 1]! / a;
          d[p + 2] = d[p + 2]! / a;
        } else d[p] = d[p + 1] = d[p + 2] = 0;
      }
    }
  }
  return out;
}

/** Running-sum box blur of radius r along one direction (premultiplied for RGBA). */
function boxPass(src: Float32Array, w: number, h: number, c: number, r: number, dir: 0 | 1): Float32Array {
  const out = new Float32Array(src.length);
  const n = dir === 0 ? w : h;
  const lines = dir === 0 ? h : w;
  const stride = dir === 0 ? c : w * c;
  const inv = 1 / (2 * r + 1);
  for (let line = 0; line < lines; line++) {
    const base = dir === 0 ? line * w * c : line * c;
    for (let ch = 0; ch < c; ch++) {
      let acc = 0;
      const at = (i: number) => src[base + Math.min(n - 1, Math.max(0, i)) * stride + ch]!;
      for (let j = -r; j <= r; j++) acc += at(j);
      for (let i = 0; i < n; i++) {
        out[base + i * stride + ch] = acc * inv;
        acc += at(i + r + 1) - at(i - r);
      }
    }
  }
  return out;
}

/** Box blur (radius in pixels). */
export function boxBlur(a: Img, r: number): Img {
  r = Math.round(r);
  if (r < 1) return cloneImg(a);
  const pm = premultiply(a);
  let d = boxPass(pm.data, a.w, a.h, a.c, r, 0);
  d = boxPass(d, a.w, a.h, a.c, r, 1);
  return unpremultiply({ ...a, data: d });
}

/** Box radii for n passes approximating a Gaussian of `sigma` (Kovesi). */
function boxesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(((i < m ? wl : wu) - 1) / 2);
  return sizes;
}

export function premultiply(a: Img): Img {
  if (a.c !== 4) return { ...a, data: a.data.slice() };
  const d = a.data.slice();
  for (let i = 0; i < d.length; i += 4) {
    const al = d[i + 3]!;
    d[i] = d[i]! * al;
    d[i + 1] = d[i + 1]! * al;
    d[i + 2] = d[i + 2]! * al;
  }
  return { ...a, data: d };
}

export function unpremultiply(a: Img): Img {
  if (a.c !== 4) return a;
  const d = a.data;
  for (let i = 0; i < d.length; i += 4) {
    const al = d[i + 3]!;
    if (al > 1e-6) {
      d[i] = d[i]! / al;
      d[i + 1] = d[i + 1]! / al;
      d[i + 2] = d[i + 2]! / al;
    } else d[i] = d[i + 1] = d[i + 2] = 0;
  }
  return a;
}

/**
 * Gaussian blur. Small radii use the exact kernel; large ones three box
 * passes (indistinguishable, and fast at any size). `radius` is Photoshop's
 * Radius, the standard deviation in pixels.
 */
export function gaussianBlur(a: Img, radius: number): Img {
  if (radius <= 0.05) return cloneImg(a);
  if (radius <= 6) {
    const k = gaussKernel(radius);
    return convolve1D(convolve1D(a, k, 0, true), k, 1, true);
  }
  const boxes = boxesForGauss(radius, 3);
  const pm = premultiply(a);
  let d = pm.data;
  for (const r of boxes) d = boxPass(d, a.w, a.h, a.c, Math.round(r), 0);
  for (const r of boxes) d = boxPass(d, a.w, a.h, a.c, Math.round(r), 1);
  return unpremultiply({ ...a, data: d });
}

/** Separable blur with a given 1D kernel (both directions). */
export function blurWithKernel(a: Img, k: Float32Array): Img {
  return convolve1D(convolve1D(a, k, 0, true), k, 1, true);
}

/** Bilinear sample (edges clamped) into out (c channels). */
export function sampleBilinear(a: Img, x: number, y: number, out: number[] | Float32Array, o = 0): void {
  const { w, h, c, data } = a;
  x -= 0.5;
  y -= 0.5;
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const fx = x - x0,
    fy = y - y0;
  const cx0 = Math.min(w - 1, Math.max(0, x0)),
    cx1 = Math.min(w - 1, Math.max(0, x0 + 1));
  const cy0 = Math.min(h - 1, Math.max(0, y0)),
    cy1 = Math.min(h - 1, Math.max(0, y0 + 1));
  const p00 = (cy0 * w + cx0) * c,
    p10 = (cy0 * w + cx1) * c,
    p01 = (cy1 * w + cx0) * c,
    p11 = (cy1 * w + cx1) * c;
  if (c === 4) {
    // Premultiplied so transparent neighbours don't bleed color.
    const a00 = data[p00 + 3]! * (1 - fx) * (1 - fy),
      a10 = data[p10 + 3]! * fx * (1 - fy),
      a01 = data[p01 + 3]! * (1 - fx) * fy,
      a11 = data[p11 + 3]! * fx * fy;
    const al = a00 + a10 + a01 + a11;
    for (let ch = 0; ch < 3; ch++)
      out[o + ch] = al > 1e-6 ? (data[p00 + ch]! * a00 + data[p10 + ch]! * a10 + data[p01 + ch]! * a01 + data[p11 + ch]! * a11) / al : 0;
    out[o + 3] = al;
  } else {
    out[o] = data[p00]! * (1 - fx) * (1 - fy) + data[p10]! * fx * (1 - fy) + data[p01]! * (1 - fx) * fy + data[p11]! * fx * fy;
  }
}

/** Sample with transparent outside the image (for transforms). */
export function sampleBilinearBorder(a: Img, x: number, y: number, out: number[] | Float32Array, o = 0): void {
  if (x < -0.5 || y < -0.5 || x > a.w + 0.5 || y > a.h + 0.5) {
    for (let ch = 0; ch < a.c; ch++) out[o + ch] = 0;
    return;
  }
  sampleBilinear(a, x, y, out, o);
  // Fade the half pixel at the border.
  const ex = Math.min(1, Math.max(0, x + 0.5), Math.max(0, a.w + 0.5 - x));
  const ey = Math.min(1, Math.max(0, y + 0.5), Math.max(0, a.h + 0.5 - y));
  const e = Math.min(ex, ey);
  if (a.c === 4) out[o + 3] = out[o + 3]! * e;
  else out[o] = out[o]! * e;
}

/** Bicubic weight (Catmull-Rom-ish, a = −0.5). */
function cubicW(t: number): number {
  t = Math.abs(t);
  const a = -0.5;
  if (t <= 1) return (a + 2) * t * t * t - (a + 3) * t * t + 1;
  if (t < 2) return a * t * t * t - 5 * a * t * t + 8 * a * t - 4 * a;
  return 0;
}

function lanczosW(t: number, a = 3): number {
  if (t === 0) return 1;
  if (Math.abs(t) >= a) return 0;
  const p = Math.PI * t;
  return (a * Math.sin(p) * Math.sin(p / a)) / (p * p);
}

export type Resample = 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';

/** Resize with a separable filter (area-aware when shrinking). */
export function resize(a: Img, w: number, h: number, method: Resample = 'bicubic'): Img {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (method === 'nearest') {
    const out = img(w, h, a.c);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(a.h - 1, Math.floor(((y + 0.5) * a.h) / h));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(a.w - 1, Math.floor(((x + 0.5) * a.w) / w));
        for (let ch = 0; ch < a.c; ch++) out.data[(y * w + x) * a.c + ch] = a.data[(sy * a.w + sx) * a.c + ch]!;
      }
    }
    return out;
  }
  const kernel = method === 'bilinear' ? (t: number) => Math.max(0, 1 - Math.abs(t)) : method === 'lanczos' ? (t: number) => lanczosW(t) : cubicW;
  const support = method === 'bilinear' ? 1 : method === 'lanczos' ? 3 : 2;
  const pm = premultiply(a);
  const pass = (src: Float32Array, sw: number, sh: number, dw: number, dir: 0 | 1): Float32Array => {
    const c = a.c;
    const n = dir === 0 ? sw : sh;
    const lines = dir === 0 ? sh : sw;
    const outW = dir === 0 ? dw : sw;
    const outH = dir === 0 ? sh : dw;
    const out = new Float32Array(outW * outH * c);
    const scale = dw / n;
    const fscale = Math.min(1, scale);
    const sup = support / fscale;
    // Precompute weights per output position.
    const wts: { start: number; w: Float32Array }[] = [];
    for (let i = 0; i < dw; i++) {
      const center = (i + 0.5) / scale - 0.5;
      const start = Math.floor(center - sup) + 1;
      const end = Math.floor(center + sup);
      const ws = new Float32Array(end - start + 1);
      let sum = 0;
      for (let j = start; j <= end; j++) {
        const v = kernel((j - center) * fscale);
        ws[j - start] = v;
        sum += v;
      }
      if (sum !== 0) for (let j = 0; j < ws.length; j++) ws[j]! /= sum;
      wts.push({ start, w: ws });
    }
    for (let line = 0; line < lines; line++) {
      for (let i = 0; i < dw; i++) {
        const { start, w: ws } = wts[i]!;
        const op = (dir === 0 ? line * outW + i : i * outW + line) * c;
        for (let ch = 0; ch < c; ch++) {
          let acc = 0;
          for (let j = 0; j < ws.length; j++) {
            const q = Math.min(n - 1, Math.max(0, start + j));
            const ip = (dir === 0 ? line * sw + q : q * sw + line) * c;
            acc += src[ip + ch]! * ws[j]!;
          }
          out[op + ch] = acc;
        }
      }
    }
    return out;
  };
  const d1 = pass(pm.data, a.w, a.h, w, 0);
  const d2 = pass(d1, w, a.h, h, 1);
  const out = { w, h, c: a.c, data: d2 } as Img;
  // Ringing can push values a little out of range.
  if (a.c === 4) for (let i = 3; i < d2.length; i += 4) d2[i] = Math.min(1, Math.max(0, d2[i]!));
  unpremultiply(out);
  if (method !== 'bilinear') for (let i = 0; i < d2.length; i++) if (d2[i]! < 0) d2[i] = 0;
  return out;
}

/** Luminance (Rec. 709 weights) as a 1-channel image. */
export function luminance(a: Img): Img {
  const out = img(a.w, a.h, 1);
  for (let i = 0, j = 0; j < out.data.length; i += a.c, j++)
    out.data[j] = a.c === 1 ? a.data[i]! : 0.2126 * a.data[i]! + 0.7152 * a.data[i + 1]! + 0.0722 * a.data[i + 2]!;
  return out;
}

export function cropImg(a: Img, x: number, y: number, w: number, h: number): Img {
  const out = img(w, h, a.c);
  for (let yy = 0; yy < h; yy++) {
    const sy = y + yy;
    if (sy < 0 || sy >= a.h) continue;
    for (let xx = 0; xx < w; xx++) {
      const sx = x + xx;
      if (sx < 0 || sx >= a.w) continue;
      for (let ch = 0; ch < a.c; ch++) out.data[(yy * w + xx) * a.c + ch] = a.data[(sy * a.w + sx) * a.c + ch]!;
    }
  }
  return out;
}

/** 8-bit RGBA (canvas) from a float image (straight alpha). */
export function toRGBA8(a: Img): Uint8ClampedArray {
  const out = new Uint8ClampedArray(a.w * a.h * 4);
  if (a.c === 1) {
    for (let i = 0; i < a.w * a.h; i++) {
      const v = a.data[i]! * 255;
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  for (let i = 0; i < out.length; i++) out[i] = a.data[i]! * 255 + 0.5;
  return out;
}

export function fromRGBA8(w: number, h: number, data: Uint8ClampedArray | Uint8Array): Img {
  const out = img(w, h, 4);
  for (let i = 0; i < data.length; i++) out.data[i] = data[i]! / 255;
  return out;
}
