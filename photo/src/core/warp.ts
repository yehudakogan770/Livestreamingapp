// Geometry for transforms and warps: projective (perspective) mapping with
// homographies from four corners, mesh warps drawn as triangles (Warp,
// Puppet Warp, Perspective Warp), and displacement fields (Liquify).

import { resize, type Img } from './img';
import type { Rect } from './types';

export type Mat3 = number[];

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as number[];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j]! += a[i * 3 + k]! * b[k * 3 + j]!;
  return r;
}

export function mat3Inv(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

export function mapPoint(m: Mat3, x: number, y: number): [number, number] {
  const w = m[6]! * x + m[7]! * y + m[8]!;
  return [(m[0]! * x + m[1]! * y + m[2]!) / w, (m[3]! * x + m[4]! * y + m[5]!) / w];
}

/** The homography taking the unit square's corners (0,0),(1,0),(1,1),(0,1) to four points. */
function squareToQuad(q: number[]): Mat3 {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = q as [number, number, number, number, number, number, number, number];
  const dx1 = x1 - x2,
    dx2 = x3 - x2,
    dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2,
    dy2 = y3 - y2,
    dy3 = y0 - y1 + y2 - y3;
  if (Math.abs(dx3) < 1e-10 && Math.abs(dy3) < 1e-10) return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1];
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

/** The homography taking quad `from` (4 points: TL, TR, BR, BL) to quad `to`. */
export function quadToQuad(from: number[], to: number[]): Mat3 | null {
  const a = squareToQuad(from),
    b = squareToQuad(to);
  const ai = mat3Inv(a);
  return ai ? mat3Mul(b, ai) : null;
}

/** Rectangle (x, y, w, h) to a quad. */
export function rectToQuad(r: Rect, to: number[]): Mat3 | null {
  return quadToQuad([r.x, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.x, r.y + r.h], to);
}

/** Scale of a projective map near a point (for choosing whether to prefilter). */
function localScale(m: Mat3, x: number, y: number): number {
  const [a, b] = mapPoint(m, x, y);
  const [c, d] = mapPoint(m, x + 1, y);
  const [e, f] = mapPoint(m, x, y + 1);
  return Math.sqrt(Math.abs((c - a) * (f - b) - (e - a) * (d - b)));
}

/**
 * Draw `img` through a projective matrix (source pixels → document) into the
 * area it covers (within `clip`). Shrinking more than 25 % prefilters first.
 */
export function warpProjective(img: Img, M: Mat3, clip: Rect, quality: 'bilinear' | 'bicubic' = 'bilinear'): { rect: Rect | null; data: Float32Array } {
  let src = img;
  let m = M;
  const scale = localScale(M, img.w / 2, img.h / 2);
  if (scale < 0.75 && img.w > 2 && img.h > 2) {
    const k = Math.max(scale * 1.3, 2 / Math.min(img.w, img.h));
    const nw = Math.max(1, Math.round(img.w * k)),
      nh = Math.max(1, Math.round(img.h * k));
    src = resize(img, nw, nh, 'bicubic');
    m = mat3Mul(M, [img.w / nw, 0, 0, 0, img.h / nh, 0, 0, 0, 1]);
  }
  const corners = [mapPoint(m, 0, 0), mapPoint(m, src.w, 0), mapPoint(m, src.w, src.h), mapPoint(m, 0, src.h)];
  const xs = corners.map((c) => c[0]),
    ys = corners.map((c) => c[1]);
  const x0 = Math.max(clip.x, Math.floor(Math.min(...xs))),
    y0 = Math.max(clip.y, Math.floor(Math.min(...ys)));
  const x1 = Math.min(clip.x + clip.w, Math.ceil(Math.max(...xs))),
    y1 = Math.min(clip.y + clip.h, Math.ceil(Math.max(...ys)));
  if (!(x1 > x0 && y1 > y0) || !Number.isFinite(x0 + x1 + y0 + y1)) return { rect: null, data: new Float32Array(0) };
  const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const inv = mat3Inv(m);
  const out = new Float32Array(rect.w * rect.h * 4);
  if (!inv) return { rect, data: out };
  const sd = src.data,
    sw = src.w,
    sh = src.h;
  const tmp = [0, 0, 0, 0];
  for (let y = 0; y < rect.h; y++) {
    const py = y0 + y + 0.5;
    for (let x = 0; x < rect.w; x++) {
      const px = x0 + x + 0.5;
      const w = inv[6]! * px + inv[7]! * py + inv[8]!;
      if (w <= 0) continue;
      const sx = (inv[0]! * px + inv[1]! * py + inv[2]!) / w,
        sy = (inv[3]! * px + inv[4]! * py + inv[5]!) / w;
      if (sx < -1 || sy < -1 || sx > sw + 1 || sy > sh + 1) continue;
      if (quality === 'bicubic') sampleBicubic(sd, sw, sh, sx, sy, tmp);
      else sampleEdge(sd, sw, sh, sx, sy, tmp);
      const o = (y * rect.w + x) * 4;
      out[o] = tmp[0]!;
      out[o + 1] = tmp[1]!;
      out[o + 2] = tmp[2]!;
      out[o + 3] = tmp[3]!;
    }
  }
  return { rect, data: out };
}

/** Bilinear with transparency outside (premultiplied). */
export function sampleEdge(d: Float32Array, w: number, h: number, x: number, y: number, out: number[]): void {
  x -= 0.5;
  y -= 0.5;
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const fx = x - x0,
    fy = y - y0;
  let r = 0,
    g = 0,
    b = 0,
    a = 0;
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 2; i++) {
      const xx = x0 + i,
        yy = y0 + j;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const wt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
      const o = (yy * w + xx) * 4;
      const al = d[o + 3]! * wt;
      r += d[o]! * al;
      g += d[o + 1]! * al;
      b += d[o + 2]! * al;
      a += al;
    }
  if (a > 1e-6) {
    out[0] = r / a;
    out[1] = g / a;
    out[2] = b / a;
  } else out[0] = out[1] = out[2] = 0;
  out[3] = a;
}

