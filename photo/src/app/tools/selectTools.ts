// The selection tools: Rectangular and Elliptical Marquee (and single row /
// column), Lasso, Polygonal Lasso, Magnetic Lasso, Magic Wand, Quick
// Selection and Object Selection. Shift adds, Alt subtracts, both intersect;
// dragging inside a selection moves its outline.

import { app, current, requestFrame, toast, bump } from '../state';
import { applySelection, transformSelection } from '../ops/select';
import { flatten, canvasRect, selectionMask, withSelection } from '../ops/common';
import { ellipseMask, fillPolygons, magicWand, quickSelect, rectMask, maskOutline, simplify, combine, emptyMask, featherMask, type Mask, type SelectOp } from '../../core/selection';
import { hasRaster } from '../../core/layers';
import type { Doc, Rect } from '../../core/types';
import type { Overlay, Tool, ToolEvent } from './types';
import { docPx } from './types';
import { objectSelect } from '../objectSelect';

/** The operation from the options bar and the keys held when the drag started. */
function opFor(e: ToolEvent): SelectOp {
  if (e.shift && e.alt) return 'intersect';
  if (e.shift) return 'add';
  if (e.alt) return 'subtract';
  return app.get().opts.selection.op;
}

// ---- the picture tools pick from (all layers or the current one), cached per change ----

let cache: { doc: Doc; layers: unknown; all: boolean; data: Float32Array } | null = null;

export function sampleSource(all: boolean): { w: number; h: number; data: Float32Array } | null {
  const s = current();
  if (!s) return null;
  const d = s.doc;
  if (cache && cache.layers === d.layers && cache.all === all && cache.doc.width === d.width && cache.doc.height === d.height) return { w: d.width, h: d.height, data: cache.data };
  let data: Float32Array;
  const l = s.activeLayer();
  if (!all && l && hasRaster(l)) data = l.raster.read(canvasRect(d));
  else data = flatten(d, canvasRect(d));
  cache = { doc: d, layers: d.layers, all, data };
  return { w: d.width, h: d.height, data };
}

// ---- marquees ----

let drag: { x0: number; y0: number; x1: number; y1: number; op: SelectOp; moving: boolean; outline: number[][] | null; alt: boolean; shift: boolean } | null = null;

