// Eyedropper, Color Sampler, Ruler, Gradient and Paint Bucket.

import { app, current, requestFrame, bump, toast, pushRecentColor } from '../state';
import { sampleSource } from './selectTools';
import { paintTarget } from './paintTools';
import { compositePixel } from '../../core/blend';
import { magicWand, maskBounds, combine, type Mask } from '../../core/selection';
import { TileEdit } from '../../core/raster';
import { getPattern, patternAt } from '../../core/patterns';
import { GRADIENT_PRESETS, fgToBg, fgToTransparent, type Gradient } from '../../core/gradient';
import { baseLayer, findLayer, insertLayers, updateLayer } from '../../core/layers';
import { selectionMask, flatten, canvasRect, withSelection } from '../ops/common';
import { maskToRaster } from '../../core/selection';
import type { FillLayer, Layer } from '../../core/types';
import type { Overlay, Tool, ToolEvent } from './types';
import { docPx } from './types';
import { snap45, sizeTag } from './selectTools';
import { rotateCanvas } from '../ops/image';

// ---- Eyedropper ----

let picking: { x: number; y: number; color: [number, number, number]; old: [number, number, number] } | null = null;

export function pickColor(x: number, y: number): [number, number, number] | null {
  const s = current();
  if (!s) return null;
  const o = app.get().opts.eyedropper;
  const src = sampleSource(o.from === 'all');
  if (!src) return null;
  const r = Math.floor(o.sample / 2);
  let R = 0,
    G = 0,
    B = 0,
    n = 0;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const px = Math.floor(x) + dx,
        py = Math.floor(y) + dy;
      if (px < 0 || py < 0 || px >= src.w || py >= src.h) continue;
      const i = (py * src.w + px) * 4;
      const a = src.data[i + 3]!;
      R += src.data[i]! * a;
      G += src.data[i + 1]! * a;
      B += src.data[i + 2]! * a;
      n += a;
    }
  if (n <= 0) return null;
  return [R / n, G / n, B / n];
}

