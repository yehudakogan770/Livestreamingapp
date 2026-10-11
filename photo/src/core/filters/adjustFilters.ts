// Image ▸ Adjustments applied to the pixels (and as smart filters): the 16
// adjustment-layer types, plus Shadows/Highlights, HDR Toning, Match Color,
// Replace Color, Desaturate and Equalize — which Photoshop offers only this
// way, not as adjustment layers.

import { cloneImg, gaussianBlur, img, type Img } from '../img';
import { pixelFn, defaultParams, ADJUSTMENT_ORDER, ADJUSTMENT_NAMES, histogram, type AdjustmentType } from '../adjust';
import { rgbToHsl, hslToRgb, rgbToLab, labToRgb, lum } from '../color';
import { guided } from './sharpenNoise';
import type { FilterDef, Params } from './types';
import { num, bool, col } from './types';

export function applyAdjustment(a: Img, type: AdjustmentType, params: unknown): Img {
  const f = pixelFn(type, params as never);
  const out = cloneImg(a);
  const o = [0, 0, 0];
  for (let i = 0; i < out.data.length; i += 4) {
    f(a.data[i]!, a.data[i + 1]!, a.data[i + 2]!, o);
    out.data[i] = o[0]!;
    out.data[i + 1] = o[1]!;
    out.data[i + 2] = o[2]!;
  }
  return out;
}

/** Shadows/Highlights: lifts shadows and recovers highlights from a smoothed brightness map. */
export function shadowsHighlights(a: Img, p: Params): Img {
  const sAmt = num(p, 'shadows', 35) / 100,
    hAmt = num(p, 'highlights', 0) / 100;
  const sTone = Math.max(0.05, num(p, 'shadowTone', 50) / 100),
    hTone = Math.max(0.05, num(p, 'highlightTone', 50) / 100);
  const radius = num(p, 'radius', 30);
  const colorCorr = num(p, 'color', 20) / 100;
  const mid = num(p, 'midtone', 0) / 100;
  const { w, h } = a;
  const L = img(w, h, 1);
  for (let i = 0; i < w * h; i++) L.data[i] = lum(a.data[i * 4]!, a.data[i * 4 + 1]!, a.data[i * 4 + 2]!);
  const B = gaussianBlur(L, radius / 3);
  const out = cloneImg(a);
  for (let i = 0; i < w * h; i++) {
    const l = L.data[i]!,
      b = B.data[i]!;
    const ws = Math.max(0, 1 - b / sTone) ** 2;
    const wh = Math.max(0, (b - (1 - hTone)) / hTone) ** 2;
    let nl = l + sAmt * ws * (1 - l) * 0.9 - hAmt * wh * l * 0.9;
    if (mid) nl = 0.5 + (nl - 0.5) * (1 + mid * 4 * nl * (1 - nl));
    nl = Math.min(1, Math.max(0, nl));
    const k = l > 1e-4 ? nl / l : 1;
    const sat = 1 + colorCorr * (ws * sAmt + wh * hAmt) * 0.8;
    for (let c = 0; c < 3; c++) {
      const v = a.data[i * 4 + c]! * k;
      out.data[i * 4 + c] = Math.min(1, Math.max(0, nl + (v - nl) * sat));
    }
  }
  return out;
}

/** HDR Toning (local adaptation): compress the base, keep the detail, then tone and color. */
export function hdrToning(a: Img, p: Params): Img {
  const radius = Math.max(1, Math.round(num(p, 'radius', 40)));
  const strength = num(p, 'strength', 0.6);
  const gamma = num(p, 'gamma', 1);
  const exposure = num(p, 'exposure', 0);
  const detail = num(p, 'detail', 30) / 100;
  const vib = num(p, 'vibrance', 20) / 100,
    sat = num(p, 'saturation', 20) / 100;
  const { w, h } = a;
  const n = w * h;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = Math.log(1e-4 + lum(a.data[i * 4]!, a.data[i * 4 + 1]!, a.data[i * 4 + 2]!));
  const base = guided(L, L, w, h, radius, 0.05);
  let bmin = Infinity,
    bmax = -Infinity;
  for (let i = 0; i < n; i++) {
    bmin = Math.min(bmin, base[i]!);
    bmax = Math.max(bmax, base[i]!);
  }
  const range = Math.max(1e-3, bmax - bmin);
  const compress = 1 / (1 + strength * 3 * Math.min(1, range / 4));
  const out = cloneImg(a);
  for (let i = 0; i < n; i++) {
    const d = L[i]! - base[i]!;
    const nb = (base[i]! - bmax) * compress;
    let nl = Math.exp(nb + d * (1 + detail * 2)) * Math.pow(2, exposure);
    nl = Math.pow(Math.min(1, nl), 1 / gamma);
    const l0 = Math.exp(L[i]!) - 1e-4;
    const k = l0 > 1e-4 ? nl / l0 : 1;
    const r = a.data[i * 4]! * k,
      g = a.data[i * 4 + 1]! * k,
      b = a.data[i * 4 + 2]! * k;
    const s = Math.max(r, g, b) - Math.min(r, g, b);
    const ks = 1 + sat + vib * (1 - s);
    out.data[i * 4] = Math.min(1, Math.max(0, nl + (r - nl) * ks));
    out.data[i * 4 + 1] = Math.min(1, Math.max(0, nl + (g - nl) * ks));
    out.data[i * 4 + 2] = Math.min(1, Math.max(0, nl + (b - nl) * ks));
  }
  return out;
}

