// The Move tool and Free Transform (Ctrl+T): scale, rotate, skew, distort,
// perspective and warp, previewed live on the GPU and drawn at full quality
// when committed. Smart objects keep their source (the transform is stored);
// shapes and text are transformed as vectors.

import { app, current, requestFrame, toast, bump } from '../state';
import { findLayer, hasRaster, updateLayer, duplicateLayer, insertLayers, allLayers } from '../../core/layers';
import { Raster, TileEdit, intersect } from '../../core/raster';
import { mat3Inv, mat3Mul, mapPoint, quadToQuad, warpProjective, warpMesh, patchMesh, bezierPatch } from '../../core/warp';
import { transformPath } from '../../core/path';
import { selectionMask, canvasRect, withSelection } from '../ops/common';
import { transformMask, maskBounds } from '../../core/selection';
import { rerenderSync } from '../layerContent';
import { resize } from '../../core/img';
import type { Doc, Layer, Rect } from '../../core/types';
import type { Overlay, Tool, ToolEvent } from './types';
import { docPx } from './types';
import { sizeTag } from './selectTools';

// ---- Move tool ----

let moving: { ids: string[]; x0: number; y0: number; dx: number; dy: number; float: FloatState | null } | null = null;

interface FloatState {
  layerId: string;
  base: Raster;
  float: Raster;
  floatId: string;
  selection: Doc['selection'];
}

/** The topmost visible layer with pixels under a point (Move tool's Auto-Select). */
function layerAt(doc: Doc, x: number, y: number, groups: boolean): Layer | null {
  const list = allLayers(doc.layers).reverse();
  for (const l of list) {
    if (!l.visible || !('raster' in l)) continue;
    const a = l.raster.pixel(Math.floor(x), Math.floor(y))[3] ?? 0;
    if (a > 0.1) {
      if (groups) {
        const top = doc.layers.find((r) => r.kind === 'group' && allLayers([r]).some((c) => c.id === l.id));
        if (top) return top;
      }
      return l;
    }
  }
  return null;
}

function movableIds(): string[] {
  const s = current();
  if (!s) return [];
  return (s.selected.length ? s.selected : s.active ? [s.active] : []).filter((id) => {
    const l = findLayer(s.doc.layers, id);
    return l && !l.locks.position && !l.locks.all;
  });
}

/** Shift a layer (and what it carries) by whole pixels, as a new record. */
export function shiftedLayer(l: Layer, dx: number, dy: number): Layer {
  const m = [1, 0, 0, 1, dx, dy];
  let out: Layer = { ...l };
  if ('raster' in out) out = { ...out, raster: out.raster.shifted(dx, dy) } as Layer;
  if (out.mask && out.mask.linked) out = { ...out, mask: { ...out.mask, raster: out.mask.raster.shifted(dx, dy) } };
  if (out.vmask) out = { ...out, vmask: { ...out.vmask, path: transformPath(out.vmask.path, m) } };
  if (out.kind === 'text')
    out = { ...out, text: { ...out.text, x: out.text.x + dx, y: out.text.y + dy, path: out.text.path ? transformPath(out.text.path, m) : undefined } };
  if (out.kind === 'shape') out = { ...out, path: transformPath(out.path, m) };
  if (out.kind === 'smart') {
    const T = out.transform;
    out = { ...out, transform: mat3Mul([1, 0, dx, 0, 1, dy, 0, 0, 1], T) };
  }
  if (out.kind === 'fill' && out.content.type !== 'solid') out = { ...out, content: { ...out.content, ox: out.content.ox + dx, oy: out.content.oy + dy } };
  if (out.kind === 'group') out = { ...out, children: out.children.map((c) => shiftedLayer(c, dx, dy)) };
  return out;
}

export function nudge(dx: number, dy: number): void {
  const s = current();
  if (!s) return;
  const ids = movableIds();
  if (!ids.length) return;
  let next = s.doc;
  for (const id of ids) next = { ...next, layers: updateLayer(next.layers, id, (l) => shiftedLayer(l, dx, dy)) };
  const last = s.history.steps[s.history.index - 1];
  if (last && last.label === 'Nudge' && Date.now() - last.time < 1200) {
    s.amend(next);
    last.time = Date.now();
  } else s.commit('Nudge', 'move', next);
  bump();
}