function marqueeRect(d: NonNullable<typeof drag>, square: boolean, centered: boolean): Rect {
  const o = app.get().opts.selection;
  let w = d.x1 - d.x0,
    h = d.y1 - d.y0;
  if (o.style === 'fixedSize') {
    w = o.w * Math.sign(w || 1);
    h = o.h * Math.sign(h || 1);
  } else if (o.style === 'fixedRatio' || square) {
    const ratio = o.style === 'fixedRatio' ? o.w / Math.max(0.001, o.h) : 1;
    const m = Math.max(Math.abs(w), Math.abs(h) * ratio);
    w = m * Math.sign(w || 1);
    h = (m / ratio) * Math.sign(h || 1);
  }
  let x = d.x0,
    y = d.y0;
  if (centered) {
    x -= w;
    y -= h;
    w *= 2;
    h *= 2;
  }
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function insideSelection(x: number, y: number): boolean {
  const s = current();
  const sel = s?.doc.selection;
  if (!s || !sel) return false;
  return sel.mask.pixel(Math.floor(x), Math.floor(y))[0]! > 0.5;
}

function startMoveOutline(e: ToolEvent): boolean {
  const s = current();
  if (!s || e.shift || e.alt || app.get().opts.selection.op !== 'replace' || !insideSelection(e.x, e.y)) return false;
  const m = selectionMask(s.doc);
  if (!m) return false;
  const step = Math.max(1, Math.round(Math.max(s.doc.width, s.doc.height) / 1500));
  drag = { x0: e.x, y0: e.y, x1: e.x, y1: e.y, op: 'replace', moving: true, outline: maskOutline(m, step).map((p) => simplify(p, step * 0.7)), alt: false, shift: false };
  return true;
}

function drawOutline(o: Overlay, polys: number[][], dx: number, dy: number): void {
  const { ctx, toScreen: T } = o;
  ctx.save();
  ctx.lineWidth = 1;
  for (const [color, dash] of [
    ['#000', 0],
    ['#fff', 4],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.setLineDash(dash ? [4, 4] : []);
    ctx.lineDashOffset = -o.time * 16;
    ctx.beginPath();
    for (const p of polys) {
      for (let i = 0; i < p.length; i += 2) {
        const [sx, sy] = T(p[i]! + dx, p[i + 1]! + dy);
        if (i === 0) ctx.moveTo(sx + 0.5, sy + 0.5);
        else ctx.lineTo(sx + 0.5, sy + 0.5);
      }
      ctx.closePath();
    }
    ctx.stroke();
  }
  ctx.restore();
}

function finishMove(): void {
  if (!drag) return;
  const dx = Math.round(drag.x1 - drag.x0),
    dy = Math.round(drag.y1 - drag.y0);
  if (dx || dy) transformSelection([1, 0, 0, 1, dx, dy], 'Move Selection');
}

function makeMarquee(id: 'marqueeRect' | 'marqueeEllipse' | 'marqueeRow' | 'marqueeColumn'): Tool {
  return {
    id,
    cursor: (e) => (e && !e.shift && !e.alt && insideSelection(e.x, e.y) && app.get().opts.selection.op === 'replace' ? 'move' : 'crosshair'),
    down: (e) => {
      const s = current();
      if (!s) return;
      if (startMoveOutline(e)) return;
      drag = { x0: e.x, y0: e.y, x1: e.x, y1: e.y, op: opFor(e), moving: false, outline: null, alt: false, shift: false };
      if (id === 'marqueeRow' || id === 'marqueeColumn') {
        const r = id === 'marqueeRow' ? { x: 0, y: Math.floor(e.y), w: s.doc.width, h: 1 } : { x: Math.floor(e.x), y: 0, w: 1, h: s.doc.height };
        applySelection(rectMask(s.doc.width, s.doc.height, r), drag.op, id === 'marqueeRow' ? 'Single Row Marquee' : 'Single Column Marquee');
        drag = null;
      }
    },
    move: (e) => {
      if (!drag) return;
      drag.x1 = e.x;
      drag.y1 = e.y;
      drag.alt = e.alt;
      drag.shift = e.shift;
      requestFrame();
    },
    up: (e) => {
      const s = current();
      if (!s || !drag) return;
      drag.x1 = e.x;
      drag.y1 = e.y;
      if (drag.moving) {
        finishMove();
        drag = null;
        return;
      }
      const square = e.shift && drag.op === 'replace';
      const centered = e.alt && drag.op === 'replace';
      const r = marqueeRect(drag, square, centered);
      const o = app.get().opts.selection;
      if (r.w < 1 || r.h < 1) {
        // A click without a drag: deselect.
        if (drag.op === 'replace' && o.style === 'normal' && s.doc.selection) void import('../ops/select').then((m) => m.deselect());
        drag = null;
        return;
      }
      const m = id === 'marqueeEllipse' ? ellipseMask(s.doc.width, s.doc.height, r, o.antialias) : rectMask(s.doc.width, s.doc.height, r);
      applySelection(m, drag.op, id === 'marqueeEllipse' ? 'Elliptical Marquee' : 'Rectangular Marquee', o.feather);
      drag = null;
    },
    overlay: (o) => {
      if (!drag) return;
      if (drag.moving && drag.outline) {
        drawOutline(o, drag.outline, Math.round(drag.x1 - drag.x0), Math.round(drag.y1 - drag.y0));
        return;
      }
      const r = marqueeRect(drag, drag.shift && drag.op === 'replace', drag.alt && drag.op === 'replace');
      const { ctx } = o;
      const poly: number[] = [];
      if (id === 'marqueeEllipse') {
        for (let i = 0; i < 96; i++) {
          const a = (i / 96) * Math.PI * 2;
          poly.push(r.x + r.w / 2 + (Math.cos(a) * r.w) / 2, r.y + r.h / 2 + (Math.sin(a) * r.h) / 2);
        }
      } else poly.push(r.x, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.x, r.y + r.h);
      drawOutline(o, [poly], 0, 0);
      // Size readout next to the pointer.
      const [sx, sy] = o.toScreen(r.x + r.w, r.y + r.h);
      sizeTag(ctx, sx + 12, sy + 12, `W: ${r.w} px  H: ${r.h} px`);
    },
    key: (e) => {
      if (e.key === 'Escape' && drag) {
        drag = null;
        requestFrame();
        return true;
      }
      return false;
    },
  };
}

export function sizeTag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  ctx.save();
  ctx.font = '11px "Inter Variable", system-ui, sans-serif';
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = 'rgba(30,30,30,0.92)';
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, 20, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#eee';
  ctx.fillText(text, x + 6, y + 14);
  ctx.restore();
}

export const marqueeRectTool = makeMarquee('marqueeRect');
export const marqueeEllipseTool = makeMarquee('marqueeEllipse');
export const marqueeRowTool = makeMarquee('marqueeRow');
export const marqueeColumnTool = makeMarquee('marqueeColumn');

// ---- lassos ----

let lasso: { pts: number[]; op: SelectOp; poly: boolean; hover: [number, number] | null } | null = null;

function finishLasso(): void {
  const s = current();
  if (!s || !lasso || lasso.pts.length < 6) {
    lasso = null;
    requestFrame();
    return;
  }
  const o = app.get().opts.selection;
  const m = fillPolygons(s.doc.width, s.doc.height, [lasso.pts], o.antialias);
  applySelection(m, lasso.op, 'Lasso', o.feather);
  lasso = null;
}

function drawLasso(o: Overlay, closed: boolean): void {
  if (!lasso) return;
  const pts = [...lasso.pts];
  if (lasso.hover) pts.push(...lasso.hover);
  drawPolyline(o, pts, closed);
}

export function drawPolyline(o: Overlay, pts: number[], closed: boolean): void {
  const { ctx, toScreen: T } = o;
  ctx.save();
  for (const [color, dash] of [
    ['#000', 0],
    ['#fff', 4],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.setLineDash(dash ? [4, 4] : []);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const [sx, sy] = T(pts[i]!, pts[i + 1]!);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    if (closed) ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

export const lassoTool: Tool = {
  id: 'lasso',
  cursor: () => 'crosshair',
  down: (e) => {
    if (startMoveOutline(e)) return;
    lasso = { pts: [e.x, e.y], op: opFor(e), poly: false, hover: null };
  },
  move: (e) => {
    if (drag?.moving) {
      drag.x1 = e.x;
      drag.y1 = e.y;
      requestFrame();
      return;
    }
    if (!lasso) return;
    const n = lasso.pts.length;
    if (Math.hypot(e.x - lasso.pts[n - 2]!, e.y - lasso.pts[n - 1]!) * current()!.view.zoom >= 1.5) lasso.pts.push(e.x, e.y);
    requestFrame();
  },
  up: () => {
    if (drag?.moving) {
      finishMove();
      drag = null;
      return;
    }
    finishLasso();
  },
  overlay: (o) => {
    if (drag?.moving && drag.outline) drawOutline(o, drag.outline, Math.round(drag.x1 - drag.x0), Math.round(drag.y1 - drag.y0));
    drawLasso(o, false);
  },
};

export const polyLassoTool: Tool = {
  id: 'polyLasso',
  cursor: () => 'crosshair',
  down: (e) => {
    if (!lasso) {
      lasso = { pts: [e.x, e.y], op: opFor(e), poly: true, hover: null };
      return;
    }
    // Close on the start point or a double click.
    const [x0, y0] = [lasso.pts[0]!, lasso.pts[1]!];
    if (e.detail >= 2 || Math.hypot(e.x - x0, e.y - y0) < docPx(6)) {
      finishLasso();
      return;
    }
    let x = e.x,
      y = e.y;
    if (e.shift) [x, y] = snap45(lasso.pts[lasso.pts.length - 2]!, lasso.pts[lasso.pts.length - 1]!, x, y);
    lasso.pts.push(x, y);
    requestFrame();
  },
  hover: (e) => {
    if (!lasso) return;
    lasso.hover = e.shift ? snap45(lasso.pts[lasso.pts.length - 2]!, lasso.pts[lasso.pts.length - 1]!, e.x, e.y) : [e.x, e.y];
    requestFrame();
  },
  key: (e) => {
    if (!lasso) return false;
    if (e.key === 'Enter') {
      finishLasso();
      return true;
    }
    if (e.key === 'Escape') {
      lasso = null;
      requestFrame();
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (lasso.pts.length > 2) lasso.pts.length -= 2;
      requestFrame();
      return true;
    }
    return false;
  },
  overlay: (o) => drawLasso(o, false),
  active: () => !!lasso,
  commit: () => finishLasso(),
  cancel: () => {
    lasso = null;
    requestFrame();
  },
  leave: () => {
    lasso = null;
  },
};

export function snap45(x0: number, y0: number, x: number, y: number): [number, number] {
  const a = Math.atan2(y - y0, x - x0);
  const s = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
  const d = Math.hypot(x - x0, y - y0);
  return [x0 + Math.cos(s) * d, y0 + Math.sin(s) * d];
}

// ---- magnetic lasso: the path between anchors follows edges (live wire) ----

let mag: { anchors: number[]; fixed: number[]; live: number[]; op: SelectOp; cost: Float32Array | null; w: number; h: number; lastAnchorAt: number } | null = null;

function edgeCost(): { cost: Float32Array; w: number; h: number } | null {
  const src = sampleSource(true);
  if (!src) return null;
  const { w, h, data } = src;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  const cost = new Float32Array(w * h);
  let max = 1e-6;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const g = Math.hypot(L[i + 1]! - L[i - 1]!, L[i + w]! - L[i - w]!);
      cost[i] = g;
      if (g > max) max = g;
    }
  for (let i = 0; i < cost.length; i++) cost[i] = 1 - cost[i]! / max;
  return { cost, w, h };
}

/** The cheapest path (along edges) between two points within a band around them. */
function liveWire(cost: Float32Array, w: number, h: number, ax: number, ay: number, bx: number, by: number, width: number): number[] {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - width)),
    y0 = Math.max(0, Math.floor(Math.min(ay, by) - width));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + width)),
    y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + width));
  const bw = x1 - x0 + 1,
    bh = y1 - y0 + 1;
  if (bw * bh > 600_000) return [bx, by];
  const dist = new Float32Array(bw * bh).fill(Infinity);
  const prev = new Int32Array(bw * bh).fill(-1);
  const start = (Math.round(ay) - y0) * bw + (Math.round(ax) - x0);
  const goal = (Math.round(by) - y0) * bw + (Math.round(bx) - x0);
  if (start < 0 || goal < 0 || start >= dist.length || goal >= dist.length) return [bx, by];
  // Dijkstra with a binary heap.
  const heap: number[] = [];
  const hd: number[] = [];
  const push = (i: number, d: number) => {
    heap.push(i);
    hd.push(d);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hd[p]! <= hd[k]!) break;
      [heap[p], heap[k]] = [heap[k]!, heap[p]!];
      [hd[p], hd[k]] = [hd[k]!, hd[p]!];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heap[0]!;
    const li = heap.pop()!,
      ld = hd.pop()!;
    if (heap.length) {
      heap[0] = li;
      hd[0] = ld;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1,
          r = l + 1;
        let m = k;
        if (l < heap.length && hd[l]! < hd[m]!) m = l;
        if (r < heap.length && hd[r]! < hd[m]!) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k]!, heap[m]!];
        [hd[m], hd[k]] = [hd[k]!, hd[m]!];
        k = m;
      }
    }
    return top;
  };
  dist[start] = 0;
  push(start, 0);
  while (heap.length) {
    const i = pop();
    if (i === goal) break;
    const x = i % bw,
      y = (i / bw) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const j = ny * bw + nx;
        const c = cost[(ny + y0) * w + nx + x0]! * (dx && dy ? 1.414 : 1) + 0.05;
        const nd = dist[i]! + c;
        if (nd < dist[j]!) {
          dist[j] = nd;
          prev[j] = i;
          push(j, nd);
        }
      }
  }
  const path: number[] = [];
  for (let i = goal; i >= 0 && i !== start; i = prev[i]!) path.push((i % bw) + x0 + 0.5, ((i / bw) | 0) + y0 + 0.5);
  path.reverse();
  // Pairs were pushed x then y and reversed: put them back in order.
  const out: number[] = [];
  for (let i = 0; i < path.length; i += 2) out.push(path[i + 1]!, path[i]!);
  return out.length ? out : [bx, by];
}

