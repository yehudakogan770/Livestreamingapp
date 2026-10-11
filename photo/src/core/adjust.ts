// Adjustments: the 16 Photoshop adjustment layers, each a per-pixel color
// function. The GPU applies them as lookup tables built from these same
// functions (1D tables for the per-channel ones, a 3D table for the rest), so
// there is one definition of each adjustment. Colors are 0..1, encoded in
// the document's space.

import { decode, encode, hslToRgb, lum, rgbToHsl, type ToneCurve } from './color';
import { sampleGradient, type Gradient } from './gradient';

export type AdjustmentType =
  | 'brightnessContrast'
  | 'levels'
  | 'curves'
  | 'exposure'
  | 'vibrance'
  | 'hueSaturation'
  | 'colorBalance'
  | 'blackWhite'
  | 'photoFilter'
  | 'channelMixer'
  | 'colorLookup'
  | 'invert'
  | 'posterize'
  | 'threshold'
  | 'gradientMap'
  | 'selectiveColor';

export const ADJUSTMENT_NAMES: Record<AdjustmentType, string> = {
  brightnessContrast: 'Brightness/Contrast',
  levels: 'Levels',
  curves: 'Curves',
  exposure: 'Exposure',
  vibrance: 'Vibrance',
  hueSaturation: 'Hue/Saturation',
  colorBalance: 'Color Balance',
  blackWhite: 'Black & White',
  photoFilter: 'Photo Filter',
  channelMixer: 'Channel Mixer',
  colorLookup: 'Color Lookup',
  invert: 'Invert',
  posterize: 'Posterize',
  threshold: 'Threshold',
  gradientMap: 'Gradient Map',
  selectiveColor: 'Selective Color',
};

/** The order of Photoshop's Adjustments panel. */
export const ADJUSTMENT_ORDER: AdjustmentType[] = [
  'brightnessContrast',
  'levels',
  'curves',
  'exposure',
  'vibrance',
  'hueSaturation',
  'colorBalance',
  'blackWhite',
  'photoFilter',
  'channelMixer',
  'colorLookup',
  'invert',
  'posterize',
  'threshold',
  'gradientMap',
  'selectiveColor',
];

export interface LevelsChannel {
  inBlack: number;
  inWhite: number;
  gamma: number;
  outBlack: number;
  outWhite: number;
}

export type CurvePoints = [number, number][];

export interface HueRange {
  hue: number;
  sat: number;
  light: number;
  /** The range's hue span in degrees: [falloff start, full start, full end, falloff end]. */
  span: [number, number, number, number];
}

export interface CMYK {
  c: number;
  m: number;
  y: number;
  k: number;
}

export interface Lut3D {
  name: string;
  size: number;
  /** RGB triples, red fastest. */
  data: Float32Array;
  min: [number, number, number];
  max: [number, number, number];
}

export interface ParamsMap {
  brightnessContrast: { brightness: number; contrast: number; legacy: boolean };
  levels: { rgb: LevelsChannel; r: LevelsChannel; g: LevelsChannel; b: LevelsChannel };
  curves: { rgb: CurvePoints; r: CurvePoints; g: CurvePoints; b: CurvePoints };
  exposure: { exposure: number; offset: number; gamma: number };
  vibrance: { vibrance: number; saturation: number };
  hueSaturation: {
    master: { hue: number; sat: number; light: number };
    ranges: Record<'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas', HueRange>;
    colorize: boolean;
    colorizeHue: number;
    colorizeSat: number;
    colorizeLight: number;
  };
  colorBalance: { shadows: [number, number, number]; midtones: [number, number, number]; highlights: [number, number, number]; preserve: boolean };
  blackWhite: { reds: number; yellows: number; greens: number; cyans: number; blues: number; magentas: number; tint: boolean; tintHue: number; tintSat: number };
  photoFilter: { color: [number, number, number]; density: number; preserve: boolean };
  channelMixer: { r: [number, number, number, number]; g: [number, number, number, number]; b: [number, number, number, number]; mono: boolean };
  colorLookup: { lut: Lut3D | null };
  invert: Record<string, never>;
  posterize: { levels: number };
  threshold: { level: number };
  gradientMap: { gradient: Gradient; reverse: boolean };
  selectiveColor: { relative: boolean; ranges: Record<SelectiveRange, CMYK> };
}

