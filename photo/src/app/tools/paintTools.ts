// The painting and retouching tools: Brush, Pencil, Eraser, Background and
// Magic Eraser, Mixer Brush, Color Replacement, Clone and Pattern Stamp,
// History Brush, Healing Brush, Spot Healing, Remove, Blur, Sharpen, Smudge,
// Dodge, Burn, Sponge, Red Eye. They paint into the active layer — or its
// mask, or the quick mask — limited by the selection.

import { app, current, requestFrame, toast, bump, pushRecentColor } from '../state';
import { BrushStroke, type PixelOp, type StrokeSample } from '../../core/brush';
import { Raster, TileEdit, intersect, type TileSwap } from '../../core/raster';
import { findLayer, hasRaster, updateLayer } from '../../core/layers';
import { maskBounds, emptyMask, growMask, maskToRaster, rasterToMask } from '../../core/selection';
import type { Doc, Layer, Rect } from '../../core/types';
import { paintOp, eraseOp, cloneOp, patternOp, historyOp, focusOp, toneOp, colorReplaceOp, bgEraseOp, smudgeOp } from './paintOps';
import { sampleSource } from './selectTools';
import { healWithSource, inpaintRaster } from '../ops/heal';
import { canvasRect } from '../ops/common';
import type { Overlay, Tool, ToolEvent } from './types';
import type { ToolId } from '../toolDefs';
import type { BrushTip } from '../../core/brush';

interface Target {
  raster: Raster;
  channels: 1 | 4;
  kind: 'layer' | 'mask' | 'quickmask';
  lockAlpha: boolean;
  isBg: boolean;
  layerId: string | null;
}

/** Where painting goes now (and why not, if it can't). */
export function paintTarget(allowNonPixel = false): Target | null {
  const s = current();
  if (!s) return null;
  if (s.quickMask) {
    let r = s.doc.selection?.mask;
    if (!r) {
      r = new Raster(8, 1);
      s.doc = { ...s.doc, selection: { mask: r, bounds: null } };
    }
    return { raster: r, channels: 1, kind: 'quickmask', lockAlpha: false, isBg: false, layerId: null };
  }
  const l = s.activeLayer();
  if (!l) {
    toast('Pick a layer to paint on.');
    return null;
  }
  if (!l.visible) {
    toast('This layer is hidden. Show it to paint on it.');
    return null;
  }
  // Adjustment and fill layers: paint their mask (as Photoshop does).
  if ((s.editMask || l.kind === 'adjust' || l.kind === 'fill') && l.mask) return { raster: l.mask.raster, channels: 1, kind: 'mask', lockAlpha: false, isBg: false, layerId: l.id };
  if (l.locks.all || l.locks.pixels) {
    toast('This layer is locked. Unlock it in the Layers panel to paint.');
    return null;
  }
  if (l.kind === 'group' || l.kind === 'adjust' || l.kind === 'fill' || (!allowNonPixel && l.kind !== 'pixel')) {
    toast(l.kind === 'group' ? 'Pick a layer inside the group to paint on.' : 'This layer can’t be painted on directly. Use Layer ▸ Rasterize first.');
    return null;
  }
  if (!hasRaster(l)) return null;
  const isBg = l.name === 'Background' && !!l.locks.position;
  return { raster: l.raster, channels: 4, kind: 'layer', lockAlpha: !!l.locks.transparency, isBg, layerId: l.id };
}

function selectionFn(): ((x: number, y: number) => number) | null {
  const s = current();
  if (!s || s.quickMask || !s.doc.selection) return null;
  const m = s.doc.selection.mask;
  const px = [0];
  return (x, y) => (m.pixel(x, y, px)[0] ?? 0);
}

interface Live {
  stroke: BrushStroke;
  target: Target;
  label: string;
  icon: string;
  timer: number;
  last: StrokeSample;
  /** Spot heal and remove: only coverage while brushing. */
  coverOnly: boolean;
  /** Healing: the source pixels (offset) to blend at the end. */
  heal: { read: (r: Rect) => Float32Array; dx: number; dy: number } | null;
}

