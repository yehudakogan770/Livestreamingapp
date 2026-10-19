// Hand, Zoom and Rotate View.

import { current, requestFrame, app, bump } from '../state';
import { nextZoom, zoomAt, fitView } from '../viewMath';
import { viewport, type Tool, type ToolEvent } from './types';

let start: { sx: number; sy: number; cx: number; cy: number; zoom: number; rotation: number; angle: number } | null = null;

export function pan(dx: number, dy: number): void {
  const s = current();
  if (!s) return;
  s.view = { ...s.view, cx: s.view.cx + dx, cy: s.view.cy + dy };
  s.fitted = false;
  requestFrame();
}

export function zoomBy(factor: number, sx = viewport.w / 2, sy = viewport.h / 2): void {
  const s = current();
  if (!s) return;
  s.view = zoomAt(s.view, factor, sx, sy);
  s.fitted = false;
  bump();
}

export function zoomStep(dir: 1 | -1, sx = viewport.w / 2, sy = viewport.h / 2): void {
  const s = current();
  if (!s) return;
  const z = nextZoom(s.view.zoom, dir);
  zoomBy(z / s.view.zoom, sx, sy);
}

export function fitOnScreen(): void {
  const s = current();
  if (!s) return;
  s.view = { ...fitView(s.doc.width, s.doc.height, viewport.w, viewport.h), rotation: s.view.rotation };
  s.fitted = true;
  bump();
}

export function actualPixels(z = 1): void {
  const s = current();
  if (!s) return;
  s.view = { ...s.view, zoom: z, cx: viewport.w / 2, cy: viewport.h / 2 };
  s.fitted = false;
  bump();
}

/** Print size: the document at its resolution on a 96 ppi-referenced screen. */
export function printSize(): void {
  const s = current();
  if (!s) return;
  s.view = { ...s.view, zoom: 96 / Math.max(1, s.doc.resolution), cx: viewport.w / 2, cy: viewport.h / 2 };
  s.fitted = false;
  bump();
}

export const handTool: Tool = {
  id: 'hand',
  cursor: () => (start ? 'grabbing' : 'grab'),
  down: (e) => {
    const s = current();
    if (!s) return;
    start = { sx: e.sx, sy: e.sy, cx: s.view.cx, cy: s.view.cy, zoom: s.view.zoom, rotation: s.view.rotation, angle: 0 };
  },
  move: (e) => {
    const s = current();
    if (!s || !start) return;
    s.view = { ...s.view, cx: start.cx + e.sx - start.sx, cy: start.cy + e.sy - start.sy };
    s.fitted = false;
    requestFrame();
  },
  up: () => {
    start = null;
    bump();
  },
};

export const zoomTool: Tool = {
  id: 'zoom',
  cursor: (e) => (e?.alt ? 'zoom-out' : 'zoom-in'),
  down: (e) => {
    const s = current();
    if (!s) return;
    start = { sx: e.sx, sy: e.sy, cx: s.view.cx, cy: s.view.cy, zoom: s.view.zoom, rotation: 0, angle: 0 };
  },
  move: (e) => {
    const s = current();
    if (!s || !start || !app.get().opts.zoom.scrubby) return;
    // Scrubby zoom: drag right to zoom in, left to zoom out.
    const f = Math.pow(1.01, e.sx - start.sx);
    s.view = zoomAt({ ...s.view, zoom: start.zoom, cx: start.cx, cy: start.cy }, f, start.sx, start.sy);
    s.fitted = false;
    requestFrame();
  },
  up: (e) => {
    if (!start) return;
    if (Math.abs(e.sx - start.sx) < 3) zoomStep(e.alt ? -1 : 1, e.sx, e.sy);
    start = null;
    bump();
  },
};

export const rotateViewTool: Tool = {
  id: 'rotateView',
  cursor: () => 'grab',
  down: (e) => {
    const s = current();
    if (!s) return;
    if (e.detail >= 2) {
      s.view = { ...s.view, rotation: 0 };
      requestFrame();
      return;
    }
    start = {
      sx: e.sx,
      sy: e.sy,
      cx: s.view.cx,
      cy: s.view.cy,
      zoom: s.view.zoom,
      rotation: s.view.rotation,
      angle: Math.atan2(e.sy - s.view.cy, e.sx - s.view.cx),
    };
  },
  move: (e: ToolEvent) => {
    const s = current();
    if (!s || !start) return;
    const a = Math.atan2(e.sy - start.cy, e.sx - start.cx);
    let r = start.rotation + ((a - start.angle) * 180) / Math.PI;
    if (e.shift) r = Math.round(r / 15) * 15;
    s.view = { ...s.view, rotation: ((r % 360) + 360) % 360 };
    requestFrame();
  },
  up: () => {
    start = null;
    bump();
  },
  key: (e) => {
    if (e.key === 'Escape') {
      const s = current();
      if (s) {
        s.view = { ...s.view, rotation: 0 };
        requestFrame();
      }
      return true;
    }
    return false;
  },
  overlay: ({ ctx }) => {
    const s = current();
    if (!s) return;
    // A compass showing which way is up.
    const r = 60;
    ctx.save();
    ctx.translate(s.view.cx, s.view.cy);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate((s.view.rotation * Math.PI) / 180);
    ctx.fillStyle = 'rgba(220,60,50,0.9)';
    ctx.beginPath();
    ctx.moveTo(0, -r + 4);
    ctx.lineTo(-8, -r + 22);
    ctx.lineTo(8, -r + 22);
    ctx.fill();
    ctx.restore();
  },
};
