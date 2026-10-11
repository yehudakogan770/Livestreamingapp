// Selections: an 8-bit coverage mask the size of the document (0 outside,
// 255 inside, in between at soft edges). Kept as a 1-channel raster in the
// document (fully selected tiles share one tile, so a big rectangle costs
// almost nothing) and worked on here as dense arrays.
//
// Shapes are drawn with antialiasing (4 sub-rows per row, exact horizontal
// coverage); the rest are the Select menu's commands, the Magic Wand, Color
// Range, Quick Selection and Refine Edge (a guided filter).

import { Raster, TILE, tileKey, nextVersion, type Tile } from './raster';
import type { Rect } from './types';
import { flatten, type VectorPath } from './path';
import { gaussianBlur, img } from './img';

export interface Mask {
  w: number;
  h: number;
  data: Uint8Array;
}

export type SelectOp = 'replace' | 'add' | 'subtract' | 'intersect';

export const emptyMask = (w: number, h: number): Mask => ({ w, h, data: new Uint8Array(w * h) });

// ---- raster ↔ dense ----

let FULL: Tile | null = null;
/** One shared tile of 255s (never changed). */
function fullTile(): Tile {
  if (!FULL) {
    const d = new Uint8Array(TILE * TILE);
    d.fill(255);
    FULL = { data: d, v: nextVersion() };
  }
  return FULL;
}

export function maskToRaster(m: Mask): Raster {
  const r = new Raster(8, 1);
  const tw = Math.ceil(m.w / TILE),
    th = Math.ceil(m.h / TILE);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const x0 = tx * TILE,
        y0 = ty * TILE;
      const x1 = Math.min(m.w, x0 + TILE),
        y1 = Math.min(m.h, y0 + TILE);
      let any = false,
        full = x1 - x0 === TILE && y1 - y0 === TILE;
      for (let y = y0; y < y1 && (!any || full); y++) {
        const row = y * m.w;
        for (let x = x0; x < x1; x++) {
          const v = m.data[row + x]!;
          if (v) any = true;
          if (v !== 255) full = false;
        }
      }
      if (!any) continue;
      if (full) {
        r.tiles.set(tileKey(tx, ty), fullTile());
        continue;
      }
      const d = new Uint8Array(TILE * TILE);
      for (let y = y0; y < y1; y++) d.set(m.data.subarray(y * m.w + x0, y * m.w + x1), (y - y0) * TILE);
      r.tiles.set(tileKey(tx, ty), { data: d, v: nextVersion() });
    }
  }
  return r;
}

export function rasterToMask(r: Raster, w: number, h: number): Mask {
  const m = emptyMask(w, h);
  for (const [k, t] of r.tiles) {
    const tx = Math.floor(k / 65536) - 32768,
      ty = (k % 65536) - 32768;
    const x0 = tx * TILE,
      y0 = ty * TILE;
    if (x0 >= w || y0 >= h || x0 + TILE <= 0 || y0 + TILE <= 0) continue;
    const scale = r.depth === 8 ? 1 : r.depth === 16 ? 255 / 65535 : 255;
    for (let y = Math.max(0, y0); y < Math.min(h, y0 + TILE); y++) {
      for (let x = Math.max(0, x0); x < Math.min(w, x0 + TILE); x++) {
        const v = t.data[(y - y0) * TILE + (x - x0)]!;
        m.data[y * w + x] = scale === 1 ? v : Math.round(Math.min(255, Math.max(0, v * scale)));
      }
    }
  }
  return m;
}