let live: Live | null = null;

/** The commit at the end of a stroke (one history step). */
function finishStroke(extra: TileSwap[] = []): void {
  const s = current();
  if (!s || !live) return;
  const sw = live.stroke.commit();
  const swaps = [...(sw ? [sw] : []), ...extra];
  if (!swaps.length) {
    live = null;
    requestFrame();
    return;
  }
  let next: Doc = { ...s.doc };
  if (live.target.kind === 'quickmask') {
    const m = rasterToMask(live.target.raster, s.doc.width, s.doc.height);
    next = { ...next, selection: { mask: live.target.raster, bounds: maskBounds(m) } };
  } else if (live.target.layerId) {
    // A new layer record so everything that watches it sees the change.
    next = { ...next, layers: updateLayer(next.layers, live.target.layerId, (l) => ({ ...l }) as Layer) };
  }
  s.commit(live.label, live.icon, next, swaps);
  live = null;
  bump();
}

function sample(e: ToolEvent): StrokeSample {
  const pen = e.pointerType === 'pen';
  return { x: e.x, y: e.y, pressure: pen ? Math.max(0.01, e.pressure || 0.5) : 1 };
}

interface PaintSpec {
  id: ToolId;
  label: string;
  icon: string;
  tip: () => BrushTip;
  flow: () => number;
  opacity: () => number;
  aliased?: boolean;
  /** Build the operation for this stroke (null: cancel). */
  op: (t: Target, e: ToolEvent, stroke: () => BrushStroke) => PixelOp | null;
  allowNonPixel?: boolean;
  buildUp?: () => boolean;
  coverOnly?: boolean;
  onEnd?: (l: Live) => Promise<TileSwap[]>;
  /** Alt+click sets a source (clone, heal). */
  altSets?: boolean;
}

function makePaintTool(spec: PaintSpec): Tool {
  return {
    id: spec.id,
    cursor: () => 'none',
    brushSize: () => spec.tip().size,
    down: (e) => {
      const s = current();
      if (!s) return;
      if (spec.altSets && e.alt) {
        cloneSource = { x: e.x, y: e.y, layer: s.active, offset: null };
        toast('Source set. Paint where the copy should go.');
        requestFrame();
        return;
      }
      const t = paintTarget(spec.allowNonPixel);
      if (!t) return;
      let stroke!: BrushStroke;
      const op = spec.op(t, e, () => stroke);
      if (!op) return;
      const tip = spec.tip();
      stroke = new BrushStroke(t.raster, op, {
        tip,
        flow: spec.flow(),
        opacity: spec.opacity(),
        selection: selectionFn(),
        bounds: canvasRect(s.doc),
        aliased: spec.aliased,
        buildUp: spec.buildUp?.(),
        seed: (Date.now() & 0xffff) + 1,
      });
      const smp = sample(e);
      live = { stroke, target: t, label: spec.label, icon: spec.icon, timer: 0, last: smp, coverOnly: !!spec.coverOnly, heal: null };
      // Shift+click: a straight line from the last point.
      if (e.shift && lastPoint) {
        stroke.add({ ...lastPoint });
        stroke.add(smp);
      } else stroke.add(smp);
      if (!spec.coverOnly) stroke.flush();
      if (spec.buildUp?.())
        live.timer = window.setInterval(() => {
          if (!live) return;
          live.stroke.hold(live.last);
          live.stroke.flush();
          requestFrame();
        }, 50);
      requestFrame();
    },
    move: (e) => {
      if (!live) return;
      const smp = sample(e);
      live.last = smp;
      live.stroke.add(smp);
      if (!live.coverOnly) live.stroke.flush();
      requestFrame();
    },
    up: async (e) => {
      if (!live) return;
      if (live.timer) clearInterval(live.timer);
      live.stroke.end(sample(e));
      lastPoint = { x: e.x, y: e.y, pressure: 1 };
      const extra = spec.onEnd ? await spec.onEnd(live) : [];
      finishStroke(extra);
    },
    overlay: (o) => {
      if (live?.coverOnly && live.stroke.touched) drawCoverage(o, live.stroke);
      if (cloneSource && spec.altSets) {
        const [sx, sy] = o.toScreen(cloneSource.x, cloneSource.y);
        o.ctx.save();
        o.ctx.strokeStyle = '#fff';
        o.ctx.lineWidth = 1;
        o.ctx.beginPath();
        o.ctx.moveTo(sx - 7, sy);
        o.ctx.lineTo(sx + 7, sy);
        o.ctx.moveTo(sx, sy - 7);
        o.ctx.lineTo(sx, sy + 7);
        o.ctx.stroke();
        o.ctx.restore();
      }
    },
    key: (e) => {
      if (e.key === 'Escape' && live) {
        live.stroke.cancel();
        if (live.timer) clearInterval(live.timer);
        live = null;
        bump();
        return true;
      }
      return false;
    },
  };
}