function startFloat(s: NonNullable<ReturnType<typeof current>>, l: Layer): FloatState | null {
  if (l.kind !== 'pixel') return null;
  const sel = selectionMask(s.doc);
  if (!sel) return null;
  const b = s.doc.selection?.bounds;
  if (!b) return null;
  const r = intersect(b, canvasRect(s.doc));
  if (!r) return null;
  const px = l.raster.read(r);
  const fl = new Float32Array(px.length);
  const W = s.doc.width;
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const i = (y * r.w + x) * 4;
      const k = sel.data[(r.y + y) * W + r.x + x]! / 255;
      fl[i] = px[i]!;
      fl[i + 1] = px[i + 1]!;
      fl[i + 2] = px[i + 2]!;
      fl[i + 3] = px[i + 3]! * k;
      px[i + 3] = px[i + 3]! * (1 - k);
    }
  const base = l.raster.clone();
  base.write(r, px, new TileEdit(base));
  const float = Raster.fromFloats(s.doc.depth, 4, r, fl);
  return { layerId: l.id, base, float, floatId: `float-${l.id}`, selection: s.doc.selection };
}

export const moveTool: Tool = {
  id: 'move',
  cursor: () => 'default',
  down: (e) => {
    const s = current();
    if (!s) return;
    const o = app.get().opts.move;
    if (o.autoSelect || e.ctrl) {
      const hit = layerAt(s.doc, e.x, e.y, o.autoSelectGroups);
      if (hit) {
        s.active = hit.id;
        s.selected = [hit.id];
        bump();
      }
    }
    const ids = movableIds();
    if (!ids.length) {
      const l = s.activeLayer();
      if (l && l.locks.position) toast('This layer’s position is locked.');
      return;
    }
    // Alt+drag: move a copy.
    if (e.alt) {
      const copies: Layer[] = [];
      let doc = s.doc;
      for (const id of ids) {
        const l = findLayer(doc.layers, id);
        if (!l) continue;
        const c = duplicateLayer(l);
        copies.push(c);
        doc = { ...doc, layers: insertLayers(doc.layers, [c], id, 'above') };
      }
      s.commit('Duplicate Layer', 'layer', doc);
      s.selected = copies.map((c) => c.id);
      s.active = copies[copies.length - 1]?.id ?? s.active;
      moving = { ids: s.selected, x0: e.x, y0: e.y, dx: 0, dy: 0, float: null };
      return;
    }
    // With a selection on a pixel layer: move the selected pixels.
    const l = s.activeLayer();
    const fl = ids.length === 1 && l && s.doc.selection ? startFloat(s, l) : null;
    moving = { ids, x0: e.x, y0: e.y, dx: 0, dy: 0, float: fl };
    if (fl) {
      s.overrides = { ...s.overrides, rasters: new Map([[fl.layerId, fl.base]]) };
      // The floating pixels show through the layer's own slot: base + moved float, drawn on the GPU as two passes is not possible, so a temporary layer carries them.
      s.doc = {
        ...s.doc,
        layers: insertLayers(
          s.doc.layers,
          [{ ...findLayer(s.doc.layers, fl.layerId)!, id: fl.floatId, name: 'Floating', raster: fl.float, mask: undefined, styles: undefined } as Layer],
          fl.layerId,
          'above',
        ),
      };
    }
  },
  move: (e) => {
    const s = current();
    if (!s || !moving) return;
    let dx = Math.round(e.x - moving.x0),
      dy = Math.round(e.y - moving.y0);
    if (e.shift) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    moving.dx = dx;
    moving.dy = dy;
    const offs = new Map<string, [number, number]>();
    if (moving.float) offs.set(moving.float.floatId, [dx, dy]);
    else for (const id of moving.ids) offs.set(id, [dx, dy]);
    s.overrides = { ...s.overrides, offsets: offs };
    requestFrame();
  },
  up: () => {
    const s = current();
    if (!s || !moving) return;
    const { dx, dy, float: fl, ids } = moving;
    moving = null;
    s.overrides = { ...s.overrides, offsets: undefined, rasters: undefined };
    if (fl) {
      // Put the moved pixels down on the layer (and move the selection with them).
      const docBefore = { ...s.doc, layers: s.doc.layers.filter((x) => x.id !== fl.floatId) };
      const removeFloat = (layers: Layer[]): Layer[] =>
        layers.filter((x) => x.id !== fl.floatId).map((x) => (x.kind === 'group' ? { ...x, children: removeFloat(x.children) } : x));
      s.doc = { ...s.doc, layers: removeFloat(s.doc.layers) };
      if (!dx && !dy) {
        bump();
        return;
      }
      const merged = fl.base.clone();
      const moved = fl.float.shifted(dx, dy);
      const b = moved.tileBounds();
      if (b) {
        const a = merged.read(b),
          f = moved.read(b);
        for (let i = 0; i < a.length; i += 4) {
          const fa = f[i + 3]!;
          if (fa <= 0) continue;
          const ao = fa + a[i + 3]! * (1 - fa);
          for (let k = 0; k < 3; k++) a[i + k] = ao > 0 ? (f[i + k]! * fa + a[i + k]! * a[i + 3]! * (1 - fa)) / ao : 0;
          a[i + 3] = ao;
        }
        merged.write(b, a, new TileEdit(merged), true);
      }
      let next: Doc = { ...docBefore, layers: updateLayer(docBefore.layers, fl.layerId, (x) => ({ ...x, raster: merged }) as Layer) };
      const sel = selectionMask(s.doc);
      if (sel) next = withSelection(next, transformMask(sel, [1, 0, 0, 1, dx, dy]));
      s.commit('Move', 'move', next);
      bump();
      return;
    }
    if (!dx && !dy) {
      bump();
      return;
    }
    let next = s.doc;
    for (const id of ids) next = { ...next, layers: updateLayer(next.layers, id, (l) => shiftedLayer(l, dx, dy)) };
    s.commit('Move', 'move', next);
    bump();
  },
  key: (e) => {
    const step = e.shiftKey ? 10 : 1;
    const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!k) return false;
    nudge(k[0]!, k[1]!);
    return true;
  },
  overlay: (o) => {
    if (!moving) return;
    const { dx, dy } = moving;
    sizeTag(o.ctx, 12, 12, `Δx ${dx} px   Δy ${dy} px`);
  },
};

