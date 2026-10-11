// Blur filters: Gaussian, Box, Surface, Motion, Radial (spin and zoom), Lens
// (hexagonal bokeh with bright highlights), Average, Blur, Blur More, and the
// Blur Gallery's Field, Iris and Tilt-Shift blurs.

import { boxBlur, cloneImg, gaussianBlur, img, premultiply, unpremultiply, type Img } from '../img';
import type { FilterDef } from './types';
import { num, str, vec, bool } from './types';

/** Sample premultiplied RGBA bilinear (edges clamped). */
function samplePM(d: Float32Array, w: number, h: number, x: number, y: number, o: number[]): void {
  x -= 0.5;
  y -= 0.5;
  let x0 = Math.floor(x),
    y0 = Math.floor(y);
  const fx = x - x0,
    fy = y - y0;
  let x1 = x0 + 1,
    y1 = y0 + 1;
  x0 = x0 < 0 ? 0 : x0 >= w ? w - 1 : x0;
  x1 = x1 < 0 ? 0 : x1 >= w ? w - 1 : x1;
  y0 = y0 < 0 ? 0 : y0 >= h ? h - 1 : y0;
  y1 = y1 < 0 ? 0 : y1 >= h ? h - 1 : y1;
  const a = (y0 * w + x0) * 4,
    b = (y0 * w + x1) * 4,
    c = (y1 * w + x0) * 4,
    e = (y1 * w + x1) * 4;
  const w00 = (1 - fx) * (1 - fy),
    w10 = fx * (1 - fy),
    w01 = (1 - fx) * fy,
    w11 = fx * fy;
  for (let k = 0; k < 4; k++) o[k] = d[a + k]! * w00 + d[b + k]! * w10 + d[c + k]! * w01 + d[e + k]! * w11;
}

/**
 * Average of the image with itself shifted, repeatedly with doubling shifts:
 * a box of `length` along a direction in log₂(length) passes (works at any angle).
 * `map(x, y, step)` gives where to read for a pixel at each pass.
 */
function doublingBlur(pm: Img, passes: number, map: (x: number, y: number, k: number, out: number[]) => void, symmetric: boolean): Img {
  let cur = pm.data;
  const { w, h } = pm;
  const s = [0, 0, 0, 0],
    t = [0, 0, 0, 0],
    q = [0, 0];
  for (let k = 0; k < passes; k++) {
    const next = new Float32Array(cur.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        map(x + 0.5, y + 0.5, k, q);
        samplePM(cur, w, h, q[0]!, q[1]!, s);
        if (symmetric) {
          // The mirror shift: 2p − q.
          samplePM(cur, w, h, 2 * (x + 0.5) - q[0]!, 2 * (y + 0.5) - q[1]!, t);
          for (let c = 0; c < 4; c++) next[o + c] = (s[c]! + t[c]!) / 2;
        } else for (let c = 0; c < 4; c++) next[o + c] = (s[c]! + cur[o + c]!) / 2;
      }
    cur = next;
  }
  return { ...pm, data: cur };
}

export function motionBlur(a: Img, angleDeg: number, distance: number): Img {
  if (distance < 1) return cloneImg(a);
  const ang = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(ang),
    dy = -Math.sin(ang);
  // Shifts ±u, ±2u, ±4u…: a comb of 2^passes taps spread evenly over `distance`.
  const passes = Math.max(1, Math.ceil(Math.log2(distance)) + 1);
  const unit = distance / 2 ** (passes + 1);
  const pm = premultiply(a);
  const out = doublingBlur(
    pm,
    passes,
    (x, y, k, o) => {
      const s = unit * 2 ** k;
      o[0] = x + dx * s;
      o[1] = y + dy * s;
    },
    true,
  );
  return unpremultiply(out);
}

