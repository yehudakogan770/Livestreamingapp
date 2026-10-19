// The 27 Photoshop blend modes. The same math runs in the GPU compositor's
// shader (gpu/shaders.ts); this is the reference used by the CPU compositor,
// the painting tools and the tests. Colors are 0..1 straight alpha.
//
// Compositing follows the W3C Compositing and Blending model Photoshop also
// matches: the blended color B(cb, cs) replaces the source where the backdrop
// is opaque, then the result is laid over the backdrop by source alpha.

export const BLEND_MODES = [
  'normal',
  'dissolve',
  'darken',
  'multiply',
  'colorBurn',
  'linearBurn',
  'darkerColor',
  'lighten',
  'screen',
  'colorDodge',
  'linearDodge',
  'lighterColor',
  'overlay',
  'softLight',
  'hardLight',
  'vividLight',
  'linearLight',
  'pinLight',
  'hardMix',
  'difference',
  'exclusion',
  'subtract',
  'divide',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

export const BLEND_NAMES: Record<BlendMode, string> = {
  normal: 'Normal',
  dissolve: 'Dissolve',
  darken: 'Darken',
  multiply: 'Multiply',
  colorBurn: 'Color Burn',
  linearBurn: 'Linear Burn',
  darkerColor: 'Darker Color',
  lighten: 'Lighten',
  screen: 'Screen',
  colorDodge: 'Color Dodge',
  linearDodge: 'Linear Dodge (Add)',
  lighterColor: 'Lighter Color',
  overlay: 'Overlay',
  softLight: 'Soft Light',
  hardLight: 'Hard Light',
  vividLight: 'Vivid Light',
  linearLight: 'Linear Light',
  pinLight: 'Pin Light',
  hardMix: 'Hard Mix',
  difference: 'Difference',
  exclusion: 'Exclusion',
  subtract: 'Subtract',
  divide: 'Divide',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
};

/** The groups Photoshop's blend menu shows (separators between them). */
export const BLEND_GROUPS: BlendMode[][] = [
  ['normal', 'dissolve'],
  ['darken', 'multiply', 'colorBurn', 'linearBurn', 'darkerColor'],
  ['lighten', 'screen', 'colorDodge', 'linearDodge', 'lighterColor'],
  ['overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix'],
  ['difference', 'exclusion', 'subtract', 'divide'],
  ['hue', 'saturation', 'color', 'luminosity'],
];

export const blendIndex = (m: BlendMode) => BLEND_MODES.indexOf(m);

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---- separable modes: one channel ----

function colorBurn(b: number, s: number): number {
  if (b >= 1) return 1;
  if (s <= 0) return 0;
  return 1 - Math.min(1, (1 - b) / s);
}

function colorDodge(b: number, s: number): number {
  if (b <= 0) return 0;
  if (s >= 1) return 1;
  return Math.min(1, b / (1 - s));
}

function hardLight(b: number, s: number): number {
  return s <= 0.5 ? b * 2 * s : screen1(b, 2 * s - 1);
}

const screen1 = (b: number, s: number) => b + s - b * s;

/** Photoshop's soft light (not the W3C variant). */
function softLight(b: number, s: number): number {
  return s <= 0.5 ? 2 * b * s + b * b * (1 - 2 * s) : 2 * b * (1 - s) + Math.sqrt(b) * (2 * s - 1);
}

function vividLight(b: number, s: number): number {
  return s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * (s - 0.5));
}

function pinLight(b: number, s: number): number {
  return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1);
}

export function blendChannel(mode: BlendMode, b: number, s: number): number {
  switch (mode) {
    case 'normal':
    case 'dissolve':
      return s;
    case 'darken':
      return Math.min(b, s);
    case 'multiply':
      return b * s;
    case 'colorBurn':
      return colorBurn(b, s);
    case 'linearBurn':
      return clamp01(b + s - 1);
    case 'lighten':
      return Math.max(b, s);
    case 'screen':
      return screen1(b, s);
    case 'colorDodge':
      return colorDodge(b, s);
    case 'linearDodge':
      return Math.min(1, b + s);
    case 'overlay':
      return hardLight(s, b);
    case 'softLight':
      return softLight(b, s);
    case 'hardLight':
      return hardLight(b, s);
    case 'vividLight':
      return vividLight(b, s);
    case 'linearLight':
      return clamp01(b + 2 * s - 1);
    case 'pinLight':
      return pinLight(b, s);
    case 'hardMix':
      return b + s >= 1 ? 1 : 0;
    case 'difference':
      return Math.abs(b - s);
    case 'exclusion':
      return b + s - 2 * b * s;
    case 'subtract':
      return Math.max(0, b - s);
    case 'divide':
      return s <= 0 ? (b <= 0 ? 0 : 1) : Math.min(1, b / s);
    default:
      return s;
  }
}

// ---- non-separable modes (HSL with Rec. 601 luma, as Photoshop) ----

const L = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;

function clipColor(c: [number, number, number]): [number, number, number] {
  const l = L(c[0], c[1], c[2]);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  if (n < 0) for (let i = 0; i < 3; i++) c[i] = l + ((c[i]! - l) * l) / (l - n || 1e-9);
  if (x > 1) for (let i = 0; i < 3; i++) c[i] = l + ((c[i]! - l) * (1 - l)) / (x - l || 1e-9);
  return c;
}