// ---- Free Transform ----

type Quad = [number, number, number, number, number, number, number, number];

interface XSession {
  target: 'layers' | 'selection' | 'path';
  ids: string[];
  /** Where the pixels were (the source rectangle). */
  src: Rect;
  quad: Quad;
  start: Quad;
  warp: number[] | null;
  pivot: [number, number];
  drag: { kind: string; x0: number; y0: number; quad: Quad; warp: number[] | null; angle0?: number; pivot: [number, number]; index?: number } | null;
  /** A small copy for warp previews. */
  proxy: { raster: Raster; scale: number } | null;
}

let xs: XSession | null = null;

export const isTransforming = () => !!xs;

const rectQuad = (r: Rect): Quad => [r.x, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.x, r.y + r.h];

/** Ctrl+T: start transforming the selected layers (or the selection's pixels). */
export function freeTransform(mode: 'free' | 'warp' | 'selection' = 'free'): void {
  const s = current();
  if (!s) return;
  if (xs) return;
  if (mode === 'selection') {
    const b = s.doc.selection?.bounds;
    if (!b) return;
    xs = {
      target: 'selection',
      ids: [],
      src: b,
      quad: rectQuad(b),
      start: rectQuad(b),
      warp: null,
      pivot: [b.x + b.w / 2, b.y + b.h / 2],
      drag: null,
      proxy: null,
    };
    requestFrame();
    return;
  }
  const ids = movableIds();
  if (!ids.length) {
    toast('Pick a layer to transform (locked layers can’t be moved).');
    return;
  }
  let r: Rect | null = null;
  for (const id of ids) {
    const l = findLayer(s.doc.layers, id);
    if (!l) continue;
    let b: Rect | null = null;
    if (l.kind === 'smart') {
      const T = l.transform;
      const pts = [mapPoint(T, 0, 0), mapPoint(T, l.source.width, 0), mapPoint(T, l.source.width, l.source.height), mapPoint(T, 0, l.source.height)];
      const xs0 = pts.map((p) => p[0]),
        ys0 = pts.map((p) => p[1]);
      b = { x: Math.min(...xs0), y: Math.min(...ys0), w: Math.max(...xs0) - Math.min(...xs0), h: Math.max(...ys0) - Math.min(...ys0) };
    } else if ('raster' in l) b = l.raster.contentBounds();
    if (b)
      r = r
        ? {
            x: Math.min(r.x, b.x),
            y: Math.min(r.y, b.y),
            w: Math.max(r.x + r.w, b.x + b.w) - Math.min(r.x, b.x),
            h: Math.max(r.y + r.h, b.y + b.h) - Math.min(r.y, b.y),
          }
        : b;
  }
  if (!r) {
    toast('The layer is empty.');
    return;
  }
  // A single smart object keeps its own corners (so transforming again starts from the last one).
  const only = ids.length === 1 ? findLayer(s.doc.layers, ids[0]!) : null;
  let quad = rectQuad(r);
  let src = r;
  if (only?.kind === 'smart') {
    const T = only.transform;
    const W = only.source.width,
      H = only.source.height;
    quad = [...mapPoint(T, 0, 0), ...mapPoint(T, W, 0), ...mapPoint(T, W, H), ...mapPoint(T, 0, H)] as Quad;
    src = { x: 0, y: 0, w: W, h: H };
  }
  xs = {
    target: 'layers',
    ids,
    src,
    quad,
    start: [...quad] as Quad,
    warp: null,
    pivot: [(quad[0] + quad[4]) / 2, (quad[1] + quad[5]) / 2],
    drag: null,
    proxy: null,
  };
  if (mode === 'warp') startWarp();
  preview();
  bump();
}