export type SelectiveRange = 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas' | 'whites' | 'neutrals' | 'blacks';
export const SELECTIVE_RANGES: SelectiveRange[] = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'];

export type AdjustmentParams = ParamsMap[AdjustmentType];

const lv = (): LevelsChannel => ({ inBlack: 0, inWhite: 1, gamma: 1, outBlack: 0, outWhite: 1 });
const line = (): CurvePoints => [
  [0, 0],
  [1, 1],
];
const hr = (span: [number, number, number, number]): HueRange => ({ hue: 0, sat: 0, light: 0, span });
const zero = (): CMYK => ({ c: 0, m: 0, y: 0, k: 0 });

export function defaultParams<T extends AdjustmentType>(t: T): ParamsMap[T] {
  const d: ParamsMap = {
    brightnessContrast: { brightness: 0, contrast: 0, legacy: false },
    levels: { rgb: lv(), r: lv(), g: lv(), b: lv() },
    curves: { rgb: line(), r: line(), g: line(), b: line() },
    exposure: { exposure: 0, offset: 0, gamma: 1 },
    vibrance: { vibrance: 0, saturation: 0 },
    hueSaturation: {
      master: { hue: 0, sat: 0, light: 0 },
      ranges: {
        reds: hr([315, 345, 15, 45]),
        yellows: hr([15, 45, 75, 105]),
        greens: hr([75, 105, 135, 165]),
        cyans: hr([135, 165, 195, 225]),
        blues: hr([195, 225, 255, 285]),
        magentas: hr([255, 285, 315, 345]),
      },
      colorize: false,
      colorizeHue: 0,
      colorizeSat: 25,
      colorizeLight: 0,
    },
    colorBalance: { shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserve: true },
    blackWhite: { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, tint: false, tintHue: 35, tintSat: 25 },
    photoFilter: { color: [0.925, 0.541, 0], density: 0.25, preserve: true },
    channelMixer: { r: [100, 0, 0, 0], g: [0, 100, 0, 0], b: [0, 0, 100, 0], mono: false },
    colorLookup: { lut: null },
    invert: {},
    posterize: { levels: 4 },
    threshold: { level: 128 },
    gradientMap: {
      gradient: {
        name: 'Black, White',
        stops: [
          { pos: 0, color: [0, 0, 0] },
          { pos: 1, color: [1, 1, 1] },
        ],
        alphas: [
          { pos: 0, alpha: 1 },
          { pos: 1, alpha: 1 },
        ],
      },
      reverse: false,
    },
    selectiveColor: {
      relative: true,
      ranges: { reds: zero(), yellows: zero(), greens: zero(), cyans: zero(), blues: zero(), magentas: zero(), whites: zero(), neutrals: zero(), blacks: zero() },
    },
  };
  return structuredClone(d[t]) as ParamsMap[T];
}

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---- curves: a natural cubic spline through the points ----

export function curveTable(points: CurvePoints, n = 1024): Float32Array {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const out = new Float32Array(n);
  if (pts.length === 0) {
    for (let i = 0; i < n; i++) out[i] = i / (n - 1);
    return out;
  }
  if (pts.length === 1) {
    out.fill(clamp(pts[0]![1]));
    return out;
  }
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const m = xs.length;
  // Second derivatives (natural spline).
  const y2 = new Float64Array(m),
    u = new Float64Array(m);
  for (let i = 1; i < m - 1; i++) {
    const sig = (xs[i]! - xs[i - 1]!) / (xs[i + 1]! - xs[i - 1]! || 1e-9);
    const p = sig * y2[i - 1]! + 2;
    y2[i] = (sig - 1) / p;
    const dy1 = (ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]! || 1e-9);
    const dy0 = (ys[i]! - ys[i - 1]!) / (xs[i]! - xs[i - 1]! || 1e-9);
    u[i] = ((6 * (dy1 - dy0)) / (xs[i + 1]! - xs[i - 1]! || 1e-9) - sig * u[i - 1]!) / p;
  }
  for (let k = m - 2; k >= 0; k--) y2[k] = y2[k]! * y2[k + 1]! + u[k]!;
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    let y: number;
    if (x <= xs[0]!) y = ys[0]!;
    else if (x >= xs[m - 1]!) y = ys[m - 1]!;
    else {
      let lo = 0,
        hi = m - 1;
      while (hi - lo > 1) {
        const k = (hi + lo) >> 1;
        if (xs[k]! > x) hi = k;
        else lo = k;
      }
      const h = xs[hi]! - xs[lo]! || 1e-9;
      const a = (xs[hi]! - x) / h,
        b = (x - xs[lo]!) / h;
      y = a * ys[lo]! + b * ys[hi]! + ((a * a * a - a) * y2[lo]! + (b * b * b - b) * y2[hi]!) * (h * h) / 6;
    }
    out[i] = clamp(y);
  }
  return out;
}