export function maskBounds(m: Mask): Rect | null {
  let x0 = m.w,
    y0 = m.h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < m.h; y++) {
    const row = y * m.w;
    let any = false;
    for (let x = 0; x < m.w; x++) {
      if (m.data[row + x]) {
        any = true;
        if (x < x0) x0 = x;
        break;
      }
    }
    if (!any) continue;
    for (let x = m.w - 1; x >= 0; x--) {
      if (m.data[row + x]) {
        if (x > x1) x1 = x;
        break;
      }
    }
    if (y < y0) y0 = y;
    y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function isEmptyMask(m: Mask): boolean {
  for (let i = 0; i < m.data.length; i++) if (m.data[i]) return false;
  return true;
}

// ---- drawing shapes ----

/**
 * Fill polygons (flat point lists) into a coverage mask with antialiasing.
 * Nonzero winding unless `evenOdd`.
 */
export function fillPolygons(w: number, h: number, polys: number[][], antialias = true, evenOdd = false): Mask {
  const m = emptyMask(w, h);
  const SUB = antialias ? 4 : 1;
  // Edges.
  const edges: { x0: number; y0: number; x1: number; y1: number; dir: number }[] = [];
  let minY = Infinity,
    maxY = -Infinity;
  for (const p of polys) {
    const n = p.length / 2;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const ax = p[i * 2]!,
        ay = p[i * 2 + 1]!;
      const bx = p[((i + 1) % n) * 2]!,
        by = p[((i + 1) % n) * 2 + 1]!;
      if (ay === by) continue;
      if (ay < by) edges.push({ x0: ax, y0: ay, x1: bx, y1: by, dir: 1 });
      else edges.push({ x0: bx, y0: by, x1: ax, y1: ay, dir: -1 });
      minY = Math.min(minY, ay, by);
      maxY = Math.max(maxY, ay, by);
    }
  }
  if (!edges.length) return m;
  const yStart = Math.max(0, Math.floor(minY)),
    yEnd = Math.min(h - 1, Math.ceil(maxY));
  const acc = new Float32Array(w + 2);
  const xs: { x: number; dir: number }[] = [];
  edges.sort((a, b) => a.y0 - b.y0);
  for (let y = yStart; y <= yEnd; y++) {
    acc.fill(0);
    let touched = false;
    for (let s = 0; s < SUB; s++) {
      const sy = y + (s + 0.5) / SUB;
      xs.length = 0;
      for (const e of edges) {
        if (e.y0 > sy) break;
        if (sy >= e.y1) continue;
        const t = (sy - e.y0) / (e.y1 - e.y0);
        xs.push({ x: e.x0 + (e.x1 - e.x0) * t, dir: e.dir });
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a.x - b.x);
      let wind = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        wind = evenOdd ? wind ^ 1 : wind + xs[i]!.dir;
        if (wind === 0) continue;
        const xa = Math.max(0, xs[i]!.x),
          xb = Math.min(w, xs[i + 1]!.x);
        if (xb <= xa) continue;
        touched = true;
        const ia = Math.floor(xa),
          ib = Math.floor(xb);
        if (ia === ib) {
          acc[ia]! += (xb - xa) / SUB;
          continue;
        }
        acc[ia]! += (ia + 1 - xa) / SUB;
        for (let x = ia + 1; x < ib; x++) acc[x]! += 1 / SUB;
        if (ib < w) acc[ib]! += (xb - ib) / SUB;
      }
    }
    if (!touched) continue;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const v = acc[x]!;
      if (v > 0) m.data[row + x] = Math.min(255, Math.round(v * 255));
    }
  }
  if (!antialias) for (let i = 0; i < m.data.length; i++) m.data[i] = m.data[i]! >= 128 ? 255 : 0;
  return m;
}

export function rectMask(w: number, h: number, r: Rect, antialias = false): Mask {
  if (!antialias) {
    const m = emptyMask(w, h);
    const x0 = Math.max(0, Math.round(r.x)),
      y0 = Math.max(0, Math.round(r.y));
    const x1 = Math.min(w, Math.round(r.x + r.w)),
      y1 = Math.min(h, Math.round(r.y + r.h));
    for (let y = y0; y < y1; y++) m.data.fill(255, y * w + x0, y * w + x1);
    return m;
  }
  return fillPolygons(w, h, [[r.x, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.x, r.y + r.h]], true);
}

export function ellipseMask(w: number, h: number, r: Rect, antialias = true): Mask {
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2;
  const n = Math.max(32, Math.min(2048, Math.ceil((r.w + r.h) * 1.2)));
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(cx + (Math.cos(a) * r.w) / 2, cy + (Math.sin(a) * r.h) / 2);
  }
  return fillPolygons(w, h, [pts], antialias);
}