function cubic(t: number): number {
  t = Math.abs(t);
  if (t <= 1) return 1.5 * t * t * t - 2.5 * t * t + 1;
  if (t < 2) return -0.5 * t * t * t + 2.5 * t * t - 4 * t + 2;
  return 0;
}

export function sampleBicubic(d: Float32Array, w: number, h: number, x: number, y: number, out: number[]): void {
  x -= 0.5;
  y -= 0.5;
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  let r = 0,
    g = 0,
    b = 0,
    a = 0,
    ws = 0;
  for (let j = -1; j <= 2; j++)
    for (let i = -1; i <= 2; i++) {
      const xx = x0 + i,
        yy = y0 + j;
      const wt = cubic(x - xx) * cubic(y - yy);
      ws += wt;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const o = (yy * w + xx) * 4;
      const al = d[o + 3]! * wt;
      r += d[o]! * al;
      g += d[o + 1]! * al;
      b += d[o + 2]! * al;
      a += al;
    }
  if (a > 1e-6) {
    out[0] = Math.max(0, r / a);
    out[1] = Math.max(0, g / a);
    out[2] = Math.max(0, b / a);
  } else out[0] = out[1] = out[2] = 0;
  out[3] = Math.min(1, Math.max(0, a / (ws || 1)));
}

/**
 * A mesh warp: `cols × rows` grid of destination points (document pixels)
 * for evenly spaced source points over the image. Drawn as triangles, each
 * mapped affinely (fine meshes look smooth).
 */