const lookup = (t: Float32Array, v: number) => {
  const x = clamp(v) * (t.length - 1);
  const i = Math.min(t.length - 2, Math.floor(x));
  const f = x - i;
  return t[i]! * (1 - f) + t[i + 1]! * f;
};

export function levelsFn(c: LevelsChannel): (v: number) => number {
  const span = Math.max(1e-6, c.inWhite - c.inBlack);
  const g = 1 / Math.max(0.01, c.gamma);
  return (v) => {
    const x = clamp((v - c.inBlack) / span);
    return c.outBlack + (c.outWhite - c.outBlack) * Math.pow(x, g);
  };
}

function brightnessContrastFn(p: ParamsMap['brightnessContrast']): (v: number) => number {
  const b = p.brightness,
    c = p.contrast;
  if (p.legacy) {
    const k = c >= 0 ? 1 / Math.max(0.01, 1 - c / 100) : 1 + c / 100;
    return (v) => clamp((v + b / 255 - 0.5) * k + 0.5);
  }
  // Brightness bends the midtones (ends stay put); contrast is an S-curve around the middle.
  const g = Math.pow(2, -b / 100);
  return (v) => {
    let x = Math.pow(clamp(v), g);
    if (c > 0) {
      const s = x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
      x = x + (c / 100) * (s - x);
    } else if (c < 0) x = 0.5 + (x - 0.5) * (1 + c / 100);
    return clamp(x);
  };
}

/** Hue weights for Hue/Saturation's ranges (0..1). */
function rangeWeight(hueDeg: number, span: [number, number, number, number]): number {
  const [a, b, c, d] = span;
  const rel = (x: number) => (((x - a) % 360) + 360) % 360;
  const h = rel(hueDeg),
    B = rel(b),
    C = rel(c),
    D = rel(d);
  if (h <= B) return B === 0 ? 1 : h / B;
  if (h <= C) return 1;
  if (h <= D) return D === C ? 0 : 1 - (h - C) / (D - C);
  return 0;
}

const SECONDARY: Record<string, string> = { rg: 'yellows', gr: 'yellows', rb: 'magentas', br: 'magentas', gb: 'cyans', bg: 'cyans' };
const PRIMARY = ['reds', 'greens', 'blues'] as const;

/** A per-pixel function for an adjustment: (r, g, b) in, written to out. */
export type PixelFn = (r: number, g: number, b: number, out: number[]) => void;

export interface AdjustContext {
  /** The document's tone curve (Exposure works in linear light). */
  trc: ToneCurve;
}