let lastPoint: StrokeSample | null = null;
let cloneSource: { x: number; y: number; layer: string | null; offset: [number, number] | null } | null = null;

function drawCoverage(o: Overlay, st: BrushStroke): void {
  const t = st.touched;
  if (!t) return;
  const { ctx } = o;
  ctx.save();
  ctx.fillStyle = 'rgba(30,30,30,0.45)';
  const step = Math.max(1, Math.round(1 / o.zoom));
  for (let y = t.y; y < t.y + t.h; y += step)
    for (let x = t.x; x < t.x + t.w; x += step) {
      if (st.coverage(x, y) <= 0.02) continue;
      const [sx, sy] = o.toScreen(x, y);
      ctx.fillRect(sx, sy, Math.max(1, o.zoom * step), Math.max(1, o.zoom * step));
    }
  ctx.restore();
}

const opts = () => app.get().opts;
const fg = () => app.get().fg;
const bgc = () => app.get().bg;

export const brushTool = makePaintTool({
  id: 'brush',
  label: 'Brush Tool',
  icon: 'brush',
  tip: () => opts().brush.tip,
  flow: () => opts().brush.flow,
  opacity: () => opts().brush.opacity,
  buildUp: () => opts().brush.airbrush,
  op: (t) => {
    pushRecentColor(fg());
    return paintOp(fg(), opts().brush.mode, t.channels, t.lockAlpha || t.isBg);
  },
});

export const pencilTool = makePaintTool({
  id: 'pencil',
  label: 'Pencil',
  icon: 'pencil',
  tip: () => ({ ...opts().pencil.tip, hardness: 1, spacing: Math.min(0.15, opts().pencil.tip.spacing) }),
  flow: () => 1,
  opacity: () => opts().pencil.opacity,
  aliased: true,
  op: (t, e) => {
    let color = fg();
    if (opts().pencil.autoErase && t.channels === 4) {
      // Auto Erase: starting on the foreground color paints the background color.
      const px = t.raster.pixel(Math.floor(e.x), Math.floor(e.y));
      if (Math.abs(px[0]! - color[0]) < 0.01 && Math.abs(px[1]! - color[1]) < 0.01 && Math.abs(px[2]! - color[2]) < 0.01) color = bgc();
    }
    return paintOp(color, opts().pencil.mode, t.channels, t.lockAlpha || t.isBg);
  },
});

export const eraserTool = makePaintTool({
  id: 'eraser',
  label: 'Eraser',
  icon: 'eraser',
  tip: () => (opts().eraser.mode === 'block' ? { ...opts().eraser.tip, hardness: 1, roundness: 1, size: 16 } : opts().eraser.tip),
  flow: () => opts().eraser.flow,
  opacity: () => opts().eraser.opacity,
  aliased: false,
  op: (t) => {
    if (opts().eraser.history) {
      const src = historySource(t);
      return src ? historyOp(src) : null;
    }
    return eraseOp(t.channels, t.isBg || t.lockAlpha || t.channels === 1 ? bgc() : null);
  },
});