function finishMag(): void {
  const s = current();
  if (!s || !mag) return;
  const pts = [...mag.fixed, ...mag.live];
  if (pts.length >= 6) {
    const m = fillPolygons(s.doc.width, s.doc.height, [pts], app.get().opts.selection.antialias);
    applySelection(m, mag.op, 'Magnetic Lasso', app.get().opts.selection.feather);
  }
  mag = null;
  requestFrame();
}

export const magneticLassoTool: Tool = {
  id: 'magneticLasso',
  cursor: () => 'crosshair',
  down: (e) => {
    if (!mag) {
      const ec = edgeCost();
      if (!ec) return;
      mag = { anchors: [e.x, e.y], fixed: [e.x, e.y], live: [], op: opFor(e), cost: ec.cost, w: ec.w, h: ec.h, lastAnchorAt: 0 };
      return;
    }
    if (e.detail >= 2 || Math.hypot(e.x - mag.anchors[0]!, e.y - mag.anchors[1]!) < docPx(8)) {
      // Close back to the start along the edge.
      if (mag.cost) mag.live.push(...liveWire(mag.cost, mag.w, mag.h, mag.live.length ? mag.live[mag.live.length - 2]! : mag.anchors[mag.anchors.length - 2]!, mag.live.length ? mag.live[mag.live.length - 1]! : mag.anchors[mag.anchors.length - 1]!, mag.anchors[0]!, mag.anchors[1]!, app.get().opts.magnetic.width * 2));
      finishMag();
      return;
    }
    // A click sets an anchor.
    mag.fixed.push(...mag.live);
    mag.live = [];
    mag.anchors.push(e.x, e.y);
  },
  hover: (e) => {
    if (!mag || !mag.cost) return;
    const n = mag.anchors.length;
    const ax = mag.anchors[n - 2]!,
      ay = mag.anchors[n - 1]!;
    mag.live = liveWire(mag.cost, mag.w, mag.h, ax, ay, e.x, e.y, app.get().opts.magnetic.width * 2);
    // Anchors drop on their own as the path gets long.
    const freq = app.get().opts.magnetic.frequency;
    if (mag.live.length / 2 > Math.max(20, 200 - freq * 1.8)) {
      mag.fixed.push(...mag.live);
      mag.anchors.push(mag.live[mag.live.length - 2]!, mag.live[mag.live.length - 1]!);
      mag.live = [];
    }
    requestFrame();
  },
  key: (e) => {
    if (!mag) return false;
    if (e.key === 'Enter') {
      finishMag();
      return true;
    }
    if (e.key === 'Escape') {
      mag = null;
      requestFrame();
      return true;
    }
    return false;
  },
  overlay: (o) => {
    if (!mag) return;
    drawPolyline(o, [...mag.fixed, ...mag.live], false);
    const { ctx, toScreen: T } = o;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    for (let i = 0; i < mag.anchors.length; i += 2) {
      const [sx, sy] = T(mag.anchors[i]!, mag.anchors[i + 1]!);
      ctx.fillRect(sx - 2.5, sy - 2.5, 5, 5);
      ctx.strokeRect(sx - 2.5, sy - 2.5, 5, 5);
    }
  },
  active: () => !!mag,
  commit: () => finishMag(),
  cancel: () => {
    mag = null;
  },
  leave: () => {
    mag = null;
  },
};

