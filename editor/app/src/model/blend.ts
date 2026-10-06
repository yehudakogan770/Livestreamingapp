// Blend modes: how a layer's colors mix with what is under it (the W3C
// compositing formulas). The GPU does the same math (render/shaders.ts); this
// copy is for tests and for anything worked out on the CPU.
import type { BlendMode } from './types';

/** In the order the GPU program numbers them (keep the first nine where they were: saved projects use the names, shaders the index). */
export const BLEND_LIST: [BlendMode, string][] = [
  ['normal', 'Normal'],
  ['multiply', 'Multiply'],
  ['screen', 'Screen'],
  ['overlay', 'Overlay'],
  ['add', 'Add'],
  ['darken', 'Darken'],
  ['lighten', 'Lighten'],
  ['difference', 'Difference'],
  ['softlight', 'Soft light'],
  ['hardlight', 'Hard light'],
  ['colordodge', 'Color dodge'],
  ['colorburn', 'Color burn'],
  ['exclusion', 'Exclusion'],
  ['hue', 'Hue'],
  ['saturation', 'Saturation'],
  ['color', 'Color'],
  ['luminosity', 'Luminosity'],
];

export const BLEND_NAMES: string[] = BLEND_LIST.map(([m]) => m);

/** Grouped for the menu. */
export const BLEND_GROUPS: [string, BlendMode[]][] = [
  ['', ['normal']],
  ['Darken', ['darken', 'multiply', 'colorburn']],
  ['Lighten', ['lighten', 'screen', 'colordodge', 'add']],
  ['Contrast', ['overlay', 'softlight', 'hardlight']],
  ['Difference', ['difference', 'exclusion']],
  ['Color', ['hue', 'saturation', 'color', 'luminosity']],
];

export type RGB = [number, number, number];

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function channel(mode: BlendMode, b: number, s: number): number {
  switch (mode) {
    case 'multiply':
      return b * s;
    case 'screen':
      return b + s - b * s;
    case 'overlay':
      return channel('hardlight', s, b);
    case 'add':
      return Math.min(1, b + s);
    case 'darken':
      return Math.min(b, s);
    case 'lighten':
      return Math.max(b, s);
    case 'difference':
      return Math.abs(b - s);
    case 'softlight': {
      const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
      return s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (d - b);
    }
    case 'hardlight':
      return s <= 0.5 ? b * 2 * s : channel('screen', b, 2 * s - 1);
    case 'colordodge':
      if (b <= 0) return 0;
      if (s >= 1) return 1;
      return Math.min(1, b / (1 - s));
    case 'colorburn':
      if (b >= 1) return 1;
      if (s <= 0) return 0;
      return 1 - Math.min(1, (1 - b) / s);
    case 'exclusion':
      return b + s - 2 * b * s;
    default:
      return s;
  }
}

export const lum = (c: RGB): number => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

function clipColor(c: RGB): RGB {
  const l = lum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  let out: RGB = [...c];
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / Math.max(1e-9, l - n)) as RGB;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / Math.max(1e-9, x - l)) as RGB;
  return out;
}

export function setLum(c: RGB, l: number): RGB {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}

export const sat = (c: RGB): number => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

export function setSat(c: RGB, s: number): RGB {
  const x = Math.max(c[0], c[1], c[2]);
  const n = Math.min(c[0], c[1], c[2]);
  if (x <= n) return [0, 0, 0];
  return c.map((v) => ((v - n) * s) / (x - n)) as RGB;
}

/** The blended color of a backdrop `b` and a layer `s` (straight colors, 0–1), before opacity. */
export function blendColor(mode: BlendMode, b: RGB, s: RGB): RGB {
  switch (mode) {
    case 'hue':
      return setLum(setSat(s, sat(b)), lum(b));
    case 'saturation':
      return setLum(setSat(b, sat(s)), lum(b));
    case 'color':
      return setLum(s, lum(b));
    case 'luminosity':
      return setLum(b, lum(s));
    default:
      return [channel(mode, b[0], s[0]), channel(mode, b[1], s[1]), channel(mode, b[2], s[2])];
  }
}

/**
 * A layer over a backdrop, both premultiplied RGBA (0–1), the way the compositor does it: the blended color
 * where both are there, each alone elsewhere.
 */
export function composite(
  mode: BlendMode,
  base: [number, number, number, number],
  top: [number, number, number, number],
  opacity = 1,
): [number, number, number, number] {
  const T = top.map((v) => v * opacity) as [number, number, number, number];
  const B = base;
  if (mode === 'normal') return [0, 1, 2, 3].map((i) => (T[i] as number) + (B[i] as number) * (1 - T[3])) as [number, number, number, number];
  const un = (c: number[]): RGB => ((c[3] as number) > 1e-4 ? [c[0]! / c[3]!, c[1]! / c[3]!, c[2]! / c[3]!] : [0, 0, 0]);
  const f = blendColor(mode, un(B), un(T)).map(clamp01);
  const out = [0, 1, 2].map((i) => (1 - B[3]) * (T[i] as number) + (1 - T[3]) * (B[i] as number) + T[3] * B[3] * (f[i] as number));
  return [out[0] as number, out[1] as number, out[2] as number, T[3] + B[3] * (1 - T[3])];
}