export const bgEraserTool = makePaintTool({
  id: 'bgEraser',
  label: 'Background Eraser',
  icon: 'eraser',
  tip: () => opts().bgEraser.tip,
  flow: () => 1,
  opacity: () => 1,
  op: (t, _e, st) => (t.channels === 4 ? bgEraseOp(st, opts().bgEraser.tolerance, opts().bgEraser.protectFg ? fg() : null) : null),
});

export const mixerTool = makePaintTool({
  id: 'mixer',
  label: 'Mixer Brush',
  icon: 'brush',
  tip: () => ({ ...opts().mixer.tip, spacing: Math.min(0.1, opts().mixer.tip.spacing) }),
  flow: () => opts().mixer.flow,
  opacity: () => 1,
  op: (t) => (t.channels === 4 ? smudgeOp(0.6 + opts().mixer.mix * 0.4, null, { wet: opts().mixer.wet, load: opts().mixer.load, mix: opts().mixer.mix, color: fg() }) : null),
});

export const colorReplaceTool = makePaintTool({
  id: 'colorReplace',
  label: 'Color Replacement',
  icon: 'brush',
  tip: () => opts().colorReplace.tip,
  flow: () => 1,
  opacity: () => 1,
  op: (t, _e, st) => (t.channels === 4 ? colorReplaceOp(st, fg(), opts().colorReplace.mode, opts().colorReplace.tolerance) : null),
});

function cloneReader(): ((r: Rect) => Float32Array) | null {
  const s = current();
  if (!s || !cloneSource) return null;
  const o = opts().clone.sample;
  if (o === 'current') {
    const l = cloneSource.layer ? findLayer(s.doc.layers, cloneSource.layer) : s.activeLayer();
    const r = l && hasRaster(l) ? l.raster.clone() : null;
    if (!r) return null;
    return (rect) => r.read(rect);
  }
  const src = sampleSource(true);
  if (!src) return null;
  return (rect) => {
    const out = new Float32Array(rect.w * rect.h * 4);
    for (let y = 0; y < rect.h; y++) {
      const sy = rect.y + y;
      if (sy < 0 || sy >= src.h) continue;
      for (let x = 0; x < rect.w; x++) {
        const sx = rect.x + x;
        if (sx < 0 || sx >= src.w) continue;
        out.set(src.data.subarray((sy * src.w + sx) * 4, (sy * src.w + sx) * 4 + 4), (y * rect.w + x) * 4);
      }
    }
    return out;
  };
}

function cloneOffset(e: ToolEvent): [number, number] | null {
  if (!cloneSource) {
    toast('Alt+click to choose where to copy from first.');
    return null;
  }
  if (opts().clone.aligned && cloneSource.offset) return cloneSource.offset;
  const off: [number, number] = [Math.round(e.x - cloneSource.x), Math.round(e.y - cloneSource.y)];
  cloneSource.offset = off;
  return off;
}

export const cloneTool = makePaintTool({
  id: 'clone',
  label: 'Clone Stamp',
  icon: 'stamp',
  altSets: true,
  tip: () => opts().clone.tip,
  flow: () => opts().clone.flow,
  opacity: () => opts().clone.opacity,
  op: (t, e) => {
    const off = cloneOffset(e);
    const read = cloneReader();
    if (!off || !read) return null;
    return cloneOp(read, off[0], off[1], t.channels, opts().clone.mode);
  },
});

export const patternStampTool = makePaintTool({
  id: 'patternStamp',
  label: 'Pattern Stamp',
  icon: 'stamp',
  tip: () => opts().pattern.tip,
  flow: () => opts().pattern.flow,
  opacity: () => opts().pattern.opacity,
  op: (t, e) => (t.channels === 4 ? patternOp(opts().pattern.pattern, 1, opts().pattern.aligned ? 0 : Math.round(e.x), opts().pattern.aligned ? 0 : Math.round(e.y)) : null),
});