export function pixelFn(type: AdjustmentType, params: AdjustmentParams, ctx: AdjustContext = { trc: { type: 'srgb' } }): PixelFn {
  switch (type) {
    case 'brightnessContrast': {
      const f = brightnessContrastFn(params as ParamsMap['brightnessContrast']);
      return (r, g, b, o) => {
        o[0] = f(r);
        o[1] = f(g);
        o[2] = f(b);
      };
    }
    case 'levels': {
      const p = params as ParamsMap['levels'];
      const m = levelsFn(p.rgb),
        fr = levelsFn(p.r),
        fg = levelsFn(p.g),
        fb = levelsFn(p.b);
      return (r, g, b, o) => {
        o[0] = m(fr(r));
        o[1] = m(fg(g));
        o[2] = m(fb(b));
      };
    }
    case 'curves': {
      const p = params as ParamsMap['curves'];
      const m = curveTable(p.rgb),
        tr = curveTable(p.r),
        tg = curveTable(p.g),
        tb = curveTable(p.b);
      return (r, g, b, o) => {
        o[0] = lookup(m, lookup(tr, r));
        o[1] = lookup(m, lookup(tg, g));
        o[2] = lookup(m, lookup(tb, b));
      };
    }
    case 'exposure': {
      const p = params as ParamsMap['exposure'];
      const k = Math.pow(2, p.exposure);
      const ig = 1 / Math.max(0.01, p.gamma);
      const f = (v: number) => {
        const lin = decode(ctx.trc, clamp(v)) * k + p.offset;
        return clamp(encode(ctx.trc, Math.pow(Math.max(0, lin), ig)));
      };
      return (r, g, b, o) => {
        o[0] = f(r);
        o[1] = f(g);
        o[2] = f(b);
      };
    }
    case 'vibrance': {
      const p = params as ParamsMap['vibrance'];
      const vib = p.vibrance / 100,
        sat = p.saturation / 100;
      return (r, g, b, o) => {
        const l = lum(r, g, b);
        const mx = Math.max(r, g, b),
          mn = Math.min(r, g, b);
        const s = mx - mn;
        // Vibrance: strong on dull colors, gentle on vivid ones and on skin (red over green over blue).
        const skin = r > g && g > b ? 0.5 : 1;
        const kv = vib >= 0 ? vib * (1 - s) * (1 - s) * skin : vib * (1 - s * 0.5);
        const k = 1 + sat + kv;
        o[0] = clamp(l + (r - l) * k);
        o[1] = clamp(l + (g - l) * k);
        o[2] = clamp(l + (b - l) * k);
      };
    }
    case 'hueSaturation': {
      const p = params as ParamsMap['hueSaturation'];
      if (p.colorize) {
        const h = p.colorizeHue / 360,
          s = p.colorizeSat / 100,
          L = p.colorizeLight / 100;
        return (r, g, b, o) => {
          let l = lum(r, g, b);
          l = L >= 0 ? l + (1 - l) * L : l * (1 + L);
          const c = hslToRgb(h, s, l);
          o[0] = c[0];
          o[1] = c[1];
          o[2] = c[2];
        };
      }
      const ranges = Object.values(p.ranges);
      return (r, g, b, o) => {
        const [h, s, l] = rgbToHsl(r, g, b);
        const deg = h * 360;
        let dh = p.master.hue,
          ds = p.master.sat,
          dl = p.master.light;
        for (const rg of ranges) {
          if (!rg.hue && !rg.sat && !rg.light) continue;
          const w = s > 0 ? rangeWeight(deg, rg.span) : 0;
          dh += rg.hue * w;
          ds += rg.sat * w;
          dl += rg.light * w;
        }
        const s2 = clamp(s * (1 + ds / 100));
        let c = hslToRgb((((h + dh / 360) % 1) + 1) % 1, s2, l);
        const Lk = dl / 100;
        if (Lk > 0) c = [c[0] + (1 - c[0]) * Lk, c[1] + (1 - c[1]) * Lk, c[2] + (1 - c[2]) * Lk];
        else if (Lk < 0) c = [c[0] * (1 + Lk), c[1] * (1 + Lk), c[2] * (1 + Lk)];
        o[0] = clamp(c[0]);
        o[1] = clamp(c[1]);
        o[2] = clamp(c[2]);
      };
    }
    case 'colorBalance': {
      const p = params as ParamsMap['colorBalance'];
      const a = 0.25,
        bb = 0.333,
        sc = 0.7;
      return (r, g, b, o) => {
        const l0 = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
        const sh = clamp((l0 - bb) / -a + 0.5) * sc;
        const mid = clamp((l0 - bb) / a + 0.5) * clamp((l0 + bb - 1) / -a + 0.5) * sc;
        const hi = clamp((l0 + bb - 1) / a + 0.5) * sc;
        const d = [0, 1, 2].map((i) => (p.shadows[i]! * sh + p.midtones[i]! * mid + p.highlights[i]! * hi) / 100);
        let c: [number, number, number] = [clamp(r + d[0]!), clamp(g + d[1]!), clamp(b + d[2]!)];
        if (p.preserve) {
          const [hh, ss] = rgbToHsl(c[0], c[1], c[2]);
          c = hslToRgb(hh, ss, l0);
        }
        o[0] = c[0];
        o[1] = c[1];
        o[2] = c[2];
      };
    }
    case 'blackWhite': {
      const p = params as ParamsMap['blackWhite'];
      const W: Record<string, number> = { reds: p.reds / 100, yellows: p.yellows / 100, greens: p.greens / 100, cyans: p.cyans / 100, blues: p.blues / 100, magentas: p.magentas / 100 };
      const tint = p.tint ? hslToRgb(p.tintHue / 360, p.tintSat / 100, 0.5) : null;
      return (r, g, b, o) => {
        const ch = [r, g, b];
        const idx = [0, 1, 2].sort((x, y) => ch[y]! - ch[x]!);
        const [iMax, iMid, iMin] = idx as [number, number, number];
        const mx = ch[iMax]!,
          md = ch[iMid]!,
          mn = ch[iMin]!;
        const names = 'rgb';
        const prim = W[PRIMARY[iMax]!]!;
        const sec = W[SECONDARY[names[iMax]! + names[iMid]!]!]!;
        const gray = clamp(mn + (md - mn) * sec + (mx - md) * prim);
        if (tint) {
          // Tint like Color mode over the gray.
          const [hh, ss] = rgbToHsl(tint[0], tint[1], tint[2]);
          const c = hslToRgb(hh, ss * (1 - Math.abs(2 * gray - 1)), gray);
          o[0] = c[0];
          o[1] = c[1];
          o[2] = c[2];
          return;
        }
        o[0] = o[1] = o[2] = gray;
      };
    }
    case 'photoFilter': {
      const p = params as ParamsMap['photoFilter'];
      const [fr, fg, fb] = p.color;
      return (r, g, b, o) => {
        let c: [number, number, number] = [r + (r * fr - r) * p.density * 1.6, g + (g * fg - g) * p.density * 1.6, b + (b * fb - b) * p.density * 1.6];
        c = [clamp(c[0]), clamp(c[1]), clamp(c[2])];
        if (p.preserve) {
          const d = lum(r, g, b) - lum(c[0], c[1], c[2]);
          c = [clamp(c[0] + d), clamp(c[1] + d), clamp(c[2] + d)];
        }
        o[0] = c[0];
        o[1] = c[1];
        o[2] = c[2];
      };
    }
    case 'channelMixer': {
      const p = params as ParamsMap['channelMixer'];
      const row = (m: [number, number, number, number], r: number, g: number, b: number) => clamp((m[0] * r + m[1] * g + m[2] * b) / 100 + m[3] / 100);
      return (r, g, b, o) => {
        if (p.mono) {
          o[0] = o[1] = o[2] = row(p.r, r, g, b);
          return;
        }
        o[0] = row(p.r, r, g, b);
        o[1] = row(p.g, r, g, b);
        o[2] = row(p.b, r, g, b);
      };
    }
    case 'colorLookup': {
      const p = params as ParamsMap['colorLookup'];
      const lut = p.lut;
      if (!lut) return (r, g, b, o) => ((o[0] = r), (o[1] = g), (o[2] = b));
      return (r, g, b, o) => sampleLut(lut, r, g, b, o);
    }
    case 'invert':
      return (r, g, b, o) => {
        o[0] = 1 - r;
        o[1] = 1 - g;
        o[2] = 1 - b;
      };
    case 'posterize': {
      const n = Math.max(2, Math.round((params as ParamsMap['posterize']).levels));
      const f = (v: number) => Math.min(n - 1, Math.floor(clamp(v) * n)) / (n - 1);
      return (r, g, b, o) => {
        o[0] = f(r);
        o[1] = f(g);
        o[2] = f(b);
      };
    }
    case 'threshold': {
      const t = (params as ParamsMap['threshold']).level / 255;
      return (r, g, b, o) => {
        o[0] = o[1] = o[2] = 0.299 * r + 0.587 * g + 0.114 * b >= t ? 1 : 0;
      };
    }
    case 'gradientMap': {
      const p = params as ParamsMap['gradientMap'];
      return (r, g, b, o) => {
        const l = clamp(0.299 * r + 0.587 * g + 0.114 * b);
        const c = sampleGradient(p.gradient, p.reverse ? 1 - l : l);
        o[0] = c[0];
        o[1] = c[1];
        o[2] = c[2];
      };
    }
    case 'selectiveColor':
      return selectiveColorFn(params as ParamsMap['selectiveColor']);
  }
}

