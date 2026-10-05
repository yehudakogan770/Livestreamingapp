import type { Look } from './project';

/** The color settings in the units FFmpeg's `eq` filter uses. */
export function eqValues(l: Look): { brightness: number; contrast: number; saturation: number; warmth: number } {
  const clamp = (v: number) => Math.max(-100, Math.min(100, v)) / 100;
  return {
    brightness: clamp(l.brightness) * 0.25,
    contrast: 1 + clamp(l.contrast) * 0.5,
    saturation: 1 + clamp(l.saturation),
    warmth: clamp(l.warmth) * 0.12,
  };
}

export const isNeutral = (l: Look): boolean => l.brightness === 0 && l.contrast === 0 && l.saturation === 0 && l.warmth === 0;

const KR = 0.2126;
const KG = 0.7152;
const KB = 0.0722;

/**
 * The same change as an RGB matrix (rows, plus an offset), so the picture in
 * the editor looks like the exported film. `eq` works on brightness around
 * the middle grey and scales the color; warmth then lifts red and lowers blue.
 */
export function lookMatrix(l: Look): { m: number[][]; offset: number[] } {
  const { brightness: b, contrast: c, saturation: s, warmth: w } = eqValues(l);
  const off = 0.5 * (1 - c) + b;
  const row = (i: number): number[] => [KR, KG, KB].map((k, j) => (i === j ? s : 0) + (c - s) * k);
  const gain = [1 + w, 1, 1 - w];
  const m = [0, 1, 2].map((i) => row(i).map((v) => v * (gain[i] ?? 1)));
  const offset = [0, 1, 2].map((i) => off * (gain[i] ?? 1));
  return { m, offset };
}

/** The values for an SVG `feColorMatrix` (used to show the look while editing). */
export function svgMatrix(l: Look): string {
  const { m, offset } = lookMatrix(l);
  const r = (v: number) => Number(v.toFixed(4));
  return [0, 1, 2]
    .map((i) => [...(m[i] ?? [0, 0, 0]), 0, offset[i] ?? 0].map(r).join(' '))
    .concat('0 0 0 1 0')
    .join(' ');
}

/** The FFmpeg filters for a look ('' when it is as recorded). */
export function ffmpegLook(l: Look): string {
  if (isNeutral(l)) return '';
  const { brightness, contrast, saturation, warmth } = eqValues(l);
  const f = (v: number) => Number(v.toFixed(4));
  const parts = [`eq=brightness=${f(brightness)}:contrast=${f(contrast)}:saturation=${f(saturation)}`];
  if (warmth !== 0) parts.push(`colorchannelmixer=rr=${f(1 + warmth)}:bb=${f(1 - warmth)}`);
  return parts.join(',');
}