/** The History Brush's source: the chosen snapshot (or the opening state) of the same raster. */
export let historyBrushSource: number | null = null;
export function setHistoryBrushSource(snapshotId: number | null): void {
  historyBrushSource = snapshotId;
  bump();
}

function historySource(t: Target): Raster | null {
  const s = current();
  if (!s) return null;
  const snap = s.history.snapshots.find((x) => x.id === historyBrushSource) ?? s.history.snapshots[0];
  if (!snap) return null;
  const tiles = snap.tiles.get(t.raster);
  if (!tiles) {
    toast('This layer didn’t exist in the history brush’s source state.');
    return null;
  }
  return new Raster(t.raster.depth, t.raster.channels, tiles);
}

export const historyBrushTool = makePaintTool({
  id: 'historyBrush',
  label: 'History Brush',
  icon: 'history',
  tip: () => opts().history.tip,
  flow: () => opts().history.flow,
  opacity: () => opts().history.opacity,
  op: (t) => {
    const src = historySource(t);
    return src ? historyOp(src) : null;
  },
});

export const healTool = makePaintTool({
  id: 'heal',
  label: 'Healing Brush',
  icon: 'heal',
  altSets: true,
  tip: () => opts().heal.tip,
  flow: () => 1,
  opacity: () => 1,
  op: (t, e) => {
    if (t.channels !== 4) return null;
    const off = cloneOffset(e);
    const read = cloneReader();
    if (!off || !read) return null;
    if (live) live.heal = { read, dx: off[0], dy: off[1] };
    healPending = { read, dx: off[0], dy: off[1] };
    return cloneOp(read, off[0], off[1], 4);
  },
  onEnd: async (l) => {
    const s = current();
    const h = healPending;
    healPending = null;
    const t = l.stroke.touched;
    if (!s || !h || !t) return [];
    // Blend the copied pixels into the surroundings (colors and light), on the stroke's area.
    l.stroke.flush();
    const sw = l.stroke.commit();
    const pad = 4;
    const reg = intersect({ x: t.x - pad, y: t.y - pad, w: t.w + 2 * pad, h: t.h + 2 * pad }, canvasRect(s.doc));
    if (!reg) return [];
    const hole = emptyMask(s.doc.width, s.doc.height);
    for (let y = reg.y; y < reg.y + reg.h; y++) for (let x = reg.x; x < reg.x + reg.w; x++) hole.data[y * s.doc.width + x] = Math.round(Math.min(1, l.stroke.coverage(x, y)) * 255);
    // Undo the plain copy, then heal from the original.
    if (sw) for (const [k, tl] of sw.before) (tl ? sw.raster.tiles.set(k, tl) : sw.raster.tiles.delete(k));
    const src = h.read({ x: reg.x - h.dx, y: reg.y - h.dy, w: reg.w, h: reg.h });
    const healed = healWithSource(l.target.raster, hole, src, reg);
    // Fold both into one swap.
    l.stroke = new BrushStroke(l.target.raster, { apply: () => {} }, { tip: opts().heal.tip, flow: 1, opacity: 1, bounds: canvasRect(s.doc) });
    return [healed];
  },
});

let healPending: { read: (r: Rect) => Float32Array; dx: number; dy: number } | null = null;

function coverOp(): PixelOp {
  return { apply: (_r, orig, _c, out) => out.set(orig) };
}

async function fillCovered(l: Live, label: string): Promise<TileSwap[]> {
  const s = current();
  const t = l.stroke.touched;
  if (!s || !t) return [];
  const hole = emptyMask(s.doc.width, s.doc.height);
  for (let y = Math.max(0, t.y); y < Math.min(s.doc.height, t.y + t.h); y++)
    for (let x = Math.max(0, t.x); x < Math.min(s.doc.width, t.x + t.w); x++) if (l.stroke.coverage(x, y) > 0.02) hole.data[y * s.doc.width + x] = 255;
  const grown = growMask(hole, 2);
  const all = l.target.kind === 'layer' && (l.label === 'Remove Tool' ? opts().remove.allLayers : opts().spot.allLayers);
  const sw = await inpaintRaster(l.target.raster, grown, s.doc.width, s.doc.height, null);
  void all;
  void label;
  return sw ? [sw] : [];
}

