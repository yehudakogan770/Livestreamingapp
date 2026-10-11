// Patterns: a few built in (drawn here, tiling seamlessly) and the person's
// own (Edit ▸ Define Pattern), used by fill layers, Pattern Overlay, the
// Paint Bucket and the Pattern Stamp.

import { img, type Img } from './img';

export interface PatternDef {
  id: string;
  name: string;
  img: Img;
}

function make(id: string, name: string, size: number, f: (x: number, y: number) => [number, number, number, number]): PatternDef {
  const p = img(size, size, 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = f(x, y);
      p.data.set(c, (y * size + x) * 4);
    }
  return { id, name, img: p };
}

function hash(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(s, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const BUILT_IN: PatternDef[] = [
  make('checker', 'Checkerboard', 32, (x, y) => {
    const v = ((x >> 4) + (y >> 4)) & 1 ? 0.8 : 1;
    return [v, v, v, 1];
  }),
  make('dots', 'Dots', 24, (x, y) => {
    const d = Math.hypot(x - 11.5, y - 11.5);
    const a = Math.min(1, Math.max(0, 5.5 - d));
    return [0.15, 0.15, 0.15, a];
  }),
  make('lines', 'Diagonal Lines', 16, (x, y) => {
    const t = (x + y) % 16;
    const a = t < 2 ? 1 : t < 3 ? 0.5 : 0;
    return [0.15, 0.15, 0.15, a];
  }),
  make('grid', 'Grid', 32, (x, y) => {
    const a = x === 0 || y === 0 ? 1 : 0;
    return [0.2, 0.2, 0.2, a];
  }),
  make('noise', 'Fine Noise', 128, (x, y) => {
    const v = 0.35 + hash(x, y, 1) * 0.3;
    return [v, v, v, 1];
  }),
  make('paper', 'Paper', 128, (x, y) => {
    // Soft fibrous grain: a few octaves of tiling value noise.
    let v = 0,
      amp = 0.5;
    for (let o = 0; o < 4; o++) {
      const s = 8 << o;
      const fx = (x / 128) * s,
        fy = (y / 128) * s;
      const ix = Math.floor(fx),
        iy = Math.floor(fy);
      const tx = fx - ix,
        ty = fy - iy;
      const n = (a: number, b: number) => hash(((a % s) + s) % s, ((b % s) + s) % s, o + 7);
      const sm = (t: number) => t * t * (3 - 2 * t);
      const top = n(ix, iy) * (1 - sm(tx)) + n(ix + 1, iy) * sm(tx);
      const bot = n(ix, iy + 1) * (1 - sm(tx)) + n(ix + 1, iy + 1) * sm(tx);
      v += (top * (1 - sm(ty)) + bot * sm(ty)) * amp;
      amp /= 2;
    }
    const g = 0.86 + v * 0.12;
    return [g, g * 0.985, g * 0.95, 1];
  }),
  make('brick', 'Brick', 64, (x, y) => {
    const row = Math.floor(y / 16);
    const off = row % 2 ? 16 : 0;
    const mortar = y % 16 < 2 || (x + off) % 32 < 2;
    return mortar ? [0.82, 0.8, 0.76, 1] : [0.62, 0.3, 0.22, 1];
  }),
];

const user = new Map<string, PatternDef>();

export function allPatterns(): PatternDef[] {
  return [...BUILT_IN, ...user.values()];
}

export function getPattern(id: string): PatternDef {
  return user.get(id) ?? BUILT_IN.find((p) => p.id === id) ?? BUILT_IN[0]!;
}

export function addPattern(name: string, pixels: Img, id = `user-${Date.now().toString(36)}`): PatternDef {
  const def = { id, name, img: pixels };
  user.set(id, def);
  return def;
}

export function removePattern(id: string): void {
  user.delete(id);
}

export function userPatterns(): PatternDef[] {
  return [...user.values()];
}

/** The pattern's color at a document point (tiled, scaled). */
export function patternAt(p: PatternDef, x: number, y: number, scale = 1, out: number[] = [0, 0, 0, 0]): number[] {
  const s = Math.max(0.01, scale);
  const w = p.img.w,
    h = p.img.h;
  const px = ((Math.floor(x / s) % w) + w) % w;
  const py = ((Math.floor(y / s) % h) + h) % h;
  const o = (py * w + px) * 4;
  out[0] = p.img.data[o]!;
  out[1] = p.img.data[o + 1]!;
  out[2] = p.img.data[o + 2]!;
  out[3] = p.img.data[o + 3]!;
  return out;
}