export function pathMask(w: number, h: number, p: VectorPath, antialias = true): Mask {
  // Each subpath combines with the ones before it.
  const subs = flatten(p, 0.25);
  if (subs.every((s) => !s.op || s.op === 'add')) return fillPolygons(w, h, subs.map((s) => s.pts), antialias, p.rule === 'evenodd');
  let acc: Mask | null = null;
  for (const s of subs) {
    const one = fillPolygons(w, h, [s.pts], antialias);
    if (!acc) acc = one;
    else if (s.op === 'exclude') {
      const out = emptyMask(w, h);
      for (let i = 0; i < out.data.length; i++) out.data[i] = Math.abs(acc.data[i]! - one.data[i]!);
      acc = out;
    } else acc = combine(acc, one, s.op === 'subtract' ? 'subtract' : s.op === 'intersect' ? 'intersect' : 'add');
  }
  return acc ?? emptyMask(w, h);
}

// ---- combining ----

export function combine(a: Mask, b: Mask, op: SelectOp): Mask {
  if (op === 'replace') return { ...b, data: b.data.slice() };
  const out = emptyMask(a.w, a.h);
  const A = a.data,
    B = b.data,
    O = out.data;
  for (let i = 0; i < O.length; i++) {
    const x = A[i]!,
      y = B[i]!;
    O[i] = op === 'add' ? (x > y ? x : y) : op === 'subtract' ? Math.round((x * (255 - y)) / 255) : x < y ? x : y;
  }
  return out;
}

export function invertMask(a: Mask): Mask {
  const out = emptyMask(a.w, a.h);
  for (let i = 0; i < out.data.length; i++) out.data[i] = 255 - a.data[i]!;
  return out;
}

export function allMask(w: number, h: number): Mask {
  const m = emptyMask(w, h);
  m.data.fill(255);
  return m;
}

/** Soften the edge (Select ▸ Modify ▸ Feather): a Gaussian of `radius` pixels. */
export function featherMask(a: Mask, radius: number): Mask {
  if (radius <= 0) return a;
  const f = img(a.w, a.h, 1);
  for (let i = 0; i < f.data.length; i++) f.data[i] = a.data[i]! / 255;
  const b = gaussianBlur(f, radius / 2);
  const out = emptyMask(a.w, a.h);
  for (let i = 0; i < out.data.length; i++) out.data[i] = Math.round(Math.min(1, Math.max(0, b.data[i]!)) * 255);
  return out;
}

/**
 * Exact squared Euclidean distance to the nearest "on" pixel (Felzenszwalb).
 * `on` decides which pixels are sources.
 */
export function distanceField(w: number, h: number, on: (i: number) => boolean): Float32Array {
  const INF = 1e20;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = on(i) ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n),
    z = new Float64Array(n + 1),
    v = new Int32Array(n),
    o = new Float64Array(n);
  const edt1 = (len: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) {
        k--;
        s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1]! < q) k++;
      o[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x]!;
    edt1(h);
    for (let y = 0; y < h; y++) d[y * w + x] = o[y]!;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x]!;
    edt1(w);
    for (let x = 0; x < w; x++) d[y * w + x] = o[x]!;
  }
  return d;
}

/** Expand (by > 0) or contract (by < 0) the selection by pixels, keeping a 1-pixel soft edge. */
export function growMask(a: Mask, by: number): Mask {
  if (by === 0) return a;
  const out = emptyMask(a.w, a.h);
  if (by > 0) {
    const d = distanceField(a.w, a.h, (i) => a.data[i]! >= 128);
    for (let i = 0; i < d.length; i++) {
      const dist = Math.sqrt(d[i]!);
      const v = Math.min(1, Math.max(0, by + 1 - dist));
      out.data[i] = Math.max(a.data[i]!, Math.round(v * 255));
    }
  } else {
    const r = -by;
    const d = distanceField(a.w, a.h, (i) => a.data[i]! < 128);
    for (let i = 0; i < d.length; i++) {
      const dist = Math.sqrt(d[i]!);
      const v = Math.min(1, Math.max(0, dist - r));
      out.data[i] = Math.min(a.data[i]!, Math.round(v * 255));
    }
  }
  return out;
}