/** Directional box along an angle, one-sided (for the hexagonal bokeh). */
function dirBox(pm: Img, angleDeg: number, length: number): Img {
  if (length < 1) return pm;
  const ang = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(ang),
    dy = -Math.sin(ang);
  const passes = Math.max(1, Math.ceil(Math.log2(length)));
  const unit = length / 2 ** passes;
  return doublingBlur(
    pm,
    passes,
    (x, y, k, o) => {
      const s = unit * 2 ** k;
      o[0] = x + dx * s;
      o[1] = y + dy * s;
    },
    false,
  );
}

export function radialBlur(a: Img, amount: number, method: 'spin' | 'zoom', cx: number, cy: number, ox = 0, oy = 0): Img {
  if (amount <= 0) return cloneImg(a);
  const pm = premultiply(a);
  const passes = 6;
  const out = doublingBlur(
    pm,
    passes,
    (x, y, k, o) => {
      const px = x + ox - cx,
        py = y + oy - cy;
      if (method === 'spin') {
        // Total spin of `amount` degrees.
        const th = ((amount * Math.PI) / 180 / 2 ** passes) * 2 ** k;
        o[0] = cx - ox + px * Math.cos(th) - py * Math.sin(th);
        o[1] = cy - oy + px * Math.sin(th) + py * Math.cos(th);
      } else {
        // Zoom: toward the center by up to amount %.
        const s = 1 - (amount / 100) * 0.5 * (2 ** k / 2 ** passes);
        o[0] = cx - ox + px * s;
        o[1] = cy - oy + py * s;
      }
    },
    true,
  );
  return unpremultiply(out);
}

/** Surface Blur: averages neighbors within `threshold` levels (edges stay sharp). Two separable passes. */
export function surfaceBlur(a: Img, radius: number, threshold: number): Img {
  const r = Math.max(1, Math.round(radius));
  const t = Math.max(1, threshold) / 255;
  const pass = (src: Float32Array, horiz: boolean): Float32Array => {
    const { w, h } = a;
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        let sr = 0,
          sg = 0,
          sb = 0,
          sa = 0,
          ws = 0;
        const r0 = src[o]!,
          g0 = src[o + 1]!,
          b0 = src[o + 2]!;
        for (let k = -r; k <= r; k++) {
          const xx = horiz ? Math.min(w - 1, Math.max(0, x + k)) : x;
          const yy = horiz ? y : Math.min(h - 1, Math.max(0, y + k));
          const q = (yy * w + xx) * 4;
          const d = (Math.abs(src[q]! - r0) + Math.abs(src[q + 1]! - g0) + Math.abs(src[q + 2]! - b0)) / 3;
          const wt = Math.max(0, 1 - d / (2.5 * t)) * src[q + 3]!;
          sr += src[q]! * wt;
          sg += src[q + 1]! * wt;
          sb += src[q + 2]! * wt;
          sa += src[q + 3]!;
          ws += wt;
        }
        if (ws > 1e-6) {
          out[o] = sr / ws;
          out[o + 1] = sg / ws;
          out[o + 2] = sb / ws;
        } else {
          out[o] = r0;
          out[o + 1] = g0;
          out[o + 2] = b0;
        }
        out[o + 3] = sa / (2 * r + 1);
      }
    return out;
  };
  const d1 = pass(a.data, true);
  const d2 = pass(d1, false);
  // Alpha stays as it was.
  for (let i = 3; i < d2.length; i += 4) d2[i] = a.data[i]!;
  return { ...a, data: d2 };
}