export const eyedropperTool: Tool = {
  id: 'eyedropper',
  cursor: () => 'crosshair',
  down: (e) => {
    const c = pickColor(e.x, e.y);
    if (!c) return;
    picking = { x: e.x, y: e.y, color: c, old: e.alt ? app.get().bg : app.get().fg };
    if (e.alt) app.set({ bg: c });
    else app.set({ fg: c });
    requestFrame();
  },
  move: (e) => {
    if (!picking) return;
    const c = pickColor(e.x, e.y);
    if (!c) return;
    picking = { ...picking, x: e.x, y: e.y, color: c };
    if (e.alt) app.set({ bg: c });
    else app.set({ fg: c });
    requestFrame();
  },
  up: () => {
    if (picking) pushRecentColor(picking.color);
    picking = null;
    requestFrame();
  },
  overlay: ({ ctx, toScreen }) => {
    if (!picking) return;
    // The sampling ring: new color on top, previous below.
    const [sx, sy] = toScreen(picking.x, picking.y);
    const css = (c: number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
    ctx.save();
    ctx.lineWidth = 14;
    ctx.strokeStyle = css(picking.color);
    ctx.beginPath();
    ctx.arc(sx, sy, 42, Math.PI, 0);
    ctx.stroke();
    ctx.strokeStyle = css(picking.old);
    ctx.beginPath();
    ctx.arc(sx, sy, 42, 0, Math.PI);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(128,128,128,0.8)';
    ctx.beginPath();
    ctx.arc(sx, sy, 49, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy, 35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },
};

// ---- Color Sampler: up to ten points read in the Info panel ----

export interface Sampler {
  x: number;
  y: number;
}

export const samplers = new WeakMap<object, Sampler[]>();
export function samplersOf(): Sampler[] {
  const s = current();
  if (!s) return [];
  let list = samplers.get(s);
  if (!list) {
    list = [];
    samplers.set(s, list);
  }
  return list;
}

let dragSampler: number | null = null;

export const colorSamplerTool: Tool = {
  id: 'colorSampler',
  cursor: () => 'crosshair',
  down: (e) => {
    const list = samplersOf();
    const r = docPx(8);
    const i = list.findIndex((p) => Math.hypot(p.x - e.x, p.y - e.y) < r);
    if (i >= 0 && e.alt) {
      list.splice(i, 1);
      bump();
      return;
    }
    if (i >= 0) {
      dragSampler = i;
      return;
    }
    if (list.length >= 10) {
      toast('Up to ten color samplers. Alt+click one to remove it.');
      return;
    }
    list.push({ x: Math.floor(e.x), y: Math.floor(e.y) });
    bump();
  },
  move: (e) => {
    if (dragSampler === null) return;
    const list = samplersOf();
    list[dragSampler] = { x: Math.floor(e.x), y: Math.floor(e.y) };
    bump();
  },
  up: () => {
    dragSampler = null;
  },
  overlay: (o) => drawSamplers(o),
};

export function drawSamplers(o: Overlay): void {
  const list = samplersOf();
  const { ctx, toScreen } = o;
  ctx.save();
  ctx.font = '600 10px "Inter Variable", system-ui';
  list.forEach((p, i) => {
    const [sx, sy] = toScreen(p.x + 0.5, p.y + 0.5);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(String(i + 1), sx + 8, sy + 14);
    ctx.fillText(String(i + 1), sx + 8, sy + 14);
  });
  ctx.restore();
}

// ---- Ruler ----

let rulerLine: { x0: number; y0: number; x1: number; y1: number } | null = null;
let rulerDrag = false;

export function rulerInfo(): { length: number; angle: number; dx: number; dy: number } | null {
  if (!rulerLine) return null;
  const dx = rulerLine.x1 - rulerLine.x0,
    dy = rulerLine.y1 - rulerLine.y0;
  return { length: Math.hypot(dx, dy), angle: (-Math.atan2(dy, dx) * 180) / Math.PI, dx, dy };
}

export function clearRuler(): void {
  rulerLine = null;
  bump();
}

/** Straighten: rotate the canvas so the measured line is level. */
export async function straightenByRuler(): Promise<void> {
  const r = rulerInfo();
  if (!r) return;
  let a = r.angle;
  // Choose the nearest level: horizontal or vertical.
  if (Math.abs(a) > 45 && Math.abs(a) < 135) a = a > 0 ? a - 90 : a + 90;
  else if (Math.abs(a) >= 135) a = a > 0 ? a - 180 : a + 180;
  rulerLine = null;
  await rotateCanvas(a);
}

export const rulerTool: Tool = {
  id: 'ruler',
  cursor: () => 'crosshair',
  down: (e) => {
    rulerLine = { x0: e.x, y0: e.y, x1: e.x, y1: e.y };
    rulerDrag = true;
    bump();
  },
  move: (e) => {
    if (!rulerLine || !rulerDrag) return;
    let [x, y] = [e.x, e.y];
    if (e.shift) [x, y] = snap45(rulerLine.x0, rulerLine.y0, x, y);
    rulerLine.x1 = x;
    rulerLine.y1 = y;
    bump();
  },
  up: () => {
    rulerDrag = false;
  },
  overlay: ({ ctx, toScreen }) => {
    if (!rulerLine) return;
    const [a, b] = toScreen(rulerLine.x0, rulerLine.y0);
    const [c, d] = toScreen(rulerLine.x1, rulerLine.y1);
    ctx.save();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a, b);
    ctx.lineTo(c, d);
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
    for (const [x, y] of [
      [a, b],
      [c, d],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(x - 5, y);
      ctx.lineTo(x + 5, y);
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x, y + 5);
      ctx.stroke();
    }
    const info = rulerInfo()!;
    sizeTag(ctx, c + 12, d + 12, `${info.length.toFixed(1)} px   ${info.angle.toFixed(1)}°`);
    ctx.restore();
  },
};

// ---- Gradient ----

/** The gradient the options bar has chosen (built with the current colors). */
export function currentGradient(): Gradient {
  const o = app.get().opts.gradient;
  const { fg, bg } = app.get();
  if (o.preset === 0) return fgToBg(fg, bg);
  if (o.preset === 1) return fgToTransparent(fg);
  return GRADIENT_PRESETS[o.preset - 2] ?? fgToBg(fg, bg);
}

export const GRADIENT_CHOICES = ['Foreground to Background', 'Foreground to Transparent', ...GRADIENT_PRESETS.map((g) => g.name)];

let grad: { x0: number; y0: number; x1: number; y1: number; tempId: string; target: string | null; editing: FillLayer | null; handle: 0 | 1 | null } | null =
  null;

function gradientLayer(x0: number, y0: number, x1: number, y1: number, id: string, mask: Mask | null): FillLayer {
  const o = app.get().opts.gradient;
  const s = current()!;
  const l: FillLayer = {
    ...baseLayer('Gradient Fill 1'),
    id,
    kind: 'fill',
    blend: o.mode,
    opacity: o.opacity,
    content: {
      type: 'gradient',
      gradient: currentGradient(),
      angle: 0,
      scale: 1,
      style: o.style,
      reverse: o.reverse,
      ox: 0,
      oy: 0,
      p0: [x0, y0],
      p1: [x1, y1],
      dither: o.dither,
    },
  };
  if (mask) l.mask = { raster: maskToRaster(mask), background: 0, enabled: true, linked: true, density: 1, feather: 0 };
  void s;
  return l;
}

export const gradientTool: Tool = {
  id: 'gradient',
  cursor: () => 'crosshair',
  down: (e) => {
    const s = current();
    if (!s) return;
    // Editing an existing gradient fill layer: grab one of its two ends.
    const act = s.activeLayer();
    if (act?.kind === 'fill' && act.content.type === 'gradient' && act.content.p0 && act.content.p1) {
      const r = docPx(9);
      const h =
        Math.hypot(e.x - act.content.p0[0], e.y - act.content.p0[1]) < r ? 0 : Math.hypot(e.x - act.content.p1[0], e.y - act.content.p1[1]) < r ? 1 : null;
      if (h !== null) {
        grad = {
          x0: act.content.p0[0],
          y0: act.content.p0[1],
          x1: act.content.p1[0],
          y1: act.content.p1[1],
          tempId: act.id,
          target: null,
          editing: act,
          handle: h,
        };
        return;
      }
    }
    const o = app.get().opts.gradient;
    let target: string | null = null;
    if (!o.asLayer) {
      const t = paintTarget();
      if (!t) return;
      target = t.layerId;
      if (t.kind !== 'layer') {
        toast('Draw gradients into masks with “As layer” off on a pixel layer, or pick the layer.');
      }
    }
    const tempId = `gradient-preview`;
    grad = { x0: e.x, y0: e.y, x1: e.x, y1: e.y, tempId, target, editing: null, handle: null };
  },
  move: (e) => {
    const s = current();
    if (!s || !grad) return;
    let [x, y] = [e.x, e.y];
    if (grad.editing) {
      if (grad.handle === 0) [grad.x0, grad.y0] = [x, y];
      else [grad.x1, grad.y1] = [x, y];
      const l = grad.editing;
      if (l.content.type !== 'gradient') return;
      const live: FillLayer = { ...l, content: { ...l.content, p0: [grad.x0, grad.y0], p1: [grad.x1, grad.y1] } };
      s.doc = { ...s.doc, layers: updateLayer(s.doc.layers, l.id, () => live) };
      requestFrame();
      return;
    }
    if (e.shift) [x, y] = snap45(grad.x0, grad.y0, x, y);
    grad.x1 = x;
    grad.y1 = y;
    // Live: a gradient fill layer just above the target (drawn by the GPU).
    const preview = gradientLayer(grad.x0, grad.y0, grad.x1, grad.y1, grad.tempId, selectionMask(s.doc));
    const without = removeTemp(s.doc.layers, grad.tempId);
    s.doc = { ...s.doc, layers: insertLayers(without, [preview], grad.target ?? s.active, 'above') };
    requestFrame();
  },
  up: () => {
    const s = current();
    const g = grad;
    grad = null;
    if (!s || !g) return;
    if (g.editing) {
      const l = findLayer(s.doc.layers, g.editing.id) as FillLayer | null;
      s.doc = { ...s.doc, layers: updateLayer(s.doc.layers, g.editing.id, () => g.editing!) };
      if (l) {
        s.commit('Edit Gradient', 'gradient', { ...s.doc, layers: updateLayer(s.doc.layers, l.id, () => l) });
        bump();
      }
      return;
    }
    const base = { ...s.doc, layers: removeTemp(s.doc.layers, g.tempId) };
    s.doc = base;
    if (Math.hypot(g.x1 - g.x0, g.y1 - g.y0) < 1) {
      bump();
      return;
    }
    const o = app.get().opts.gradient;
    const sel = selectionMask(base);
    const layer = gradientLayer(g.x0, g.y0, g.x1, g.y1, `g${Date.now().toString(36)}`, sel);
    if (o.asLayer) {
      // An editable gradient: a fill layer whose ends can be dragged again.
      layer.name = 'Gradient Fill 1';
      s.commit('Gradient', 'gradient', { ...withSelection(base, null), layers: insertLayers(base.layers, [layer], s.active, 'above') });
      s.active = layer.id;
      s.selected = [layer.id];
      bump();
      return;
    }
    // Into the pixels: the target with the gradient laid over it.
    const target = g.target ? findLayer(base.layers, g.target) : null;
    if (!target || !('raster' in target)) {
      bump();
      return;
    }
    const r = canvasRect(base);
    const merged = flatten(base, r, [
      { ...target, visible: true, opacity: 1, blend: 'normal', mask: undefined, clip: false, styles: undefined } as Layer,
      { ...layer, clip: false } as Layer,
    ]);
    if (target.locks.transparency) {
      const orig = target.raster.read(r);
      for (let i = 3; i < merged.length; i += 4) merged[i] = orig[i]!;
    }
    const e = new TileEdit(target.raster);
    target.raster.write(r, merged, e, true);
    s.commit('Gradient', 'gradient', { ...base, layers: updateLayer(base.layers, target.id, (x) => ({ ...x }) as Layer) }, [e.commit()]);
    bump();
  },
  overlay: (o) => {
    const s = current();
    if (!s) return;
    const { ctx, toScreen } = o;
    let line: [number, number, number, number] | null = grad ? [grad.x0, grad.y0, grad.x1, grad.y1] : null;
    const act = s.activeLayer();
    if (!line && act?.kind === 'fill' && act.content.type === 'gradient' && act.content.p0 && act.content.p1)
      line = [act.content.p0[0], act.content.p0[1], act.content.p1[0], act.content.p1[1]];
    if (!line) return;
    const [a, b] = toScreen(line[0], line[1]);
    const [c, d] = toScreen(line[2], line[3]);
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a, b);
    ctx.lineTo(c, d);
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
    for (const [x, y] of [
      [a, b],
      [c, d],
    ] as const) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  },
  key: (e) => {
    if (e.key === 'Escape' && grad) {
      const s = current();
      if (s) s.doc = { ...s.doc, layers: removeTemp(s.doc.layers, grad.tempId) };
      grad = null;
      bump();
      return true;
    }
    return false;
  },
};