function startWarp(): void {
  if (!xs) return;
  const q = xs.quad;
  // 4×4 control points spread over the current quad (bilinear).
  const cp: number[] = [];
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      const u = i / 3,
        v = j / 3;
      const x = (q[0] * (1 - u) + q[2] * u) * (1 - v) + (q[6] * (1 - u) + q[4] * u) * v;
      const y = (q[1] * (1 - u) + q[3] * u) * (1 - v) + (q[7] * (1 - u) + q[5] * u) * v;
      cp.push(x, y);
    }
  xs.warp = cp;
}

export function toggleWarp(): void {
  if (!xs || xs.target !== 'layers') return;
  if (xs.warp) xs.warp = null;
  else startWarp();
  preview();
  bump();
}

/** The doc → source map for the current quad. */
function invMatrix(): number[] | null {
  if (!xs) return null;
  const m = quadToQuad(rectQuad(xs.src), xs.quad);
  return m ? mat3Inv(m) : null;
}

function quadBounds(q: number[]): Rect {
  const xs0 = [q[0]!, q[2]!, q[4]!, q[6]!],
    ys0 = [q[1]!, q[3]!, q[5]!, q[7]!];
  const x = Math.floor(Math.min(...xs0)),
    y = Math.floor(Math.min(...ys0));
  return { x, y, w: Math.ceil(Math.max(...xs0)) - x + 1, h: Math.ceil(Math.max(...ys0)) - y + 1 };
}

/** Show the transform on the GPU (or a warped proxy for Warp). */
function preview(): void {
  const s = current();
  if (!s || !xs || xs.target !== 'layers') {
    requestFrame();
    return;
  }
  const map = new Map<string, { inv: number[]; raster?: Raster; bounds: Rect }>();
  if (xs.warp) {
    // Warp: a mesh drawn from a reduced copy (full quality on commit).
    for (const id of xs.ids) {
      const l = findLayer(s.doc.layers, id);
      if (!l || !('raster' in l)) continue;
      const srcR = l.kind === 'smart' ? l.source.raster : l.raster;
      const scale = Math.min(1, 1600 / Math.max(xs.src.w, xs.src.h));
      const img = { w: xs.src.w, h: xs.src.h, c: 4 as const, data: srcR.read(xs.src) };
      const small = scale < 1 ? resize(img, Math.max(1, Math.round(img.w * scale)), Math.max(1, Math.round(img.h * scale)), 'bilinear') : img;
      const mesh = patchMesh(
        xs.warp.map((v) => v * scale),
        24,
      );
      const { rect, data } = warpMesh(small, 25, 25, mesh, {
        x: -s.doc.width * scale,
        y: -s.doc.height * scale,
        w: s.doc.width * 3 * scale,
        h: s.doc.height * 3 * scale,
      });
      if (!rect) continue;
      const r = Raster.fromFloats(s.doc.depth, 4, rect, data);
      map.set(id, {
        inv: [scale, 0, 0, 0, scale, 0, 0, 0, 1],
        raster: r,
        bounds: { x: rect.x / scale, y: rect.y / scale, w: rect.w / scale, h: rect.h / scale },
      });
    }
  } else {
    const inv = invMatrix();
    if (!inv) return;
    const bounds = quadBounds(xs.quad);
    for (const id of xs.ids) {
      const l = findLayer(s.doc.layers, id);
      if (!l) continue;
      if (l.kind === 'smart') {
        // The smart object's own source through the new matrix: its pixels come from the source.
        map.set(id, { inv, raster: l.source.raster, bounds });
      } else map.set(id, { inv, bounds });
    }
  }
  s.overrides = { ...s.overrides, transforms: map };
  requestFrame();
}

