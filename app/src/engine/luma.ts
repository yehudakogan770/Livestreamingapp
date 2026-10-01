// Luma wipes: each pattern is a gray picture (0 black – 1 white); the new
// source shows first where the pattern is darkest, spreading to the lightest.
// The masks are made here once and used by the screens and the recorder.

import type { TransitionKind } from './types/TransitionKind';

export type LumaPattern = 'lumaClock' | 'lumaCircle' | 'lumaBlinds' | 'lumaDiagonal' | 'lumaSparkle' | 'lumaHeart';

export const isLuma = (k: TransitionKind): k is LumaPattern => k.startsWith('luma');

/** The pattern's gray value at (u, v), both 0 – 1 across the frame. */
export function lumaValue(p: LumaPattern, u: number, v: number): number {
  const x = (u - 0.5) * (16 / 9);
  const y = v - 0.5;
  switch (p) {
    case 'lumaClock':
      // Round like a clock hand, from twelve o'clock.
      return (Math.atan2(x, -y) / (2 * Math.PI) + 1) % 1;
    case 'lumaCircle':
      return Math.min(1, Math.hypot(x, y) / 1.02);
    case 'lumaBlinds':
      return (u * 8) % 1;
    case 'lumaDiagonal':
      return (u + v) / 2;
    case 'lumaSparkle': {
      // A fixed scatter of small squares.
      const cx = Math.floor(u * 64);
      const cy = Math.floor(v * 36);
      const a = Math.sin(cx * 12.9898 + cy * 78.233) * 43758.5453;
      return a - Math.floor(a);
    }
    case 'lumaHeart': {
      // A heart growing from the middle: the size of the heart shape that just reaches this point.
      const hx = x * 2.2;
      const hy = -y * 2.2 + 0.15;
      const inside = (k: number) => {
        const X = hx / k;
        const Y = hy / k;
        const a = X * X + Y * Y - 1;
        return a * a * a - X * X * Y * Y * Y <= 0;
      };
      let lo = 0.001;
      let hi = 4;
      for (let n = 0; n < 24; n++) {
        const mid = (lo + hi) / 2;
        if (inside(mid)) hi = mid;
        else lo = mid;
      }
      return Math.min(1, hi / 2.9);
    }
  }
}

/** How soft the edge is (0 hard – 1 very soft). */
const SOFT = 0.08;

/** How much of the new source shows at a point: 0 – 1. */
export const lumaAlpha = (luma: number, p: number) => Math.min(1, Math.max(0, (p * (1 + SOFT) - luma) / SOFT));

const W = 192;
const H = 108;
const STEPS = 30;
const grids = new Map<LumaPattern, Float32Array>();
const masks = new Map<string, { canvas: HTMLCanvasElement; url: string }>();

function grid(p: LumaPattern): Float32Array {
  let g = grids.get(p);
  if (!g) {
    g = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) g[j * W + i] = lumaValue(p, (i + 0.5) / W, (j + 0.5) / H);
    grids.set(p, g);
  }
  return g;
}

/** The mask at progress `p` (made once for each of 30 steps): white where the new source shows. */
export function lumaMask(pattern: LumaPattern, p: number): { canvas: HTMLCanvasElement; url: string } | null {
  if (typeof document === 'undefined') return null;
  const step = Math.round(Math.min(1, Math.max(0, p)) * STEPS);
  const key = `${pattern}:${step}`;
  let m = masks.get(key);
  if (!m) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(W, H);
    const g = grid(pattern);
    const t = step / STEPS;
    for (let i = 0; i < W * H; i++) {
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = 255;
      img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = Math.round(lumaAlpha(g[i]!, t) * 255);
    }
    ctx.putImageData(img, 0, 0);
    m = { canvas, url: canvas.toDataURL('image/png') };
    masks.set(key, m);
  }
  return m;
}
