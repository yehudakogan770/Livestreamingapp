// Crop (with straighten, ratios, overlays, and content-aware filling of the
// edges a rotation or a bigger box leaves empty), Perspective Crop, Slice and
// Artboard.

import { app, current, requestFrame, bump, toast, busy } from '../state';
import { transformDoc } from '../ops/image';
import { inpaintRaster } from '../ops/heal';
import { flattenRaster, canvasRect, withSelection } from '../ops/common';
import { Raster } from '../../core/raster';
import { quadToQuad, warpProjective } from '../../core/warp';
import { allLayers, uid, updateLayer, pixelLayer } from '../../core/layers';
import { emptyMask } from '../../core/selection';
import type { Doc, Layer } from '../../core/types';
import type { Overlay, Tool, ToolEvent } from './types';
import { docPx } from './types';
import { sizeTag } from './selectTools';

interface CropBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Degrees (the box turns; the picture is straightened on commit). */
  angle: number;
}

let crop: CropBox | null = null;
let cdrag: { kind: string; index: number; x0: number; y0: number; box: CropBox; a0: number } | null = null;
let straighten: { x0: number; y0: number; x1: number; y1: number } | null = null;

const RATIOS: Record<string, number> = { '1:1': 1, '4:5': 4 / 5, '5:7': 5 / 7, '2:3': 2 / 3, '16:9': 16 / 9, '9:16': 9 / 16 };

function ratio(): number | null {
  const s = current();
  const o = app.get().opts.crop;
  if (o.ratio === 'free') return null;
  if (o.ratio === 'original' && s) return s.doc.width / s.doc.height;
  if (o.ratio === 'custom') return o.w > 0 && o.h > 0 ? o.w / o.h : null;
  return RATIOS[o.ratio] ?? null;
}

function corners(b: CropBox): [number, number][] {
  const a = (b.angle * Math.PI) / 180;
  const c = Math.cos(a),
    s = Math.sin(a);
  return [
    [-b.w / 2, -b.h / 2],
    [b.w / 2, -b.h / 2],
    [b.w / 2, b.h / 2],
    [-b.w / 2, b.h / 2],
  ].map(([x, y]) => [b.cx + x! * c - y! * s, b.cy + x! * s + y! * c]);
}

/** Into the box's own (unrotated) frame. */
function local(b: CropBox, x: number, y: number): [number, number] {
  const a = (-b.angle * Math.PI) / 180;
  const dx = x - b.cx,
    dy = y - b.cy;
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}

export function startCrop(): void {
  const s = current();
  if (!s) return;
  const r = ratio();
  let w = s.doc.width,
    h = s.doc.height;
  if (r) {
    if (w / h > r) w = h * r;
    else h = w / r;
  }
  crop = { cx: s.doc.width / 2, cy: s.doc.height / 2, w, h, angle: 0 };
  requestFrame();
}

export function cropActive(): boolean {
  return !!crop;
}

export async function commitCrop(): Promise<void> {
  const s = current();
  const b = crop;
  crop = null;
  if (!s || !b) return;
  const o = app.get().opts.crop;
  const W = Math.max(1, Math.round(b.w)),
    H = Math.max(1, Math.round(b.h));
  const a = (-b.angle * Math.PI) / 180;
  const c = Math.cos(a),
    sn = Math.sin(a);
  // Document → output: around the box center, turned straight.
  const mat = [c, sn, -sn, c, W / 2 - (c * b.cx - sn * b.cy), H / 2 - (sn * b.cx + c * b.cy)];
  const before = s.doc;
  if (b.angle === 0 && o.deleteCropped) {
    const { cropTo } = await import('../ops/image');
    cropTo({ x: Math.round(b.cx - b.w / 2), y: Math.round(b.cy - b.h / 2), w: W, h: H });
  } else await transformDoc(before, mat, W, H, 'bicubic', b.angle ? 'Crop and Straighten' : 'Crop');
  if (o.contentAware) await fillEmptyEdges();
  bump();
}

/** Content-Aware crop: the empty areas around the picture are filled on the bottom pixel layer. */
async function fillEmptyEdges(): Promise<void> {
  const s = current();
  if (!s) return;
  const base = s.doc.layers.find((l) => l.kind === 'pixel');
  if (!base || base.kind !== 'pixel') return;
  const r = canvasRect(s.doc);
  const px = base.raster.read(r);
  const hole = emptyMask(s.doc.width, s.doc.height);
  let any = false;
  for (let i = 0; i < hole.data.length; i++)
    if (px[i * 4 + 3]! < 0.99) {
      hole.data[i] = 255;
      any = true;
    }
  if (!any) return;
  const sw = await busy('Filling the edges…', () => inpaintRaster(base.raster, hole, s.doc.width, s.doc.height, null, 64));
  if (sw) s.amend({ ...s.doc, layers: updateLayer(s.doc.layers, base.id, (l) => ({ ...l }) as Layer) }, [sw]);
}