function selectiveColorFn(p: ParamsMap['selectiveColor']): PixelFn {
  const ranges = p.ranges;
  return (r, g, b, o) => {
    const ch = [r, g, b];
    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b);
    const md = r + g + b - mx - mn;
    const weights: [SelectiveRange, number][] = [];
    // Primary: the largest channel's color, by how far it leads the middle one.
    const iMax = ch.indexOf(mx);
    const iMin = ch.indexOf(mn);
    weights.push([(['reds', 'greens', 'blues'] as const)[iMax]!, mx - md]);
    // Secondary: the color opposite the smallest channel, by how far the middle one leads it.
    weights.push([(['cyans', 'magentas', 'yellows'] as const)[iMin]!, md - mn]);
    if (mn > 0.5) weights.push(['whites', (mn - 0.5) * 2]);
    if (mx < 0.5) weights.push(['blacks', (0.5 - mx) * 2]);
    weights.push(['neutrals', Math.max(0, 1 - (Math.abs(mx - 0.5) + Math.abs(mn - 0.5)))]);
    const out = [r, g, b];
    for (const [name, w] of weights) {
      if (w <= 0) continue;
      const a = ranges[name];
      if (!a.c && !a.m && !a.y && !a.k) continue;
      const adj = [a.c / 100, a.m / 100, a.y / 100];
      const k = a.k / 100;
      for (let i = 0; i < 3; i++) {
        const ink = 1 - ch[i]!;
        const scale = p.relative ? ink : 1;
        let d = adj[i]! * scale + k * (p.relative ? ink : 1);
        d = Math.max(-ink, Math.min(1 - ink, d));
        out[i] = out[i]! - d * w;
      }
    }
    o[0] = clamp(out[0]!);
    o[1] = clamp(out[1]!);
    o[2] = clamp(out[2]!);
  };
}

