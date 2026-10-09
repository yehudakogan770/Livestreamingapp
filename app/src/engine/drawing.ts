// Drawing on screen (mirrors crates/engine/src/drawing.rs): strokes kept as
// fractions of the frame, thinned before they are sent, and the arrowhead
// every renderer draws the same way.

import type { Drawing } from './types/Drawing';
import type { Stroke } from './types/Stroke';

export const MAX_STROKES = 200;
export const MAX_POINTS = 1000;
export const MIN_WIDTH = 0.002;
export const MAX_WIDTH = 0.05;

/** The pens offered (plain, high-contrast colors that read over any picture). */
export const PEN_COLORS = ['#ffd400', '#ff3b30', '#ffffff', '#2f80ed', '#34c759', '#000000'] as const;
/** Thin, medium, thick (fractions of the frame's height). */
export const PEN_WIDTHS = [0.004, 0.008, 0.016] as const;

export function emptyDrawing(): Drawing {
  return { strokes: [], changedAt: 0 };
}

const hex = (c: string) => /^#[0-9a-f]{6}$/i.test(c);

/** A stroke within the rules (mirrors Stroke::repair). */
export function repairStroke(s: Stroke): Stroke {
  const width = Number.isFinite(s.width) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, s.width)) : 0.008;
  const points = s.points
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map(([x, y]) => [Math.min(1.1, Math.max(-0.1, x)), Math.min(1.1, Math.max(-0.1, y))] as [number, number])
    .slice(0, MAX_POINTS);
  return { color: hex(s.color) ? s.color : '#ffd400', width, points, arrow: !!s.arrow };
}

/** Add a stroke (the oldest goes when full); nothing to draw, nothing added. */
export function addStroke(d: Drawing, stroke: Stroke, now: number): void {
  const s = repairStroke(stroke);
  if (!s.points.length) return;
  d.strokes.push(s);
  if (d.strokes.length > MAX_STROKES) d.strokes.shift();
  d.changedAt = now;
}

/**
 * Fewer points for the same line: a point closer than `min` (frame fraction)
 * to the last kept one is left out (the last point is always kept), and never
 * more than MAX_POINTS.
 */
export function thin(points: readonly [number, number][], min = 0.002): [number, number][] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]]);
  const out: [number, number][] = [[points[0]![0], points[0]![1]]];
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i]!;
    const [lx, ly] = out[out.length - 1]!;
    if (Math.hypot(x - lx, y - ly) >= min) out.push([x, y]);
  }
  const last = points[points.length - 1]!;
  out.push([last[0], last[1]]);
  if (out.length <= MAX_POINTS) return out;
  // Still too many: keep every n-th (and the last).
  const step = Math.ceil(out.length / (MAX_POINTS - 1));
  const kept = out.filter((_, i) => i % step === 0);
  kept.push(out[out.length - 1]!);
  return kept.slice(0, MAX_POINTS);
}

/**
 * The arrowhead at the end of a stroke, in pixels of a `w` × `h` frame: the
 * tip and the two back corners. Null for a dot.
 */
export function arrowHead(s: Stroke, w: number, h: number): [number, number][] | null {
  const pts = s.points.map(([x, y]) => [x * w, y * h] as const);
  const tip = pts[pts.length - 1];
  if (!tip) return null;
  const size = Math.max(10, s.width * h * 4);
  // Look back far enough along the line for a steady direction.
  let from: readonly [number, number] | null = null;
  for (let i = pts.length - 2; i >= 0; i--) {
    if (Math.hypot(tip[0] - pts[i]![0], tip[1] - pts[i]![1]) >= size * 0.8) {
      from = pts[i]!;
      break;
    }
  }
  from ??= pts.length > 1 ? pts[0]! : null;
  if (!from || (from[0] === tip[0] && from[1] === tip[1])) return null;
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const spread = Math.PI / 7;
  return [
    [tip[0], tip[1]],
    [tip[0] - size * Math.cos(a - spread), tip[1] - size * Math.sin(a - spread)],
    [tip[0] - size * Math.cos(a + spread), tip[1] - size * Math.sin(a + spread)],
  ];
}

/** Draw a drawing's strokes on a canvas of `w` × `h` (recording, unified engine). */
export function paintDrawing(ctx: CanvasRenderingContext2D, d: Drawing, w: number, h: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of d.strokes) {
    if (!s.points.length) continue;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width * h;
    ctx.beginPath();
    const [x0, y0] = s.points[0]!;
    if (s.points.length === 1) {
      ctx.arc(x0 * w, y0 * h, (s.width * h) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.moveTo(x0 * w, y0 * h);
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i]![0] * w, s.points[i]![1] * h);
    ctx.stroke();
    const head = s.arrow ? arrowHead(s, w, h) : null;
    if (head) {
      ctx.beginPath();
      ctx.moveTo(head[0]![0], head[0]![1]);
      ctx.lineTo(head[1]![0], head[1]![1]);
      ctx.lineTo(head[2]![0], head[2]![1]);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}