// ---- Magic Wand ----

export const magicWandTool: Tool = {
  id: 'magicWand',
  cursor: () => 'crosshair',
  down: (e) => {
    const s = current();
    if (!s) return;
    const o = app.get().opts.wand;
    const src = sampleSource(o.allLayers);
    if (!src) return;
    if (e.x < 0 || e.y < 0 || e.x >= s.doc.width || e.y >= s.doc.height) return;
    const m = magicWand(src, e.x, e.y, o.tolerance, o.contiguous, o.antialias);
    applySelection(m, opFor(e), 'Magic Wand', app.get().opts.selection.feather);
  },
};

// ---- Quick Selection: paint over what you want ----

let quick: { op: SelectOp; base: Mask | null; acc: Mask | null; last: [number, number] | null; pending: [number, number][]; timer: number } | null = null;

function quickStep(): void {
  const s = current();
  if (!s || !quick || !quick.pending.length) return;
  const o = app.get().opts.quick;
  const src = sampleSource(o.allLayers);
  if (!src) return;
  const r = o.size / 2;
  // Work in a window around the new dabs.
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of quick.pending) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const lim = r * 4;
  const win = { x: Math.max(0, Math.floor(x0 - lim)), y: Math.max(0, Math.floor(y0 - lim)), w: 0, h: 0 };
  win.w = Math.min(s.doc.width, Math.ceil(x1 + lim)) - win.x;
  win.h = Math.min(s.doc.height, Math.ceil(y1 + lim)) - win.y;
  if (win.w <= 0 || win.h <= 0) return;
  const data = new Float32Array(win.w * win.h * 4);
  for (let y = 0; y < win.h; y++) data.set(src.data.subarray(((win.y + y) * src.w + win.x) * 4, ((win.y + y) * src.w + win.x + win.w) * 4), y * win.w * 4);
  const seeds = emptyMask(win.w, win.h);
  for (const [px, py] of quick.pending) {
    const cx = px - win.x,
      cy = py - win.y;
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(win.h, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(win.w, Math.ceil(cx + r)); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) seeds.data[y * win.w + x] = 255;
  }
  quick.pending = [];
  const part = quickSelect({ w: win.w, h: win.h, data }, seeds, r * 2.5, 1);
  // Into the document-size mask.
  const acc = quick.acc ?? emptyMask(s.doc.width, s.doc.height);
  for (let y = 0; y < win.h; y++)
    for (let x = 0; x < win.w; x++) {
      const v = part.data[y * win.w + x]!;
      const i = (win.y + y) * s.doc.width + win.x + x;
      if (v > acc.data[i]!) acc.data[i] = v;
    }
  quick.acc = acc;
  const next = quick.base ? combine(quick.base, acc, quick.op === 'subtract' ? 'subtract' : 'add') : acc;
  // Show it as we go (one history step at the end).
  s.doc = withSelection(s.doc, next);
  requestFrame();
}

