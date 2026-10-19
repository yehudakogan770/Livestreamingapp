// Paths and shapes: the Pen, Freeform Pen and Curvature Pen; adding,
// deleting and converting anchor points; Path Selection and Direct
// Selection; and the shape tools (Rectangle, Ellipse, Triangle, Polygon,
// Line, Custom Shape) making shape layers, paths or pixels.

import { app, current, requestFrame, bump, toast } from '../state';
import {
  clonePath,
  corner,
  ellipsePath,
  flatten,
  hitAnchor,
  linePath,
  polygonPath,
  rectPath,
  smoothPath,
  transformPath,
  type Anchor,
  type VectorPath,
} from '../../core/path';
import { CUSTOM_SHAPES, parseSvgPath } from '../../core/svgPath';
import { baseLayer, findLayer, insertLayers, nextName, uid, updateLayer } from '../../core/layers';
import { Raster, TileEdit } from '../../core/raster';
import { rerenderSync, renderShapeRaster } from '../layerContent';
import type { Layer, ShapeLayer } from '../../core/types';
import type { Overlay, Tool, ToolEvent } from './types';
import { docPx } from './types';
import { sizeTag, snap45 } from './selectTools';
import { paintTarget } from './paintTools';

/** Which path the pen and the selection tools work on. */
export type PathTarget = { kind: 'path'; id: string } | { kind: 'shape'; id: string } | { kind: 'vmask'; id: string };

let target: PathTarget | null = null;
/** Selected anchors (subpath, anchor) for Direct Selection. */
let selected: { s: number; a: number }[] = [];

export function setPathTarget(t: PathTarget | null): void {
  target = t;
  selected = [];
  bump();
}

export function pathTarget(): PathTarget | null {
  const s = current();
  if (!s) return null;
  // Follow the active shape layer.
  const l = s.activeLayer();
  if (!target && l?.kind === 'shape') return { kind: 'shape', id: l.id };
  if (target?.kind === 'shape' && !findLayer(s.doc.layers, target.id)) target = null;
  if (target?.kind === 'path' && !s.doc.paths.some((p) => p.id === target!.id)) target = null;
  return target;
}

export function targetPath(): VectorPath | null {
  const s = current();
  const t = pathTarget();
  if (!s || !t) return null;
  if (t.kind === 'path') return s.doc.paths.find((p) => p.id === t.id)?.path ?? null;
  const l = findLayer(s.doc.layers, t.id);
  if (t.kind === 'shape' && l?.kind === 'shape') return l.path;
  if (t.kind === 'vmask') return l?.vmask?.path ?? null;
  return null;
}

/** Put an edited path back where it belongs (live while dragging; `label` records a step). */
function storePath(p: VectorPath, label: string | null): void {
  const s = current();
  const t = pathTarget();
  if (!s || !t) return;
  let next = s.doc;
  if (t.kind === 'path') next = { ...next, paths: next.paths.map((x) => (x.id === t.id ? { ...x, path: p } : x)) };
  else if (t.kind === 'shape')
    next = { ...next, layers: updateLayer(next.layers, t.id, (l) => (l.kind === 'shape' ? rerenderSync({ ...l, path: p }, s.doc) : l)) };
  else next = { ...next, layers: updateLayer(next.layers, t.id, (l) => (l.vmask ? { ...l, vmask: { ...l.vmask, path: p } } : l)) };
  if (label) s.commit(label, 'path', next);
  else s.doc = next;
  bump();
}

/** Make (or reuse) the Work Path for new drawing. */
function ensureWorkPath(): VectorPath {
  const s = current()!;
  const t = pathTarget();
  if (t) return targetPath() ?? { subpaths: [] };
  let wp = s.doc.paths.find((p) => p.name === 'Work Path');
  if (!wp) {
    wp = { id: uid('p'), name: 'Work Path', path: { subpaths: [] } };
    s.doc = { ...s.doc, paths: [...s.doc.paths, wp] };
  }
  target = { kind: 'path', id: wp.id };
  return wp.path;
}