function removeTemp(layers: Layer[], id: string): Layer[] {
  return layers.filter((l) => l.id !== id).map((l) => (l.kind === 'group' ? { ...l, children: removeTemp(l.children, id) } : l));
}

// ---- Paint Bucket ----

export const bucketTool: Tool = {
  id: 'bucket',
  cursor: () => 'crosshair',
  down: (e: ToolEvent) => {
    const s = current();
    const t = paintTarget();
    if (!s || !t) return;
    const o = app.get().opts.bucket;
    if (e.x < 0 || e.y < 0 || e.x >= s.doc.width || e.y >= s.doc.height) return;
    let src = sampleSource(o.allLayers);
    if (t.channels === 1) {
      const m = t.raster.read(canvasRect(s.doc));
      const d = new Float32Array(m.length * 4);
      for (let i = 0; i < m.length; i++) d.set([m[i]!, m[i]!, m[i]!, 1], i * 4);
      src = { w: s.doc.width, h: s.doc.height, data: d };
    }
    if (!src) return;
    let m = magicWand(src, e.x, e.y, o.tolerance, o.contiguous, o.antialias);
    const sel = selectionMask(s.doc);
    if (sel) m = combine(m, sel, 'intersect');
    const b = maskBounds(m);
    if (!b) return;
    const W = s.doc.width;
    const color = app.get().fg;
    const pat = o.source === 'pattern' ? getPattern(o.pattern) : null;
    const tmp = [0, 0, 0, 0];
    const px = t.raster.read(b);
    if (t.channels === 1) {
      const g = 0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2];
      for (let y = 0; y < b.h; y++)
        for (let x = 0; x < b.w; x++) {
          const k = (m.data[(b.y + y) * W + b.x + x]! / 255) * o.opacity;
          px[y * b.w + x] = px[y * b.w + x]! + (g - px[y * b.w + x]!) * k;
        }
    } else
      for (let y = 0; y < b.h; y++)
        for (let x = 0; x < b.w; x++) {
          const k = (m.data[(b.y + y) * W + b.x + x]! / 255) * o.opacity;
          if (k <= 0) continue;
          const i = (y * b.w + x) * 4;
          const a0 = px[i + 3]!;
          let c = color as number[];
          let ca = 1;
          if (pat) {
            patternAt(pat, b.x + x, b.y + y, 1, tmp);
            c = tmp;
            ca = tmp[3]!;
          }
          compositePixel(o.mode, px, i, c[0]!, c[1]!, c[2]!, ca * k, b.x + x, b.y + y);
          if (t.lockAlpha || t.isBg) px[i + 3] = a0;
        }
    const ed = new TileEdit(t.raster);
    t.raster.write(b, px, ed, t.channels === 4);
    s.commit('Paint Bucket', 'bucket', { ...s.doc, layers: t.layerId ? updateLayer(s.doc.layers, t.layerId, (x) => ({ ...x }) as Layer) : s.doc.layers }, [
      ed.commit(t.channels === 4),
    ]);
    pushRecentColor(color);
    bump();
  },
};