export const quickSelectTool: Tool = {
  id: 'quickSelect',
  cursor: () => 'crosshair',
  brushSize: () => app.get().opts.quick.size,
  down: (e) => {
    const s = current();
    if (!s) return;
    const base = selectionMask(s.doc);
    // Quick selection adds by default once there is a selection (as Photoshop does).
    const op: SelectOp = e.alt ? 'subtract' : base ? 'add' : 'replace';
    quick = { op, base: op === 'replace' ? null : base, acc: null, last: [e.x, e.y], pending: [[e.x, e.y]], timer: 0 };
    quickStep();
  },
  move: (e) => {
    if (!quick) return;
    const r = app.get().opts.quick.size / 4;
    if (quick.last && Math.hypot(e.x - quick.last[0], e.y - quick.last[1]) < r) return;
    quick.last = [e.x, e.y];
    quick.pending.push([e.x, e.y]);
    if (!quick.timer) quick.timer = window.setTimeout(() => {
      if (quick) {
        quick.timer = 0;
        quickStep();
      }
    }, 30);
  },
  up: () => {
    const s = current();
    if (!s || !quick) return;
    if (quick.timer) clearTimeout(quick.timer);
    quickStep();
    const final = selectionMask(s.doc);
    // Record it: restore the before state, then apply as one step.
    const before = quick.base;
    s.doc = withSelection(s.doc, before);
    const enhance = app.get().opts.quick.enhance;
    if (final) applySelection(enhance ? featherMask(final, 0.8) : final, 'replace', 'Quick Selection');
    else bump();
    quick = null;
  },
};