/** Trilinear sample of a 3D LUT. */
export function sampleLut(lut: Lut3D, r: number, g: number, b: number, o: number[]): void {
  const n = lut.size;
  const f = (v: number, k: number) => clamp((v - lut.min[k]!) / (lut.max[k]! - lut.min[k]! || 1)) * (n - 1);
  const x = f(r, 0),
    y = f(g, 1),
    z = f(b, 2);
  const x0 = Math.min(n - 2, Math.floor(x)),
    y0 = Math.min(n - 2, Math.floor(y)),
    z0 = Math.min(n - 2, Math.floor(z));
  const dx = x - x0,
    dy = y - y0,
    dz = z - z0;
  const d = lut.data;
  for (let c = 0; c < 3; c++) {
    const at = (i: number, j: number, k: number) => d[((k * n + j) * n + i) * 3 + c]!;
    const c00 = at(x0, y0, z0) * (1 - dx) + at(x0 + 1, y0, z0) * dx;
    const c10 = at(x0, y0 + 1, z0) * (1 - dx) + at(x0 + 1, y0 + 1, z0) * dx;
    const c01 = at(x0, y0, z0 + 1) * (1 - dx) + at(x0 + 1, y0, z0 + 1) * dx;
    const c11 = at(x0, y0 + 1, z0 + 1) * (1 - dx) + at(x0 + 1, y0 + 1, z0 + 1) * dx;
    o[c] = (c00 * (1 - dy) + c10 * dy) * (1 - dz) + (c01 * (1 - dy) + c11 * dy) * dz;
  }
}

/** Read an Adobe / Resolve .cube 3D LUT. */
export function parseCube(text: string, name = 'LUT'): Lut3D {
  let size = 0;
  const min: [number, number, number] = [0, 0, 0],
    max: [number, number, number] = [1, 1, 1];
  const vals: number[] = [];
  let title = name;
  for (const raw of text.split(/\r?\n/)) {
    const ln = raw.trim();
    if (!ln || ln.startsWith('#')) continue;
    const parts = ln.split(/\s+/);
    const key = parts[0]!.toUpperCase();
    if (key === 'TITLE') title = ln.slice(5).trim().replace(/^"|"$/g, '') || name;
    else if (key === 'LUT_3D_SIZE') size = parseInt(parts[1]!, 10);
    else if (key === 'LUT_1D_SIZE') throw new Error('This is a 1D LUT; Color Lookup needs a 3D LUT (.cube).');
    else if (key === 'DOMAIN_MIN') parts.slice(1, 4).forEach((v, i) => (min[i] = parseFloat(v)));
    else if (key === 'DOMAIN_MAX') parts.slice(1, 4).forEach((v, i) => (max[i] = parseFloat(v)));
    else if (/^[-+.\deE]/.test(parts[0]!)) {
      if (parts.length < 3) continue;
      vals.push(parseFloat(parts[0]!), parseFloat(parts[1]!), parseFloat(parts[2]!));
    }
  }
  if (!(size >= 2 && size <= 256)) throw new Error('This .cube file has no LUT_3D_SIZE.');
  if (vals.length !== size * size * size * 3) throw new Error(`This .cube file should have ${size ** 3} entries but has ${vals.length / 3}.`);
  if (vals.some((v) => !Number.isFinite(v))) throw new Error('This .cube file has numbers that cannot be read.');
  return { name: title, size, data: new Float32Array(vals), min, max };
}