// ---- drawing paths on the overlay ----

export function drawPath(o: Overlay, p: VectorPath, opts: { anchors: boolean; selected?: { s: number; a: number }[]; color?: string }): void {
  const { ctx, toScreen } = o;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = opts.color ?? '#3d8bfd';
  for (const sp of flatten(p, 0.5 / Math.max(0.01, o.zoom))) {
    ctx.beginPath();
    for (let i = 0; i < sp.pts.length; i += 2) {
      const [x, y] = toScreen(sp.pts[i]!, sp.pts[i + 1]!);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (sp.closed) ctx.closePath();
    ctx.stroke();
  }
  if (opts.anchors) {
    p.subpaths.forEach((sp, si) =>
      sp.anchors.forEach((a, ai) => {
        const sel = opts.selected?.some((x) => x.s === si && x.a === ai);
        const [x, y] = toScreen(a.x, a.y);
        if (sel) {
          // Handles of selected anchors.
          for (const [hx, hy] of [
            [a.ix, a.iy],
            [a.ox, a.oy],
          ] as const) {
            if (hx === a.x && hy === a.y) continue;
            const [sx, sy] = toScreen(hx, hy);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(sx, sy);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(sx, sy, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#3d8bfd';
            ctx.fill();
          }
        }
        ctx.fillStyle = sel ? '#3d8bfd' : '#fff';
        ctx.fillRect(x - 3, y - 3, 6, 6);
        ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
      }),
    );
  }
  ctx.restore();
}

// ---- Pen ----

let pen: { path: VectorPath; si: number; dragging: boolean; hover: [number, number] | null; shape: boolean } | null = null;

function finishPen(): void {
  const s = current();
  if (!s || !pen) return;
  const p = pen.path;
  const isShape = pen.shape;
  pen = null;
  if (isShape) {
    const sp = p.subpaths[p.subpaths.length - 1];
    if (sp && sp.anchors.length > 1) makeShape({ subpaths: [sp] }, 'Pen');
    return;
  }
  storePath(p, 'Pen');
}

export const penTool: Tool = {
  id: 'pen',
  cursor: () => 'crosshair',
  down: (e) => {
    const s = current();
    if (!s) return;
    if (!pen) {
      const shape = app.get().opts.pen.mode === 'shape' && current()?.activeLayer()?.kind !== 'shape';
      const base = shape ? { subpaths: [] } : clonePath(ensureWorkPath());
      base.subpaths.push({ anchors: [], closed: false });
      pen = { path: base, si: base.subpaths.length - 1, dragging: false, hover: null, shape };
    }
    const sp = pen.path.subpaths[pen.si]!;
    // Click the first anchor: close.
    const first = sp.anchors[0];
    if (first && sp.anchors.length > 1 && Math.hypot(e.x - first.x, e.y - first.y) < docPx(7)) {
      sp.closed = true;
      finishPen();
      return;
    }
    let [x, y] = [e.x, e.y];
    const last = sp.anchors[sp.anchors.length - 1];
    if (e.shift && last) [x, y] = snap45(last.x, last.y, x, y);
    sp.anchors.push(corner(x, y));
    pen.dragging = true;
    if (!pen.shape) storePath(pen.path, null);
    requestFrame();
  },
  move: (e) => {
    if (!pen || !pen.dragging) return;
    // Dragging pulls out symmetric handles (a smooth point).
    const sp = pen.path.subpaths[pen.si]!;
    const a = sp.anchors[sp.anchors.length - 1]!;
    const dx = e.x - a.x,
      dy = e.y - a.y;
    a.ox = a.x + dx;
    a.oy = a.y + dy;
    if (!e.alt) {
      a.ix = a.x - dx;
      a.iy = a.y - dy;
    }
    a.smooth = !e.alt;
    if (!pen.shape) storePath(pen.path, null);
    requestFrame();
  },
  up: () => {
    if (pen) pen.dragging = false;
  },
  hover: (e) => {
    if (!pen) return;
    pen.hover = [e.x, e.y];
    requestFrame();
  },
  key: (e) => {
    if (!pen) return false;
    if (e.key === 'Enter' || e.key === 'Escape') {
      finishPen();
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const sp = pen.path.subpaths[pen.si]!;
      sp.anchors.pop();
      requestFrame();
      return true;
    }
    return false;
  },
  overlay: (o) => {
    const p = pen?.path ?? targetPath();
    if (!p) return;
    drawPath(o, p, { anchors: true, selected: pen ? [{ s: pen.si, a: (pen.path.subpaths[pen.si]?.anchors.length ?? 1) - 1 }] : selected });
    if (pen?.hover) {
      // Rubber band to the pointer.
      const sp = pen.path.subpaths[pen.si]!;
      const a = sp.anchors[sp.anchors.length - 1];
      if (a) {
        const preview = { subpaths: [{ anchors: [{ ...a }, corner(pen.hover[0], pen.hover[1])], closed: false }] };
        drawPath(o, preview, { anchors: false, color: 'rgba(61,139,253,0.6)' });
      }
    }
  },
  active: () => !!pen,
  commit: () => finishPen(),
  cancel: () => finishPen(),
  leave: () => finishPen(),
};

// ---- Freeform Pen ----

let free: number[] | null = null;

export const freeformPenTool: Tool = {
  id: 'freeformPen',
  cursor: () => 'crosshair',
  down: (e) => {
    free = [e.x, e.y];
  },
  move: (e) => {
    if (!free) return;
    const n = free.length;
    if (Math.hypot(e.x - free[n - 2]!, e.y - free[n - 1]!) > docPx(3)) free.push(e.x, e.y);
    requestFrame();
  },
  up: () => {
    const pts = free;
    free = null;
    if (!pts || pts.length < 6) return;
    // Fit: keep every few points and smooth them.
    const step = 6;
    const kept: number[] = [];
    for (let i = 0; i < pts.length; i += 2 * step) kept.push(pts[i]!, pts[i + 1]!);
    kept.push(pts[pts.length - 2]!, pts[pts.length - 1]!);
    const closed = Math.hypot(pts[0]! - pts[pts.length - 2]!, pts[1]! - pts[pts.length - 1]!) < docPx(10);
    const sp = smoothPath(kept, closed).subpaths[0]!;
    if (app.get().opts.pen.mode === 'shape') {
      makeShape({ subpaths: [sp] }, 'Freeform Pen');
      return;
    }
    const base = clonePath(ensureWorkPath());
    base.subpaths.push(sp);
    storePath(base, 'Freeform Pen');
  },
  overlay: (o) => {
    if (!free) return;
    const { ctx, toScreen } = o;
    ctx.strokeStyle = '#3d8bfd';
    ctx.beginPath();
    for (let i = 0; i < free.length; i += 2) {
      const [x, y] = toScreen(free[i]!, free[i + 1]!);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  },
};

// ---- Curvature Pen: clicks make smooth curves through the points ----

let curv: { pts: number[]; closed: boolean } | null = null;

function curvPath(): VectorPath {
  return smoothPath(curv!.pts, curv!.closed);
}

export const curvaturePenTool: Tool = {
  id: 'curvaturePen',
  cursor: () => 'crosshair',
  down: (e) => {
    if (!curv) curv = { pts: [], closed: false };
    if (curv.pts.length >= 6 && Math.hypot(e.x - curv.pts[0]!, e.y - curv.pts[1]!) < docPx(7)) {
      curv.closed = true;
      finishCurv();
      return;
    }
    curv.pts.push(e.x, e.y);
    requestFrame();
  },
  key: (e) => {
    if (!curv) return false;
    if (e.key === 'Enter' || e.key === 'Escape') {
      finishCurv();
      return true;
    }
    return false;
  },
  overlay: (o) => {
    if (curv && curv.pts.length >= 4) drawPath(o, curvPath(), { anchors: true });
    else if (curv) {
      const [x, y] = o.toScreen(curv.pts[0]!, curv.pts[1]!);
      o.ctx.fillStyle = '#fff';
      o.ctx.fillRect(x - 3, y - 3, 6, 6);
    }
  },
  active: () => !!curv,
  commit: () => finishCurv(),
  cancel: () => {
    curv = null;
  },
  leave: () => finishCurv(),
};

function finishCurv(): void {
  if (!curv || curv.pts.length < 4) {
    curv = null;
    requestFrame();
    return;
  }
  const sp = curvPath().subpaths[0]!;
  curv = null;
  if (app.get().opts.pen.mode === 'shape') {
    makeShape({ subpaths: [sp] }, 'Curvature Pen');
    return;
  }
  const base = clonePath(ensureWorkPath());
  base.subpaths.push(sp);
  storePath(base, 'Curvature Pen');
}

// ---- anchor point tools ----

function nearestSegment(p: VectorPath, x: number, y: number): { s: number; seg: number; t: number; d: number } | null {
  let best: { s: number; seg: number; t: number; d: number } | null = null;
  p.subpaths.forEach((sp, si) => {
    const n = sp.closed ? sp.anchors.length : sp.anchors.length - 1;
    for (let k = 0; k < n; k++) {
      const A = sp.anchors[k]!,
        B = sp.anchors[(k + 1) % sp.anchors.length]!;
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const u = 1 - t;
        const px = u * u * u * A.x + 3 * u * u * t * A.ox + 3 * u * t * t * B.ix + t * t * t * B.x;
        const py = u * u * u * A.y + 3 * u * u * t * A.oy + 3 * u * t * t * B.iy + t * t * t * B.y;
        const d = Math.hypot(px - x, py - y);
        if (!best || d < best.d) best = { s: si, seg: k, t, d };
      }
    }
  });
  return best;
}

/** Split a segment at t (de Casteljau): a new anchor that keeps the curve's shape. */
function splitAt(p: VectorPath, s: number, seg: number, t: number): VectorPath {
  const out = clonePath(p);
  const sp = out.subpaths[s]!;
  const A = sp.anchors[seg]!,
    B = sp.anchors[(seg + 1) % sp.anchors.length]!;
  const L = (a: number, b: number) => a + (b - a) * t;
  const p01x = L(A.x, A.ox),
    p01y = L(A.y, A.oy);
  const p12x = L(A.ox, B.ix),
    p12y = L(A.oy, B.iy);
  const p23x = L(B.ix, B.x),
    p23y = L(B.iy, B.y);
  const a1x = L(p01x, p12x),
    a1y = L(p01y, p12y);
  const b1x = L(p12x, p23x),
    b1y = L(p12y, p23y);
  const mx = L(a1x, b1x),
    my = L(a1y, b1y);
  A.ox = p01x;
  A.oy = p01y;
  B.ix = p23x;
  B.iy = p23y;
  const mid: Anchor = { x: mx, y: my, ix: a1x, iy: a1y, ox: b1x, oy: b1y, smooth: true };
  sp.anchors.splice(seg + 1, 0, mid);
  return out;
}

export const addAnchorTool: Tool = {
  id: 'addAnchor',
  cursor: () => 'crosshair',
  down: (e) => {
    const p = targetPath();
    if (!p) return;
    const h = nearestSegment(p, e.x, e.y);
    if (!h || h.d > docPx(6)) return;
    storePath(splitAt(p, h.s, h.seg, h.t), 'Add Anchor Point');
  },
  overlay: (o) => {
    const p = targetPath();
    if (p) drawPath(o, p, { anchors: true });
  },
};

export const deleteAnchorTool: Tool = {
  id: 'deleteAnchor',
  cursor: () => 'crosshair',
  down: (e) => {
    const p = targetPath();
    if (!p) return;
    const h = hitAnchor(p, e.x, e.y, docPx(7));
    if (!h || h.part !== 'anchor') return;
    const out = clonePath(p);
    out.subpaths[h.s]!.anchors.splice(h.a, 1);
    out.subpaths = out.subpaths.filter((sp) => sp.anchors.length > 1);
    storePath(out, 'Delete Anchor Point');
  },
  overlay: (o) => {
    const p = targetPath();
    if (p) drawPath(o, p, { anchors: true });
  },
};

let convertDrag: { s: number; a: number } | null = null;

export const convertPointTool: Tool = {
  id: 'convertPoint',
  cursor: () => 'crosshair',
  down: (e) => {
    const p = targetPath();
    if (!p) return;
    const h = hitAnchor(p, e.x, e.y, docPx(7));
    if (!h) return;
    const out = clonePath(p);
    const a = out.subpaths[h.s]!.anchors[h.a]!;
    if (h.part === 'anchor' && (a.ix !== a.x || a.ox !== a.x || a.iy !== a.y || a.oy !== a.y)) {
      // A click on a smooth point makes it a corner.
      Object.assign(a, { ix: a.x, iy: a.y, ox: a.x, oy: a.y, smooth: false });
      storePath(out, 'Convert Point');
      return;
    }
    convertDrag = { s: h.s, a: h.a };
    storePath(out, 'Convert Point');
  },
  move: (e) => {
    if (!convertDrag) return;
    const p = targetPath();
    if (!p) return;
    const out = clonePath(p);
    const a = out.subpaths[convertDrag.s]!.anchors[convertDrag.a]!;
    a.ox = e.x;
    a.oy = e.y;
    a.ix = 2 * a.x - e.x;
    a.iy = 2 * a.y - e.y;
    a.smooth = true;
    storePath(out, null);
  },
  up: () => {
    if (convertDrag) {
      const p = targetPath();
      if (p) storePath(p, 'Convert Point');
    }
    convertDrag = null;
  },
  overlay: (o) => {
    const p = targetPath();
    if (p) drawPath(o, p, { anchors: true, selected });
  },
};

// ---- Path Selection and Direct Selection ----

let sdrag: { x0: number; y0: number; base: VectorPath; part: 'anchor' | 'in' | 'out' | 'whole'; picks: { s: number; a: number }[] } | null = null;

function selectTool(id: 'pathSelect' | 'directSelect'): Tool {
  return {
    id,
    cursor: () => 'default',
    down: (e) => {
      const p = targetPath();
      if (!p) return;
      const r = docPx(7);
      const h = hitAnchor(p, e.x, e.y, r);
      if (id === 'directSelect' && h) {
        const pick = { s: h.s, a: h.a };
        if (e.shift)
          selected = selected.some((x) => x.s === pick.s && x.a === pick.a) ? selected.filter((x) => !(x.s === pick.s && x.a === pick.a)) : [...selected, pick];
        else if (!selected.some((x) => x.s === pick.s && x.a === pick.a)) selected = [pick];
        sdrag = { x0: e.x, y0: e.y, base: clonePath(p), part: h.part, picks: h.part === 'anchor' ? selected : [pick] };
        requestFrame();
        return;
      }
      const seg = nearestSegment(p, e.x, e.y);
      if (seg && seg.d < r * 1.5) {
        const sp = p.subpaths[seg.s]!;
        selected = sp.anchors.map((_, a) => ({ s: seg.s, a }));
        sdrag = { x0: e.x, y0: e.y, base: clonePath(p), part: 'whole', picks: selected };
      } else selected = [];
      requestFrame();
    },
    move: (e) => {
      if (!sdrag) return;
      const dx = e.x - sdrag.x0,
        dy = e.y - sdrag.y0;
      const out = clonePath(sdrag.base);
      for (const { s, a } of sdrag.picks) {
        const k = out.subpaths[s]!.anchors[a]!;
        const b = sdrag.base.subpaths[s]!.anchors[a]!;
        if (sdrag.part === 'in' || sdrag.part === 'out') {
          const ox = sdrag.part === 'out' ? 'ox' : 'ix',
            oy = sdrag.part === 'out' ? 'oy' : 'iy';
          k[ox] = b[ox] + dx;
          k[oy] = b[oy] + dy;
          // Smooth points keep their handles in line (Alt breaks them).
          if (b.smooth && !e.alt) {
            const ix = sdrag.part === 'out' ? 'ix' : 'ox',
              iy = sdrag.part === 'out' ? 'iy' : 'oy';
            const len = Math.hypot(b[ix] - b.x, b[iy] - b.y);
            const ang = Math.atan2(k[oy] - k.y, k[ox] - k.x) + Math.PI;
            k[ix] = k.x + Math.cos(ang) * len;
            k[iy] = k.y + Math.sin(ang) * len;
          }
        } else {
          k.x = b.x + dx;
          k.y = b.y + dy;
          k.ix = b.ix + dx;
          k.iy = b.iy + dy;
          k.ox = b.ox + dx;
          k.oy = b.oy + dy;
        }
      }
      storePath(out, null);
    },
    up: () => {
      if (sdrag) {
        const p = targetPath();
        if (p) storePath(p, id === 'pathSelect' ? 'Move Path' : 'Drag Anchor');
      }
      sdrag = null;
    },
    key: (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
        const p = targetPath();
        if (!p) return false;
        const out = clonePath(p);
        for (const sp of out.subpaths.keys()) {
          const del = new Set(selected.filter((x) => x.s === sp).map((x) => x.a));
          out.subpaths[sp]!.anchors = out.subpaths[sp]!.anchors.filter((_, i) => !del.has(i));
        }
        out.subpaths = out.subpaths.filter((sp) => sp.anchors.length > 1);
        selected = [];
        storePath(out, 'Delete Anchor Point');
        return true;
      }
      return false;
    },
    overlay: (o) => {
      const p = targetPath();
      if (p) drawPath(o, p, { anchors: id === 'directSelect' || selected.length > 0, selected });
    },
  };
}

export const pathSelectTool = selectTool('pathSelect');
export const directSelectTool = selectTool('directSelect');

// ---- shapes ----

/** A new shape layer from a path (or a path, or pixels, per the options bar). */
export function makeShape(path: VectorPath, label: string): void {
  const s = current();
  if (!s) return;
  const o = app.get().opts.shape;
  if (o.mode === 'path') {
    const base = clonePath(ensureWorkPath());
    base.subpaths.push(...path.subpaths);
    storePath(base, label);
    return;
  }
  const fill = o.fill ? ([...o.fill, 1] as [number, number, number, number]) : null;
  const stroke = o.stroke
    ? {
        color: [...o.stroke, 1] as [number, number, number, number],
        width: o.strokeWidth,
        align: 'inside' as const,
        cap: 'butt' as const,
        join: 'miter' as const,
        dash: [],
      }
    : null;
  const layer: ShapeLayer = {
    ...baseLayer(nextName(s.doc, label.replace(/ Tool$/, ''))),
    kind: 'shape',
    path,
    fillColor: fill,
    stroke,
    raster: new Raster(s.doc.depth, 4),
  };
  layer.raster = renderShapeRaster(layer, s.doc);
  if (o.mode === 'pixels') {
    const t = paintTarget();
    if (!t || t.channels !== 4) return;
    // Pixels: the shape drawn into the current layer.
    const b = layer.raster.tileBounds();
    if (!b) return;
    const dst = t.raster.read(b),
      src = layer.raster.read(b);
    for (let i = 0; i < dst.length; i += 4) {
      const a = src[i + 3]!;
      if (a <= 0) continue;
      const ao = a + dst[i + 3]! * (1 - a);
      for (let k = 0; k < 3; k++) dst[i + k] = (src[i + k]! * a + dst[i + k]! * dst[i + 3]! * (1 - a)) / ao;
      dst[i + 3] = t.lockAlpha ? dst[i + 3]! : ao;
    }
    const e = new TileEdit(t.raster);
    t.raster.write(b, dst, e, true);
    s.commit(label, 'shape', { ...s.doc, layers: t.layerId ? updateLayer(s.doc.layers, t.layerId, (x) => ({ ...x }) as Layer) : s.doc.layers }, [e.commit()]);
    bump();
    return;
  }
  s.commit(label, 'shape', { ...s.doc, layers: insertLayers(s.doc.layers, [layer], s.active, 'above') });
  s.active = layer.id;
  s.selected = [layer.id];
  target = null;
  bump();
}

let shapeDrag: { x0: number; y0: number; x1: number; y1: number; shift: boolean; alt: boolean } | null = null;

function shapePath(kind: string, d: NonNullable<typeof shapeDrag>): VectorPath {
  const o = app.get().opts.shape;
  let x0 = d.x0,
    y0 = d.y0,
    w = d.x1 - d.x0,
    h = d.y1 - d.y0;
  if (kind === 'line') {
    let [x1, y1] = [d.x1, d.y1];
    if (d.shift) [x1, y1] = snap45(x0, y0, x1, y1);
    return linePath(x0, y0, x1, y1, o.lineWeight);
  }
  if (d.shift) {
    const m = Math.max(Math.abs(w), Math.abs(h));
    w = m * Math.sign(w || 1);
    h = m * Math.sign(h || 1);
  }
  if (d.alt) {
    x0 -= w;
    y0 -= h;
    w *= 2;
    h *= 2;
  }
  const rx = Math.min(x0, x0 + w),
    ry = Math.min(y0, y0 + h),
    rw = Math.abs(w),
    rh = Math.abs(h);
  switch (kind) {
    case 'rect':
      return rectPath(rx, ry, rw, rh, o.radius);
    case 'ellipse':
      return ellipsePath(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2);
    case 'triangle':
      return { subpaths: [{ closed: true, anchors: [corner(rx + rw / 2, ry), corner(rx + rw, ry + rh), corner(rx, ry + rh)] }] };
    case 'polygon': {
      const p = polygonPath(0, 0, 1, o.sides, o.star);
      return transformPath(p, [rw / 2, 0, 0, rh / 2, rx + rw / 2, ry + rh / 2]);
    }
    default: {
      const cs = CUSTOM_SHAPES.find((c) => c.id === o.custom) ?? CUSTOM_SHAPES[0]!;
      return transformPath(parseSvgPath(cs.d), [rw / 100, 0, 0, rh / 100, rx, ry]);
    }
  }
}

function shapeTool(id: 'rect' | 'ellipse' | 'triangle' | 'polygon' | 'line' | 'customShape', label: string): Tool {
  const kind = id === 'customShape' ? 'custom' : id;
  return {
    id,
    cursor: () => 'crosshair',
    down: (e) => {
      shapeDrag = { x0: e.x, y0: e.y, x1: e.x, y1: e.y, shift: e.shift, alt: e.alt };
    },
    move: (e: ToolEvent) => {
      if (!shapeDrag) return;
      shapeDrag = { ...shapeDrag, x1: e.x, y1: e.y, shift: e.shift, alt: e.alt };
      requestFrame();
    },
    up: () => {
      const d = shapeDrag;
      shapeDrag = null;
      if (!d) return;
      if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 2) {
        toast('Drag to draw the shape.');
        requestFrame();
        return;
      }
      makeShape(shapePath(kind, d), label);
    },
    overlay: (o) => {
      if (!shapeDrag) return;
      const p = shapePath(kind, shapeDrag);
      drawPath(o, p, { anchors: false });
      const w = Math.abs(shapeDrag.x1 - shapeDrag.x0),
        h = Math.abs(shapeDrag.y1 - shapeDrag.y0);
      const [sx, sy] = o.toScreen(shapeDrag.x1, shapeDrag.y1);
      sizeTag(o.ctx, sx + 12, sy + 12, `W: ${Math.round(w)} px  H: ${Math.round(h)} px`);
    },
  };
}

export const rectTool = shapeTool('rect', 'Rectangle');
export const ellipseTool = shapeTool('ellipse', 'Ellipse');
export const triangleTool = shapeTool('triangle', 'Triangle');
export const polygonTool = shapeTool('polygon', 'Polygon');
export const lineTool = shapeTool('line', 'Line');
export const customShapeTool = shapeTool('customShape', 'Shape');

export { findLayer };
