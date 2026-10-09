// Lottie (Bodymovin JSON) in: animations made in After Effects (exported
// with Bodymovin or LottieFiles), Figma plugins, Rive, Jitter and other
// tools, opened as a Titler project with real layers and keyframes.
//
// What comes over: compositions and precomps, shape layers (rectangles,
// ellipses, stars and polygons, paths, groups, fills, gradient fills,
// strokes, trim paths, path morphs), text layers, pictures, solids, nulls,
// parenting, masks, track mattes, blend modes, keyframes with their easing,
// holds and motion paths, and markers. What does not (effects, expressions,
// repeaters, text animators, time remapping…) is listed in `notes`.

import { DEFAULT_TOKENS } from './binding';
import { uid } from './build';
import { ellipsePath, rectPath } from './paths';
import { textStyle } from './build';
import type {
  Asset,
  BlendMode,
  Composition,
  GroupLayer,
  Keyframe,
  Layer,
  LayerBase,
  Mask,
  Paint,
  PathData,
  PathKey,
  PathVertex,
  Prop,
  ShapeLayer,
  Stroke,
  TextAnimator,
  TextLayer,
  TitleProject,
  Transform,
  Value,
  Vec2,
} from './types';
import { FORMAT, VERSION } from './types';

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const numOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : Array.isArray(v) && typeof v[0] === 'number' ? v[0] : d);

/** Does this JSON look like a Lottie animation? */
export function isLottie(o: unknown): boolean {
  return isObj(o) && Array.isArray(o.layers) && typeof o.w === 'number' && typeof o.h === 'number' && ('fr' in o || 'op' in o);
}

export interface LottieImport {
  project: TitleProject;
  /** What could not be brought over (each said once). */
  notes: string[];
}

interface Ctx {
  fr: number;
  /** Frame the animation starts (ip of the root). */
  ip: number;
  assets: Map<string, J>;
  fonts: Map<string, { family: string; weight: number; italic: boolean }>;
  project: TitleProject;
  notes: Set<string>;
  comps: Map<string, Composition>;
  depth: number;
}

const BLENDS: Record<number, BlendMode> = { 0: 'normal', 1: 'multiply', 2: 'screen', 3: 'overlay', 4: 'darken', 5: 'lighten', 16: 'add' };

// ---- values and keyframes ----