/** A band of `width` pixels along the edge (Select ▸ Modify ▸ Border). */
export function borderMask(a: Mask, width: number): Mask {
  const outer = growMask(a, Math.ceil(width / 2));
  const inner = growMask(a, -Math.floor(width / 2));
  return featherMask(combine(outer, inner, 'subtract'), 1);
}

/** Round off corners and fill small holes (Select ▸ Modify ▸ Smooth). */
export function smoothMask(a: Mask, radius: number): Mask {
  const f = featherMask(a, radius * 2);
  const out = emptyMask(a.w, a.h);
  for (let i = 0; i < out.data.length; i++) {
    const v = f.data[i]!;
    // Re-sharpen around 50 %.
    out.data[i] = Math.round(Math.min(255, Math.max(0, (v - 128) * 4 + 128)));
  }
  return out;
}

// ---- picking by color ----

export interface ColorSource {
  w: number;
  h: number;
  /** RGBA floats 0..1. */
  data: Float32Array;
}

/**
 * Magic Wand: pixels within `tolerance` (0..255 levels, each channel) of the
 * clicked one; touching it (contiguous) or anywhere.
 */
export function magicWand(src: ColorSource, x: number, y: number, tolerance: number, contiguous = true, antialias = true): Mask {
  const { w, h, data } = src;
  const m = emptyMask(w, h);
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return m;
  const p = (y * w + x) * 4;
  const r0 = data[p]!,
    g0 = data[p + 1]!,
    b0 = data[p + 2]!,
    a0 = data[p + 3]!;
  const tol = tolerance / 255 + 1e-6;
  const near = (i: number) => {
    const q = i * 4;
    return Math.abs(data[q]! - r0) <= tol && Math.abs(data[q + 1]! - g0) <= tol && Math.abs(data[q + 2]! - b0) <= tol && Math.abs(data[q + 3]! - a0) <= tol;
  };
  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (near(i)) m.data[i] = 255;
  } else {
    // Scanline flood fill.
    const stack: number[] = [x, y];
    while (stack.length) {
      const sy = stack.pop()!,
        sx = stack.pop()!;
      let lx = sx;
      const row = sy * w;
      if (m.data[row + sx] || !near(row + sx)) continue;
      while (lx > 0 && !m.data[row + lx - 1] && near(row + lx - 1)) lx--;
      let rx = sx;
      while (rx < w - 1 && !m.data[row + rx + 1] && near(row + rx + 1)) rx++;
      for (let i = lx; i <= rx; i++) m.data[row + i] = 255;
      for (const ny of [sy - 1, sy + 1]) {
        if (ny < 0 || ny >= h) continue;
        const nrow = ny * w;
        let i = lx;
        while (i <= rx) {
          while (i <= rx && (m.data[nrow + i] || !near(nrow + i))) i++;
          if (i > rx) break;
          stack.push(i, ny);
          while (i <= rx && !m.data[nrow + i] && near(nrow + i)) i++;
        }
      }
    }
  }
  return antialias ? antialiasEdge(m) : m;
}

/** Soften a hard mask's stair steps by one pixel. */
export function antialiasEdge(m: Mask): Mask {
  const out = emptyMask(m.w, m.h);
  const { w, h, data } = m;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = data[i]!;
      const l = x > 0 ? data[i - 1]! : v,
        r = x < w - 1 ? data[i + 1]! : v,
        u = y > 0 ? data[i - w]! : v,
        d = y < h - 1 ? data[i + w]! : v;
      if (l === v && r === v && u === v && d === v) out.data[i] = v;
      else out.data[i] = Math.round((v * 4 + l + r + u + d) / 8);
    }
  }
  return out;
}

export type ColorRangeMode = 'sampled' | 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas' | 'highlights' | 'midtones' | 'shadows' | 'skin';