function handles(q: Quad): [number, number][] {
  return [
    [q[0], q[1]],
    [(q[0] + q[2]) / 2, (q[1] + q[3]) / 2],
    [q[2], q[3]],
    [(q[2] + q[4]) / 2, (q[3] + q[5]) / 2],
    [q[4], q[5]],
    [(q[4] + q[6]) / 2, (q[5] + q[7]) / 2],
    [q[6], q[7]],
    [(q[6] + q[0]) / 2, (q[7] + q[1]) / 2],
  ];
}

function insideQuad(q: Quad, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = q[i * 2]!,
      yi = q[i * 2 + 1]!,
      xj = q[j * 2]!,
      yj = q[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function hit(e: ToolEvent): { kind: string; index?: number } {
  if (!xs) return { kind: 'none' };
  const r = docPx(7);
  if (xs.warp) {
    for (let i = 0; i < 16; i++) if (Math.hypot(e.x - xs.warp[i * 2]!, e.y - xs.warp[i * 2 + 1]!) < r * 1.3) return { kind: 'warp', index: i };
    return insideQuad(xs.quad, e.x, e.y) ? { kind: 'move' } : { kind: 'none' };
  }
  if (Math.hypot(e.x - xs.pivot[0], e.y - xs.pivot[1]) < r) return { kind: 'pivot' };
  const hs = handles(xs.quad);
  for (let i = 0; i < 8; i++) if (Math.hypot(e.x - hs[i]![0], e.y - hs[i]![1]) < r * 1.4) return { kind: 'handle', index: i };
  if (insideQuad(xs.quad, e.x, e.y)) return { kind: 'move' };
  return { kind: 'rotate' };
}

function applyMat(q: Quad, m: number[]): Quad {
  const out = [] as number[];
  for (let i = 0; i < 4; i++) {
    const [x, y] = mapPoint(m, q[i * 2]!, q[i * 2 + 1]!);
    out.push(x, y);
  }
  return out as Quad;
}

export const transformTool: Tool = {
  id: 'move',
  cursor: (e) => {
    if (!e || !xs) return 'default';
    const h = hit(e);
    return h.kind === 'move' ? 'move' : h.kind === 'rotate' ? 'alias' : h.kind === 'handle' ? 'crosshair' : h.kind === 'warp' ? 'pointer' : 'default';
  },
  down: (e) => {
    if (!xs) return;
    const h = hit(e);
    xs.drag = {
      kind: h.kind,
      index: h.index,
      x0: e.x,
      y0: e.y,
      quad: [...xs.quad] as Quad,
      warp: xs.warp ? [...xs.warp] : null,
      pivot: [...xs.pivot] as [number, number],
      angle0: Math.atan2(e.y - xs.pivot[1], e.x - xs.pivot[0]),
    };
  },
  move: (e) => {
    if (!xs || !xs.drag) return;
    const d = xs.drag;
    const dx = e.x - d.x0,
      dy = e.y - d.y0;
    if (d.kind === 'move') {
      xs.quad = d.quad.map((v, i) => v + (i % 2 ? dy : dx)) as Quad;
      if (xs.warp && d.warp) xs.warp = d.warp.map((v, i) => v + (i % 2 ? dy : dx));
      xs.pivot = [d.pivot[0] + dx, d.pivot[1] + dy];
    } else if (d.kind === 'pivot') xs.pivot = [d.pivot[0] + dx, d.pivot[1] + dy];
    else if (d.kind === 'warp' && d.warp && d.index !== undefined) {
      xs.warp = [...d.warp];
      xs.warp[d.index * 2] = d.warp[d.index * 2]! + dx;
      xs.warp[d.index * 2 + 1] = d.warp[d.index * 2 + 1]! + dy;
    } else if (d.kind === 'rotate') {
      let a = Math.atan2(e.y - d.pivot[1], e.x - d.pivot[0]) - d.angle0!;
      if (e.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      const c = Math.cos(a),
        sn = Math.sin(a);
      const [px, py] = d.pivot;
      xs.quad = applyMat(d.quad, [c, -sn, px - c * px + sn * py, sn, c, py - sn * px - c * py, 0, 0, 1]);
    } else if (d.kind === 'handle' && d.index !== undefined) {
      const i = d.index;
      const corner = i % 2 === 0;
      if (corner && e.ctrl) {
        // Distort: move one corner freely (with Shift+Alt as well: perspective, the opposite corner mirrors).
        const ci = i / 2;
        const q: number[] = [...d.quad];
        q[ci * 2] = q[ci * 2]! + dx;
        q[ci * 2 + 1] = q[ci * 2 + 1]! + dy;
        if (e.shift && e.alt) {
          // Perspective: the neighbor along the same edge moves the opposite way.
          const ni = ci === 0 ? 1 : ci === 1 ? 0 : ci === 2 ? 3 : 2;
          q[ni * 2] = q[ni * 2]! - dx;
        }
        xs.quad = q as Quad;
      } else {
        // Scale about the opposite handle (or the center with Alt), in the box's own axes.
        const q = d.quad;
        const ux = q[2] - q[0],
          uy = q[3] - q[1],
          vx = q[6] - q[0],
          vy = q[7] - q[1];
        const lu = Math.hypot(ux, uy) || 1,
          lv = Math.hypot(vx, vy) || 1;
        const eu = [ux / lu, uy / lu],
          ev = [vx / lv, vy / lv];
        const pu = dx * eu[0]! + dy * eu[1]!,
          pv = dx * ev[0]! + dy * ev[1]!;
        // Which sides this handle moves.
        const sx = [-1, 0, 1, 1, 1, 0, -1, -1][i]!,
          sy = [-1, -1, -1, 0, 1, 1, 1, 0][i]!;
        let ku = sx ? 1 + (sx * pu) / lu : 1,
          kv = sy ? 1 + (sy * pv) / lv : 1;
        if (e.alt) {
          ku = sx ? 1 + (2 * sx * pu) / lu : 1;
          kv = sy ? 1 + (2 * sy * pv) / lv : 1;
        }
        // Corners keep proportions unless Shift is held (Photoshop's default since 2019).
        if (corner && !e.shift) {
          const k = Math.abs(ku) > Math.abs(kv) ? ku : kv;
          ku = k;
          kv = k;
        }
        // Anchor: the opposite side (or the center).
        const ax = e.alt ? 0.5 : sx === -1 ? 1 : sx === 1 ? 0 : 0.5;
        const ay = e.alt ? 0.5 : sy === -1 ? 1 : sy === 1 ? 0 : 0.5;
        const anc = [q[0] + ux * ax + vx * ay, q[1] + uy * ax + vy * ay];
        const out: number[] = [];
        for (let c = 0; c < 4; c++) {
          const rx = q[c * 2]! - anc[0]!,
            ry = q[c * 2 + 1]! - anc[1]!;
          const a = rx * eu[0]! + ry * eu[1]!,
            b = rx * ev[0]! + ry * ev[1]!;
          out.push(anc[0]! + eu[0]! * a * ku + ev[0]! * b * kv, anc[1]! + eu[1]! * a * ku + ev[1]! * b * kv);
        }
        xs.quad = out as Quad;
      }
    }
    preview();
  },
  up: () => {
    if (!xs) return;
    xs.drag = null;
    preview();
    bump();
  },
  key: (e) => {
    if (!xs) return false;
    if (e.key === 'Enter') {
      void commitTransform();
      return true;
    }
    if (e.key === 'Escape') {
      cancelTransform();
      return true;
    }
    const step = e.shiftKey ? 10 : 1;
    const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (k) {
      xs.quad = xs.quad.map((v, i) => v + (i % 2 ? k[1]! : k[0]!)) as Quad;
      if (xs.warp) xs.warp = xs.warp.map((v, i) => v + (i % 2 ? k[1]! : k[0]!));
      xs.pivot = [xs.pivot[0] + k[0]!, xs.pivot[1] + k[1]!];
      preview();
      return true;
    }
    return false;
  },
  overlay: (o: Overlay) => {
    if (!xs) return;
    const { ctx, toScreen: T } = o;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1;
    const q = xs.quad;
    if (xs.warp) {
      // The warp grid: Bézier patch lines.
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      for (let k = 0; k <= 3; k++) {
        ctx.beginPath();
        for (let t = 0; t <= 24; t++) {
          const [x, y] = bezierPatch(xs.warp, t / 24, k / 3);
          const [sx, sy] = T(x, y);
          if (t === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.beginPath();
        for (let t = 0; t <= 24; t++) {
          const [x, y] = bezierPatch(xs.warp, k / 3, t / 24);
          const [sx, sy] = T(x, y);
          if (t === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
      for (let i = 0; i < 16; i++) {
        const [sx, sy] = T(xs.warp[i * 2]!, xs.warp[i * 2 + 1]!);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const [sx, sy] = T(q[i * 2]!, q[i * 2 + 1]!);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
    for (const [x, y] of handles(q)) {
      const [sx, sy] = T(x, y);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#1a1a1a';
      ctx.fillRect(sx - 4, sy - 4, 8, 8);
      ctx.strokeRect(sx - 4.5, sy - 4.5, 9, 9);
    }
    const [px, py] = T(xs.pivot[0], xs.pivot[1]);
    ctx.beginPath();
    ctx.arc(px, py, 4.5, 0, Math.PI * 2);
    ctx.moveTo(px - 8, py);
    ctx.lineTo(px + 8, py);
    ctx.moveTo(px, py - 8);
    ctx.lineTo(px, py + 8);
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    if (xs.drag) {
      const w = Math.hypot(q[2] - q[0], q[3] - q[1]),
        h = Math.hypot(q[6] - q[0], q[7] - q[1]);
      const ang = (Math.atan2(q[3] - q[1], q[2] - q[0]) * 180) / Math.PI;
      const [tx, ty] = T(q[4], q[5]);
      sizeTag(ctx, tx + 14, ty + 14, xs.drag.kind === 'rotate' ? `${ang.toFixed(1)}°` : `W: ${Math.round(w)} px  H: ${Math.round(h)} px`);
    }
    ctx.restore();
  },
  active: () => !!xs,
  commit: () => void commitTransform(),
  cancel: () => cancelTransform(),
};

export function cancelTransform(): void {
  const s = current();
  xs = null;
  if (s) s.overrides = { ...s.overrides, transforms: undefined };
  bump();
}

/** Numeric transform from the options bar (W/H percent, angle). */
export function transformNumbers(): { x: number; y: number; w: number; h: number; angle: number } | null {
  if (!xs) return null;
  const q = xs.quad;
  return {
    x: (q[0] + q[4]) / 2,
    y: (q[1] + q[5]) / 2,
    w: (Math.hypot(q[2] - q[0], q[3] - q[1]) / xs.src.w) * 100,
    h: (Math.hypot(q[6] - q[0], q[7] - q[1]) / xs.src.h) * 100,
    angle: (Math.atan2(q[3] - q[1], q[2] - q[0]) * 180) / Math.PI,
  };
}

export function setTransformNumbers(n: { x: number; y: number; w: number; h: number; angle: number }): void {
  if (!xs) return;
  const W = (xs.src.w * n.w) / 100,
    H = (xs.src.h * n.h) / 100;
  const a = (n.angle * Math.PI) / 180;
  const c = Math.cos(a),
    sn = Math.sin(a);
  const pts = [
    [-W / 2, -H / 2],
    [W / 2, -H / 2],
    [W / 2, H / 2],
    [-W / 2, H / 2],
  ].flatMap(([x, y]) => [n.x + x! * c - y! * sn, n.y + x! * sn + y! * c]);
  xs.quad = pts as Quad;
  xs.pivot = [n.x, n.y];
  preview();
  bump();
}

/** Transform ▸ Rotate 180° / 90° / Flip, applied to the current box (or starting one). */
export function quickTransform(kind: 'rot180' | 'rot90cw' | 'rot90ccw' | 'flipH' | 'flipV'): void {
  const started = !xs;
  if (!xs) freeTransform();
  if (!xs) return;
  const [px, py] = xs.pivot;
  const m =
    kind === 'flipH'
      ? [-1, 0, 2 * px, 0, 1, 0, 0, 0, 1]
      : kind === 'flipV'
        ? [1, 0, 0, 0, -1, 2 * py, 0, 0, 1]
        : kind === 'rot180'
          ? [-1, 0, 2 * px, 0, -1, 2 * py, 0, 0, 1]
          : kind === 'rot90cw'
            ? [0, -1, px + py, 1, 0, py - px, 0, 0, 1]
            : [0, 1, px - py, -1, 0, px + py, 0, 0, 1];
  xs.quad = applyMat(xs.quad, m);
  preview();
  if (started) void commitTransform();
}

export async function commitTransform(): Promise<void> {
  const s = current();
  const x = xs;
  if (!s || !x) return;
  xs = null;
  s.overrides = { ...s.overrides, transforms: undefined };
  if (x.quad.every((v, i) => Math.abs(v - x.start[i]!) < 1e-6) && !x.warp) {
    bump();
    return;
  }
  if (x.target === 'selection') {
    const m = quadToQuad(rectQuad(x.src), x.quad);
    const sel = selectionMask(s.doc);
    if (m && sel && Math.abs(m[6]!) < 1e-9 && Math.abs(m[7]!) < 1e-9) {
      const next = withSelection(s.doc, transformMask(sel, [m[0]!, m[3]!, m[1]!, m[4]!, m[2]!, m[5]!]));
      s.commit('Transform Selection', 'select', next);
    }
    bump();
    return;
  }
  const M = quadToQuad(rectQuad(x.src), x.quad);
  if (!M && !x.warp) return;
  let next = s.doc;
  const clip = { x: -s.doc.width, y: -s.doc.height, w: s.doc.width * 3, h: s.doc.height * 3 };
  for (const id of x.ids) {
    const l = findLayer(next.layers, id);
    if (!l) continue;
    let out: Layer | null = null;
    if (l.kind === 'smart' && !x.warp && M) {
      out = rerenderSync({ ...l, transform: M }, s.doc);
    } else if (l.kind === 'shape' && !x.warp && M) {
      const affine = Math.abs(M[6]!) < 1e-9 && Math.abs(M[7]!) < 1e-9;
      const path = affine ? transformPath(l.path, [M[0]!, M[3]!, M[1]!, M[4]!, M[2]!, M[5]!]) : projectPath(l.path, M);
      out = rerenderSync({ ...l, path }, s.doc);
    } else if (l.kind === 'text' && !x.warp && M && isSimilarity(M)) {
      const k = Math.hypot(M[0]!, M[3]!);
      const ang = (Math.atan2(M[3]!, M[0]!) * 180) / Math.PI;
      const [nx, ny] = mapPoint(M, l.text.x, l.text.y);
      out = rerenderSync(
        {
          ...l,
          text: {
            ...l.text,
            x: nx,
            y: ny,
            rotation: l.text.rotation + ang,
            base: { ...l.text.base, size: l.text.base.size * k },
            runs: l.text.runs.map((r) => ({ ...r, style: r.style?.size ? { ...r.style, size: r.style.size * k } : r.style })),
            box: l.text.box ? { w: l.text.box.w * k, h: l.text.box.h * k } : undefined,
          },
        },
        s.doc,
      );
    } else if ('raster' in l) {
      if (l.kind === 'text') toast('Text was turned into pixels to distort it.');
      const srcR = l.kind === 'smart' ? l.source.raster : l.raster;
      const img = { w: x.src.w, h: x.src.h, c: 4 as const, data: srcR.read(x.src) };
      const res = x.warp ? warpMesh(img, 33, 33, patchMesh(x.warp, 32), clip) : warpProjective(img, M!, clip, 'bicubic');
      if (!res.rect) continue;
      const r = Raster.fromFloats(s.doc.depth, 4, res.rect, res.data);
      out = l.kind === 'smart' ? ({ ...l, kind: 'pixel', raster: r } as unknown as Layer) : ({ ...l, kind: 'pixel', raster: r } as Layer);
      if (out.mask?.linked && M && !x.warp) {
        const mimg = { w: x.src.w, h: x.src.h, c: 4 as const, data: maskAsRgba(out.mask.raster.read(x.src, undefined, out.mask.background)) };
        const mr = warpProjective(mimg, M, clip);
        if (mr.rect) {
          const one = new Float32Array(mr.rect.w * mr.rect.h);
          for (let i = 0; i < one.length; i++) one[i] = mr.data[i * 4]! * mr.data[i * 4 + 3]! + out.mask.background * (1 - mr.data[i * 4 + 3]!);
          out = { ...out, mask: { ...out.mask, raster: Raster.fromFloats(8, 1, mr.rect, one) } };
        }
      }
    }
    if (out) next = { ...next, layers: updateLayer(next.layers, id, () => out!) };
  }
  s.commit(x.warp ? 'Warp' : 'Free Transform', 'transform', next);
  bump();
}

function maskAsRgba(m: Float32Array): Float32Array {
  const out = new Float32Array(m.length * 4);
  for (let i = 0; i < m.length; i++) out.set([m[i]!, m[i]!, m[i]!, 1], i * 4);
  return out;
}

function isSimilarity(M: number[]): boolean {
  if (Math.abs(M[6]!) > 1e-9 || Math.abs(M[7]!) > 1e-9) return false;
  return Math.abs(M[0]! - M[4]!) < 1e-6 && Math.abs(M[1]! + M[3]!) < 1e-6;
}

function projectPath(p: import('../../core/path').VectorPath, M: number[]): import('../../core/path').VectorPath {
  const P = (x: number, y: number) => mapPoint(M, x, y);
  return {
    ...p,
    subpaths: p.subpaths.map((sp) => ({
      ...sp,
      anchors: sp.anchors.map((a) => {
        const [x, y] = P(a.x, a.y),
          [ix, iy] = P(a.ix, a.iy),
          [ox, oy] = P(a.ox, a.oy);
        return { ...a, x, y, ix, iy, ox, oy };
      }),
    })),
  };
}

export { maskBounds };