export function cancelCrop(): void {
  crop = null;
  straighten = null;
  requestFrame();
}

function cropHit(e: ToolEvent): { kind: string; index: number } {
  if (!crop) return { kind: 'none', index: -1 };
  const r = docPx(9);
  const cs = corners(crop);
  const mids = cs.map((p, i) => {
    const q = cs[(i + 1) % 4]!;
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as [number, number];
  });
  for (let i = 0; i < 4; i++) if (Math.hypot(e.x - cs[i]![0], e.y - cs[i]![1]) < r) return { kind: 'corner', index: i };
  for (let i = 0; i < 4; i++) if (Math.hypot(e.x - mids[i]![0], e.y - mids[i]![1]) < r) return { kind: 'edge', index: i };
  const [lx, ly] = local(crop, e.x, e.y);
  if (Math.abs(lx) <= crop.w / 2 && Math.abs(ly) <= crop.h / 2) return { kind: 'move', index: -1 };
  return { kind: 'rotate', index: -1 };
}

export const cropTool: Tool = {
  id: 'crop',
  cursor: (e) => {
    if (!e || !crop) return 'crosshair';
    const h = cropHit(e);
    return h.kind === 'move' ? 'move' : h.kind === 'rotate' ? 'alias' : h.kind === 'none' ? 'crosshair' : 'nwse-resize';
  },
  down: (e) => {
    const s = current();
    if (!s) return;
    if (app.get().opts.crop.straighten || (e.ctrl && crop)) {
      straighten = { x0: e.x, y0: e.y, x1: e.x, y1: e.y };
      return;
    }
    if (!crop) {
      crop = { cx: e.x, cy: e.y, w: 0, h: 0, angle: 0 };
      cdrag = { kind: 'new', index: 2, x0: e.x, y0: e.y, box: { ...crop }, a0: 0 };
      return;
    }
    const h = cropHit(e);
    cdrag = { kind: h.kind, index: h.index, x0: e.x, y0: e.y, box: { ...crop }, a0: Math.atan2(e.y - crop.cy, e.x - crop.cx) };
  },
  move: (e) => {
    if (straighten) {
      straighten.x1 = e.x;
      straighten.y1 = e.y;
      requestFrame();
      return;
    }
    if (!crop || !cdrag) return;
    const b = cdrag.box;
    const rr = ratio();
    if (cdrag.kind === 'new') {
      let w = Math.abs(e.x - cdrag.x0),
        h = Math.abs(e.y - cdrag.y0);
      if (rr) h = w / rr;
      crop = { cx: cdrag.x0 + (Math.sign(e.x - cdrag.x0) * w) / 2, cy: cdrag.y0 + (Math.sign(e.y - cdrag.y0 || 1) * h) / 2, w, h, angle: 0 };
    } else if (cdrag.kind === 'move') crop = { ...b, cx: b.cx + e.x - cdrag.x0, cy: b.cy + e.y - cdrag.y0 };
    else if (cdrag.kind === 'rotate') {
      let ang = b.angle + ((Math.atan2(e.y - b.cy, e.x - b.cx) - cdrag.a0) * 180) / Math.PI;
      if (e.shift) ang = Math.round(ang / 15) * 15;
      crop = { ...b, angle: ang };
    } else {
      // Resize in the box's frame, the opposite side fixed.
      const [lx, ly] = local(b, e.x, e.y);
      const i = cdrag.index;
      const corner = cdrag.kind === 'corner';
      const sx = corner ? (i === 0 || i === 3 ? -1 : 1) : i === 1 ? 1 : i === 3 ? -1 : 0;
      const sy = corner ? (i < 2 ? -1 : 1) : i === 0 ? -1 : i === 2 ? 1 : 0;
      let x0 = -b.w / 2,
        x1 = b.w / 2,
        y0 = -b.h / 2,
        y1 = b.h / 2;
      if (sx < 0) x0 = Math.min(lx, x1 - 1);
      if (sx > 0) x1 = Math.max(lx, x0 + 1);
      if (sy < 0) y0 = Math.min(ly, y1 - 1);
      if (sy > 0) y1 = Math.max(ly, y0 + 1);
      let w = x1 - x0,
        h = y1 - y0;
      if (rr || (corner && e.shift)) {
        const k = rr ?? b.w / b.h;
        if (sx && (!sy || w / k > h)) {
          h = w / k;
          if (sy < 0) y0 = y1 - h;
          else if (sy > 0) y1 = y0 + h;
          else {
            y0 = -h / 2;
            y1 = h / 2;
          }
        } else {
          w = h * k;
          if (sx < 0) x0 = x1 - w;
          else if (sx > 0) x1 = x0 + w;
          else {
            x0 = -w / 2;
            x1 = w / 2;
          }
        }
      }
      const mx = (x0 + x1) / 2,
        my = (y0 + y1) / 2;
      const a = (b.angle * Math.PI) / 180;
      crop = { cx: b.cx + mx * Math.cos(a) - my * Math.sin(a), cy: b.cy + mx * Math.sin(a) + my * Math.cos(a), w: x1 - x0, h: y1 - y0, angle: b.angle };
    }
    requestFrame();
  },
  up: () => {
    if (straighten) {
      const s = current();
      const st = straighten;
      straighten = null;
      const ang = (Math.atan2(st.y1 - st.y0, st.x1 - st.x0) * 180) / Math.PI;
      let a = ang;
      if (Math.abs(a) > 45 && Math.abs(a) < 135) a = a - 90 * Math.sign(a);
      else if (Math.abs(a) >= 135) a = a - 180 * Math.sign(a);
      if (s && Math.hypot(st.x1 - st.x0, st.y1 - st.y0) > 2) {
        if (!crop) startCrop();
        if (crop) {
          // The largest box of the same shape that fits the turned picture.
          const t = (Math.abs(a) * Math.PI) / 180;
          const W = s.doc.width,
            H = s.doc.height;
          const k = Math.min(W / (W * Math.cos(t) + H * Math.sin(t)), H / (W * Math.sin(t) + H * Math.cos(t)));
          crop = { cx: W / 2, cy: H / 2, w: crop.w * k, h: crop.h * k, angle: a };
        }
      }
      requestFrame();
      return;
    }
    if (crop && (crop.w < 2 || crop.h < 2)) crop = null;
    cdrag = null;
    requestFrame();
  },
  key: (e) => {
    if (!crop) return false;
    if (e.key === 'Enter') {
      void commitCrop();
      return true;
    }
    if (e.key === 'Escape') {
      cancelCrop();
      return true;
    }
    return false;
  },
  overlay: (o) => drawCrop(o),
  active: () => !!crop,
  commit: () => void commitCrop(),
  cancel: () => cancelCrop(),
  leave: () => {
    crop = null;
  },
};

