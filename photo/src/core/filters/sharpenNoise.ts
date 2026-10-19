// Sharpen (Unsharp Mask, Smart Sharpen, Sharpen, Sharpen More, High Pass)
// and Noise (Add Noise, Reduce Noise, Median, Dust & Scratches, Despeckle).

import { cloneImg, gaussianBlur, img, type Img } from '../img';
import { Rand } from '../brush';
import type { FilterDef } from './types';
import { num, str, bool } from './types';

export function unsharpMask(a: Img, amount: number, radius: number, threshold: number): Img {
  const blurred = gaussianBlur(a, radius);
  const out = cloneImg(a);
  const k = amount / 100;
  const t = threshold / 255;
  for (let i = 0; i < out.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = a.data[i + c]! - blurred.data[i + c]!;
      if (Math.abs(d) * 2 < t) continue;
      out.data[i + c] = Math.min(1, Math.max(0, a.data[i + c]! + d * k));
    }
  }
  return out;
}

/** Smart Sharpen: unsharp on luminance only (no color fringes), with halos and noise held back. */
export function smartSharpen(a: Img, amount: number, radius: number, reduceNoise: number, shadowFade: number, highlightFade: number): Img {
  const blurred = gaussianBlur(a, radius);
  const out = cloneImg(a);
  const k = amount / 100;
  const nz = (reduceNoise / 100) * 0.06;
  for (let i = 0; i < out.data.length; i += 4) {
    const l0 = 0.299 * a.data[i]! + 0.587 * a.data[i + 1]! + 0.114 * a.data[i + 2]!;
    const l1 = 0.299 * blurred.data[i]! + 0.587 * blurred.data[i + 1]! + 0.114 * blurred.data[i + 2]!;
    let d = l0 - l1;
    // Small differences are noise: let them through less.
    const ad = Math.abs(d);
    if (ad < nz) d *= ad / nz;
    // Halo control: limit how far past the local range a pixel can go.
    let delta = d * k;
    const fade = l0 < 0.25 ? 1 - (shadowFade / 100) * (1 - l0 / 0.25) : l0 > 0.75 ? 1 - (highlightFade / 100) * ((l0 - 0.75) / 0.25) : 1;
    delta *= fade;
    delta = Math.max(-0.35, Math.min(0.35, delta));
    for (let c = 0; c < 3; c++) out.data[i + c] = Math.min(1, Math.max(0, a.data[i + c]! + delta));
  }
  return out;
}

export function highPass(a: Img, radius: number): Img {
  const blurred = gaussianBlur(a, radius);
  const out = cloneImg(a);
  for (let i = 0; i < out.data.length; i += 4)
    for (let c = 0; c < 3; c++) out.data[i + c] = Math.min(1, Math.max(0, a.data[i + c]! - blurred.data[i + c]! + 0.5));
  return out;
}

function gauss(r: Rand): number {
  // Box–Muller.
  const u = Math.max(1e-9, r.next()),
    v = r.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function addNoise(a: Img, amount: number, distribution: 'uniform' | 'gaussian', mono: boolean, seed: number, ox = 0, oy = 0): Img {
  const out = cloneImg(a);
  const k = amount / 100;
  for (let y = 0; y < a.h; y++) {
    // Seeded by row so bands give the same result as the whole picture.
    const rr = new Rand(seed * 7919 + (y + oy) * 104729 + ox);
    for (let x = 0; x < a.w; x++) {
      const i = (y * a.w + x) * 4;
      const n = () => (distribution === 'gaussian' ? gauss(rr) * 0.5 : rr.next() * 2 - 1) * k;
      if (mono) {
        const v = n();
        for (let c = 0; c < 3; c++) out.data[i + c] = Math.min(1, Math.max(0, a.data[i + c]! + v));
      } else for (let c = 0; c < 3; c++) out.data[i + c] = Math.min(1, Math.max(0, a.data[i + c]! + n()));
    }
  }
  return out;
}

/** Median of each channel over a square (histogram method for speed at larger radii). */
export function median(a: Img, radius: number): Img {
  const r = Math.max(1, Math.round(radius));
  const out = cloneImg(a);
  const { w, h } = a;
  const hist = new Uint32Array(256);
  const n = (2 * r + 1) * (2 * r + 1);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      hist.fill(0);
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy)),
            xx = Math.min(w - 1, Math.max(0, dx));
          hist[Math.round(Math.min(1, Math.max(0, a.data[(yy * w + xx) * 4 + c]!)) * 255)]!++;
        }
      for (let x = 0; x < w; x++) {
        // The median from the histogram.
        let acc = 0,
          m = 0;
        for (; m < 256; m++) {
          acc += hist[m]!;
          if (acc * 2 > n) break;
        }
        out.data[(y * w + x) * 4 + c] = m / 255;
        // Slide the window right.
        const xo = Math.max(0, x - r),
          xn = Math.min(w - 1, x + r + 1);
        for (let dy = -r; dy <= r; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          hist[Math.round(Math.min(1, Math.max(0, a.data[(yy * w + xo) * 4 + c]!)) * 255)]!--;
          hist[Math.round(Math.min(1, Math.max(0, a.data[(yy * w + xn) * 4 + c]!)) * 255)]!++;
        }
      }
    }
  }
  return out;
}