/** Lens Blur: hexagonal bokeh (Gotanda's three rhombi), with bright highlights blooming. */
export function lensBlur(a: Img, radius: number, brightness: number, threshold: number, rotation: number): Img {
  if (radius < 1) return cloneImg(a);
  // Highlights above the threshold get more light before blurring (so they bloom into
  // bright discs), and the same straight line is undone after.
  const K = 1 + brightness / 10;
  const thr = threshold / 255;
  const src = cloneImg(a);
  if (brightness > 0)
    for (let i = 0; i < src.data.length; i += 4)
      for (let k = 0; k < 3; k++) {
        const v = src.data[i + k]!;
        if (v > thr) src.data[i + k] = thr + (v - thr) * K;
      }
  // A hexagon is three rhombi meeting at the pixel; each rhombus is two one-sided boxes.
  const pm = premultiply(src);
  const r = radius;
  const up = dirBox(pm, 90 + rotation, r);
  const ra = dirBox(up, 210 + rotation, r);
  const rb = dirBox(up, 330 + rotation, r);
  const rc = dirBox(dirBox(pm, 210 + rotation, r), 330 + rotation, r);
  const out = img(a.w, a.h, 4);
  for (let i = 0; i < out.data.length; i++) out.data[i] = (ra.data[i]! + rb.data[i]! + rc.data[i]!) / 3;
  const res = unpremultiply(out);
  if (brightness > 0)
    for (let i = 0; i < res.data.length; i += 4)
      for (let k = 0; k < 3; k++) {
        const v = res.data[i + k]!;
        if (v > thr) res.data[i + k] = Math.min(1, thr + (v - thr) / Math.sqrt(K));
      }
  return res;
}