export const spotHealTool = makePaintTool({
  id: 'spotHeal',
  label: 'Spot Healing Brush',
  icon: 'heal',
  coverOnly: true,
  tip: () => opts().spot.tip,
  flow: () => 1,
  opacity: () => 1,
  op: (t) => (t.channels === 4 ? coverOp() : null),
  onEnd: (l) => fillCovered(l, 'Spot Healing Brush'),
});

export const removeTool = makePaintTool({
  id: 'removeTool',
  label: 'Remove Tool',
  icon: 'heal',
  coverOnly: true,
  tip: () => opts().remove.tip,
  flow: () => 1,
  opacity: () => 1,
  op: (t) => (t.channels === 4 ? coverOp() : null),
  onEnd: (l) => fillCovered(l, 'Remove Tool'),
});

export const blurTool = makePaintTool({
  id: 'blur',
  label: 'Blur Tool',
  icon: 'blur',
  tip: () => opts().focus.tip,
  flow: () => 1,
  opacity: () => 1,
  op: (t, _e, st) => (t.channels === 4 ? focusOp(st, 'blur', opts().focus.strength, opts().focus.tip.size) : null),
});

export const sharpenTool = makePaintTool({
  id: 'sharpen',
  label: 'Sharpen Tool',
  icon: 'sharpen',
  tip: () => opts().focus.tip,
  flow: () => 1,
  opacity: () => 1,
  op: (t, _e, st) => (t.channels === 4 ? focusOp(st, 'sharpen', opts().focus.strength * 0.6, opts().focus.tip.size) : null),
});

export const smudgeTool = makePaintTool({
  id: 'smudge',
  label: 'Smudge Tool',
  icon: 'smudge',
  tip: () => ({ ...opts().focus.tip, spacing: Math.min(0.1, opts().focus.tip.spacing) }),
  flow: () => 1,
  opacity: () => 1,
  op: (t) => (t.channels === 4 ? smudgeOp(opts().focus.strength, opts().focus.fingerPainting ? fg() : null, null) : null),
});

export const dodgeTool = makePaintTool({
  id: 'dodge',
  label: 'Dodge Tool',
  icon: 'dodge',
  tip: () => opts().tone.tip,
  flow: () => 1,
  opacity: () => 1,
  op: (t) => (t.channels === 4 ? toneOp('dodge', opts().tone.range, opts().tone.exposure * 0.5, opts().tone.protectTones, 'saturate') : null),
});

export const burnTool = makePaintTool({
  id: 'burn',
  label: 'Burn Tool',
  icon: 'burn',
  tip: () => opts().tone.tip,
  flow: () => 1,
  opacity: () => 1,
  op: (t) => (t.channels === 4 ? toneOp('burn', opts().tone.range, opts().tone.exposure * 0.5, opts().tone.protectTones, 'saturate') : null),
});

export const spongeTool = makePaintTool({
  id: 'sponge',
  label: 'Sponge Tool',
  icon: 'sponge',
  tip: () => opts().tone.tip,
  flow: () => 1,
  opacity: () => 1,
  op: (t) => (t.channels === 4 ? toneOp('sponge', 'midtones', opts().tone.flow, false, opts().tone.sponge) : null),
});

// ---- click tools: Red Eye, Magic Eraser ----

let redBox: { x0: number; y0: number; x1: number; y1: number } | null = null;