function drawCrop(o: Overlay): void {
  const s = current();
  if (!s) return;
  const { ctx, toScreen } = o;
  if (straighten) {
    const [a, b] = toScreen(straighten.x0, straighten.y0);
    const [c, d] = toScreen(straighten.x1, straighten.y1);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a, b);
    ctx.lineTo(c, d);
    ctx.stroke();
  }
  if (!crop) return;
  const cs = corners(crop).map(([x, y]) => toScreen(x, y));
  ctx.save();
  // Shade everything outside the box.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.moveTo(cs[0]![0], cs[0]![1]);
  for (let i = 3; i >= 1; i--) ctx.lineTo(cs[i]![0], cs[i]![1]);
  ctx.closePath();
  ctx.fill('evenodd');
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  cs.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  // Overlay guides.
  const ov = app.get().opts.crop.overlay;
  const lerp = (p: [number, number], q: [number, number], t: number): [number, number] => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const lines: [number, number][][] = [];
  const fr = ov === 'thirds' ? [1 / 3, 2 / 3] : ov === 'grid' ? [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] : ov === 'golden' ? [0.382, 0.618] : [];
  for (const t of fr) {
    lines.push([lerp(cs[0]!, cs[1]!, t), lerp(cs[3]!, cs[2]!, t)]);
    lines.push([lerp(cs[0]!, cs[3]!, t), lerp(cs[1]!, cs[2]!, t)]);
  }
  if (ov === 'diagonal') lines.push([cs[0]!, cs[2]!], [cs[1]!, cs[3]!]);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  for (const ln of lines) {
    const a = ln[0]!,
      b = ln[1]!;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  // Handles.
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 4; i++) {
    const [x, y] = cs[i]!;
    ctx.fillRect(x - 4, y - 4, 8, 8);
    const [x2, y2] = cs[(i + 1) % 4]!;
    ctx.fillRect((x + x2) / 2 - 3.5, (y + y2) / 2 - 3.5, 7, 7);
  }
  sizeTag(ctx, cs[2]![0] + 12, cs[2]![1] + 12, `W: ${Math.round(crop.w)} px  H: ${Math.round(crop.h)} px${crop.angle ? `  ${crop.angle.toFixed(1)}°` : ''}`);
  ctx.restore();
}

