// Where layers are on the canvas: their boxes (with the words' real size and
// boxes that follow text), hit tests, and the matrices for dragging.

import { tokensFor, valuesFor } from '../core/binding';
import { isAnimated, setValue, valueAt, vec } from '../core/easing';
import { apply, invert, mul, type Mat } from '../core/matrix';
import { canvasMeasure, contentSize, fittedBox, groupOf, layerIndex, ownMatrix, textLayout, worldMatrix, type Ctx } from '../core/render';
import type { Composition, Layer, TitleProject, Value, Values, BrandTokens, Vec2 } from '../core/types';
import { boundsOf, type Box } from './ops';
import { getProp, withProp } from './props';

let measureCtx: Ctx | null = null;
function measurer(): Ctx | null {
  if (measureCtx) return measureCtx;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  measureCtx = c.getContext('2d') as Ctx | null;
  return measureCtx;
}

export interface Look {
  project: TitleProject;
  comp: Composition;
  t: number;
  values: Values;
  brand: Partial<BrandTokens> | null;
}

/** The size and offset of what a layer shows, in its own space. */
export function layerBox(look: Look, l: Layer): { x: number; y: number; w: number; h: number } {
  const t = look.t;
  const ctx = measurer();
  if (l.type === 'text') {
    if (l.box[0] > 0 && l.box[1] > 0) return { x: 0, y: 0, w: l.box[0], h: l.box[1] };
    if (!ctx) return { x: 0, y: 0, w: l.box[0] || 100, h: l.box[1] || l.style.size * l.style.lineHeight };
    const lay = textLayout(
      l,
      valuesFor(look.project, look.values),
      tokensFor(look.project, look.brand ?? undefined),
      canvasMeasure(ctx),
      look.project.variables,
    );
    return { x: 0, y: 0, w: l.box[0] || lay.width, h: l.box[1] || lay.height };
  }
  if (l.type === 'shape' && l.fitTo && ctx) {
    const f = fittedBox(ctx, l, {
      t,
      f: { values: valuesFor(look.project, look.values), tokens: tokensFor(look.project, look.brand ?? undefined), project: look.project },
      index: layerIndex(look.comp),
    });
    if (f) return { x: f.dx, y: 0, w: f.w, h: f.h };
  }
  if (l.type === 'shape' && l.shape === 'path' && l.path?.v.length) {
    const xs = l.path.v.map((v) => v.p[0]);
    const ys = l.path.v.map((v) => v.p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
  }
  const [w, h] = contentSize(l, t, look.project);
  return { x: 0, y: 0, w, h };
}

/** A layer's corners on the composition (groups: around their children). */
export function layerCorners(look: Look, l: Layer): Vec2[] {
  const c = look.comp;
  if (l.type === 'group') {
    const pts = l.children.filter((k) => k.visible).flatMap((k) => layerCorners(look, k));
    if (!pts.length) return [];
    const b = boundsOf(pts);
    return [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h],
      [b.x, b.y + b.h],
    ];
  }
  const m = worldMatrix(c, l, look.t, layerIndex(c), groupOf(c));
  const b = layerBox(look, l);
  if (l.type === 'null') {
    const p = apply(m, [0, 0]);
    return [
      [p[0] - 12, p[1] - 12],
      [p[0] + 12, p[1] - 12],
      [p[0] + 12, p[1] + 12],
      [p[0] - 12, p[1] + 12],
    ];
  }
  return [apply(m, [b.x, b.y]), apply(m, [b.x + b.w, b.y]), apply(m, [b.x + b.w, b.y + b.h]), apply(m, [b.x, b.y + b.h])];
}

export const layerBounds = (look: Look, l: Layer): Box | null => {
  const pts = layerCorners(look, l);
  return pts.length ? boundsOf(pts) : null;
};

function inside(pts: Vec2[], p: Vec2): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

/** The front-most layer under a composition point (children of groups first; mattes and locked layers skipped). */
export function hitLayer(look: Look, p: Vec2, list: Layer[] = look.comp.layers): Layer | null {
  const mattes = new Set<string>();
  for (const l of layerIndex(look.comp).values()) if (l.matte) mattes.add(l.matte.layer);
  for (const l of list) {
    if (!l.visible || l.locked || look.t < l.start || look.t >= l.end) continue;
    if (l.type === 'group') {
      const k = hitLayer(look, p, l.children);
      if (k) return k;
      continue;
    }
    if (mattes.has(l.id)) continue;
    const pts = layerCorners(look, l);
    if (pts.length && inside(pts, p)) return l;
  }
  return null;
}

/** The matrix of a layer's parent (its group or parent layer) in composition space. */
export function parentMatrix(c: Composition, l: Layer, t: number): Mat {
  const world = worldMatrix(c, l, t, layerIndex(c), groupOf(c));
  const inv = invert(ownMatrix(l, t));
  return inv ? mul(world, inv) : [1, 0, 0, 1, 0, 0];
}

/** A move in composition space as a move in the layer's parent space. */
export function toParent(c: Composition, l: Layer, t: number, d: Vec2): Vec2 {
  const m = parentMatrix(c, l, t);
  const inv = invert([m[0], m[1], m[2], m[3], 0, 0]);
  return inv ? apply(inv, d) : d;
}

/** Set a property at time t: a key there if it has keys, otherwise its still value. */
export function setAt(l: Layer, path: string, v: Value, t: number): Layer {
  const p = getProp(l, path);
  return withProp(l, path, setValue(p as never, t, v as never));
}

export const valueOf = (l: Layer, path: string, t: number, fallback: Value): Value => valueAt(getProp(l, path) as never, t, fallback as never);

export const posAt = (l: Layer, t: number): Vec2 => vec(l.transform.position, t, [0, 0]);
export const animated = (l: Layer, path: string) => isAnimated(getProp(l, path));