/** Match Color: the source's Lab statistics (mean and spread) applied to this picture. */
export function matchColor(a: Img, src: Img, luminance: number, intensity: number, fade: number, neutralize: boolean): Img {
  const stats = (im: Img) => {
    let n = 0;
    const m = [0, 0, 0],
      s = [0, 0, 0];
    const step = Math.max(1, Math.floor((im.w * im.h) / 250000));
    for (let i = 0; i < im.w * im.h; i += step) {
      if (im.data[i * 4 + 3]! < 0.5) continue;
      const lab = rgbToLab(im.data[i * 4]!, im.data[i * 4 + 1]!, im.data[i * 4 + 2]!);
      for (let k = 0; k < 3; k++) {
        m[k]! += lab[k]!;
        s[k]! += lab[k]! * lab[k]!;
      }
      n++;
    }
    n = Math.max(1, n);
    return m.map((v, k) => {
      const mean = v / n;
      return { mean, sd: Math.sqrt(Math.max(1e-6, s[k]! / n - mean * mean)) };
    });
  };
  const A = stats(a),
    B = stats(src);
  if (neutralize) {
    B[1] = { mean: 0, sd: B[1]!.sd };
    B[2] = { mean: 0, sd: B[2]!.sd };
  }
  const out = cloneImg(a);
  const lk = luminance / 100,
    ck = intensity / 100,
    fk = 1 - fade / 100;
  for (let i = 0; i < a.w * a.h; i++) {
    const lab = rgbToLab(a.data[i * 4]!, a.data[i * 4 + 1]!, a.data[i * 4 + 2]!);
    const t = lab.map((v, k) => ((v - A[k]!.mean) / A[k]!.sd) * B[k]!.sd + B[k]!.mean);
    t[0] = lab[0]! + (t[0]! - lab[0]!) * lk;
    t[1] = (lab[1]! + (t[1]! - lab[1]!) * fk) * ck;
    t[2] = (lab[2]! + (t[2]! - lab[2]!) * fk) * ck;
    const rgb = labToRgb(t[0]!, t[1]!, t[2]!);
    for (let k = 0; k < 3; k++) out.data[i * 4 + k] = a.data[i * 4 + k]! + (rgb[k]! - a.data[i * 4 + k]!) * fk;
  }
  return out;
}

export function replaceColor(a: Img, target: [number, number, number], fuzziness: number, hue: number, sat: number, light: number): Img {
  const out = cloneImg(a);
  const fz = Math.max(1, fuzziness) / 255;
  for (let i = 0; i < a.w * a.h; i++) {
    const r = a.data[i * 4]!,
      g = a.data[i * 4 + 1]!,
      b = a.data[i * 4 + 2]!;
    const d = Math.max(Math.abs(r - target[0]), Math.abs(g - target[1]), Math.abs(b - target[2]));
    const k = d <= fz * 0.5 ? 1 : d >= fz ? 0 : 1 - (d - fz * 0.5) / (fz * 0.5);
    if (k <= 0) continue;
    const [hh, ss, ll] = rgbToHsl(r, g, b);
    const nh = (((hh + hue / 360) % 1) + 1) % 1;
    const ns = Math.min(1, Math.max(0, ss * (1 + sat / 100)));
    const nl = light >= 0 ? ll + (1 - ll) * (light / 100) : ll * (1 + light / 100);
    const c = hslToRgb(nh, ns, nl);
    for (let k2 = 0; k2 < 3; k2++) out.data[i * 4 + k2] = a.data[i * 4 + k2]! + (c[k2]! - a.data[i * 4 + k2]!) * k;
  }
  return out;
}

export function equalize(a: Img): Img {
  const h = histogram(a.data)[3]!;
  let total = 0;
  for (const v of h) total += v;
  const cdf = new Float32Array(256);
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += h[i]!;
    cdf[i] = total ? acc / total : i / 255;
  }
  const out = cloneImg(a);
  for (let i = 0; i < a.w * a.h; i++) {
    const l = lum(a.data[i * 4]!, a.data[i * 4 + 1]!, a.data[i * 4 + 2]!);
    const nl = cdf[Math.round(Math.min(1, Math.max(0, l)) * 255)]!;
    const k = l > 1e-4 ? nl / l : 1;
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.min(1, Math.max(0, l > 1e-4 ? a.data[i * 4 + c]! * k : nl));
  }
  return out;
}

const ADJ_FILTERS: FilterDef[] = ADJUSTMENT_ORDER.map((t) => ({
  id: `adj:${t}`,
  name: ADJUSTMENT_NAMES[t],
  menu: 'Adjust',
  params: [],
  run: (a: Img, p: Params) => applyAdjustment(a, t, Object.keys(p).length ? p : defaultParams(t)),
  reach: () => 0,
  dialog: true,
  smart: true,
  hidden: true,
}));

