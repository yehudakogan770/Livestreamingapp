// Gradients: color stops and opacity stops (each with a midpoint), as in
// Photoshop's Gradient Editor; used by the Gradient tool, fill layers,
// gradient overlays and Gradient Map.

import type { RGBA } from './types';

export interface ColorStop {
  pos: number;
  color: [number, number, number];
  /** Where between this stop and the next the colors are half and half (0..1). */
  mid?: number;
}

export interface AlphaStop {
  pos: number;
  alpha: number;
  mid?: number;
}

export interface Gradient {
  name: string;
  stops: ColorStop[];
  alphas: AlphaStop[];
}

function interp<T extends { pos: number; mid?: number }>(stops: T[], t: number, get: (s: T) => number[]): number[] {
  if (stops.length === 0) return [0, 0, 0];
  const s = [...stops].sort((a, b) => a.pos - b.pos);
  if (t <= s[0]!.pos) return get(s[0]!);
  const last = s[s.length - 1]!;
  if (t >= last.pos) return get(last);
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i]!,
      b = s[i + 1]!;
    if (t >= a.pos && t <= b.pos) {
      let f = b.pos > a.pos ? (t - a.pos) / (b.pos - a.pos) : 0;
      // The midpoint bends the blend: at `mid` the colors are half and half.
      const mid = Math.min(0.95, Math.max(0.05, a.mid ?? 0.5));
      f = f < mid ? (f / mid) * 0.5 : 0.5 + ((f - mid) / (1 - mid)) * 0.5;
      const ca = get(a),
        cb = get(b);
      return ca.map((v, k) => v + (cb[k]! - v) * f);
    }
  }
  return get(last);
}

export function sampleGradient(g: Gradient, t: number): RGBA {
  const c = interp(g.stops, t, (s) => s.color);
  const a = g.alphas.length ? interp(g.alphas, t, (s) => [s.alpha])[0]! : 1;
  return [c[0]!, c[1]!, c[2]!, a];
}

/** `n` samples of the gradient, RGBA floats (the GPU's ramp texture). */
export function gradientRamp(g: Gradient, n = 256, reverse = false): Float32Array {
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const c = sampleGradient(g, reverse ? 1 - t : t);
    out.set(c, i * 4);
  }
  return out;
}

const c3 = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

const two = (name: string, a: string, b: string, alphaB = 1): Gradient => ({
  name,
  stops: [
    { pos: 0, color: c3(a) },
    { pos: 1, color: c3(b) },
  ],
  alphas: [
    { pos: 0, alpha: 1 },
    { pos: 1, alpha: alphaB },
  ],
});

/** Foreground to background (filled in with the current colors when used). */
export function fgToBg(fg: readonly number[], bg: readonly number[]): Gradient {
  return {
    name: 'Foreground to Background',
    stops: [
      { pos: 0, color: [fg[0]!, fg[1]!, fg[2]!] },
      { pos: 1, color: [bg[0]!, bg[1]!, bg[2]!] },
    ],
    alphas: [
      { pos: 0, alpha: 1 },
      { pos: 1, alpha: 1 },
    ],
  };
}

export function fgToTransparent(fg: readonly number[]): Gradient {
  return {
    name: 'Foreground to Transparent',
    stops: [
      { pos: 0, color: [fg[0]!, fg[1]!, fg[2]!] },
      { pos: 1, color: [fg[0]!, fg[1]!, fg[2]!] },
    ],
    alphas: [
      { pos: 0, alpha: 1 },
      { pos: 1, alpha: 0 },
    ],
  };
}

export const GRADIENT_PRESETS: Gradient[] = [
  two('Black, White', '#000000', '#ffffff'),
  two('Neutral Fade', '#1f1f1f', '#d8d8d8'),
  {
    name: 'Copper',
    stops: [
      { pos: 0, color: c3('#97462a') },
      { pos: 0.6, color: c3('#f0a774') },
      { pos: 1, color: c3('#fbe2cf') },
    ],
    alphas: [
      { pos: 0, alpha: 1 },
      { pos: 1, alpha: 1 },
    ],
  },
  two('Teal and Orange', '#0f4c5c', '#f09a3e'),
  two('Sky', '#2a5d9e', '#c9e2f6'),
  {
    name: 'Sunset',
    stops: [
      { pos: 0, color: c3('#2b1a4a') },
      { pos: 0.45, color: c3('#c4475b') },
      { pos: 1, color: c3('#f6c56b') },
    ],
    alphas: [
      { pos: 0, alpha: 1 },
      { pos: 1, alpha: 1 },
    ],
  },
  {
    name: 'Spectrum',
    stops: ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'].map((h, i) => ({ pos: i / 6, color: c3(h) })),
    alphas: [
      { pos: 0, alpha: 1 },
      { pos: 1, alpha: 1 },
    ],
  },
  two('Black to Transparent', '#000000', '#000000', 0),
  two('White to Transparent', '#ffffff', '#ffffff', 0),
];

/** The gradient's position t (0..1) for a point, by style; (x0,y0)→(x1,y1) is the drag. */
export function gradientT(style: string, x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0,
    dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  const len = Math.sqrt(len2);
  const px = x - x0,
    py = y - y0;
  switch (style) {
    case 'radial':
      return Math.min(1, Math.sqrt(px * px + py * py) / len);
    case 'angle': {
      const a0 = Math.atan2(dy, dx);
      let a = Math.atan2(py, px) - a0;
      a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return 1 - a / (2 * Math.PI);
    }
    case 'reflected': {
      const t = (px * dx + py * dy) / len2;
      return Math.min(1, Math.abs(t));
    }
    case 'diamond': {
      const ux = dx / len,
        uy = dy / len;
      const a = Math.abs(px * ux + py * uy),
        b = Math.abs(-px * uy + py * ux);
      return Math.min(1, (a + b) / len);
    }
    default: {
      const t = (px * dx + py * dy) / len2;
      return Math.min(1, Math.max(0, t));
    }
  }
}
