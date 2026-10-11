// Outlines edited by hand: a layer's masks and a path shape's outline. Their
// points are dragged on the canvas, their box typed in, and they can change
// form over time (keys of the whole outline, like After Effects' mask path
// and path keyframes): an edit at the playhead sets the key there.

import { morphAt, pathBounds } from '../core/paths';
import type { Layer, PathData, PathKey, PathVertex, Vec2 } from '../core/types';

/** Which outline of a layer: one of its masks, or its own path (a path shape). */
export type OutlineRef = { kind: 'mask'; index: number } | { kind: 'path' };

export const sameRef = (a: OutlineRef | null, b: OutlineRef | null) =>
  !!a && !!b && a.kind === b.kind && (a.kind === 'path' || a.index === (b as { index: number }).index);

/** The outlines a layer can have edited (its masks, then its path when it is a path shape). */
export function outlineRefs(l: Layer): OutlineRef[] {
  const out: OutlineRef[] = (l.masks ?? []).map((_, index) => ({ kind: 'mask', index }));
  if (l.type === 'shape' && l.shape === 'path' && (l.path || l.morph?.length)) out.push({ kind: 'path' });
  return out;
}

function keysOf(l: Layer, ref: OutlineRef): PathKey[] | null {
  if (ref.kind === 'mask') return l.masks?.[ref.index]?.morph?.length ? l.masks[ref.index]!.morph! : null;
  return l.type === 'shape' && l.morph?.length ? l.morph : null;
}

/** Does the outline change form over time? */
export const isMorphing = (l: Layer, ref: OutlineRef) => !!keysOf(l, ref);

/** The outline's keys' times. */
export const outlineKeyTimes = (l: Layer, ref: OutlineRef) => (keysOf(l, ref) ?? []).map((k) => k.t);