function setLum(c: readonly number[], l: number): [number, number, number] {
  const d = l - L(c[0]!, c[1]!, c[2]!);
  return clipColor([c[0]! + d, c[1]! + d, c[2]! + d]);
}

const sat = (c: readonly number[]) => Math.max(c[0]!, c[1]!, c[2]!) - Math.min(c[0]!, c[1]!, c[2]!);

function setSat(c: readonly number[], s: number): [number, number, number] {
  const out = [c[0]!, c[1]!, c[2]!];
  const [mn, md, mx] = [0, 1, 2].sort((a, b) => out[a]! - out[b]!) as [number, number, number];
  const lo = out[mn]!,
    mid = out[md]!,
    hi = out[mx]!;
  if (hi > lo) {
    out[md] = ((mid - lo) * s) / (hi - lo);
    out[mx] = s;
  } else {
    out[md] = 0;
    out[mx] = 0;
  }
  out[mn] = 0;
  return [out[0]!, out[1]!, out[2]!];
}

/** B(cb, cs) for all three channels. */
export function blendRGB(mode: BlendMode, cb: readonly number[], cs: readonly number[], out: number[] = [0, 0, 0]): number[] {
  switch (mode) {
    case 'hue': {
      const r = setLum(setSat(cs, sat(cb)), L(cb[0]!, cb[1]!, cb[2]!));
      out[0] = r[0];
      out[1] = r[1];
      out[2] = r[2];
      return out;
    }
    case 'saturation': {
      const r = setLum(setSat(cb, sat(cs)), L(cb[0]!, cb[1]!, cb[2]!));
      out[0] = r[0];
      out[1] = r[1];
      out[2] = r[2];
      return out;
    }
    case 'color': {
      const r = setLum(cs, L(cb[0]!, cb[1]!, cb[2]!));
      out[0] = r[0];
      out[1] = r[1];
      out[2] = r[2];
      return out;
    }
    case 'luminosity': {
      const r = setLum(cb, L(cs[0]!, cs[1]!, cs[2]!));
      out[0] = r[0];
      out[1] = r[1];
      out[2] = r[2];
      return out;
    }
    case 'darkerColor': {
      const pick = L(cs[0]!, cs[1]!, cs[2]!) < L(cb[0]!, cb[1]!, cb[2]!) ? cs : cb;
      out[0] = pick[0]!;
      out[1] = pick[1]!;
      out[2] = pick[2]!;
      return out;
    }
    case 'lighterColor': {
      const pick = L(cs[0]!, cs[1]!, cs[2]!) > L(cb[0]!, cb[1]!, cb[2]!) ? cs : cb;
      out[0] = pick[0]!;
      out[1] = pick[1]!;
      out[2] = pick[2]!;
      return out;
    }
    default:
      out[0] = blendChannel(mode, cb[0]!, cs[0]!);
      out[1] = blendChannel(mode, cb[1]!, cs[1]!);
      out[2] = blendChannel(mode, cb[2]!, cs[2]!);
      return out;
  }
}

/** A stable per-pixel random 0..1 (Dissolve's pattern; the shader uses the same hash). */
export function dissolveNoise(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Lay a source pixel over a backdrop pixel (both straight alpha) with a blend
 * mode. `alpha` is the source's alpha already multiplied by opacity and mask.
 * Writes the result into `dst` at `o`.
 */
export function compositePixel(mode: BlendMode, dst: Float32Array, o: number, sr: number, sg: number, sb: number, alpha: number, x = 0, y = 0): void {
  if (alpha <= 0) return;
  if (mode === 'dissolve') {
    alpha = dissolveNoise(x, y) < alpha ? 1 : 0;
    if (alpha === 0) return;
  }
  const ab = dst[o + 3]!;
  const br = dst[o]!,
    bg = dst[o + 1]!,
    bb = dst[o + 2]!;
  let cr = sr,
    cg = sg,
    cb = sb;
  if (mode !== 'normal' && mode !== 'dissolve' && ab > 0) {
    const B = blendRGB(mode, [clamp01(br), clamp01(bg), clamp01(bb)], [clamp01(sr), clamp01(sg), clamp01(sb)]);
    cr = (1 - ab) * sr + ab * B[0]!;
    cg = (1 - ab) * sg + ab * B[1]!;
    cb = (1 - ab) * sb + ab * B[2]!;
  }
  const ao = alpha + ab * (1 - alpha);
  if (ao <= 0) {
    dst[o] = dst[o + 1] = dst[o + 2] = dst[o + 3] = 0;
    return;
  }
  const k = ab * (1 - alpha);
  dst[o] = (cr * alpha + br * k) / ao;
  dst[o + 1] = (cg * alpha + bg * k) / ao;
  dst[o + 2] = (cb * alpha + bb * k) / ao;
  dst[o + 3] = ao;
}

/** Modes that make sense for painting tools beyond the layer modes. */
export type PaintMode = BlendMode | 'behind' | 'clear';
