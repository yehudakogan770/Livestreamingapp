// The built-in music types, scenes and color sets (from Stage Visuals Live).
// The engine reads the same file, so tempos and scene counts always agree.

import lib from './banks.json';

/** [name, look (shader mode), color set, speed, flash, bounce] */
export type SceneRow = [string, number, string, number, number, number];
export interface Bank {
  name: string;
  bpm: number;
  fade: number;
  desc: string;
  scenes: SceneRow[];
}
export interface Palette {
  name: string;
  c: [string, string, string];
}

export const PALETTES = lib.palettes as unknown as Record<string, Palette>;
export const BANKS = lib.banks as unknown as Bank[];

export const hexRgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

const palCache = new Map<string, number[]>();
/** A color set as the 3×3 matrix the shaders take. */
export function palMat(key: string): number[] {
  let m = palCache.get(key);
  if (!m) {
    m = (PALETTES[key] ?? PALETTES.afterhours!).c.flatMap(hexRgb);
    palCache.set(key, m);
  }
  return m;
}

/** The scene, or the first one if it is gone. */
export function sceneRow(bank: number, scene: number): SceneRow {
  return BANKS[bank]?.scenes[scene] ?? BANKS[0]!.scenes[0]!;
}

/** The colors a scene shows with the palette setting ("scene": its own). */
export function sceneColours(row: SceneRow, palette: string): [string, string, string] {
  return (PALETTES[palette === 'scene' ? row[2] : palette] ?? PALETTES.afterhours!).c;
}

export const FONTS: Record<string, [string, string]> = {
  clean: ['700', '"Chakra Petch", system-ui, sans-serif'],
  bold: ['400', '"Bebas Neue", Impact, sans-serif'],
  elegant: ['400', '"Great Vibes", "Brush Script MT", cursive'],
  classic: ['700', 'Georgia, "Times New Roman", serif'],
};
