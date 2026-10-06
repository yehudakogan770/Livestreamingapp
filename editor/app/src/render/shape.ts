// Drawing a shape layer onto a frame-sized canvas (sizes are for a 1080-high frame).
import { valueAt } from '../model/anim';
import { shapeOutline, trimOutline, type Pt } from '../model/shapes';
import type { ShapeData } from '../model/types';

/** The trim at a frame. */
export function trimAt(s: ShapeData, local: number): { start: number; end: number; offset: number } {
  return { start: valueAt(s.trimStart, local, 0), end: valueAt(s.trimEnd, local, 100), offset: valueAt(s.trimOffset, local, 0) };
}

const looks = new WeakMap<ShapeData, string>();

/** What the shape looks like at a frame, as a key (the same key: no need to draw it again). */
export function shapeStamp(s: ShapeData, local: number): string {
  let base = looks.get(s);
  if (base === undefined) {
    base = JSON.stringify(s);
    looks.set(s, base);
  }
  const t = trimAt(s, local);
  return `${base}|${t.start}|${t.end}|${t.offset}`;
}

export function drawShape(ctx: CanvasRenderingContext2D, s: ShapeData, w: number, h: number, local: number): void {
  const k = h / 1080;
  const { pts, closed } = shapeOutline(s, k);
  const t = trimAt(s, local);
  const parts = trimOutline(pts, closed, t.start, t.end, t.offset);
  if (!parts.length) return;
  ctx.save();
  ctx.translate(s.px * w, s.py * h);
  const path = (line: Pt[]) => {
    ctx.beginPath();
    line.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  };
  const whole = parts.length === 1 && t.end - t.start >= 100 - 1e-6;
  if (s.fillOn && closed) {
    ctx.fillStyle = s.fill;
    for (const line of parts) {
      path(line);
      if (whole) ctx.closePath();
      ctx.fill();
    }
  }
  if (s.strokeOn && s.strokeWidth > 0) {
    ctx.strokeStyle = s.stroke;
    ctx.lineWidth = s.strokeWidth * k;
    ctx.lineJoin = 'round';
    ctx.lineCap = closed ? 'butt' : 'round';
    for (const line of parts) {
      path(line);
      if (whole && closed) ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.restore();
}