/**
 * Color Range: how close each pixel is to the sampled colors (fuzziness 0..200,
 * like Photoshop), or a preset range.
 */
export function colorRange(src: ColorSource, mode: ColorRangeMode, samples: [number, number, number][], fuzziness: number): Mask {
  const { w, h, data } = src;
  const m = emptyMask(w, h);
  const fz = Math.max(1, fuzziness) / 255;
  const hueOf = (r: number, g: number, b: number) => {
    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b);
    const d = mx - mn;
    if (d < 1e-6) return { hue: -1, sat: 0 };
    let hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh *= 60;
    return { hue: hh, sat: d };
  };
  const centers: Record<string, number> = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 };
  for (let i = 0; i < w * h; i++) {
    const q = i * 4;
    const r = data[q]!,
      g = data[q + 1]!,
      b = data[q + 2]!;
    let v = 0;
    if (mode === 'sampled') {
      for (const s of samples) {
        const d = Math.max(Math.abs(r - s[0]), Math.abs(g - s[1]), Math.abs(b - s[2]));
        const k = d <= fz * 0.5 ? 1 : d >= fz ? 0 : 1 - (d - fz * 0.5) / (fz * 0.5);
        if (k > v) v = k;
      }
    } else if (mode in centers) {
      const { hue, sat } = hueOf(r, g, b);
      if (hue >= 0) {
        let dd = Math.abs(hue - centers[mode]!);
        if (dd > 180) dd = 360 - dd;
        v = (dd <= 20 ? 1 : dd >= 45 ? 0 : 1 - (dd - 20) / 25) * Math.min(1, sat * 4);
      }
    } else {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      if (mode === 'highlights') v = l >= 0.75 ? 1 : l <= 0.6 ? 0 : (l - 0.6) / 0.15;
      else if (mode === 'shadows') v = l <= 0.25 ? 1 : l >= 0.4 ? 0 : (0.4 - l) / 0.15;
      else if (mode === 'midtones') v = Math.max(0, 1 - Math.abs(l - 0.5) / 0.25);
      else if (mode === 'skin') {
        const { hue, sat } = hueOf(r, g, b);
        const okHue = hue >= 0 && (hue <= 50 || hue >= 340);
        v = okHue && sat > 0.08 && sat < 0.7 && l > 0.15 && l < 0.95 ? 1 - Math.min(1, Math.abs((hue > 180 ? hue - 360 : hue) - 22) / 35) : 0;
      }
    }
    m.data[i] = Math.round(Math.max(0, Math.min(1, v)) * 255);
  }
  return m;
}

/**
 * Quick Selection: grows from the brushed seed pixels to neighbours of a
 * similar color, stopping at strong edges. Seeds are a mask; the region is
 * limited to `limit` pixels away from them.
 */