export function warpMesh(img: Img, cols: number, rows: number, dst: number[], clip: Rect): { rect: Rect | null; data: Float32Array } {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = 0; i < dst.length; i += 2) {
    x0 = Math.min(x0, dst[i]!);
    x1 = Math.max(x1, dst[i]!);
    y0 = Math.min(y0, dst[i + 1]!);
    y1 = Math.max(y1, dst[i + 1]!);
  }
  const rx0 = Math.max(clip.x, Math.floor(x0)),
    ry0 = Math.max(clip.y, Math.floor(y0));
  const rx1 = Math.min(clip.x + clip.w, Math.ceil(x1)),
    ry1 = Math.min(clip.y + clip.h, Math.ceil(y1));
  if (rx1 <= rx0 || ry1 <= ry0) return { rect: null, data: new Float32Array(0) };
  const rect = { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 };
  const out = new Float32Array(rect.w * rect.h * 4);
  const tmp = [0, 0, 0, 0];
  const P = (c: number, r: number) => [dst[(r * cols + c) * 2]!, dst[(r * cols + c) * 2 + 1]!];
  const S = (c: number, r: number) => [(c / (cols - 1)) * img.w, (r / (rows - 1)) * img.h];
  const tri = (a: number[], b: number[], c: number[], sa: number[], sb: number[], sc: number[]) => {
    const minX = Math.max(rect.x, Math.floor(Math.min(a[0]!, b[0]!, c[0]!))),
      maxX = Math.min(rect.x + rect.w - 1, Math.ceil(Math.max(a[0]!, b[0]!, c[0]!)));
    const minY = Math.max(rect.y, Math.floor(Math.min(a[1]!, b[1]!, c[1]!))),
      maxY = Math.min(rect.y + rect.h - 1, Math.ceil(Math.max(a[1]!, b[1]!, c[1]!)));
    const den = (b[1]! - c[1]!) * (a[0]! - c[0]!) + (c[0]! - b[0]!) * (a[1]! - c[1]!);
    if (Math.abs(den) < 1e-9) return;
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5,
          py = y + 0.5;
        const l1 = ((b[1]! - c[1]!) * (px - c[0]!) + (c[0]! - b[0]!) * (py - c[1]!)) / den;
        const l2 = ((c[1]! - a[1]!) * (px - c[0]!) + (a[0]! - c[0]!) * (py - c[1]!)) / den;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const sx = l1 * sa[0]! + l2 * sb[0]! + l3 * sc[0]!,
          sy = l1 * sa[1]! + l2 * sb[1]! + l3 * sc[1]!;
        sampleEdge(img.data, img.w, img.h, sx, sy, tmp);
        const o = ((y - rect.y) * rect.w + (x - rect.x)) * 4;
        // Folded meshes: keep the more opaque.
        if (tmp[3]! >= out[o + 3]!) {
          out[o] = tmp[0]!;
          out[o + 1] = tmp[1]!;
          out[o + 2] = tmp[2]!;
          out[o + 3] = tmp[3]!;
        }
      }
  };
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const a = P(c, r),
        b = P(c + 1, r),
        cc = P(c + 1, r + 1),
        d = P(c, r + 1);
      tri(a, b, cc, S(c, r), S(c + 1, r), S(c + 1, r + 1));
      tri(a, cc, d, S(c, r), S(c + 1, r + 1), S(c, r + 1));
    }
  return { rect, data: out };
}

/** Evaluate a 4×4 Bézier patch (16 control points, row-major, x/y pairs) at (u, v). */
export function bezierPatch(cp: number[], u: number, v: number): [number, number] {
  const B = (t: number) => [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3];
  const bu = B(u),
    bv = B(v);
  let x = 0,
    y = 0;
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      const w = bu[i]! * bv[j]!;
      x += cp[(j * 4 + i) * 2]! * w;
      y += cp[(j * 4 + i) * 2 + 1]! * w;
    }
  return [x, y];
}

/** A dense mesh from a Bézier patch (for the Warp transform). */
export function patchMesh(cp: number[], n = 32): number[] {
  const out: number[] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const [x, y] = bezierPatch(cp, i / n, j / n);
      out.push(x, y);
    }
  return out;
}

/** Apply a displacement field (Liquify): out(p) = src(p + d(p)). */
export function displace(img: Img, dx: Float32Array, dy: Float32Array): Img {
  const out = { w: img.w, h: img.h, c: 4 as const, data: new Float32Array(img.w * img.h * 4) };
  const tmp = [0, 0, 0, 0];
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const i = y * img.w + x;
      if (dx[i] === 0 && dy[i] === 0) {
        out.data.set(img.data.subarray(i * 4, i * 4 + 4), i * 4);
        continue;
      }
      sampleEdge(img.data, img.w, img.h, x + 0.5 + dx[i]!, y + 0.5 + dy[i]!, tmp);
      out.data[i * 4] = tmp[0]!;
      out.data[i * 4 + 1] = tmp[1]!;
      out.data[i * 4 + 2] = tmp[2]!;
      out.data[i * 4 + 3] = tmp[3]!;
    }
  return out;
}
