// Drawn masks: a shape of points drawn over the picture (0–1 across and down
// the sequence's frame), filled, softened by its feather, made into a matte
// the size of the frame. The viewer, the native engine and the export all get
// the same matte (through the same path as the AI masks).
import type { MotionNow } from './frame';

export interface DrawnShape {
  points: [number, number][];
  /** The frame's width over its height when it was drawn. */
  aspect: number;
}

const pointList = (v: unknown): [number, number][] =>
  (Array.isArray(v) ? v : []).filter(
    (p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && Number.isFinite(x)),
  );

/** An animated drawn mask's shapes: the shape at frames of its clip, in time order. */
export interface ShapeKey {
  t: number;
  points: [number, number][];
}

export function shapeKeys(d: Record<string, unknown> | undefined): ShapeKey[] {
  const keys = Array.isArray(d?.keys) ? (d.keys as unknown[]) : [];
  return keys
    .filter((k): k is { t: number; points: unknown } => !!k && typeof k === 'object' && typeof (k as { t?: unknown }).t === 'number')
    .map((k) => ({ t: k.t, points: pointList(k.points) }))
    .filter((k) => k.points.length > 0)
    .sort((a, b) => a.t - b.t);
}

/** The points at a frame of the clip: between two shapes of the same number of points, part way; otherwise the last one before. */
export function pointsAt(d: Record<string, unknown> | undefined, local: number): [number, number][] {
  const keys = shapeKeys(d);
  if (!keys.length) return pointList(d?.points);
  const first = keys[0] as ShapeKey;
  if (local <= first.t) return first.points;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i] as ShapeKey;
    if (local > b.t) continue;
    const a = keys[i - 1] as ShapeKey;
    if (a.points.length !== b.points.length || b.t === a.t) return a.points;
    const k = (local - a.t) / (b.t - a.t);
    return a.points.map(([x, y], j) => {
      const [x2, y2] = b.points[j] as [number, number];
      return [x + (x2 - x) * k, y + (y2 - y) * k];
    });
  }
  return (keys[keys.length - 1] as ShapeKey).points;
}

/** The shape at a frame of the clip with a key there set to `points` (made, or changed). */
export function withKey(d: Record<string, unknown> | undefined, local: number, points: [number, number][]): ShapeKey[] {
  const keys = shapeKeys(d).filter((k) => k.t !== local);
  return [...keys, { t: local, points }].sort((a, b) => a.t - b.t);
}

/** A drawn mask's shape at a frame of its clip (null: fewer than three points). */
export function drawnShape(d: Record<string, unknown> | undefined, local = 0): DrawnShape | null {
  const points = pointsAt(d, local);
  if (points.length < 3) return null;
  const aspect = typeof d?.aspect === 'number' && d.aspect > 0.1 && d.aspect < 10 ? d.aspect : 16 / 9;
  return { points, aspect };
}

/** How big the matte is drawn (its long side). */
const LONG = 640;

/** Is a point inside the shape (even-odd)? For tests and picking. */
export function inside(points: [number, number][], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i] as [number, number];
    const [xj, yj] = points[j] as [number, number];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const cache = new Map<string, { w: number; h: number; data: Uint8Array; stamp: string }>();

/**
 * The matte of a drawn mask: white inside the shape (or outside, inverted),
 * softened by `feather` (pixels at a 1080-high frame). Null where no canvas
 * can draw (tests).
 */
export function drawnMatte(shape: DrawnShape, feather: number, invert: boolean): { w: number; h: number; data: Uint8Array; stamp: string } | null {
  const w = shape.aspect >= 1 ? LONG : Math.round(LONG * shape.aspect);
  const h = shape.aspect >= 1 ? Math.round(LONG / shape.aspect) : LONG;
  const stamp = `drawn:${w}x${h}:${feather}:${invert ? 1 : 0}:${shape.points.map((p) => p.map((x) => x.toFixed(4)).join(',')).join(';')}`;
  const have = cache.get(stamp);
  if (have) return have;
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = invert ? '#ffffff' : '#000000';
  ctx.fillRect(0, 0, w, h);
  const blur = Math.max(0, feather) * (h / 1080);
  if (blur > 0.2) ctx.filter = `blur(${blur.toFixed(2)}px)`;
  ctx.beginPath();
  shape.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
  ctx.closePath();
  ctx.fillStyle = invert ? '#000000' : '#ffffff';
  ctx.fill();
  const px = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = px[i * 4] as number;
  const out = { w, h, data, stamp };
  if (cache.size > 32) cache.delete(cache.keys().next().value as string);
  cache.set(stamp, out);
  return out;
}

/** Where a drawn mask's matte goes: over the whole frame (it was drawn on the frame, not the clip). */
export const WHOLE_FRAME: MotionNow = {
  x: 0,
  y: 0,
  scale: 100,
  scaleX: 100,
  rotation: 0,
  rotX: 0,
  rotY: 0,
  z: 0,
  cropL: 0,
  cropR: 0,
  cropT: 0,
  cropB: 0,
  opacity: 100,
  blend: 'normal',
  fill: true,
};