export function quickSelect(src: ColorSource, seeds: Mask, limit: number, sensitivity = 1): Mask {
  const { w, h, data } = src;
  // Seed color model: mean and spread.
  let n = 0;
  let m0 = 0,
    m1 = 0,
    m2 = 0;
  for (let i = 0; i < w * h; i++)
    if (seeds.data[i]! > 127) {
      m0 += data[i * 4]!;
      m1 += data[i * 4 + 1]!;
      m2 += data[i * 4 + 2]!;
      n++;
    }
  if (!n) return emptyMask(w, h);
  const mean = [m0 / n, m1 / n, m2 / n];
  let spread = 0;
  for (let i = 0; i < w * h; i++)
    if (seeds.data[i]! > 127) spread += (data[i * 4]! - mean[0]!) ** 2 + (data[i * 4 + 1]! - mean[1]!) ** 2 + (data[i * 4 + 2]! - mean[2]!) ** 2;
  spread = Math.sqrt(spread / n) + 0.06;
  // Geodesic growth (Dijkstra with a bucket queue): each step costs more across edges and away from the seed colors.
  const cost = new Float32Array(w * h).fill(Infinity);
  const BUCKETS = 2048;
  const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
  const scale = BUCKETS / (limit * 2.5);
  for (let i = 0; i < w * h; i++)
    if (seeds.data[i]! > 127) {
      cost[i] = 0;
      buckets[0]!.push(i);
    }
  const step = (a: number, b: number) => {
    const qa = a * 4,
      qb = b * 4;
    const edge = Math.abs(data[qa]! - data[qb]!) + Math.abs(data[qa + 1]! - data[qb + 1]!) + Math.abs(data[qa + 2]! - data[qb + 2]!);
    const far = Math.sqrt((data[qb]! - mean[0]!) ** 2 + (data[qb + 1]! - mean[1]!) ** 2 + (data[qb + 2]! - mean[2]!) ** 2) / spread;
    return 1 + edge * 60 * sensitivity + Math.max(0, far - 1) * 6 * sensitivity;
  };
  const maxCost = limit * 2.5;
  for (let bi = 0; bi < BUCKETS; bi++) {
    const bucket = buckets[bi]!;
    while (bucket.length) {
      const i = bucket.pop()!;
      const ci = cost[i]!;
      if (Math.floor(ci * scale) !== bi && ci * scale < bi) continue;
      const x = i % w,
        y = (i / w) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j < 0) continue;
        const c = ci + step(i, j);
        if (c < cost[j]! && c < maxCost) {
          cost[j] = c;
          const b = Math.min(BUCKETS - 1, Math.floor(c * scale));
          buckets[b]!.push(j);
        }
      }
    }
  }
  const out = emptyMask(w, h);
  const cut = limit * 1.2;
  for (let i = 0; i < w * h; i++) if (cost[i]! <= cut) out.data[i] = 255;
  return antialiasEdge(fillHoles(out, Math.max(16, limit * limit * 0.05)));
}

/** Fill enclosed holes smaller than `maxArea` pixels. */
export function fillHoles(m: Mask, maxArea: number): Mask {
  const { w, h, data } = m;
  const out = { w, h, data: data.slice() };
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const region: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (data[s] || seen[s]) continue;
    region.length = 0;
    let touchesEdge = false;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      region.push(i);
      const x = i % w,
        y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) if (j >= 0 && !data[j] && !seen[j]) (seen[j] = 1), stack.push(j);
    }
    if (!touchesEdge && region.length <= maxArea) for (const i of region) out.data[i] = 255;
  }
  return out;
}

// ---- Select and Mask ----

export interface RefineOptions {
  /** Edge detection radius: the band around the edge refined from the picture (pixels). */
  radius: number;
  smooth: number;
  feather: number;
  /** −1..1 */
  contrast: number;
  /** −1..1: move the edge in (−) or out (+), as a fraction of 10 pixels... see shiftEdge. */
  shiftEdge: number;
}

/**
 * Refine a selection's edge from the picture (He's guided filter, run on the
 * band around the edge): soft edges follow hair and fur in the image.
 */
export function refineEdge(src: ColorSource, m: Mask, o: RefineOptions): Mask {
  const { w, h } = m;
  let cur = m;
  if (o.smooth > 0) cur = smoothMask(cur, o.smooth);
  if (o.radius > 0) {
    const r = Math.max(1, Math.round(o.radius));
    const p = new Float32Array(w * h);
    for (let i = 0; i < p.length; i++) p[i] = cur.data[i]! / 255;
    const I = new Float32Array(w * h);
    for (let i = 0; i < I.length; i++) I[i] = 0.299 * src.data[i * 4]! + 0.587 * src.data[i * 4 + 1]! + 0.114 * src.data[i * 4 + 2]!;
    const q = guidedFilter(I, p, w, h, r, 1e-4);
    // Only inside the band near the original edge.
    const inner = growMask(cur, -r),
      outer = growMask(cur, r);
    const out = emptyMask(w, h);
    for (let i = 0; i < out.data.length; i++) {
      if (inner.data[i]! >= 255) out.data[i] = 255;
      else if (outer.data[i]! === 0) out.data[i] = 0;
      else out.data[i] = Math.round(Math.min(1, Math.max(0, q[i]!)) * 255);
    }
    cur = out;
  }
  if (o.feather > 0) cur = featherMask(cur, o.feather);
  if (o.contrast !== 0) {
    const k = o.contrast > 0 ? 1 / Math.max(0.02, 1 - o.contrast) : 1 + o.contrast;
    const out = emptyMask(w, h);
    for (let i = 0; i < out.data.length; i++) out.data[i] = Math.round(Math.min(255, Math.max(0, (cur.data[i]! - 127.5) * k + 127.5)));
    cur = out;
  }
  if (o.shiftEdge !== 0) {
    const px = o.shiftEdge * 10;
    cur = growMask(cur, Math.round(px));
  }
  return cur;
}