// ---- Perspective Crop ----

let quad: number[] | null = null;
let qdrag: { i: number; x0: number; y0: number; q: number[] } | null = null;

export const perspectiveCropTool: Tool = {
  id: 'perspectiveCrop',
  cursor: () => 'crosshair',
  down: (e) => {
    if (!quad) {
      quad = [e.x, e.y, e.x, e.y, e.x, e.y, e.x, e.y];
      qdrag = { i: -1, x0: e.x, y0: e.y, q: [...quad] };
      return;
    }
    const r = docPx(10);
    let i = -1;
    for (let k = 0; k < 4; k++) if (Math.hypot(e.x - quad[k * 2]!, e.y - quad[k * 2 + 1]!) < r) i = k;
    qdrag = { i: i >= 0 ? i : -2, x0: e.x, y0: e.y, q: [...quad] };
  },
  move: (e) => {
    if (!quad || !qdrag) return;
    if (qdrag.i === -1) quad = [qdrag.x0, qdrag.y0, e.x, qdrag.y0, e.x, e.y, qdrag.x0, e.y];
    else if (qdrag.i === -2) quad = qdrag.q.map((v, k) => v + (k % 2 ? e.y - qdrag!.y0 : e.x - qdrag!.x0));
    else {
      quad = [...qdrag.q];
      quad[qdrag.i * 2] = e.x;
      quad[qdrag.i * 2 + 1] = e.y;
    }
    requestFrame();
  },
  up: () => {
    qdrag = null;
    if (quad && Math.abs(quad[2]! - quad[0]!) < 2 && Math.abs(quad[5]! - quad[1]!) < 2) quad = null;
    requestFrame();
  },
  key: (e) => {
    if (!quad) return false;
    if (e.key === 'Enter') {
      void commitPerspective();
      return true;
    }
    if (e.key === 'Escape') {
      quad = null;
      requestFrame();
      return true;
    }
    return false;
  },
  overlay: ({ ctx, toScreen }) => {
    if (!quad) return;
    const pts = [0, 1, 2, 3].map((k) => toScreen(quad![k * 2]!, quad![k * 2 + 1]!));
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    // A grid inside the quad shows the perspective.
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    for (let t = 1; t < 4; t++) {
      const f = t / 4;
      const L = (a: number[], b: number[]) => [a[0]! + (b[0]! - a[0]!) * f, a[1]! + (b[1]! - a[1]!) * f];
      const a = L(pts[0]!, pts[1]!),
        b = L(pts[3]!, pts[2]!),
        c = L(pts[0]!, pts[3]!),
        d = L(pts[1]!, pts[2]!);
      ctx.beginPath();
      ctx.moveTo(a[0]!, a[1]!);
      ctx.lineTo(b[0]!, b[1]!);
      ctx.moveTo(c[0]!, c[1]!);
      ctx.lineTo(d[0]!, d[1]!);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    for (const [x, y] of pts) ctx.fillRect(x - 4, y - 4, 8, 8);
    ctx.restore();
  },
  active: () => !!quad,
  commit: () => void commitPerspective(),
  cancel: () => {
    quad = null;
  },
};

async function commitPerspective(): Promise<void> {
  const s = current();
  const q = quad;
  quad = null;
  if (!s || !q) return;
  // Output size: the average lengths of opposite edges.
  const len = (a: number, b: number) => Math.hypot(q[b * 2]! - q[a * 2]!, q[b * 2 + 1]! - q[a * 2 + 1]!);
  const W = Math.max(1, Math.round((len(0, 1) + len(3, 2)) / 2)),
    H = Math.max(1, Math.round((len(0, 3) + len(1, 2)) / 2));
  const M = quadToQuad([0, 0, W, 0, W, H, 0, H], q);
  if (!M) return;
  // Source quad → output rect: each layer is warped by the inverse.
  const toOut = quadToQuad(q, [0, 0, W, 0, W, H, 0, H]);
  if (!toOut) return;
  await busy('Straightening the perspective…', async () => {
    const d = s.doc;
    // Vector layers become pixels here (a perspective can't keep them editable).
    const layers: Layer[] = [];
    for (const l of d.layers) {
      if (l.kind === 'adjust' || l.kind === 'fill') {
        layers.push(l);
        continue;
      }
      const r = l.kind === 'pixel' ? l.raster : flattenRaster(d, canvasRect(d), [{ ...l, blend: 'normal', opacity: 1 } as Layer]);
      const b = r.tileBounds();
      if (!b) continue;
      const img = { w: b.w, h: b.h, c: 4 as const, data: r.read(b) };
      const T = [1, 0, b.x, 0, 1, b.y, 0, 0, 1];
      const full = mul(toOut, T);
      const res = warpProjective(img, full, { x: 0, y: 0, w: W, h: H }, 'bicubic');
      const nr = res.rect ? Raster.fromFloats(d.depth, 4, res.rect, res.data) : new Raster(d.depth, 4);
      layers.push(
        l.kind === 'pixel'
          ? { ...l, raster: nr, mask: undefined }
          : { ...pixelLayer(l.name, nr), id: l.id, blend: l.blend, opacity: l.opacity, visible: l.visible },
      );
    }
    s.commit('Perspective Crop', 'crop', withSelection({ ...d, width: W, height: H, layers, guides: [] }, null));
  });
  s.fitted = true;
  bump();
}

function mul(a: number[], b: number[]): number[] {
  const r = new Array(9).fill(0) as number[];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j]! += a[i * 3 + k]! * b[k * 3 + j]!;
  return r;
}