/** Dust & Scratches: the median, only where it differs by more than the threshold. */
export function dustScratches(a: Img, radius: number, threshold: number): Img {
  const m = median(a, radius);
  const t = threshold / 255;
  const out = cloneImg(a);
  for (let i = 0; i < out.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i]! - m.data[i]!), Math.abs(a.data[i + 1]! - m.data[i + 1]!), Math.abs(a.data[i + 2]! - m.data[i + 2]!));
    if (d > t) for (let c = 0; c < 3; c++) out.data[i + c] = m.data[i + c]!;
  }
  return out;
}

/**
 * Reduce Noise: edge-aware smoothing (a guided filter on each channel, guided
 * by luminance), stronger on color than on brightness, with detail added back.
 */
export function reduceNoise(a: Img, strength: number, preserveDetails: number, colorNoise: number, sharpenDetails: number): Img {
  const { w, h } = a;
  const n = w * h;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.299 * a.data[i * 4]! + 0.587 * a.data[i * 4 + 1]! + 0.114 * a.data[i * 4 + 2]!;
  const r = Math.max(1, Math.round(1 + strength / 3));
  const epsL = (0.0004 + (strength / 10) * 0.004) * (1 - (preserveDetails / 100) * 0.9);
  const Ls = guided(L, L, w, h, r, epsL);
  // Color noise: smooth the chroma much more.
  const cr = Math.max(1, Math.round(2 + colorNoise / 8));
  const Cb = new Float32Array(n),
    Cr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Cb[i] = a.data[i * 4 + 2]! - L[i]!;
    Cr[i] = a.data[i * 4]! - L[i]!;
  }
  const epsC = 0.002 + (colorNoise / 100) * 0.05;
  const Cbs = colorNoise > 0 ? guided(Ls, Cb, w, h, cr, epsC) : Cb;
  const Crs = colorNoise > 0 ? guided(Ls, Cr, w, h, cr, epsC) : Cr;
  const out = cloneImg(a);
  const sharp = sharpenDetails / 100;
  for (let i = 0; i < n; i++) {
    const l = Ls[i]!;
    const R = l + Crs[i]!,
      B = l + Cbs[i]!;
    const G = (l - 0.299 * R - 0.114 * B) / 0.587;
    out.data[i * 4] = Math.min(1, Math.max(0, R));
    out.data[i * 4 + 1] = Math.min(1, Math.max(0, G));
    out.data[i * 4 + 2] = Math.min(1, Math.max(0, B));
  }
  if (sharp > 0) return unsharpMask(out, sharp * 100, 1, 2);
  return out;
}

function box(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h),
    out = new Float32Array(w * h);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * inv;
      acc += a[row + Math.min(w - 1, x + r + 1)]! - a[row + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc * inv;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}

export function guided(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h;
  const mI = box(I, w, h, r),
    mP = box(p, w, h, r);
  const IP = new Float32Array(n),
    II = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    IP[i] = I[i]! * p[i]!;
    II[i] = I[i]! * I[i]!;
  }
  const mIP = box(IP, w, h, r),
    mII = box(II, w, h, r);
  const A = new Float32Array(n),
    B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cov = mIP[i]! - mI[i]! * mP[i]!;
    const v = mII[i]! - mI[i]! * mI[i]!;
    A[i] = cov / (v + eps);
    B[i] = mP[i]! - A[i]! * mI[i]!;
  }
  const mA = box(A, w, h, r),
    mB = box(B, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = mA[i]! * I[i]! + mB[i]!;
  return q;
}