export const ADJUST_FILTERS: FilterDef[] = [
  ...ADJ_FILTERS,
  {
    id: 'shadowsHighlights',
    name: 'Shadows/Highlights',
    menu: 'Adjust',
    params: [
      { key: 'shadows', label: 'Shadows: Amount', type: 'number', min: 0, max: 100, def: 35, unit: '%' },
      { key: 'shadowTone', label: 'Shadows: Tone', type: 'number', min: 0, max: 100, def: 50, unit: '%' },
      { key: 'highlights', label: 'Highlights: Amount', type: 'number', min: 0, max: 100, def: 0, unit: '%' },
      { key: 'highlightTone', label: 'Highlights: Tone', type: 'number', min: 0, max: 100, def: 50, unit: '%' },
      { key: 'radius', label: 'Radius', type: 'number', min: 0, max: 2500, def: 30, unit: 'px', log: true },
      { key: 'color', label: 'Color', type: 'number', min: -100, max: 100, def: 20 },
      { key: 'midtone', label: 'Midtone', type: 'number', min: -100, max: 100, def: 0 },
    ],
    run: (a, p) => shadowsHighlights(a, p),
    reach: (p) => Math.ceil(num(p, 'radius', 30)) + 4,
    dialog: true,
    smart: true,
    hidden: true,
  },
  {
    id: 'hdrToning',
    name: 'HDR Toning',
    menu: 'Adjust',
    params: [
      { key: 'radius', label: 'Radius', type: 'number', min: 1, max: 500, def: 40, unit: 'px' },
      { key: 'strength', label: 'Strength', type: 'number', min: 0.1, max: 4, step: 0.01, def: 0.6 },
      { key: 'gamma', label: 'Gamma', type: 'number', min: 0.1, max: 2, step: 0.01, def: 1 },
      { key: 'exposure', label: 'Exposure', type: 'number', min: -5, max: 5, step: 0.01, def: 0 },
      { key: 'detail', label: 'Detail', type: 'number', min: -100, max: 300, def: 30, unit: '%' },
      { key: 'vibrance', label: 'Vibrance', type: 'number', min: -100, max: 100, def: 20, unit: '%' },
      { key: 'saturation', label: 'Saturation', type: 'number', min: -100, max: 100, def: 20, unit: '%' },
    ],
    run: (a, p) => hdrToning(a, p),
    reach: () => Infinity,
    dialog: true,
    smart: true,
    hidden: true,
  },
  {
    id: 'matchColor',
    name: 'Match Color',
    menu: 'Adjust',
    params: [
      { key: 'luminance', label: 'Luminance', type: 'number', min: 1, max: 200, def: 100 },
      { key: 'intensity', label: 'Color Intensity', type: 'number', min: 1, max: 200, def: 100 },
      { key: 'fade', label: 'Fade', type: 'number', min: 0, max: 100, def: 0 },
      { key: 'neutralize', label: 'Neutralize', type: 'bool', def: false },
    ],
    run: (a, p, c) => {
      const src = c.extra?.source ?? a;
      return matchColor(a, src, num(p, 'luminance', 100), num(p, 'intensity', 100), num(p, 'fade'), bool(p, 'neutralize'));
    },
    reach: () => Infinity,
    dialog: true,
    smart: true,
    hidden: true,
  },
  {
    id: 'replaceColor',
    name: 'Replace Color',
    menu: 'Adjust',
    params: [
      { key: 'color', label: 'Color', type: 'color', def: [0.8, 0.2, 0.2] },
      { key: 'fuzziness', label: 'Fuzziness', type: 'number', min: 0, max: 200, def: 40 },
      { key: 'hue', label: 'Hue', type: 'number', min: -180, max: 180, def: 0 },
      { key: 'sat', label: 'Saturation', type: 'number', min: -100, max: 100, def: 0 },
      { key: 'light', label: 'Lightness', type: 'number', min: -100, max: 100, def: 0 },
    ],
    run: (a, p) => replaceColor(a, col(p, 'color', [0.8, 0.2, 0.2]), num(p, 'fuzziness', 40), num(p, 'hue'), num(p, 'sat'), num(p, 'light')),
    reach: () => 0,
    dialog: true,
    smart: true,
    hidden: true,
  },
  {
    id: 'desaturate',
    name: 'Desaturate',
    menu: 'Adjust',
    params: [],
    run: (a) => {
      const out = cloneImg(a);
      for (let i = 0; i < out.data.length; i += 4) {
        const l = (Math.max(a.data[i]!, a.data[i + 1]!, a.data[i + 2]!) + Math.min(a.data[i]!, a.data[i + 1]!, a.data[i + 2]!)) / 2;
        out.data[i] = out.data[i + 1] = out.data[i + 2] = l;
      }
      return out;
    },
    reach: () => 0,
    smart: true,
    hidden: true,
  },
  { id: 'equalize', name: 'Equalize', menu: 'Adjust', params: [], run: (a) => equalize(a), reach: () => Infinity, smart: true, hidden: true },
];
