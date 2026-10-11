// Develop (the Camera Raw filter): white balance, tone (exposure, contrast,
// highlights, shadows, whites, blacks), presence (texture, clarity, dehaze,
// vibrance, saturation), a tone curve, HSL by eight colors, color grading,
// detail (sharpening, noise reduction), lens corrections and effects
// (vignette, grain). The same settings develop raw files and any layer.

import { cloneImg, gaussianBlur, img, type Img } from '../img';
import { curveTable, type CurvePoints } from '../adjust';
import { rgbToHsl, hslToRgb } from '../color';
import { guided, unsharpMask } from './sharpenNoise';
import { Rand } from '../brush';
import type { FilterDef, Params } from './types';

export const HSL_COLORS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
export type HslColor = (typeof HSL_COLORS)[number];
const HSL_CENTERS: Record<HslColor, number> = { red: 0, orange: 30, yellow: 60, green: 120, aqua: 180, blue: 225, purple: 270, magenta: 315 };

export interface DevelopParams {
  temp: number;
  tint: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  texture: number;
  clarity: number;
  dehaze: number;
  vibrance: number;
  saturation: number;
  curve: CurvePoints;
  hsl: Record<HslColor, { h: number; s: number; l: number }>;
  grade: { shadows: { hue: number; sat: number; lum: number }; midtones: { hue: number; sat: number; lum: number }; highlights: { hue: number; sat: number; lum: number }; blending: number; balance: number };
  sharpen: { amount: number; radius: number; detail: number; masking: number };
  noise: { luminance: number; detail: number; color: number };
  lens: { distortion: number; vignetting: number; defringe: number };
  effects: { vignette: number; midpoint: number; roundness: number; feather: number; grain: number; grainSize: number; grainRoughness: number };
}

export function defaultDevelop(): DevelopParams {
  const hsl = {} as DevelopParams['hsl'];
  for (const c of HSL_COLORS) hsl[c] = { h: 0, s: 0, l: 0 };
  return {
    temp: 0,
    tint: 0,
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    texture: 0,
    clarity: 0,
    dehaze: 0,
    vibrance: 0,
    saturation: 0,
    curve: [
      [0, 0],
      [1, 1],
    ],
    hsl,
    grade: { shadows: { hue: 220, sat: 0, lum: 0 }, midtones: { hue: 40, sat: 0, lum: 0 }, highlights: { hue: 45, sat: 0, lum: 0 }, blending: 50, balance: 0 },
    sharpen: { amount: 0, radius: 1, detail: 25, masking: 0 },
    noise: { luminance: 0, detail: 50, color: 0 },
    lens: { distortion: 0, vignetting: 0, defringe: 0 },
    effects: { vignette: 0, midpoint: 50, roundness: 0, feather: 50, grain: 0, grainSize: 25, grainRoughness: 50 },
  };
}

const s2l = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const l2s = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Is everything at its default (nothing to do)? */
export function developIsIdentity(p: DevelopParams): boolean {
  return JSON.stringify(p) === JSON.stringify(defaultDevelop());
}