export const SHARPEN_NOISE_FILTERS: FilterDef[] = [
  {
    id: 'unsharpMask',
    name: 'Unsharp Mask',
    menu: 'Sharpen',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', min: 1, max: 500, def: 100, unit: '%' },
      { key: 'radius', label: 'Radius', type: 'number', min: 0.1, max: 250, step: 0.1, def: 1, unit: 'px', log: true },
      { key: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 255, def: 0, unit: 'levels' },
    ],
    run: (a, p) => unsharpMask(a, num(p, 'amount', 100), num(p, 'radius', 1), num(p, 'threshold')),
    reach: (p) => Math.ceil(num(p, 'radius', 1) * 3.5) + 2,
    dialog: true,
    smart: true,
  },
  {
    id: 'smartSharpen',
    name: 'Smart Sharpen',
    menu: 'Sharpen',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', min: 1, max: 500, def: 200, unit: '%' },
      { key: 'radius', label: 'Radius', type: 'number', min: 0.1, max: 64, step: 0.1, def: 1, unit: 'px', log: true },
      { key: 'noise', label: 'Reduce Noise', type: 'number', min: 0, max: 100, def: 10, unit: '%' },
      { key: 'shadowFade', label: 'Shadows: Fade Amount', type: 'number', min: 0, max: 100, def: 0, unit: '%' },
      { key: 'highlightFade', label: 'Highlights: Fade Amount', type: 'number', min: 0, max: 100, def: 0, unit: '%' },
    ],
    run: (a, p) => smartSharpen(a, num(p, 'amount', 200), num(p, 'radius', 1), num(p, 'noise', 10), num(p, 'shadowFade'), num(p, 'highlightFade')),
    reach: (p) => Math.ceil(num(p, 'radius', 1) * 3.5) + 2,
    dialog: true,
    smart: true,
  },
  {
    id: 'sharpen',
    name: 'Sharpen',
    menu: 'Sharpen',
    params: [],
    run: (a) => unsharpMask(a, 60, 0.7, 0),
    reach: () => 4,
    smart: true,
  },
  {
    id: 'sharpenMore',
    name: 'Sharpen More',
    menu: 'Sharpen',
    params: [],
    run: (a) => unsharpMask(a, 130, 0.8, 0),
    reach: () => 4,
    smart: true,
  },
  {
    id: 'highPass',
    name: 'High Pass',
    menu: 'Other',
    params: [{ key: 'radius', label: 'Radius', type: 'number', min: 0.1, max: 1000, step: 0.1, def: 10, unit: 'px', log: true }],
    run: (a, p) => highPass(a, num(p, 'radius', 10)),
    reach: (p) => Math.ceil(num(p, 'radius', 10) * 3.5) + 2,
    dialog: true,
    smart: true,
  },
  {
    id: 'addNoise',
    name: 'Add Noise',
    menu: 'Noise',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', min: 0.1, max: 400, step: 0.1, def: 12.5, unit: '%' },
      {
        key: 'distribution',
        label: 'Distribution',
        type: 'select',
        options: [
          ['uniform', 'Uniform'],
          ['gaussian', 'Gaussian'],
        ],
        def: 'gaussian',
      },
      { key: 'mono', label: 'Monochromatic', type: 'bool', def: false },
      { key: 'seed', label: 'Seed', type: 'seed', def: 1 },
    ],
    run: (a, p, c) =>
      addNoise(a, num(p, 'amount', 12.5), str(p, 'distribution', 'gaussian') as 'gaussian', bool(p, 'mono'), num(p, 'seed', 1), c.ox ?? 0, c.oy ?? 0),
    reach: () => 0,
    dialog: true,
    smart: true,
  },
  {
    id: 'reduceNoise',
    name: 'Reduce Noise',
    menu: 'Noise',
    params: [
      { key: 'strength', label: 'Strength', type: 'number', min: 0, max: 10, def: 6 },
      { key: 'details', label: 'Preserve Details', type: 'number', min: 0, max: 100, def: 60, unit: '%' },
      { key: 'color', label: 'Reduce Color Noise', type: 'number', min: 0, max: 100, def: 45, unit: '%' },
      { key: 'sharpen', label: 'Sharpen Details', type: 'number', min: 0, max: 100, def: 25, unit: '%' },
    ],
    run: (a, p) => reduceNoise(a, num(p, 'strength', 6), num(p, 'details', 60), num(p, 'color', 45), num(p, 'sharpen', 25)),
    reach: (p) => Math.ceil(4 + num(p, 'color', 45) / 4) * 3,
    dialog: true,
    smart: true,
  },
  {
    id: 'median',
    name: 'Median',
    menu: 'Noise',
    params: [{ key: 'radius', label: 'Radius', type: 'number', min: 1, max: 100, def: 2, unit: 'px' }],
    run: (a, p) => median(a, num(p, 'radius', 2)),
    reach: (p) => Math.ceil(num(p, 'radius', 2)) + 1,
    dialog: true,
    smart: true,
  },
  {
    id: 'dustScratches',
    name: 'Dust & Scratches',
    menu: 'Noise',
    params: [
      { key: 'radius', label: 'Radius', type: 'number', min: 1, max: 100, def: 2, unit: 'px' },
      { key: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 255, def: 10, unit: 'levels' },
    ],
    run: (a, p) => dustScratches(a, num(p, 'radius', 2), num(p, 'threshold', 10)),
    reach: (p) => Math.ceil(num(p, 'radius', 2)) + 1,
    dialog: true,
    smart: true,
  },
  {
    id: 'despeckle',
    name: 'Despeckle',
    menu: 'Noise',
    params: [],
    run: (a) => reduceNoise(a, 3, 80, 30, 0),
    reach: () => 30,
    smart: true,
  },
];

export { img };