// ---- Slice and Artboard: rectangles kept with the document ----

let rectDrag: { x0: number; y0: number; x1: number; y1: number } | null = null;

function rectTool(id: 'slice' | 'artboard'): Tool {
  return {
    id,
    cursor: () => 'crosshair',
    down: (e) => {
      rectDrag = { x0: Math.round(e.x), y0: Math.round(e.y), x1: Math.round(e.x), y1: Math.round(e.y) };
    },
    move: (e) => {
      if (!rectDrag) return;
      rectDrag.x1 = Math.round(e.x);
      rectDrag.y1 = Math.round(e.y);
      requestFrame();
    },
    up: () => {
      const s = current();
      const r = rectDrag;
      rectDrag = null;
      if (!s || !r) return;
      const rect = { x: Math.min(r.x0, r.x1), y: Math.min(r.y0, r.y1), w: Math.abs(r.x1 - r.x0), h: Math.abs(r.y1 - r.y0) };
      if (rect.w < 2 || rect.h < 2) return;
      if (id === 'slice') {
        const n = s.doc.slices.length + 1;
        s.commit('Slice', 'slice', {
          ...s.doc,
          slices: [...s.doc.slices, { id: uid('s'), name: `${s.doc.name.replace(/\.[^.]+$/, '')}_${String(n).padStart(2, '0')}`, rect }],
        });
      } else {
        const n = s.doc.artboards.length + 1;
        s.commit('Artboard', 'artboard', {
          ...s.doc,
          artboards: [...s.doc.artboards, { id: uid('a'), name: `Artboard ${n}`, rect, background: [1, 1, 1, 1] }],
        });
      }
      bump();
    },
    overlay: (o) => {
      const s = current();
      if (!s) return;
      const { ctx, toScreen } = o;
      ctx.save();
      const list = id === 'slice' ? s.doc.slices : s.doc.artboards;
      ctx.font = '11px "Inter Variable", system-ui';
      list.forEach((sl, i) => {
        const [a, b] = toScreen(sl.rect.x, sl.rect.y);
        const [c, d] = toScreen(sl.rect.x + sl.rect.w, sl.rect.y + sl.rect.h);
        ctx.strokeStyle = id === 'slice' ? 'rgba(80,170,255,0.9)' : 'rgba(255,255,255,0.8)';
        ctx.strokeRect(Math.min(a, c) + 0.5, Math.min(b, d) + 0.5, Math.abs(c - a), Math.abs(d - b));
        ctx.fillStyle = id === 'slice' ? 'rgba(80,170,255,0.95)' : '#ddd';
        ctx.fillText(id === 'slice' ? String(i + 1).padStart(2, '0') : sl.name, Math.min(a, c) + 4, Math.min(b, d) - 4);
      });
      if (rectDrag) {
        const [a, b] = toScreen(rectDrag.x0, rectDrag.y0);
        const [c, d] = toScreen(rectDrag.x1, rectDrag.y1);
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b));
      }
      ctx.restore();
    },
  };
}

export const sliceTool = rectTool('slice');
export const artboardTool = rectTool('artboard');

export function toastNoCrop(): void {
  toast('Draw a crop box first.');
}

export { allLayers };
export type { Doc };