export function develop(a: Img, p: DevelopParams, ctx: { width: number; height: number; ox?: number; oy?: number } = { width: a.w, height: a.h }): Img {
  const { w, h } = a;
  const n = w * h;
  const out = cloneImg(a);
  const d = out.data;
  // 1. White balance and exposure in linear light.
  const t = p.temp / 100,
    ti = p.tint / 100;
  const gR = Math.pow(2, t * 0.6 - ti * 0.15),
    gG = Math.pow(2, ti * 0.35),
    gB = Math.pow(2, -t * 0.6 - ti * 0.15);
  const evK = Math.pow(2, p.exposure);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    d[o] = l2s(clamp(s2l(d[o]!) * gR * evK));
    d[o + 1] = l2s(clamp(s2l(d[o + 1]!) * gG * evK));
    d[o + 2] = l2s(clamp(s2l(d[o + 2]!) * gB * evK));
  }
  // 2. Tone: highlights and shadows follow a smoothed brightness (local), whites/blacks the ends, contrast an S.
  const needLocal = p.highlights || p.shadows || p.clarity || p.texture || p.dehaze;
  let Lb: Img | null = null,
    Lt: Img | null = null;
  const L = img(w, h, 1);
  for (let i = 0; i < n; i++) L.data[i] = 0.2126 * d[i * 4]! + 0.7152 * d[i * 4 + 1]! + 0.0722 * d[i * 4 + 2]!;
  if (needLocal) {
    const r = Math.max(4, Math.min(w, h) / 40);
    Lb = { ...L, data: guided(L.data, L.data, w, h, Math.round(r), 0.01) };
    if (p.texture) Lt = gaussianBlur(L, Math.max(1.5, Math.min(w, h) / 600));
  }
  const hi = p.highlights / 100,
    sh = p.shadows / 100,
    wh = p.whites / 100,
    bl = p.blacks / 100,
    co = p.contrast / 100;
  const cla = p.clarity / 100,
    tex = p.texture / 100,
    dh = p.dehaze / 100;
  const curve = curveTable(p.curve, 1024);
  const curveId = p.curve.length === 2 && p.curve[0]![0] === 0 && p.curve[0]![1] === 0 && p.curve[1]![0] === 1 && p.curve[1]![1] === 1;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const l0 = L.data[i]!;
    let l = l0;
    if (Lb) {
      const b = Lb.data[i]!;
      // Highlights pull bright areas down (negative) or up; shadows the reverse.
      l += hi * smooth(0.45, 0.95, b) * (hi < 0 ? l : 1 - l) * 0.9;
      l += sh * smooth(0.55, 0.05, b) * (sh > 0 ? 1 - l : l) * 0.9;
      if (cla) l += (l0 - b) * cla * 1.6 * (1 - Math.abs(2 * l0 - 1) * 0.6);
      if (tex && Lt) l += (l0 - Lt.data[i]!) * tex * 2.2;
      if (dh) {
        // Dehaze: deepen low-contrast bright haze (positive) or add it (negative).
        const haze = smooth(0.3, 0.9, b);
        l = dh > 0 ? l - dh * haze * 0.35 * (l - (l - b) * 0.5) * 0.8 : l + -dh * (1 - l) * 0.4;
      }
    }
    // Whites and blacks: move the ends.
    l = l + wh * smooth(0.6, 1, l) * 0.25 + bl * smooth(0.4, 0, l) * 0.25;
    // Contrast: an S-curve about the middle.
    if (co) {
      const s = l < 0.5 ? 0.5 * Math.pow(2 * Math.max(0, l), 1 + co) : 1 - 0.5 * Math.pow(2 * Math.max(0, 1 - l), 1 + co);
      l = co > 0 ? s : l + (0.5 - l) * -co * 0.5;
    }
    l = clamp(l);
    if (!curveId) {
      const x = l * 1023;
      const k = Math.min(1022, Math.floor(x));
      l = curve[k]! + (curve[k + 1]! - curve[k]!) * (x - k);
    }
    const k = l0 > 1e-4 ? l / l0 : 0;
    for (let c = 0; c < 3; c++) d[o + c] = l0 > 1e-4 ? clamp(d[o + c]! * k) : l;
    if (dh > 0 && Lb) {
      // Dehaze also brings back color.
      const m = (d[o]! + d[o + 1]! + d[o + 2]!) / 3;
      for (let c = 0; c < 3; c++) d[o + c] = clamp(m + (d[o + c]! - m) * (1 + dh * 0.5));
    }
  }
  // 3. Color: HSL by color, vibrance, saturation, grading.
  const hsl = p.hsl;
  const hslOn = HSL_COLORS.some((c) => hsl[c].h || hsl[c].s || hsl[c].l);
  const vib = p.vibrance / 100,
    sat = p.saturation / 100;
  const g = p.grade;
  const gradeOn = g.shadows.sat || g.midtones.sat || g.highlights.sat || g.shadows.lum || g.midtones.lum || g.highlights.lum;
  const tintOf = (hue: number, s: number) => {
    const c = hslToRgb(hue / 360, 1, 0.5);
    return c.map((v) => (v - 0.5) * s * 0.4);
  };
  const tS = tintOf(g.shadows.hue, g.shadows.sat / 100),
    tM = tintOf(g.midtones.hue, g.midtones.sat / 100),
    tH = tintOf(g.highlights.hue, g.highlights.sat / 100);
  const bal = g.balance / 100,
    blend = 0.15 + (g.blending / 100) * 0.35;
  if (hslOn || vib || sat || gradeOn) {
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      let r = d[o]!,
        gg = d[o + 1]!,
        b = d[o + 2]!;
      if (hslOn) {
        const [hh, ss, ll] = rgbToHsl(r, gg, b);
        if (ss > 0.001) {
          const deg = hh * 360;
          let dhue = 0,
            dsat = 0,
            dl = 0,
            wsum = 0;
          for (const c of HSL_COLORS) {
            let dd = Math.abs(deg - HSL_CENTERS[c]);
            if (dd > 180) dd = 360 - dd;
            const wt = Math.max(0, 1 - dd / 40);
            if (wt <= 0) continue;
            dhue += hsl[c].h * wt;
            dsat += hsl[c].s * wt;
            dl += hsl[c].l * wt;
            wsum += wt;
          }
          if (wsum > 0) {
            const nh = (((hh + (dhue * 0.3) / 360) % 1) + 1) % 1;
            const ns = clamp(ss * (1 + dsat / 100));
            const nl = clamp(ll + (dl / 100) * ss * 0.4);
            [r, gg, b] = hslToRgb(nh, ns, nl);
          }
        }
      }
      if (vib || sat) {
        const m = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
        const s = Math.max(r, gg, b) - Math.min(r, gg, b);
        const k = 1 + sat + vib * (1 - s) * (1 - s);
        r = clamp(m + (r - m) * k);
        gg = clamp(m + (gg - m) * k);
        b = clamp(m + (b - m) * k);
      }
      if (gradeOn) {
        const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
        const ws = smooth(0.5 + bal * 0.3 + blend, 0.5 + bal * 0.3 - blend - 0.3, l);
        const whh = smooth(0.5 + bal * 0.3 - blend, 0.5 + bal * 0.3 + blend + 0.3, l);
        const wm = Math.max(0, 1 - ws - whh);
        const lum = (g.shadows.lum * ws + g.midtones.lum * wm + g.highlights.lum * whh) / 100;
        r = clamp(r + tS[0]! * ws + tM[0]! * wm + tH[0]! * whh + lum * 0.3);
        gg = clamp(gg + tS[1]! * ws + tM[1]! * wm + tH[1]! * whh + lum * 0.3);
        b = clamp(b + tS[2]! * ws + tM[2]! * wm + tH[2]! * whh + lum * 0.3);
      }
      d[o] = r;
      d[o + 1] = gg;
      d[o + 2] = b;
    }
  }
  let res: Img = out;
  // 4. Detail.
  if (p.noise.luminance > 0 || p.noise.color > 0) {
    const Y = new Float32Array(n),
      Cb = new Float32Array(n),
      Cr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      Y[i] = 0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!;
      Cb[i] = d[i * 4 + 2]! - Y[i]!;
      Cr[i] = d[i * 4]! - Y[i]!;
    }
    const Ys = p.noise.luminance > 0 ? guided(Y, Y, w, h, Math.round(1 + p.noise.luminance / 25), (0.0002 + p.noise.luminance * 0.00006) * (1.5 - p.noise.detail / 100)) : Y;
    const Cbs = p.noise.color > 0 ? guided(Ys, Cb, w, h, Math.round(2 + p.noise.color / 10), 0.001 + p.noise.color * 0.0004) : Cb;
    const Crs = p.noise.color > 0 ? guided(Ys, Cr, w, h, Math.round(2 + p.noise.color / 10), 0.001 + p.noise.color * 0.0004) : Cr;
    for (let i = 0; i < n; i++) {
      const R = Ys[i]! + Crs[i]!,
        B = Ys[i]! + Cbs[i]!;
      d[i * 4] = clamp(R);
      d[i * 4 + 2] = clamp(B);
      d[i * 4 + 1] = clamp((Ys[i]! - 0.299 * R - 0.114 * B) / 0.587);
    }
  }
  if (p.sharpen.amount > 0) {
    const sharp = unsharpMask(res, p.sharpen.amount, p.sharpen.radius, 0);
    // Masking: sharpen only where there are edges.
    if (p.sharpen.masking > 0) {
      const Lm = img(w, h, 1);
      for (let i = 0; i < n; i++) Lm.data[i] = 0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!;
      const thr = (p.sharpen.masking / 100) * 0.08;
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const gm = Math.abs(Lm.data[i + 1]! - Lm.data[i - 1]!) + Math.abs(Lm.data[i + w]! - Lm.data[i - w]!);
          const k = smooth(thr * 0.5, thr * 1.5, gm);
          for (let c = 0; c < 3; c++) sharp.data[i * 4 + c] = d[i * 4 + c]! + (sharp.data[i * 4 + c]! - d[i * 4 + c]!) * k;
        }
    }
    res = sharp;
  }
  // 5. Lens vignetting, post-crop vignette and grain.
  const W = ctx.width,
    H = ctx.height,
    ox = ctx.ox ?? 0,
    oy = ctx.oy ?? 0;
  const lv = p.lens.vignetting / 100,
    ev = p.effects.vignette / 100;
  const grain = p.effects.grain / 100;
  if (lv || ev || grain) {
    const rd = res.data;
    const rand = new Rand(17 + oy * 31 + ox);
    const gs = Math.max(1, p.effects.grainSize / 12);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const u = ((x + ox + 0.5) / W) * 2 - 1,
          v = ((y + oy + 0.5) / H) * 2 - 1;
        const round = p.effects.roundness / 100;
        const ar = W / H;
        const uu = u * (round >= 0 ? 1 : 1) * (1 + round * (ar > 1 ? ar - 1 : 0) * 0.5);
        const rr = Math.hypot(uu, v) / Math.SQRT2;
        if (lv) {
          const f = 1 + lv * rr * rr * 1.2;
          for (let c = 0; c < 3; c++) rd[o + c] = clamp(rd[o + c]! * f);
        }
        if (ev) {
          const mid = 0.2 + (p.effects.midpoint / 100) * 0.7;
          const fe = 0.05 + (p.effects.feather / 100) * 0.9;
          const t2 = smooth(mid - fe * 0.5, mid + fe * 0.5, rr);
          for (let c = 0; c < 3; c++) rd[o + c] = clamp(ev < 0 ? rd[o + c]! * (1 + ev * t2) : rd[o + c]! + (1 - rd[o + c]!) * ev * t2);
        }
        if (grain) {
          // Clumped noise: coarser with size, rougher with roughness.
          const gx = Math.floor((x + ox) / gs),
            gy = Math.floor((y + oy) / gs);
          const hsh = (((Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663)) >>> 0) % 10007) / 10007;
          const nz = (hsh - 0.5) * (p.effects.grainRoughness / 50) + (rand.next() - 0.5) * (1 - p.effects.grainRoughness / 100);
          const l = 0.299 * rd[o]! + 0.587 * rd[o + 1]! + 0.114 * rd[o + 2]!;
          const amt = nz * grain * 0.35 * (1 - Math.abs(2 * l - 1) * 0.5);
          for (let c = 0; c < 3; c++) rd[o + c] = clamp(rd[o + c]! + amt);
        }
      }
  }
  return res;
}

export const DEVELOP_FILTER: FilterDef = {
  id: 'cameraRaw',
  name: 'Camera Raw Filter',
  menu: '',
  params: [],
  run: (a, p, c) => develop(a, { ...defaultDevelop(), ...(p as Partial<DevelopParams>) } as DevelopParams, c),
  reach: () => Infinity,
  dialog: true,
  smart: true,
  hidden: true,
};

export type { Params };