/** The outline at time t: the main one first, then any further ones (holes, more pieces). */
export function outlinesAt(l: Layer, ref: OutlineRef, t: number): PathData[] {
  const keys = keysOf(l, ref);
  if (keys) return morphAt(keys, t);
  if (ref.kind === 'mask') {
    const m = l.masks?.[ref.index];
    return m ? [m.path] : [];
  }
  if (l.type !== 'shape' || !l.path) return [];
  return [l.path, ...(l.subpaths ?? [])];
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;

/** The layer with the outline set at time t (the key there when it changes form, made if none is there). */
export function setOutlinesAt(l: Layer, ref: OutlineRef, t: number, outlines: PathData[]): Layer {
  const keys = keysOf(l, ref);
  let morph: PathKey[] | null = null;
  if (keys) {
    const i = keys.findIndex((k) => near(k.t, t));
    morph = i >= 0 ? keys.map((k, j) => (j === i ? { ...k, v: outlines } : k)) : [...keys, { t, v: outlines }].sort((a, b) => a.t - b.t);
  }
  if (ref.kind === 'mask') {
    return {
      ...l,
      masks: (l.masks ?? []).map((m, j) => (j !== ref.index ? m : morph ? { ...m, morph } : { ...m, path: outlines[0] ?? m.path })),
    };
  }
  if (l.type !== 'shape') return l;
  if (morph) return { ...l, morph };
  return { ...l, path: outlines[0] ?? l.path, ...(outlines.length > 1 || l.subpaths ? { subpaths: outlines.slice(1) } : {}) };
}

/** Start changing form over time (a key at t of the outline as it is), or stop (it keeps its form at t). */
export function animateOutline(l: Layer, ref: OutlineRef, t: number, on: boolean): Layer {
  const now = outlinesAt(l, ref, t);
  if (!now.length) return l;
  if (ref.kind === 'mask')
    return {
      ...l,
      masks: (l.masks ?? []).map((m, j) => (j !== ref.index ? m : on ? { ...m, path: now[0]!, morph: [{ t, v: now }] } : { ...m, path: now[0]!, morph: null })),
    };
  if (l.type !== 'shape') return l;
  return on
    ? { ...l, path: now[0]!, subpaths: now.slice(1).length ? now.slice(1) : l.subpaths, morph: [{ t, v: now }] }
    : { ...l, path: now[0]!, ...(now.length > 1 ? { subpaths: now.slice(1) } : {}), morph: null };
}

/** The outline's key at t removed (the last one left stops the change over time). */
export function removeOutlineKey(l: Layer, ref: OutlineRef, t: number): Layer {
  const keys = keysOf(l, ref);
  if (!keys) return l;
  const left = keys.filter((k) => !near(k.t, t));
  if (left.length === keys.length) return l;
  if (!left.length) return animateOutline(l, ref, t, false);
  if (ref.kind === 'mask') return { ...l, masks: (l.masks ?? []).map((m, j) => (j === ref.index ? { ...m, morph: left } : m)) };
  return l.type === 'shape' ? { ...l, morph: left } : l;
}

/** The outline's key at `from` moved to `to` (not onto another key). */
export function moveOutlineKey(l: Layer, ref: OutlineRef, from: number, to: number): Layer {
  const keys = keysOf(l, ref);
  if (!keys || keys.some((k) => near(k.t, to) && !near(k.t, from))) return l;
  const moved = keys.map((k) => (near(k.t, from) ? { ...k, t: Math.max(0, Math.round(to * 1e6) / 1e6) } : k)).sort((a, b) => a.t - b.t);
  if (ref.kind === 'mask') return { ...l, masks: (l.masks ?? []).map((m, j) => (j === ref.index ? { ...m, morph: moved } : m)) };
  return l.type === 'shape' ? { ...l, morph: moved } : l;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** A point of an outline moved to `p` (its handles go with it). */
export function moveVertex(o: PathData, i: number, p: Vec2): PathData {
  return { ...o, v: o.v.map((v, j) => (j === i ? { ...v, p: [round(p[0]), round(p[1])] } : v)) };
}

/** A point's handle dragged to `at` (relative to the point); the other side mirrors it unless `free`. */
export function moveTangent(o: PathData, i: number, side: 'i' | 'o', at: Vec2, free = false): PathData {
  const other = side === 'i' ? 'o' : 'i';
  return {
    ...o,
    v: o.v.map((v, j) => {
      if (j !== i) return v;
      const next: PathVertex = { ...v, [side]: [round(at[0]), round(at[1])] as Vec2 };
      if (!free) next[other] = [round(-at[0]), round(-at[1])];
      return next;
    }),
  };
}

/** Every point of an outline moved by (dx, dy). */
export function moveOutline(o: PathData, d: Vec2): PathData {
  return { ...o, v: o.v.map((v) => ({ ...v, p: [round(v.p[0] + d[0]), round(v.p[1] + d[1])] as Vec2 })) };
}

/** Where outlines are together: the box around their points. */
export function outlinesBox(list: PathData[]): { x: number; y: number; w: number; h: number } {
  const bs = list.filter((o) => o.v.length).map(pathBounds);
  if (!bs.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}

/** Outlines fitted together to another box (for typing a mask's or a path's place and size). */
export function fitOutlines(list: PathData[], box: { x: number; y: number; w: number; h: number }): PathData[] {
  const b = outlinesBox(list);
  return list.map((o) => fitOutline(o, box, b));
}

/** An outline fitted to another box (points and handles scaled), from its own box or the one given. */
export function fitOutline(o: PathData, box: { x: number; y: number; w: number; h: number }, from = pathBounds(o)): PathData {
  const b = from;
  const kx = b.w > 1e-6 ? box.w / b.w : 1;
  const ky = b.h > 1e-6 ? box.h / b.h : 1;
  return {
    ...o,
    v: o.v.map((v) => ({
      p: [round(box.x + (v.p[0] - b.x) * kx), round(box.y + (v.p[1] - b.y) * ky)] as Vec2,
      ...(v.i ? { i: [round(v.i[0] * kx), round(v.i[1] * ky)] as Vec2 } : {}),
      ...(v.o ? { o: [round(v.o[0] * kx), round(v.o[1] * ky)] as Vec2 } : {}),
    })),
  };
}