export const redEyeTool: Tool = {
  id: 'redEye',
  cursor: () => 'crosshair',
  down: (e) => {
    redBox = { x0: e.x, y0: e.y, x1: e.x, y1: e.y };
  },
  move: (e) => {
    if (!redBox) return;
    redBox.x1 = e.x;
    redBox.y1 = e.y;
    requestFrame();
  },
  up: () => {
    const s = current();
    const t = paintTarget();
    const b = redBox;
    redBox = null;
    if (!s || !t || !b || t.channels !== 4) return;
    let r = { x: Math.floor(Math.min(b.x0, b.x1)), y: Math.floor(Math.min(b.y0, b.y1)), w: Math.ceil(Math.abs(b.x1 - b.x0)), h: Math.ceil(Math.abs(b.y1 - b.y0)) };
    // A click: a box around the point, sized to a typical pupil.
    if (r.w < 4 || r.h < 4) {
      const sz = Math.max(12, Math.min(s.doc.width, s.doc.height) / 25);
      r = { x: Math.round(b.x0 - sz / 2), y: Math.round(b.y0 - sz / 2), w: Math.round(sz), h: Math.round(sz) };
    }
    const reg = intersect(r, canvasRect(s.doc));
    if (!reg) return;
    const px = t.raster.read(reg);
    const o = opts().redEye;
    let changed = 0;
    const cx = reg.x + reg.w / 2,
      cy = reg.y + reg.h / 2,
      rad = Math.min(reg.w, reg.h) / 2;
    for (let y = 0; y < reg.h; y++)
      for (let x = 0; x < reg.w; x++) {
        const i = (y * reg.w + x) * 4;
        const R = px[i]!,
          G = px[i + 1]!,
          B = px[i + 2]!;
        const redness = R - Math.max(G, B);
        const d = Math.hypot(reg.x + x + 0.5 - cx, reg.y + y + 0.5 - cy) / rad;
        if (redness < 0.12 + (1 - o.pupil) * 0.15 || d > 1) continue;
        const k = Math.min(1, redness * 3) * Math.min(1, (1 - d) * 4);
        const target = ((G + B) / 2) * (1 - o.darken * 0.7);
        px[i] = R + (target - R) * k;
        px[i + 1] = G + (target - G) * k * 0.6;
        px[i + 2] = B + (target - B) * k * 0.6;
        changed++;
      }
    if (!changed) {
      toast('No red eye found there.');
      return;
    }
    const e = new TileEdit(t.raster);
    t.raster.write(reg, px, e);
    s.commit('Red Eye Tool', 'brush', { ...s.doc }, [e.commit()]);
    bump();
  },
  overlay: (o) => {
    if (!redBox) return;
    const [a, b] = o.toScreen(redBox.x0, redBox.y0);
    const [c, d] = o.toScreen(redBox.x1, redBox.y1);
    o.ctx.strokeStyle = '#fff';
    o.ctx.setLineDash([4, 4]);
    o.ctx.strokeRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b));
    o.ctx.setLineDash([]);
  },
};

export const magicEraserTool: Tool = {
  id: 'magicEraser',
  cursor: () => 'crosshair',
  down: async (e) => {
    const s = current();
    const t = paintTarget();
    if (!s || !t || t.channels !== 4) return;
    const o = opts().magicEraser;
    const src = sampleSource(o.allLayers);
    if (!src) return;
    const { magicWand } = await import('../../core/selection');
    const m = magicWand(src, e.x, e.y, o.tolerance, o.contiguous, o.antialias);
    const b = maskBounds(m);
    if (!b) return;
    const px = t.raster.read(b);
    for (let y = 0; y < b.h; y++)
      for (let x = 0; x < b.w; x++) {
        const k = (m.data[(b.y + y) * s.doc.width + b.x + x]! / 255) * o.opacity;
        px[(y * b.w + x) * 4 + 3]! *= 1 - k;
      }
    const ed = new TileEdit(t.raster);
    t.raster.write(b, px, ed, true);
    // Erasing the Background turns it into a normal layer (it can now be transparent).
    let next = { ...s.doc };
    const l = s.activeLayer();
    if (l && t.isBg) next = { ...next, layers: updateLayer(next.layers, l.id, (x) => ({ ...x, name: 'Layer 0', locks: {} }) as Layer) };
    s.commit('Magic Eraser', 'eraser', next, [ed.commit()]);
    bump();
  },
};

export { maskToRaster };