// ---- Object Selection: drag a box around something ----

let objBox: { x0: number; y0: number; x1: number; y1: number; op: SelectOp } | null = null;

export const objectSelectTool: Tool = {
  id: 'objectSelect',
  cursor: () => 'crosshair',
  down: (e) => {
    objBox = { x0: e.x, y0: e.y, x1: e.x, y1: e.y, op: opFor(e) };
  },
  move: (e) => {
    if (!objBox) return;
    objBox.x1 = e.x;
    objBox.y1 = e.y;
    requestFrame();
  },
  up: async () => {
    const s = current();
    const b = objBox;
    objBox = null;
    if (!s || !b) return;
    const r = { x: Math.min(b.x0, b.x1), y: Math.min(b.y0, b.y1), w: Math.abs(b.x1 - b.x0), h: Math.abs(b.y1 - b.y0) };
    const src = sampleSource(true);
    if (!src) return;
    const m = await objectSelect(src, r.w < 4 || r.h < 4 ? null : r, r.w < 4 ? [b.x0, b.y0] : null);
    if (!m) {
      toast('No object was found there. Try a box around it.');
      return;
    }
    applySelection(m, b.op, 'Object Selection');
  },
  overlay: (o) => {
    if (!objBox) return;
    const x = Math.min(objBox.x0, objBox.x1),
      y = Math.min(objBox.y0, objBox.y1);
    drawPolyline(o, [x, y, x + Math.abs(objBox.x1 - objBox.x0), y, x + Math.abs(objBox.x1 - objBox.x0), y + Math.abs(objBox.y1 - objBox.y0), x, y + Math.abs(objBox.y1 - objBox.y0)], true);
  },
};