function boxMean(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h),
    out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += a[row + Math.min(w - 1, x + r + 1)]! - a[row + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}

/** He et al.'s guided filter (gray guide). */
export function guidedFilter(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h;
  const meanI = boxMean(I, w, h, r),
    meanP = boxMean(p, w, h, r);
  const IP = new Float32Array(n),
    II = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    IP[i] = I[i]! * p[i]!;
    II[i] = I[i]! * I[i]!;
  }
  const meanIP = boxMean(IP, w, h, r),
    meanII = boxMean(II, w, h, r);
  const a = new Float32Array(n),
    b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cov = meanIP[i]! - meanI[i]! * meanP[i]!;
    const v = meanII[i]! - meanI[i]! * meanI[i]!;
    a[i] = cov / (v + eps);
    b[i] = meanP[i]! - a[i]! * meanI[i]!;
  }
  const ma = boxMean(a, w, h, r),
    mb = boxMean(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i]! * I[i]! + mb[i]!;
  return q;
}

/** Outline of a mask at 50 % as closed polylines (for Make Work Path and vector masks). */
export function maskOutline(m: Mask, step = 1): number[][] {
  // Marching squares on a grid of `step` pixels.
  const { w, h, data } = m;
  const gw = Math.ceil(w / step) + 1,
    gh = Math.ceil(h / step) + 1;
  const val = (gx: number, gy: number) => {
    const x = Math.min(w - 1, gx * step),
      y = Math.min(h - 1, gy * step);
    if (gx * step >= w || gy * step >= h || gx < 0 || gy < 0) return 0;
    return data[y * w + x]! >= 128 ? 1 : 0;
  };
  const segs = new Map<string, [number, number, number, number][]>();
  const k = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const key = k(x0, y0);
    const list = segs.get(key) ?? [];
    list.push([x0, y0, x1, y1]);
    segs.set(key, list);
  };
  for (let gy = -1; gy < gh; gy++) {
    for (let gx = -1; gx < gw; gx++) {
      const a = val(gx, gy),
        b = val(gx + 1, gy),
        c = val(gx + 1, gy + 1),
        d = val(gx, gy + 1);
      const idx = a * 8 + b * 4 + c * 2 + d;
      if (idx === 0 || idx === 15) continue;
      const X = (gx + 0.5) * step,
        Y = (gy + 0.5) * step;
      const top: [number, number] = [X + step / 2, Y],
        right: [number, number] = [X + step, Y + step / 2],
        bottom: [number, number] = [X + step / 2, Y + step],
        left: [number, number] = [X, Y + step / 2];
      const S = (p: [number, number], q: [number, number]) => add(p[0], p[1], q[0], q[1]);
      switch (idx) {
        case 1: S(bottom, left); break;
        case 2: S(right, bottom); break;
        case 3: S(right, left); break;
        case 4: S(top, right); break;
        case 5: S(top, left); S(bottom, right); break;
        case 6: S(top, bottom); break;
        case 7: S(top, left); break;
        case 8: S(left, top); break;
        case 9: S(bottom, top); break;
        case 10: S(left, bottom); S(right, top); break;
        case 11: S(right, top); break;
        case 12: S(left, right); break;
        case 13: S(bottom, right); break;
        case 14: S(left, bottom); break;
      }
    }
  }
  const polys: number[][] = [];
  while (segs.size) {
    const [startKey, list] = segs.entries().next().value as [string, [number, number, number, number][]];
    const first = list.pop()!;
    if (!list.length) segs.delete(startKey);
    const pts = [first[0], first[1]];
    let cx = first[2],
      cy = first[3];
    for (let guard = 0; guard < 10_000_000; guard++) {
      pts.push(cx, cy);
      const key = k(cx, cy);
      const next = segs.get(key);
      if (!next || !next.length) break;
      const s = next.pop()!;
      if (!next.length) segs.delete(key);
      cx = s[2];
      cy = s[3];
    }
    if (pts.length >= 6) polys.push(pts);
  }
  return polys;
}