function ease(v: unknown): Vec2 | undefined {
  if (!isObj(v)) return undefined;
  const x = numOr(v.x, NaN);
  const y = numOr(v.y, NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined;
}

/** A Lottie property ({a, k}) as a Titler one, through `map` (e.g. frames → values). */
function prop<T extends Value>(p: unknown, c: Ctx, map: (raw: number[]) => T, fallback: T, shift = 0): Prop<T> {
  if (!isObj(p)) return { v: fallback };
  if (p.x && typeof p.x === 'string') c.notes.add('Expressions are left out (their values at the keys are kept).');
  const k = p.k;
  const animated = Array.isArray(k) && k.length > 0 && isObj(k[0]) && 't' in (k[0] as J);
  if (!animated) {
    const raw = typeof k === 'number' ? [k] : Array.isArray(k) ? (k as unknown[]).map((x) => numOr(x, 0)) : [];
    return raw.length ? { v: map(raw) } : { v: fallback };
  }
  const list = k as J[];
  const out: Keyframe<T>[] = [];
  for (let n = 0; n < list.length; n++) {
    const kf = list[n]!;
    let raw = arr(kf.s).map((x) => numOr(x, 0));
    if (typeof kf.s === 'number') raw = [kf.s];
    if (!raw.length) {
      // The old form: the last key has only t, its value is the previous key's e.
      const prev = list[n - 1];
      raw = prev ? arr(prev.e).map((x) => numOr(x, 0)) : [];
      if (typeof prev?.e === 'number') raw = [prev.e];
    }
    if (!raw.length) continue;
    const key: Keyframe<T> = { t: (numOr(kf.t, 0) - c.ip + shift) / c.fr, v: map(raw) };
    const o = ease(kf.o);
    if (o) key.o = o;
    if (kf.h === 1) key.hold = true;
    const prevKey = list[n - 1];
    const i = prevKey ? ease(prevKey.i) : undefined;
    if (i) key.i = i;
    const to = arr(kf.to).map((x) => numOr(x, 0));
    if (to.length >= 2 && (to[0] || to[1])) (key as Keyframe<Vec2>).so = [to[0]!, to[1]!];
    const ti = prevKey ? arr(prevKey.ti).map((x) => numOr(x, 0)) : [];
    if (ti.length >= 2 && (ti[0] || ti[1])) (key as Keyframe<Vec2>).si = [ti[0]!, ti[1]!];
    out.push(key);
  }
  if (!out.length) return { v: fallback };
  if (out.length === 1) return { v: out[0]!.v };
  return { k: out };
}

const vec2 = (r: number[]): Vec2 => [r[0] ?? 0, r[1] ?? 0];
const scalar = (r: number[]) => r[0] ?? 0;

/** The first value of a property (for things the Titler keeps still). */
function first(p: unknown, c: Ctx, what: string): number[] {
  if (!isObj(p)) return [];
  const k = p.k;
  if (typeof k === 'number') return [k];
  if (Array.isArray(k) && k.length && isObj(k[0]) && 't' in (k[0] as J)) {
    if (k.length > 1) c.notes.add(`${what} that change over time keep their first value.`);
    const s = (k[0] as J).s;
    return typeof s === 'number' ? [s] : arr(s).map((x) => numOr(x, 0));
  }
  return arr(k).map((x) => numOr(x, 0));
}

/** A Lottie color (0–1, or 0–255 in some old files) as #rrggbb[aa]. */
export function hex(rgba: number[], alpha = 1): string {
  const k = rgba.slice(0, 3).some((x) => x > 1) ? 1 / 255 : 1;
  const h = (x: number) =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  const a = Math.max(0, Math.min(1, (rgba[3] ?? 1) * alpha));
  return `#${h((rgba[0] ?? 0) * k)}${h((rgba[1] ?? 0) * k)}${h((rgba[2] ?? 0) * k)}${a < 0.999 ? h(a) : ''}`;
}

/** Position, possibly split into X and Y. */
function position(p: unknown, c: Ctx, shift: number): Prop<Vec2> {
  if (isObj(p) && p.s === true) {
    const x = prop(p.x, c, scalar, 0, shift);
    const y = prop(p.y, c, scalar, 0, shift);
    if (!('k' in x && x.k) && !('k' in y && y.k)) return { v: [x.v as number, y.v as number] };
    // Separate X and Y keys: one key at each time either has, the other's value there.
    const times = [...new Set([...('k' in x && x.k ? x.k.map((q) => q.t) : []), ...('k' in y && y.k ? y.k.map((q) => q.t) : [])])].sort((a, b) => a - b);
    const at = (q: Prop, t: number) => {
      if (!('k' in q) || !q.k) return q.v as number;
      const ks = q.k;
      if (t <= ks[0]!.t) return ks[0]!.v;
      for (let n = 0; n < ks.length - 1; n++) if (t <= ks[n + 1]!.t) return ks[n]!.v + ((ks[n + 1]!.v - ks[n]!.v) * (t - ks[n]!.t)) / (ks[n + 1]!.t - ks[n]!.t || 1);
      return ks[ks.length - 1]!.v;
    };
    const keyAt = (q: Prop, t: number) => ('k' in q && q.k ? q.k.find((kk) => Math.abs(kk.t - t) < 1e-6) : undefined);
    c.notes.add('Position with separate X and Y keys is joined into one (the easing of keys only one of them had is lost).');
    return {
      k: times.map((t) => {
        const kx = keyAt(x, t);
        const ky = keyAt(y, t);
        const ref = kx ?? ky;
        const key: Keyframe<Vec2> = { t, v: [at(x, t), at(y, t)] };
        if (ref?.o) key.o = ref.o;
        if (ref?.i) key.i = ref.i;
        if (ref?.hold) key.hold = true;
        return key;
      }),
    };
  }
  return prop(p, c, vec2, [0, 0], shift);
}

function transform(ks: unknown, c: Ctx, shift: number): Transform {
  const k = isObj(ks) ? ks : {};
  if (k.sk && numOr((k.sk as J).k, 0)) c.notes.add('Skew is left out.');
  const deep: Partial<Transform> = {};
  if (k.rx) deep.rotationX = prop(k.rx, c, scalar, 0, shift);
  if (k.ry) deep.rotationY = prop(k.ry, c, scalar, 0, shift);
  if (k.or && arr((k.or as J).k).some((v) => numOr(v, 0))) c.notes.add('3D orientation is left out (X and Y rotation are kept).');
  const p3 = isObj(k.p) && !k.p.s && !(Array.isArray(k.p.k) && isObj(k.p.k[0])) ? arr(k.p.k).map((v) => numOr(v, 0)) : [];
  if (p3.length > 2 && p3[2]) deep.z = { v: p3[2] };
  return {
    ...deep,
    anchor: prop(k.a, c, vec2, [0, 0], shift),
    position: position(k.p, c, shift),
    scale: prop(k.s, c, vec2, [100, 100], shift),
    rotation: prop(k.r ?? k.rz, c, scalar, 0, shift),
    opacity: prop(k.o, c, scalar, 100, shift),
  };
}

// ---- paths ----

function bezier(v: unknown): PathData {
  const o = isObj(v) ? v : {};
  const pts = arr(o.v);
  const ins = arr(o.i);
  const outs = arr(o.o);
  const verts: PathVertex[] = pts.map((p, n) => {
    const vp = arr(p).map((x) => numOr(x, 0));
    const vi = arr(ins[n]).map((x) => numOr(x, 0));
    const vo = arr(outs[n]).map((x) => numOr(x, 0));
    const out: PathVertex = { p: [vp[0] ?? 0, vp[1] ?? 0] };
    if (vi[0] || vi[1]) out.i = [vi[0]!, vi[1]!];
    if (vo[0] || vo[1]) out.o = [vo[0]!, vo[1]!];
    return out;
  });
  return { closed: !!o.c, v: verts };
}

const movePath = (p: PathData, d: Vec2): PathData => ({ ...p, v: p.v.map((x) => ({ ...x, p: [x.p[0] + d[0], x.p[1] + d[1]] as Vec2 })) });

function starPath(it: J, c: Ctx): PathData {
  const pts = Math.max(3, Math.round(first(it.pt, c, 'Star points')[0] ?? 5));
  const pos = vec2(first(it.p, c, 'Star positions'));
  const rot = ((first(it.r, c, 'Star rotations')[0] ?? 0) * Math.PI) / 180;
  const outer = first(it.or, c, 'Star sizes')[0] ?? 50;
  const inner = first(it.ir, c, 'Star sizes')[0] ?? outer / 2;
  const star = numOr(it.sy, 1) === 1;
  if (numOr((it.is as J | undefined)?.k, 0) || numOr((it.os as J | undefined)?.k, 0)) c.notes.add('Star and polygon roundness is left out.');
  const n = star ? pts * 2 : pts;
  const v: PathVertex[] = [];
  for (let k = 0; k < n; k++) {
    const r = star && k % 2 ? inner : outer;
    const a = rot + (k / n) * Math.PI * 2 - Math.PI / 2;
    v.push({ p: [pos[0] + Math.cos(a) * r, pos[1] + Math.sin(a) * r] });
  }
  return { closed: true, v };
}

/** A shape item's outline in its group's space (rectangles and ellipses at their first size). */
function itemPath(it: J, c: Ctx): PathData | null {
  switch (it.ty) {
    case 'sh': {
      const ks = it.ks as J | undefined;
      const k = ks?.k;
      if (Array.isArray(k) && isObj(k[0]) && 't' in (k[0] as J)) return bezier(arr((k[0] as J).s)[0]);
      return bezier(k);
    }
    case 'rc': {
      const s = vec2(first(it.s, c, 'Rectangle sizes'));
      const p = vec2(first(it.p, c, 'Rectangle positions'));
      return movePath(rectPath(s[0], s[1], first(it.r, c, 'Rectangle roundness')[0] ?? 0), [p[0] - s[0] / 2, p[1] - s[1] / 2]);
    }
    case 'el': {
      const s = vec2(first(it.s, c, 'Ellipse sizes'));
      const p = vec2(first(it.p, c, 'Ellipse positions'));
      return movePath(ellipsePath(s[0], s[1]), [p[0] - s[0] / 2, p[1] - s[1] / 2]);
    }
    case 'sr':
      return starPath(it, c);
  }
  return null;
}

/** Path keys of an animated 'sh' item (or null when it is still). */
function pathKeys(it: J, c: Ctx, shift: number): PathKey[] | null {
  if (it.ty !== 'sh') return null;
  const k = (it.ks as J | undefined)?.k;
  if (!Array.isArray(k) || !isObj(k[0]) || !('t' in (k[0] as J)) || k.length < 2) return null;
  const list = k as J[];
  const out: PathKey[] = [];
  for (let n = 0; n < list.length; n++) {
    const kf = list[n]!;
    const s = arr(kf.s)[0] ?? arr(list[n - 1]?.e)[0];
    if (!s) continue;
    const key: PathKey = { t: (numOr(kf.t, 0) - c.ip + shift) / c.fr, v: [bezier(s)] };
    const o = ease(kf.o);
    if (o) key.o = o;
    const i = n > 0 ? ease(list[n - 1]!.i) : undefined;
    if (i) key.i = i;
    if (kf.h === 1) key.hold = true;
    out.push(key);
  }
  return out.length > 1 ? out : null;
}

// ---- shape layers ----

interface Styles {
  fill: Paint | null;
  extraFills: Paint[];
  fillRule: 'nonzero' | 'evenodd';
  stroke: Stroke | null;
  trim: ShapeLayer['trim'];
}

function paintOf(it: J, c: Ctx, shift: number): Paint | null {
  const opacity = (first(it.o, c, 'Fill and stroke opacities')[0] ?? 100) / 100;
  if (it.ty === 'fl' || it.ty === 'st') {
    const col = first(it.c, c, 'Colors');
    return { type: 'solid', color: hex(col.length ? col : [1, 1, 1, 1], opacity) };
  }
  // Gradients: g.p color stops [pos, r, g, b]…, then alpha stops [pos, a]…
  const g = (it.g as J | undefined) ?? {};
  const count = numOr(g.p, 2);
  const raw = first(g.k, c, 'Gradients');
  const stops: { at: number; color: string }[] = [];
  for (let n = 0; n < count; n++) {
    const at = raw[n * 4] ?? 0;
    const col = [raw[n * 4 + 1] ?? 0, raw[n * 4 + 2] ?? 0, raw[n * 4 + 3] ?? 0];
    // Alpha at this stop (if the gradient has alpha stops).
    let a = 1;
    const alphas = raw.slice(count * 4);
    for (let m = 0; m + 1 < alphas.length; m += 2) if (Math.abs(alphas[m]! - at) < 1e-3) a = alphas[m + 1]!;
    stops.push({ at, color: hex([...col, a], opacity) });
  }
  void shift;
  if (numOr(it.t, 1) === 2) return { type: 'radial', stops };
  const s = vec2(first(it.s, c, 'Gradient ends'));
  const e = vec2(first(it.e, c, 'Gradient ends'));
  const angle = Math.round(((Math.atan2(e[1] - s[1], e[0] - s[0]) * 180) / Math.PI + 90 + 360) % 360);
  return { type: 'linear', angle, stops };
}

function strokeOf(it: J, c: Ctx, shift: number): Stroke | null {
  const paint = paintOf(it, c, shift);
  if (!paint) return null;
  const width = first(it.w, c, 'Stroke widths')[0] ?? 1;
  const st: Stroke = { paint, width, cap: (['butt', 'butt', 'round', 'square'] as const)[numOr(it.lc, 1)] ?? 'butt', join: (['miter', 'miter', 'round', 'bevel'] as const)[numOr(it.lj, 1)] ?? 'miter' };
  const dash = arr(it.d)
    .filter((d) => isObj(d) && (d.n === 'd' || d.n === 'g'))
    .map((d) => first((d as J).v, c, 'Dashes')[0] ?? 0);
  if (dash.length) st.dash = dash;
  return st;
}

/** Fills, strokes and trims in a group's items (they style the outlines above them, in this group and below). */
function stylesIn(items: J[], parent: Styles, c: Ctx, shift: number): Styles {
  const s: Styles = { ...parent };
  let fill = false;
  let stroke = false;
  for (const it of items) {
    if (it.hd === true) continue;
    if ((it.ty === 'fl' || it.ty === 'gf') && !fill) {
      s.fill = paintOf(it, c, shift);
      s.extraFills = [];
      s.fillRule = numOr(it.r, 1) === 2 ? 'evenodd' : 'nonzero';
      fill = true;
    } else if (it.ty === 'fl' || it.ty === 'gf') {
      // More fills: the earlier one is on top, so this one goes under it.
      const under = paintOf(it, c, shift);
      if (under && s.fill) {
        s.extraFills = [s.fill, ...s.extraFills];
        s.fill = under;
      }
    } else if ((it.ty === 'st' || it.ty === 'gs') && !stroke) {
      s.stroke = strokeOf(it, c, shift);
      stroke = true;
    } else if (it.ty === 'tm') {
      s.trim = { start: prop(it.s, c, scalar, 0, shift), end: prop(it.e, c, scalar, 100, shift), offset: prop(it.o, c, (r) => (r[0] ?? 0) / 3.6, 0, shift) };
    } else if (it.ty === 'rp') c.notes.add('Repeaters are left out.');
    else if (it.ty === 'rd') c.notes.add('Round corners on paths are left out.');
    else if (it.ty === 'mm') c.notes.add('Merge paths are drawn as the paths together.');
    else if (it.ty === 'pb' || it.ty === 'tw' || it.ty === 'zz' || it.ty === 'op') c.notes.add('Path effects (pucker, twist, zig zag, offset) are left out.');
    else if (it.ty === 'gs' || it.ty === 'st') c.notes.add('Only the first stroke of a group is kept.');
  }
  return s;
}

function baseOf(name: string, start: number, end: number, tr: Transform): LayerBase {
  return { id: uid(), name, visible: true, start, end, transform: tr };
}

const STILL: Transform = { anchor: { v: [0, 0] }, position: { v: [0, 0] }, scale: { v: [100, 100] }, rotation: { v: 0 }, opacity: { v: 100 } };

/** A group's items as layers (front first), styled by `parent` and their own fills and strokes. */
function shapeItems(items: J[], parent: Styles, start: number, end: number, c: Ctx, shift: number): Layer[] {
  const styles = stylesIn(items, parent, c, shift);
  const out: Layer[] = [];
  // Simple outlines of this group: one shape (several outlines under one fill make one compound path).
  const outlines = items.filter((it) => it.hd !== true && (it.ty === 'sh' || it.ty === 'rc' || it.ty === 'el' || it.ty === 'sr'));
  const own = (): ShapeLayer | null => {
    if (!outlines.length || (!styles.fill && !styles.stroke)) return null;
    const one = outlines.length === 1 ? outlines[0]! : null;
    const base = {
      ...baseOf(String(one?.nm ?? 'Shape'), start, end, { ...STILL }),
      type: 'shape' as const,
      fill: styles.fill,
      ...(styles.extraFills.length ? { extraFills: styles.extraFills } : {}),
      stroke: styles.stroke,
      trim: styles.trim ?? null,
    };
    if (one && (one.ty === 'rc' || one.ty === 'el')) {
      // A rectangle or ellipse (size and place may move): kept as one, about its center.
      const size = prop<Vec2>(one.s, c, vec2, [100, 100], shift);
      const half: Prop<Vec2> = 'k' in size && size.k ? { k: size.k.map((k) => ({ ...k, v: [k.v[0] / 2, k.v[1] / 2] as Vec2 })) } : { v: [(size.v as Vec2)[0] / 2, (size.v as Vec2)[1] / 2] };
      return {
        ...base,
        name: one.ty === 'rc' ? String(one.nm ?? 'Rectangle') : String(one.nm ?? 'Ellipse'),
        shape: one.ty === 'rc' ? 'rect' : 'ellipse',
        size,
        roundness: one.ty === 'rc' ? prop(one.r, c, scalar, 0, shift) : { v: 0 },
        transform: { ...STILL, anchor: half, position: prop(one.p, c, vec2, [0, 0], shift) },
      };
    }
    const keys = outlines.length === 1 ? pathKeys(outlines[0]!, c, shift) : null;
    if (!keys) for (const it of outlines) if (pathKeys(it, c, shift)) c.notes.add('Path animations of compound shapes keep their first form.');
    const paths = outlines.map((it) => itemPath(it, c)).filter((p): p is PathData => !!p);
    const shape: ShapeLayer = {
      ...base,
      shape: 'path',
      size: { v: [100, 100] },
      roundness: { v: 0 },
      path: paths[0] ?? { closed: false, v: [] },
      ...(paths.length > 1 ? { subpaths: paths.slice(1) } : {}),
      ...(styles.fillRule === 'evenodd' ? { fillRule: 'evenodd' as const } : {}),
      ...(keys ? { morph: keys } : {}),
    };
    return shape;
  };
  // Lottie draws the first item on top; nested groups and this group's outlines keep their order.
  let ownDone = false;
  for (const it of items) {
    if (it.hd === true) continue;
    if (it.ty === 'gr') {
      const tr = arr(it.it).find((x) => isObj(x) && x.ty === 'tr') as J | undefined;
      const children = shapeItems(
        arr(it.it).filter(isObj).filter((x) => x.ty !== 'tr'),
        styles,
        start,
        end,
        c,
        shift,
      );
      if (!children.length) continue;
      const g: GroupLayer = { ...baseOf(String(it.nm ?? 'Group'), start, end, tr ? transform(tr, c, shift) : { ...STILL }), type: 'group', children };
      out.push(g);
    } else if (!ownDone && (it.ty === 'sh' || it.ty === 'rc' || it.ty === 'el' || it.ty === 'sr')) {
      ownDone = true;
      const s = own();
      if (s) out.push(s);
    }
  }
  return out;
}

// ---- text ----

function textLayer(l: J, b: LayerBase, c: Ctx, shift: number): TextLayer {
  const t = isObj(l.t) ? l.t : {};
  const dk = arr((t.d as J | undefined)?.k);
  if (dk.length > 1) c.notes.add('Text that changes over time keeps its first words.');
  const doc = (isObj(dk[0]) ? (dk[0] as J).s : {}) as J;
  if (isObj(t.p) && Object.keys(t.p).length) c.notes.add('Text on a path is drawn on a line.');
  const size = numOr(doc.s, 48);
  const font = c.fonts.get(String(doc.f ?? '')) ?? { family: String(doc.f ?? 'Inter'), weight: 400, italic: false };
  const lhPx = numOr(doc.lh, size * 1.2);
  const lineHeight = Math.round((lhPx / size) * 100) / 100 || 1.2;
  const words = String(doc.t ?? '').replace(/\r\n?|\u0003/g, '\n');
  const align = (['left', 'right', 'center', 'justify', 'justify', 'justify', 'justify'] as const)[numOr(doc.j, 0)] ?? 'left';
  const fc = arr(doc.fc).map((x) => numOr(x, 1));
  const sc = arr(doc.sc).map((x) => numOr(x, 0));
  const sw = numOr(doc.sw, 0);
  const lines = words.split('\n');
  const sz = arr(doc.sz).map((x) => numOr(x, 0));
  const ps = arr(doc.ps).map((x) => numOr(x, 0));
  const boxed = sz.length >= 2 && sz[0]! > 0;
  // Point text: about 0.6 of the size a letter, the baseline at the layer's origin.
  const longest = Math.max(1, ...lines.map((x) => x.length));
  const box: Vec2 = boxed ? [sz[0]!, sz[1]!] : [Math.ceil(longest * size * 0.62 + size), Math.ceil(lines.length * lhPx)];
  // Where the Titler's box (top left at 0,0) sits in Lottie's text space.
  const firstBaseline = size * lineHeight * 0.5 + size * 0.35;
  const off: Vec2 = boxed ? [ps[0] ?? 0, ps[1] ?? 0] : [align === 'center' ? -box[0] / 2 : align === 'right' ? -box[0] : 0, -firstBaseline];
  const shiftA = (v: Vec2): Vec2 => [v[0] - off[0], v[1] - off[1]];
  const a = b.transform.anchor;
  const anchor: Prop<Vec2> = 'k' in a && a.k ? { k: a.k.map((k) => ({ ...k, v: shiftA(k.v) })) } : { v: shiftA(a.v as Vec2) };
  void shift;
  return {
    ...b,
    transform: { ...b.transform, anchor },
    type: 'text',
    text: words,
    style: textStyle({
      font: font.family,
      weight: font.weight,
      italic: font.italic,
      size,
      fill: { type: 'solid', color: hex(fc.length ? fc : [1, 1, 1]) },
      stroke: sw > 0 && sc.length ? { paint: { type: 'solid', color: hex(sc) }, width: sw / 2 } : null,
      tracking: Math.round((numOr(doc.tr, 0) / 1000) * size * 100) / 100,
      lineHeight,
      align: align === 'justify' ? 'justify' : align,
      vAlign: 'top',
    }),
    box,
    wrap: boxed,
    fit: 'none',
    ...(arr(t.a).length ? { animators: arr(t.a).filter(isObj).map((a) => animatorOf(a, size, c, shift)) } : {}),
  };
}

const SHAPE_OF: Record<number, TextAnimator['shape']> = { 1: 'square', 2: 'rampUp', 3: 'rampDown', 4: 'triangle', 5: 'smooth', 6: 'smooth' };

/** A Lottie text animator (range selector and its properties) as the Titler's. */
function animatorOf(a: J, size: number, c: Ctx, shift: number): TextAnimator {
  const s = (isObj(a.s) ? a.s : {}) as J;
  const p = (isObj(a.a) ? a.a : {}) as J;
  if (numOr(s.t, 0) !== 0) c.notes.add('Expression and wiggly selectors in text animators are drawn as range selectors.');
  if (numOr(s.r, 1) === 2) c.notes.add('Text animator ranges counted by index are read as percent.');
  if (numOr(s.rn, 0)) c.notes.add('Random order in text animators is left out.');
  const by = numOr(s.b, 1);
  const out: TextAnimator = {
    id: uid('a'),
    name: String(a.nm ?? 'Animator'),
    by: by === 3 ? 'word' : by === 4 ? 'line' : 'char',
    start: prop(s.s, c, scalar, 0, shift),
    end: prop(s.e, c, scalar, 100, shift),
    offset: prop(s.o, c, scalar, 0, shift),
    shape: SHAPE_OF[numOr(s.sh, 1)] ?? 'square',
  };
  if (p.o) out.opacity = prop(p.o, c, scalar, 100, shift);
  if (p.p) out.position = prop(p.p, c, vec2, [0, 0], shift);
  if (p.s) out.scale = prop(p.s, c, scalar, 100, shift);
  if (p.r ?? p.rz) out.rotation = prop(p.r ?? p.rz, c, scalar, 0, shift);
  if (p.t) out.tracking = prop(p.t, c, (r) => ((r[0] ?? 0) / 1000) * size, 0, shift);
  if (p.fc) out.color = hex(first(p.fc, c, 'Animator colors'));
  if (p.sc || p.sw || p.fh || p.fs || p.fb || p.sk) c.notes.add('Some text animator properties (stroke, hue, skew) are left out.');
  return out;
}

function fontWeight(style: string): { weight: number; italic: boolean } {
  const s = style.toLowerCase();
  const weight = /thin|hairline/.test(s)
    ? 100
    : /extra ?light|ultra ?light/.test(s)
      ? 200
      : /light/.test(s)
        ? 300
        : /medium/.test(s)
          ? 500
          : /semi ?bold|demi/.test(s)
            ? 600
            : /extra ?bold|ultra ?bold/.test(s)
              ? 800
              : /black|heavy/.test(s)
                ? 900
                : /bold/.test(s)
                  ? 700
                  : 400;
  return { weight, italic: /italic|oblique/.test(s) };
}

// ---- layers ----

function maskOf(m: J, c: Ctx, shift: number): Mask | null {
  const mode = m.mode === 's' ? 'subtract' : m.mode === 'i' ? 'intersect' : m.mode === 'a' ? 'add' : null;
  if (!mode) {
    if (m.mode !== 'n') c.notes.add('Mask modes other than add, subtract and intersect are drawn as add.');
    if (m.mode === 'n') return null;
  }
  const pt = m.pt as J | undefined;
  const k = pt?.k;
  const animated = Array.isArray(k) && isObj(k[0]) && 't' in (k[0] as J);
  const path = bezier(animated ? arr((k[0] as J).s)[0] : k);
  const morph = animated ? pathKeys({ ty: 'sh', ks: pt }, c, shift) : null;
  if (m.x && numOr((m.x as J).k, 0)) c.notes.add('Mask expansion is left out.');
  return {
    id: uid('m'),
    name: String(m.nm ?? 'Mask'),
    path,
    ...(morph ? { morph } : {}),
    mode: mode ?? 'add',
    inverted: !!m.inv,
    opacity: prop(m.o, c, scalar, 100),
    ...(m.f ? { feather: prop(m.f, c, (r) => r[0] ?? 0, 0) } : {}),
  };
}

function layersOf(list: J[], c: Ctx, shift: number, compW: number, compH: number): Layer[] {
  const byInd = new Map<number, string>();
  const out: (Layer | null)[] = [];
  const parentInd: (number | null)[] = [];
  for (const l of list) {
    const ip = numOr(l.ip, 0);
    const op = numOr(l.op, ip + 1);
    const st = numOr(l.st, 0);
    const start = Math.max(0, (ip - c.ip + shift) / c.fr);
    const end = Math.max(start + 1 / c.fr, (op - c.ip + shift) / c.fr);
    const tr = transform(l.ks, c, shift);
    const b: LayerBase = { ...baseOf(String(l.nm ?? 'Layer'), start, end, tr) };
    if (l.hd === true) b.visible = false;
    const bm = numOr(l.bm, 0);
    if (bm) {
      if (BLENDS[bm]) b.blend = BLENDS[bm];
      else c.notes.add('Some blend modes (color dodge, difference…) are drawn as normal.');
    }
    if (arr(l.ef).length) c.notes.add('After Effects effects are left out (add the Titler’s own in Effects).');
    if (l.tm) c.notes.add('Time remapping is left out.');
    const masks = arr(l.masksProperties)
      .filter(isObj)
      .map((m) => maskOf(m, c, shift))
      .filter((m): m is Mask => !!m);
    if (masks.length) b.masks = masks;
    let layer: Layer | null = null;
    switch (numOr(l.ty, -1)) {
      case 0: {
        const comp = precomp(String(l.refId ?? ''), numOr(l.w, compW), numOr(l.h, compH), c);
        layer = comp ? { ...b, type: 'comp', comp: comp.id, offset: (st - c.ip + shift) / c.fr } : null;
        break;
      }
      case 1: {
        const w = numOr(l.sw, compW);
        const h = numOr(l.sh, compH);
        layer = { ...b, type: 'shape', shape: 'rect', size: { v: [w, h] }, roundness: { v: 0 }, fill: { type: 'solid', color: String(l.sc ?? '#000000').slice(0, 9) }, stroke: null };
        break;
      }
      case 2: {
        const a = c.assets.get(String(l.refId ?? ''));
        const asset = a ? imageAsset(a, c) : null;
        layer = asset ? { ...b, type: 'image', asset: asset.id, size: [asset.width ?? 100, asset.height ?? 100], fit: 'stretch' } : null;
        break;
      }
      case 3:
        layer = { ...b, type: 'null' };
        break;
      case 4: {
        const children = shapeItems(arr(l.shapes).filter(isObj), { fill: null, extraFills: [], fillRule: 'nonzero', stroke: null, trim: null }, start, end, c, shift);
        layer = collapse({ ...b, type: 'group', children });
        break;
      }
      case 5:
        layer = textLayer(l, b, c, shift);
        break;
      default:
        c.notes.add('Some layer kinds (cameras, lights, audio, data) are left out.');
    }
    if (layer && typeof l.ind === 'number') byInd.set(l.ind, layer.id);
    out.push(layer);
    parentInd.push(typeof l.parent === 'number' ? l.parent : null);
  }
  // Parents, and track mattes (the layer above, or the one named by tp).
  for (let n = 0; n < out.length; n++) {
    const layer = out[n];
    if (!layer) continue;
    const pi = parentInd[n];
    if (pi !== null && pi !== undefined && byInd.has(pi)) layer.parent = byInd.get(pi)!;
    const l = list[n]!;
    const tt = numOr(l.tt, 0);
    if (tt) {
      const src = typeof l.tp === 'number' ? byInd.get(l.tp) : out[n - 1]?.id;
      const mode = (['alpha', 'alpha', 'alphaInverted', 'luma', 'lumaInverted'] as const)[tt];
      if (src && mode) layer.matte = { layer: src, mode };
    }
  }
  return out.filter((x): x is Layer => !!x);
}

const isStill = <T extends Value>(p: Prop<T>, v: T) => !('k' in p && p.k) && !p.x && JSON.stringify(p.v) === JSON.stringify(v);
const plain = (tr: Transform) => isStill(tr.anchor, [0, 0]) && isStill(tr.position, [0, 0]) && isStill(tr.scale, [100, 100]) && isStill(tr.rotation, 0) && isStill(tr.opacity, 100);

/** A shape layer that is one shape (After Effects' usual layer > group > rectangle) as that shape. */
function collapse(g: GroupLayer): Layer {
  let children = g.children;
  while (children.length === 1 && children[0]!.type === 'group' && plain(children[0]!.transform) && !children[0]!.masks?.length) children = (children[0] as GroupLayer).children;
  const only = children.length === 1 ? children[0]! : null;
  if (only && only.type === 'shape' && !only.masks?.length) {
    const tr = only.transform;
    const centered = !('k' in tr.anchor && tr.anchor.k) && !('k' in tr.position && tr.position.k) && JSON.stringify(tr.anchor.v) === JSON.stringify(tr.position.v);
    if (centered && isStill(tr.scale, [100, 100]) && isStill(tr.rotation, 0) && isStill(tr.opacity, 100)) {
      const { children: _c, type: _t, ...rest } = g;
      return { ...only, ...rest, name: g.name, type: 'shape', transform: g.transform };
    }
  }
  return { ...g, children };
}

function imageAsset(a: J, c: Ctx): Asset | null {
  const id = `lottie-${String(a.id)}`;
  const have = c.project.assets.find((x) => x.id === id);
  if (have) return have;
  const p = String(a.p ?? '');
  const src = a.e === 1 || p.startsWith('data:') ? p : `${String(a.u ?? '')}${p}`;
  if (!src.startsWith('data:')) c.notes.add('Pictures linked outside the file are kept as links; add them in Project if they do not show.');
  const asset: Asset = { id, name: String(a.nm ?? a.id ?? 'Picture'), kind: p.includes('svg') ? 'svg' : 'image', src, width: numOr(a.w, 100), height: numOr(a.h, 100) };
  c.project.assets.push(asset);
  return asset;
}

function precomp(refId: string, w: number, h: number, c: Ctx): Composition | null {
  const have = c.comps.get(refId);
  if (have) return have;
  const a = c.assets.get(refId);
  if (!a || !Array.isArray(a.layers) || c.depth > 8) return null;
  const main = c.project.compositions[0]!;
  const comp: Composition = {
    id: uid('c'),
    name: String(a.nm ?? refId),
    width: Math.round(numOr(a.w, w)),
    height: Math.round(numOr(a.h, h)),
    fps: main.fps,
    duration: main.duration,
    background: null,
    markers: { inEnd: main.duration, outStart: main.duration, loop: null },
    cues: [],
    layers: [],
  };
  c.comps.set(refId, comp);
  c.depth++;
  // Inside a precomp, time runs from the precomp's own 0 (the layer's offset places it).
  comp.layers = layersOf(a.layers as J[], { ...c, ip: 0 }, 0, comp.width, comp.height);
  c.depth--;
  let last = 0;
  for (const l of comp.layers) last = Math.max(last, l.end);
  comp.duration = Math.max(1 / comp.fps, last);
  comp.markers = { inEnd: comp.duration, outStart: comp.duration, loop: null };
  c.project.compositions.push(comp);
  return comp;
}

/** A Lottie animation as a Titler project. */
export function fromLottie(input: unknown, name = 'Lottie animation'): LottieImport {
  const o = (typeof input === 'string' ? (JSON.parse(input) as unknown) : input) as J;
  if (!isLottie(o)) throw new Error('This is not a Lottie animation (Bodymovin JSON).');
  const fr = numOr(o.fr, 30) || 30;
  const ip = numOr(o.ip, 0);
  const op = numOr(o.op, ip + fr * 5);
  const duration = Math.max(1 / fr, (op - ip) / fr);
  const w = Math.round(numOr(o.w, 1920));
  const h = Math.round(numOr(o.h, 1080));
  const main: Composition = {
    id: uid('c'),
    name: String(o.nm ?? 'Main') || 'Main',
    width: w,
    height: h,
    fps: Math.round(fr * 1000) / 1000,
    duration,
    background: null,
    markers: { inEnd: duration, outStart: duration, loop: null },
    cues: [],
    layers: [],
  };
  const project: TitleProject = {
    format: FORMAT,
    version: VERSION,
    id: uid('p'),
    name: String(o.nm ?? '') || name,
    category: 'Custom',
    main: main.id,
    compositions: [main],
    variables: [],
    tokens: { ...DEFAULT_TOKENS },
    assets: [],
  };
  const fonts = new Map<string, { family: string; weight: number; italic: boolean }>();
  for (const f of arr((o.fonts as J | undefined)?.list).filter(isObj)) {
    const fw = fontWeight(String(f.fStyle ?? ''));
    fonts.set(String(f.fName ?? ''), { family: String(f.fFamily ?? f.fName ?? 'Inter'), ...fw });
  }
  const c: Ctx = {
    fr,
    ip,
    assets: new Map(
      arr(o.assets)
        .filter(isObj)
        .map((a) => [String(a.id), a]),
    ),
    fonts,
    project,
    notes: new Set(),
    comps: new Map(),
    depth: 0,
  };
  main.layers = layersOf(o.layers as J[], c, 0, w, h);
  // Markers named like IN / OUT / loop set the Titler's; others become cue markers.
  for (const m of arr(o.markers).filter(isObj)) {
    const t = (numOr(m.tm, 0) - ip) / fr;
    const d = numOr(m.dr, 0) / fr;
    const nm = String(m.cm ?? '').trim();
    const low = nm.toLowerCase();
    if (/^(in|intro|animate ?in)$/.test(low)) main.markers.inEnd = Math.min(duration, t + d);
    else if (/^(out|outro|animate ?out)$/.test(low)) main.markers.outStart = Math.max(0, t);
    else if (/^(loop|hold)$/.test(low) && d > 0) main.markers.loop = { start: t, end: Math.min(duration, t + d) };
    else main.cues.push({ id: uid('q'), t, name: nm || 'Marker' });
  }
  if (main.markers.outStart < main.markers.inEnd) main.markers.outStart = main.markers.inEnd;
  const notes = [...c.notes];
  if (!arr(o.markers).length) notes.push('It plays through once and holds its last frame; set IN and OUT markers to take it in and out.');
  return { project, notes };
}