/** Write a 3D LUT as a .cube file (for Export Color Lookup Tables). */
export function writeCube(lut: Lut3D): string {
  const lines = [`TITLE "${lut.name}"`, `LUT_3D_SIZE ${lut.size}`];
  for (let i = 0; i < lut.data.length; i += 3) lines.push(`${lut.data[i]!.toFixed(6)} ${lut.data[i + 1]!.toFixed(6)} ${lut.data[i + 2]!.toFixed(6)}`);
  return lines.join('\n') + '\n';
}

// ---- compiled forms for the GPU ----

export type Compiled =
  | { kind: 'identity' }
  | { kind: 'lut1d'; n: number; data: Float32Array }
  | { kind: 'lut3d'; size: number; data: Float32Array }
  | { kind: 'threshold'; level: number };

const SEPARABLE = new Set<AdjustmentType>(['brightnessContrast', 'levels', 'curves', 'exposure', 'invert', 'posterize']);

/** Is an adjustment doing nothing (skipped when drawing)? */
export function isIdentity(type: AdjustmentType, params: AdjustmentParams): boolean {
  const z = defaultParams(type);
  if (type === 'invert' || type === 'posterize' || type === 'threshold' || type === 'gradientMap' || type === 'blackWhite' || type === 'photoFilter') return false;
  if (type === 'colorLookup') return !(params as ParamsMap['colorLookup']).lut;
  return JSON.stringify(params) === JSON.stringify(z);
}

/** A table form of the adjustment (RGBA float data; alpha unused). */
export function compile(type: AdjustmentType, params: AdjustmentParams, ctx?: AdjustContext): Compiled {
  if (isIdentity(type, params)) return { kind: 'identity' };
  if (type === 'threshold') return { kind: 'threshold', level: (params as ParamsMap['threshold']).level / 255 };
  const fn = pixelFn(type, params, ctx);
  const o = [0, 0, 0];
  if (SEPARABLE.has(type)) {
    const n = type === 'posterize' ? 4096 : 1024;
    const data = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const v = i / (n - 1);
      fn(v, v, v, o);
      data[i * 4] = o[0]!;
      data[i * 4 + 1] = o[1]!;
      data[i * 4 + 2] = o[2]!;
      data[i * 4 + 3] = 1;
    }
    return { kind: 'lut1d', n, data };
  }
  const size = 33;
  const data = new Float32Array(size * size * size * 4);
  let at = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        fn(r / (size - 1), g / (size - 1), b / (size - 1), o);
        data[at++] = o[0]!;
        data[at++] = o[1]!;
        data[at++] = o[2]!;
        data[at++] = 1;
      }
  return { kind: 'lut3d', size, data };
}

