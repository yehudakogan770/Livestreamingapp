// A real canvas for tests (Skia through @napi-rs/canvas), with the test font
// registered, pictures preloaded, and PNG reading and comparing.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { RenderEnv, Surface } from '../core/render';
import type { TitleProject, Values } from '../core/types';
import { fill, valuesFor } from '../core/binding';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const napi = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');

export const ROOT = resolve(__dirname, '../../..');
/** The family every test draws with (Heebo's static files: the same pixels on every computer). */
export const TEST_FONT = 'Titler Test Sans';

let fontsReady = false;
export function registerTestFont(): void {
  if (fontsReady) return;
  const dir = resolve(ROOT, 'node_modules/@fontsource/heebo/files');
  napi.GlobalFonts.registerFromPath(resolve(dir, 'heebo-latin-400-normal.woff2'), TEST_FONT);
  napi.GlobalFonts.registerFromPath(resolve(dir, 'heebo-latin-700-normal.woff2'), TEST_FONT);
  fontsReady = true;
}

export function canvas(w: number, h: number) {
  return napi.createCanvas(w, h);
}

const images = new Map<string, unknown>();

/** Load every picture a project shows (sync drawing needs them ready). */
export async function preload(p: TitleProject, given?: Values): Promise<void> {
  const values = valuesFor(p, given);
  const srcs = new Set<string>();
  for (const a of p.assets) if (a.kind === 'image' || a.kind === 'svg') srcs.add(a.src);
  for (const v of p.variables) if (v.type === 'image') srcs.add(fill(`{{${v.key}}}`, values));
  for (const src of srcs) {
    if (images.has(src) || !src) continue;
    try {
      images.set(src, await napi.loadImage(src.startsWith('data:') ? Buffer.from(src.split(',')[1]!, 'base64') : src));
    } catch {
      /* a broken picture draws nothing */
    }
  }
}

export const env: RenderEnv = {
  createCanvas: (w, h) => napi.createCanvas(w, h) as unknown as Surface,
  image: (src) => (images.get(src) as CanvasImageSource | undefined) ?? null,
};

/** RGBA pixels of a canvas. */
export function pixels(c: { getContext(k: '2d'): unknown; width: number; height: number }): Uint8ClampedArray {
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

export function png(c: { encodeSync(f: 'png'): Buffer }): Buffer {
  return c.encodeSync('png');
}

/** Decode a PNG to pixels. */
export async function decode(file: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const img = await napi.loadImage(readFileSync(file));
  const c = napi.createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
}

/**
 * Compare pixels: the share of pixels differing by more than `tol` in any
 * channel (font smoothing differs a little between machines).
 */
export function diff(a: Uint8ClampedArray, b: Uint8ClampedArray, tol = 40): number {
  if (a.length !== b.length) return 1;
  let bad = 0;
  for (let k = 0; k < a.length; k += 4) {
    if (
      Math.abs(a[k]! - b[k]!) > tol ||
      Math.abs(a[k + 1]! - b[k + 1]!) > tol ||
      Math.abs(a[k + 2]! - b[k + 2]!) > tol ||
      Math.abs(a[k + 3]! - b[k + 3]!) > tol
    )
      bad++;
  }
  return bad / (a.length / 4);
}

/** Write a PNG (making the folder). */
export function save(file: string, data: Buffer): void {
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
}