/** Blur by a per-pixel amount 0..1 of `radius` (the Blur Gallery's engine). */
export function variableBlur(a: Img, radius: number, amount: (x: number, y: number) => number): Img {
  const levels = [0, radius / 8, radius / 4, radius / 2, radius];
  const imgs = levels.map((r) => (r < 0.3 ? a : gaussianBlur(a, r)));
  const out = img(a.w, a.h, 4);
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const t = Math.min(1, Math.max(0, amount(x, y)));
      // Find the two levels around t·radius.
      const want = t * radius;
      let k = 0;
      while (k < levels.length - 2 && levels[k + 1]! < want) k++;
      const lo = levels[k]!,
        hi = levels[k + 1]!;
      const f = hi > lo ? Math.min(1, Math.max(0, (want - lo) / (hi - lo))) : 0;
      const o = (y * a.w + x) * 4;
      const A = imgs[k]!.data,
        B = imgs[k + 1]!.data;
      for (let c = 0; c < 4; c++) out.data[o + c] = A[o + c]! * (1 - f) + B[o + c]! * f;
    }
  return out;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export const BLUR_FILTERS: FilterDef[] = [
  {
    id: 'gaussianBlur',
    name: 'Gaussian Blur',
    menu: 'Blur',
    params: [{ key: 'radius', label: 'Radius', type: 'number', min: 0.1, max: 1000, step: 0.1, def: 4, unit: 'px', log: true }],
    run: (a, p) => gaussianBlur(a, num(p, 'radius', 4)),
    reach: (p) => Math.ceil(num(p, 'radius', 4) * 3.5) + 2,
    dialog: true,
    smart: true,
  },
  {
    id: 'boxBlur',
    name: 'Box Blur',
    menu: 'Blur',
    params: [{ key: 'radius', label: 'Radius', type: 'number', min: 1, max: 999, def: 8, unit: 'px', log: true }],
    run: (a, p) => boxBlur(a, num(p, 'radius', 8)),
    reach: (p) => Math.ceil(num(p, 'radius', 8)) + 2,
    dialog: true,
    smart: true,
  },
  {
    id: 'surfaceBlur',
    name: 'Surface Blur',
    menu: 'Blur',
    params: [
      { key: 'radius', label: 'Radius', type: 'number', min: 1, max: 100, def: 5, unit: 'px' },
      { key: 'threshold', label: 'Threshold', type: 'number', min: 2, max: 255, def: 15, unit: 'levels' },
    ],
    run: (a, p) => surfaceBlur(a, num(p, 'radius', 5), num(p, 'threshold', 15)),
    reach: (p) => Math.ceil(num(p, 'radius', 5)) * 2 + 2,
    dialog: true,
    smart: true,
  },
  {
    id: 'motionBlur',
    name: 'Motion Blur',
    menu: 'Blur',
    params: [
      { key: 'angle', label: 'Angle', type: 'angle', def: 0 },
      { key: 'distance', label: 'Distance', type: 'number', min: 1, max: 2000, def: 20, unit: 'px', log: true },
    ],
    run: (a, p) => motionBlur(a, num(p, 'angle'), num(p, 'distance', 20)),
    reach: (p) => Math.ceil(num(p, 'distance', 20)) + 4,
    dialog: true,
    smart: true,
  },
  {
    id: 'radialBlur',
    name: 'Radial Blur',
    menu: 'Blur',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', min: 1, max: 100, def: 10 },
      {
        key: 'method',
        label: 'Blur Method',
        type: 'select',
        options: [
          ['spin', 'Spin'],
          ['zoom', 'Zoom'],
        ],
        def: 'spin',
      },
      { key: 'center', label: 'Blur Center', type: 'point', def: [0.5, 0.5] },
    ],
    run: (a, p, c) => {
      const [u, v] = vec(p, 'center');
      return radialBlur(a, num(p, 'amount', 10), str(p, 'method', 'spin') as 'spin' | 'zoom', u * c.width, v * c.height, c.ox ?? 0, c.oy ?? 0);
    },
    reach: () => Infinity,
    dialog: true,
    smart: true,
  },
  {
    id: 'lensBlur',
    name: 'Lens Blur',
    menu: 'Blur',
    params: [
      { key: 'radius', label: 'Radius', type: 'number', min: 1, max: 100, def: 15, unit: 'px' },
      { key: 'rotation', label: 'Blade Curvature Rotation', type: 'angle', def: 0 },
      { key: 'brightness', label: 'Specular Brightness', type: 'number', min: 0, max: 100, def: 0 },
      { key: 'threshold', label: 'Specular Threshold', type: 'number', min: 0, max: 255, def: 255 },
    ],
    run: (a, p) => lensBlur(a, num(p, 'radius', 15), num(p, 'brightness'), num(p, 'threshold', 255), num(p, 'rotation')),
    reach: (p) => Math.ceil(num(p, 'radius', 15)) * 2 + 4,
    dialog: true,
    smart: true,
  },
  {
    id: 'average',
    name: 'Average',
    menu: 'Blur',
    params: [],
    run: (a) => {
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        const al = a.data[i + 3]!;
        r += a.data[i]! * al;
        g += a.data[i + 1]! * al;
        b += a.data[i + 2]! * al;
        n += al;
      }
      const out = cloneImg(a);
      if (n > 0) for (let i = 0; i < out.data.length; i += 4) out.data.set([r / n, g / n, b / n], i);
      return out;
    },
    reach: () => Infinity,
    smart: true,
  },
  {
    id: 'blur',
    name: 'Blur',
    menu: 'Blur',
    params: [],
    run: (a) => gaussianBlur(a, 0.6),
    reach: () => 4,
    smart: true,
  },
  {
    id: 'blurMore',
    name: 'Blur More',
    menu: 'Blur',
    params: [],
    run: (a) => gaussianBlur(a, 1.4),
    reach: () => 7,
    smart: true,
  },
  {
    id: 'fieldBlur',
    name: 'Field Blur',
    menu: 'Blur Gallery',
    params: [
      { key: 'radius', label: 'Blur', type: 'number', min: 0, max: 500, def: 15, unit: 'px' },
      { key: 'from', label: 'Sharp at', type: 'point', def: [0.5, 0.65] },
      { key: 'to', label: 'Blurred at', type: 'point', def: [0.5, 0.15] },
    ],
    run: (a, p, c) => {
      const [fx, fy] = vec(p, 'from', [0.5, 0.65]);
      const [tx, ty] = vec(p, 'to', [0.5, 0.15]);
      const ox = c.ox ?? 0,
        oy = c.oy ?? 0;
      const ax = fx * c.width,
        ay = fy * c.height,
        bx = tx * c.width,
        by = ty * c.height;
      const dx = bx - ax,
        dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      return variableBlur(a, num(p, 'radius', 15), (x, y) => smooth(Math.min(1, Math.max(0, ((x + ox - ax) * dx + (y + oy - ay) * dy) / len2))));
    },
    reach: (p) => Math.ceil(num(p, 'radius', 15) * 3.5) + 2,
    dialog: true,
    smart: true,
  },
  {
    id: 'irisBlur',
    name: 'Iris Blur',
    menu: 'Blur Gallery',
    params: [
      { key: 'radius', label: 'Blur', type: 'number', min: 0, max: 500, def: 15, unit: 'px' },
      { key: 'center', label: 'Center', type: 'point', def: [0.5, 0.5] },
      { key: 'size', label: 'Focus size', type: 'number', min: 1, max: 100, def: 30, unit: '%' },
      { key: 'aspect', label: 'Roundness', type: 'number', min: 10, max: 400, def: 100, unit: '%' },
      { key: 'feather', label: 'Feather', type: 'number', min: 0, max: 100, def: 60, unit: '%' },
    ],
    run: (a, p, c) => {
      const [u, v] = vec(p, 'center');
      const cx = u * c.width,
        cy = v * c.height;
      const R = (num(p, 'size', 30) / 100) * Math.min(c.width, c.height);
      const asp = num(p, 'aspect', 100) / 100;
      const fe = num(p, 'feather', 60) / 100;
      const ox = c.ox ?? 0,
        oy = c.oy ?? 0;
      return variableBlur(a, num(p, 'radius', 15), (x, y) => {
        const d = Math.hypot((x + ox - cx) / asp, y + oy - cy) / R;
        const inner = 1 - fe;
        return d <= inner ? 0 : smooth(Math.min(1, (d - inner) / Math.max(0.01, fe + 0.5)));
      });
    },
    reach: (p) => Math.ceil(num(p, 'radius', 15) * 3.5) + 2,
    dialog: true,
    smart: true,
  },
  {
    id: 'tiltShift',
    name: 'Tilt-Shift',
    menu: 'Blur Gallery',
    params: [
      { key: 'radius', label: 'Blur', type: 'number', min: 0, max: 500, def: 15, unit: 'px' },
      { key: 'center', label: 'Center', type: 'point', def: [0.5, 0.55] },
      { key: 'angle', label: 'Angle', type: 'angle', def: 0 },
      { key: 'focus', label: 'Sharp band', type: 'number', min: 0, max: 100, def: 12, unit: '%' },
      { key: 'transition', label: 'Transition', type: 'number', min: 1, max: 100, def: 25, unit: '%' },
      { key: 'symmetric', label: 'Symmetric distortion', type: 'bool', def: true },
    ],
    run: (a, p, c) => {
      const [u, v] = vec(p, 'center', [0.5, 0.55]);
      const cx = u * c.width,
        cy = v * c.height;
      const ang = (num(p, 'angle') * Math.PI) / 180;
      const nx = -Math.sin(ang),
        ny = Math.cos(ang);
      const band = (num(p, 'focus', 12) / 100) * c.height,
        tr = (num(p, 'transition', 25) / 100) * c.height;
      const ox = c.ox ?? 0,
        oy = c.oy ?? 0;
      const sym = bool(p, 'symmetric', true);
      return variableBlur(a, num(p, 'radius', 15), (x, y) => {
        let d = (x + ox - cx) * nx + (y + oy - cy) * ny;
        if (!sym && d < 0) d *= 0.6;
        d = Math.abs(d);
        return d <= band ? 0 : smooth(Math.min(1, (d - band) / Math.max(1, tr)));
      });
    },
    reach: (p) => Math.ceil(num(p, 'radius', 15) * 3.5) + 2,
    dialog: true,
    smart: true,
  },
];