/** Apply a compiled table to one color (what the GPU does). */
export function applyCompiled(c: Compiled, r: number, g: number, b: number, o: number[]): void {
  switch (c.kind) {
    case 'identity':
      o[0] = r;
      o[1] = g;
      o[2] = b;
      return;
    case 'threshold':
      o[0] = o[1] = o[2] = 0.299 * r + 0.587 * g + 0.114 * b >= c.level ? 1 : 0;
      return;
    case 'lut1d': {
      const n = c.n;
      const f = (v: number, k: number) => {
        const x = clamp(v) * (n - 1);
        const i = Math.min(n - 2, Math.floor(x));
        const t = x - i;
        return c.data[i * 4 + k]! * (1 - t) + c.data[(i + 1) * 4 + k]! * t;
      };
      o[0] = f(r, 0);
      o[1] = f(g, 1);
      o[2] = f(b, 2);
      return;
    }
    case 'lut3d': {
      const n = c.size;
      const x = clamp(r) * (n - 1),
        y = clamp(g) * (n - 1),
        z = clamp(b) * (n - 1);
      const x0 = Math.min(n - 2, Math.floor(x)),
        y0 = Math.min(n - 2, Math.floor(y)),
        z0 = Math.min(n - 2, Math.floor(z));
      const dx = x - x0,
        dy = y - y0,
        dz = z - z0;
      for (let k = 0; k < 3; k++) {
        const at = (i: number, j: number, l: number) => c.data[((l * n + j) * n + i) * 4 + k]!;
        const c00 = at(x0, y0, z0) * (1 - dx) + at(x0 + 1, y0, z0) * dx;
        const c10 = at(x0, y0 + 1, z0) * (1 - dx) + at(x0 + 1, y0 + 1, z0) * dx;
        const c01 = at(x0, y0, z0 + 1) * (1 - dx) + at(x0 + 1, y0, z0 + 1) * dx;
        const c11 = at(x0, y0 + 1, z0 + 1) * (1 - dx) + at(x0 + 1, y0 + 1, z0 + 1) * dx;
        o[k] = (c00 * (1 - dy) + c10 * dy) * (1 - dz) + (c01 * (1 - dy) + c11 * dy) * dz;
      }
      return;
    }
  }
}

// ---- auto tone / contrast / color (Levels from the histogram) ----

/** Histogram of 256 bins per channel (r, g, b, luminosity) from RGBA floats. */
export function histogram(data: Float32Array, channels = 4, step = 1): Uint32Array[] {
  const h = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < data.length; i += channels * step) {
    if (channels === 4 && data[i + 3]! <= 0) continue;
    const r = clamp(data[i]!),
      g = clamp(data[i + 1]!),
      b = clamp(data[i + 2]!);
    h[0]![Math.round(r * 255)]!++;
    h[1]![Math.round(g * 255)]!++;
    h[2]![Math.round(b * 255)]!++;
    h[3]![Math.round(lum(r, g, b) * 255)]!++;
  }
  return h;
}

/** The levels that clip `clip` (fraction) of the pixels at each end. */
function clipPoints(h: Uint32Array, clip: number): [number, number] {
  let total = 0;
  for (const v of h) total += v;
  if (total === 0) return [0, 1];
  const want = total * clip;
  let acc = 0,
    lo = 0,
    hi = 255;
  for (let i = 0; i < 256; i++) {
    acc += h[i]!;
    if (acc > want) {
      lo = i;
      break;
    }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += h[i]!;
    if (acc > want) {
      hi = i;
      break;
    }
  }
  if (hi <= lo) return [0, 1];
  return [lo / 255, hi / 255];
}

/** Auto Tone (each channel stretched), Auto Contrast (all together) or Auto Color (channels, midtones neutral). */
export function autoLevels(hist: Uint32Array[], mode: 'tone' | 'contrast' | 'color', clip = 0.001): ParamsMap['levels'] {
  const p = defaultParams('levels');
  if (mode === 'contrast') {
    const comb = new Uint32Array(256);
    for (let c = 0; c < 3; c++) for (let i = 0; i < 256; i++) comb[i] = comb[i]! + hist[c]![i]!;
    const [lo, hi] = clipPoints(comb, clip);
    p.rgb.inBlack = lo;
    p.rgb.inWhite = hi;
    return p;
  }
  const keys = ['r', 'g', 'b'] as const;
  keys.forEach((k, c) => {
    const [lo, hi] = clipPoints(hist[c]!, clip);
    p[k].inBlack = lo;
    p[k].inWhite = hi;
  });
  if (mode === 'color') {
    // Pull the channels' middle values together (neutral midtones).
    const mids = keys.map((k, c) => {
      const h = hist[c]!;
      let total = 0,
        acc = 0;
      for (const v of h) total += v;
      for (let i = 0; i < 256; i++) {
        acc += h[i]!;
        if (acc >= total / 2) return (i / 255 - p[k].inBlack) / Math.max(1e-3, p[k].inWhite - p[k].inBlack);
      }
      return 0.5;
    });
    const target = (mids[0]! + mids[1]! + mids[2]!) / 3;
    keys.forEach((k, c) => {
      const m = Math.min(0.95, Math.max(0.05, mids[c]!));
      p[k].gamma = Math.min(3, Math.max(0.33, Math.log(m) / Math.log(Math.min(0.95, Math.max(0.05, target)))));
    });
  }
  return p;
}
