// Word clouds: the words phones sent, the most sent biggest, packed around
// the middle without touching. Drawn the same in the control window
// (PollView) and on the screens (compositor.ts), so the layout is worked out
// here once from the words, the box and a way to measure text.

import type { WordCount } from './types/WordCount';

export interface PlacedWord {
  text: string;
  count: number;
  /** The middle of the word, in the box's units. */
  x: number;
  y: number;
  /** Font size, in the box's units. */
  size: number;
  /** Which of `CLOUD_COLORS`. */
  color: number;
}

/** How wide `text` is at font size `size` (any unit; the same as the box's). */
export type Measure = (text: string, size: number) => number;

/** Flat colors that read well on the dark poll background; the biggest word is white. */
export const CLOUD_COLORS = ['#ffffff', '#9ecbff', '#ffd27a', '#a5e3c4', '#f2a7a0', '#c9bcff', '#d8dde4'] as const;

export const CLOUD_FONT = `"Segoe UI", system-ui, sans-serif`;
export const cloudFont = (size: number): string => `700 ${size}px ${CLOUD_FONT}`;

/** Most words drawn (the rest are the least sent). */
export const MAX_SHOWN = 60;

/** A rough width when there is nothing to measure with (tests, or no canvas). */
export const roughMeasure: Measure = (text, size) => [...text].length * size * 0.56;

let measurer: CanvasRenderingContext2D | null | undefined;
/** Measures with a canvas in the cloud's font (rough when there is no canvas). */
export const canvasMeasure: Measure = (text, size) => {
  if (measurer === undefined) {
    try {
      measurer = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    } catch {
      measurer = null;
    }
  }
  if (!measurer) return roughMeasure(text, size);
  // Measured at a fixed size and scaled: fonts scale evenly.
  measurer.font = cloudFont(100);
  return (measurer.measureText(text).width / 100) * size;
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Lay out a cloud in a `width` × `height` box: the most sent words first,
 * from the middle outwards along a spiral. Words that find no room (even a
 * little smaller) are left out. The same words and box always give the same
 * picture.
 */
export function cloudLayout(words: WordCount[], width: number, height: number, measure: Measure = roughMeasure, max = MAX_SHOWN): PlacedWord[] {
  if (width <= 0 || height <= 0) return [];
  const list = [...words]
    .filter((w) => w.count > 0 && w.text.trim())
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, max);
  if (!list.length) return [];
  const most = list[0]!.count;
  const least = list[list.length - 1]!.count;
  // Fewer words are drawn bigger.
  const biggest = height * (list.length <= 3 ? 0.3 : list.length <= 10 ? 0.22 : 0.17);
  const smallest = height * 0.055;
  const placed: PlacedWord[] = [];
  const boxes: Box[] = [];
  const pad = height * 0.012;
  const cx = width / 2;
  const cy = height / 2;
  const aspect = width / height;
  list.forEach((w, i) => {
    const share = most === least ? 1 : Math.sqrt((w.count - least) / (most - least));
    let size = smallest + (biggest - smallest) * share;
    for (let attempt = 0; attempt < 3; attempt++, size *= 0.8) {
      const ww = Math.min(measure(w.text, size), width);
      const hh = size * 1.05;
      const spot = findSpot(ww, hh, width, height, cx, cy, aspect, boxes, pad);
      if (!spot) continue;
      boxes.push({ x: spot.x - ww / 2 - pad, y: spot.y - hh / 2 - pad, w: ww + pad * 2, h: hh + pad * 2 });
      placed.push({ text: w.text, count: w.count, x: spot.x, y: spot.y, size, color: i === 0 ? 0 : 1 + ((i - 1) % (CLOUD_COLORS.length - 1)) });
      return;
    }
  });
  return placed;
}

function findSpot(w: number, h: number, width: number, height: number, cx: number, cy: number, aspect: number, boxes: Box[], pad: number) {
  const step = 0.12;
  const grow = Math.min(width, height) / 160;
  for (let t = 0; t < 900; t += step) {
    const r = grow * t;
    const x = cx + r * Math.cos(t) * aspect * 0.8;
    const y = cy + r * Math.sin(t);
    const b = { x: x - w / 2, y: y - h / 2, w, h };
    if (b.x < 0 || b.y < 0 || b.x + w > width || b.y + h > height) {
      // Once the spiral is past every side, nothing further fits.
      if (r * Math.min(aspect * 0.8, 1) > Math.hypot(width, height)) return null;
      continue;
    }
    const grown = { x: b.x - pad, y: b.y - pad, w: w + pad * 2, h: h + pad * 2 };
    if (!boxes.some((o) => overlaps(grown, o))) return { x, y };
  }
  return null;
}

/** A cache of the last layouts (drawing the same cloud every frame costs nothing). */
export class CloudCache {
  private readonly cache = new Map<string, PlacedWord[]>();

  get(words: WordCount[], width: number, height: number, measure: Measure = canvasMeasure): PlacedWord[] {
    const key = `${Math.round(width)}x${Math.round(height)}|${words.map((w) => `${w.text}\u0000${w.count}`).join('\u0001')}`;
    let hit = this.cache.get(key);
    if (!hit) {
      hit = cloudLayout(words, width, height, measure);
      if (this.cache.size > 8) this.cache.clear();
      this.cache.set(key, hit);
    }
    return hit;
  }
}

/** The points of a five-pointed star (for ratings), as x, y pairs. */
export function starPoints(cx: number, cy: number, r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return out;
}

/** How full each of five stars is for an average (4.3 → 1, 1, 1, 1, 0.3). */
export const starFill = (avg: number | null): number[] => [0, 1, 2, 3, 4].map((i) => Math.max(0, Math.min(1, (avg ?? 0) - i)));