/**
 * Select ▸ Grow / Similar: pixels whose color is within `tolerance` (0..255)
 * of a color already selected; Grow only reaches neighbors of the selection,
 * Similar anywhere.
 */
export function growByColor(src: ColorSource, m: Mask, tolerance: number, contiguous: boolean): Mask {
  const { w, h, data } = src;
  const cell = Math.max(1, tolerance) / 255;
  const N = Math.ceil(1 / cell) + 1;
  const grid = new Uint8Array(N * N * N);
  const q = (v: number) => Math.min(N - 1, Math.floor(Math.min(1, Math.max(0, v)) / cell));
  for (let i = 0; i < w * h; i++) {
    if (m.data[i]! < 128) continue;
    grid[q(data[i * 4]!) * N * N + q(data[i * 4 + 1]!) * N + q(data[i * 4 + 2]!)] = 1;
  }
  const near = (i: number) => {
    const cr = q(data[i * 4]!),
      cg = q(data[i * 4 + 1]!),
      cb = q(data[i * 4 + 2]!);
    for (let a = Math.max(0, cr - 1); a <= Math.min(N - 1, cr + 1); a++)
      for (let c = Math.max(0, cg - 1); c <= Math.min(N - 1, cg + 1); c++)
        for (let d = Math.max(0, cb - 1); d <= Math.min(N - 1, cb + 1); d++) if (grid[a * N * N + c * N + d]) return true;
    return false;
  };
  const out = { w, h, data: m.data.slice() };
  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (out.data[i]! < 255 && near(i)) out.data[i] = 255;
    return antialiasEdge(out);
  }
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) if (m.data[i]! >= 128) stack.push(i);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w,
      y = (i / w) | 0;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of nb) {
      if (j < 0 || out.data[j]! >= 128) continue;
      if (!near(j)) continue;
      out.data[j] = 255;
      stack.push(j);
    }
  }
  return antialiasEdge(out);
}

/** Simplify a polyline (Ramer–Douglas–Peucker). */
export function simplify(pts: number[], tol: number): number[] {
  const n = pts.length / 2;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a * 2]!,
      ay = pts[a * 2 + 1]!,
      bx = pts[b * 2]!,
      by = pts[b * 2 + 1]!;
    const dx = bx - ax,
      dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    let best = -1,
      bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i * 2]! - ax) * dy - (pts[i * 2 + 1]! - ay) * dx) / len;
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2]!, pts[i * 2 + 1]!);
  return out;
}

/** Transform a selection (for Transform Selection and moving it): affine [a,b,c,d,e,f] applied to the mask. */
export function transformMask(m: Mask, mat: number[]): Mask {
  const [a, b, c, d, e, f] = mat as [number, number, number, number, number, number];
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) return emptyMask(m.w, m.h);
  const ia = d / det,
    ib = -b / det,
    ic = -c / det,
    id = a / det;
  const ie = -(ia * e + ic * f),
    iff = -(ib * e + id * f);
  const out = emptyMask(m.w, m.h);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const px = x + 0.5,
        py = y + 0.5;
      const sx = ia * px + ic * py + ie - 0.5,
        sy = ib * px + id * py + iff - 0.5;
      const x0 = Math.floor(sx),
        y0 = Math.floor(sy);
      const fx = sx - x0,
        fy = sy - y0;
      const at = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= m.w || yy >= m.h ? 0 : m.data[yy * m.w + xx]!);
      const v = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
      out.data[y * m.w + x] = Math.round(v);
    }
  }
  return out;
}
