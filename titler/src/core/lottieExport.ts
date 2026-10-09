// A title out as Lottie (Bodymovin JSON), for websites, apps and other
// tools (lottie-web, LottieFiles, After Effects with a Lottie importer, Rive,
// Figma plugins). Fields are filled with their values now; expressions are
// worked out frame by frame; groups and precomps become Lottie precomps;
// wipes become masks; track mattes are placed as Lottie wants them. What
// Lottie cannot draw is listed in `notes`.

import { fill, resolveColor, resolveFont, tokensFor, valuesFor } from './binding';
import { isAnimated, valueAt } from './easing';
import { setExprScope } from './expr';
import { plainText, type Measure } from './layout';
import { rectCornersPath } from './paths';
import { contentSize, exprScopeFor, layerIndex, textLayout } from './render';
import type { BrandTokens, Composition, Keyframe, Layer, Paint, PathData, PathKey, Prop, ShapeLayer, Stroke, TextAnimator, TextLayer, TitleProject, Value, Values, Vec2 } from './types';

type J = Record<string, unknown>;

export interface LottieExportOptions {
  values?: Values;
  brand?: Partial<BrandTokens>;
  /** Measures text (a canvas); a rough measure is used when left out. */
  measure?: Measure;
  /** The composition (the main one when left out). */
  comp?: string;
}

export interface LottieExport {
  json: J;
  notes: string[];
}

interface X {
  p: TitleProject;
  fr: number;
  tokens: BrandTokens;
  values: Values;
  measure: Measure;
  assets: J[];
  fonts: Map<string, J>;
  notes: Set<string>;
  done: Set<string>;
  seq: number;
  /** The layers of the composition being written, by id (boxes following words find their text). */
  index: Map<string, Layer>;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const roughMeasure: Measure = (font, text) => {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  return text.length * px * 0.55;
};

function rgba(color: string): [number, number, number, number] {
  const h = color.replace('#', '');
  const full = h.length === 3 || h.length === 4 ? [...h].map((c) => c + c).join('') : h;
  const n = (k: number) => parseInt(full.slice(k, k + 2), 16) / 255;
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(full)) {
    const m = /rgba?\(([^)]+)\)/.exec(color);
    if (m) {
      const parts = m[1]!.split(',').map((x) => Number(x.trim()));
      return [r3((parts[0] ?? 0) / 255), r3((parts[1] ?? 0) / 255), r3((parts[2] ?? 0) / 255), parts[3] ?? 1];
    }
    return [1, 1, 1, 1];
  }
  return [r3(n(0)), r3(n(2)), r3(n(4)), full.length === 8 ? r3(n(6)) : 1];
}

const color = (x: X, ref: string) => rgba(resolveColor(ref, x.tokens, x.values));

// ---- properties ----

const asArr = (v: Value): number[] => (typeof v === 'number' ? [v] : [v[0], v[1]]);

/** A Titler property as a Lottie one; `map` turns a value into Lottie's numbers. */
function lprop<T extends Value>(x: X, p: Prop<T> | undefined, fallback: T, map: (v: T) => number[] = (v) => asArr(v)): J {
  if (!p) return { a: 0, k: one(map(fallback)) };
  if (p.x && p.x.trim()) {
    // Expressions: the value at every frame where it is worked out.
    x.notes.add('Expressions are written out as a keyframe on every frame.');
    return baked(x, (t) => valueAt(p, t, fallback), map);
  }
  if (!isAnimated(p)) return { a: 0, k: one(map(p.v as T)) };
  const ks = p.k;
  const out: J[] = ks.map((k, n) => {
    const next = ks[n + 1];
    const key: J = { t: r3(k.t * x.fr), s: map(k.v) };
    if (next) {
      const o = k.o ?? [0, 0];
      const i = next.i ?? [1, 1];
      key.o = { x: [r3(o[0])], y: [r3(o[1])] };
      key.i = { x: [r3(i[0])], y: [r3(i[1])] };
      if (k.hold) key.h = 1;
      const kv = k as Keyframe<Vec2>;
      const nv = next as Keyframe<Vec2>;
      if (kv.so || nv.si) {
        key.to = [r3(kv.so?.[0] ?? 0), r3(kv.so?.[1] ?? 0), 0];
        key.ti = [r3(nv.si?.[0] ?? 0), r3(nv.si?.[1] ?? 0), 0];
      }
    }
    return key;
  });
  return { a: 1, k: out };
}

const one = (v: number[]) => (v.length === 1 ? v[0] : v);

function baked<T extends Value>(x: X, at: (t: number) => T, map: (v: T) => number[], from = 0, to?: number): J {
  const comp = x.p.compositions.find((c) => c.id === x.p.main) ?? x.p.compositions[0]!;
  const end = to ?? comp.duration;
  const frames = Math.min(3000, Math.max(1, Math.ceil((end - from) * x.fr)));
  const k: J[] = [];
  for (let f = 0; f <= frames; f++) {
    const t = from + f / x.fr;
    const key: J = { t: r3(t * x.fr), s: map(at(t)) };
    if (f < frames) {
      key.o = { x: [0], y: [0] };
      key.i = { x: [1], y: [1] };
    }
    k.push(key);
  }
  return { a: 1, k };
}

function transform(x: X, l: Layer, anchorShift: Vec2 = [0, 0]): J {
  const tr = l.transform;
  const a = tr.anchor;
  const shifted: Prop<Vec2> =
    anchorShift[0] || anchorShift[1]
      ? isAnimated(a)
        ? { k: a.k.map((k) => ({ ...k, v: [k.v[0] + anchorShift[0], k.v[1] + anchorShift[1]] as Vec2 })), x: a.x }
        : { v: [(a.v as Vec2)[0] + anchorShift[0], (a.v as Vec2)[1] + anchorShift[1]], x: a.x }
      : a;
  const v3 = (v: Vec2) => [r3(v[0]), r3(v[1]), 0];
  const deep: J = {};
  if (tr.rotationX || tr.rotationY || tr.z) {
    x.notes.add('3D layers turn in Lottie players that draw in 3D (the HTML renderer); others draw them flat.');
    deep.rx = lprop(x, tr.rotationX, 0, (v) => [r3(v)]);
    deep.ry = lprop(x, tr.rotationY, 0, (v) => [r3(v)]);
    deep.rz = lprop(x, tr.rotation, 0, (v) => [r3(v)]);
    deep.or = { a: 0, k: [0, 0, 0] };
  }
  return {
    ...deep,
    a: lprop(x, shifted, [0, 0], v3),
    p: lprop(x, tr.position, [0, 0], v3),
    s: lprop(x, tr.scale, [100, 100], (v) => [r3(v[0]), r3(v[1]), 100]),
    r: lprop(x, tr.rotation, 0, (v) => [r3(v)]),
    o: lprop(x, tr.opacity, 100, (v) => [r3(v)]),
  };
}

function lpath(p: PathData): J {
  return {
    i: p.v.map((v) => [r3(v.i?.[0] ?? 0), r3(v.i?.[1] ?? 0)]),
    o: p.v.map((v) => [r3(v.o?.[0] ?? 0), r3(v.o?.[1] ?? 0)]),
    v: p.v.map((v) => [r3(v.p[0]), r3(v.p[1])]),
    c: p.closed,
  };
}

function pathKeysJson(x: X, ks: PathKey[]): J {
  return {
    a: 1,
    k: ks.map((k, n) => {
      const next = ks[n + 1];
      const key: J = { t: r3(k.t * x.fr), s: [lpath(k.v[0]!)] };
      if (next) {
        key.o = { x: [r3(k.o?.[0] ?? 0)], y: [r3(k.o?.[1] ?? 0)] };
        key.i = { x: [r3(next.i?.[0] ?? 1)], y: [r3(next.i?.[1] ?? 1)] };
        if (k.hold) key.h = 1;
      }
      return key;
    }),
  };
}

// ---- shapes ----

function paintItems(x: X, paint: Paint, kind: 'fill' | 'stroke', size: Vec2, extra: J): J {
  if (paint.type === 'solid') {
    const c = color(x, paint.color);
    return { ty: kind === 'fill' ? 'fl' : 'st', c: { a: 0, k: [c[0], c[1], c[2], 1] }, o: { a: 0, k: r3(c[3] * 100) }, ...extra };
  }
  const stops = [...paint.stops].sort((a, b) => a.at - b.at);
  const cols: number[] = [];
  const alphas: number[] = [];
  for (const s of stops) {
    const c = color(x, s.color);
    cols.push(r3(s.at), c[0], c[1], c[2]);
    alphas.push(r3(s.at), c[3]);
  }
  const [w, h] = size;
  let s: number[] = [0, h / 2];
  let e: number[] = [w, h / 2];
  if (paint.type === 'linear') {
    const a = ((paint.angle - 90) * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const half = Math.abs((w / 2) * dx) + Math.abs((h / 2) * dy);
    s = [r3(w / 2 - dx * half), r3(h / 2 - dy * half)];
    e = [r3(w / 2 + dx * half), r3(h / 2 + dy * half)];
  } else {
    s = [w / 2, h / 2];
    e = [w / 2 + Math.max(w, h) / 2, h / 2];
  }
  return {
    ty: kind === 'fill' ? 'gf' : 'gs',
    t: paint.type === 'linear' ? 1 : 2,
    s: { a: 0, k: s },
    e: { a: 0, k: e },
    g: { p: stops.length, k: { a: 0, k: [...cols, ...alphas] } },
    o: { a: 0, k: 100 },
    ...extra,
  };
}

function strokeItem(x: X, st: Stroke, size: Vec2): J {
  if (st.align && st.align !== 'center') x.notes.add('Inside and outside strokes are drawn centered on the outline.');
  const extra: J = {
    w: { a: 0, k: st.width },
    lc: st.cap === 'round' ? 2 : st.cap === 'square' ? 3 : 1,
    lj: st.join === 'round' ? 2 : st.join === 'bevel' ? 3 : 1,
    ml: 4,
  };
  if (st.dash?.length) extra.d = st.dash.map((v, n) => ({ n: n % 2 ? 'g' : 'd', nm: n % 2 ? 'gap' : 'dash', v: { a: 0, k: v } }));
  return paintItems(x, st.paint, 'stroke', size, extra);
}

/** A box that follows a text layer's words: its size and place now (render.ts fittedBox). */
function fitted(x: X, l: ShapeLayer): { dx: number; w: number; h: number } | null {
  const f = l.fitTo;
  const text = f ? x.index.get(f.layer) : undefined;
  if (!f || !text || text.type !== 'text') return null;
  const lay = textLayout(text, x.values, x.tokens, x.measure, x.p.variables, x.p.textStyles);
  const base = contentSize(l, 0, x.p);
  const min = f.min ?? [0, 0];
  const empty = !lay.lines.some((q) => q.glyphs.length);
  const w = empty ? min[0] : Math.max(min[0], lay.width + f.pad[0] * 2);
  const h = f.axis === 'both' ? Math.max(min[1], lay.height + f.pad[1] * 2) : base[1];
  const dx = text.style.align === 'center' ? (base[0] - w) / 2 : text.style.align === 'right' ? base[0] - w : 0;
  return { dx, w, h };
}

function shapeContents(x: X, l: ShapeLayer): J[] {
  const t0 = 0;
  const size = contentSize(l, t0, x.p);
  const items: J[] = [];
  const half = (v: Vec2) => [r3(v[0] / 2), r3(v[1] / 2)];
  const fit = l.fitTo ? fitted(x, l) : null;
  if (fit) {
    // A box following its words: the size it has with the words now.
    x.notes.add('Boxes that follow their words keep the size they have with the words now.');
    if (l.shape === 'rect' && !l.corners)
      items.push({ ty: 'rc', d: 1, s: { a: 0, k: [r3(fit.w), r3(fit.h)] }, p: { a: 0, k: [r3(fit.dx + fit.w / 2), r3(fit.h / 2)] }, r: lprop(x, l.roundness, 0, (v) => [r3(v)]) });
    else if (l.shape === 'ellipse') items.push({ ty: 'el', d: 1, s: { a: 0, k: [r3(fit.w), r3(fit.h)] }, p: { a: 0, k: [r3(fit.dx + fit.w / 2), r3(fit.h / 2)] } });
    else items.push({ ty: 'sh', ks: { a: 0, k: lpath(rectCornersPath(fit.w, fit.h, l.corners ?? [0, 0, 0, 0])) } });
  } else if (l.shape === 'rect' && !l.corners) {
    items.push({ ty: 'rc', d: 1, s: lprop(x, l.size, [100, 100], (v) => [r3(v[0]), r3(v[1])]), p: lprop(x, l.size, [100, 100], half), r: lprop(x, l.roundness, 0, (v) => [r3(v)]) });
  } else if (l.shape === 'ellipse') {
    items.push({ ty: 'el', d: 1, s: lprop(x, l.size, [100, 100], (v) => [r3(v[0]), r3(v[1])]), p: lprop(x, l.size, [100, 100], half) });
  } else if (l.shape === 'rect' && l.corners) {
    items.push({ ty: 'sh', ks: { a: 0, k: lpath(rectCornersPath(size[0], size[1], l.corners)) } });
  } else if (l.morph?.length) {
    const ks = l.morph;
    items.push({ ty: 'sh', ks: pathKeysJson(x, ks) });
    for (let n = 1; n < (ks[0]?.v.length ?? 0); n++) items.push({ ty: 'sh', ks: { a: 0, k: lpath(ks[0]!.v[n]!) } });
  } else if (l.path) {
    items.push({ ty: 'sh', ks: { a: 0, k: lpath(l.path) } });
    for (const sp of l.subpaths ?? []) items.push({ ty: 'sh', ks: { a: 0, k: lpath(sp) } });
  }
  if (l.trim) items.push({ ty: 'tm', s: lprop(x, l.trim.start, 0), e: lprop(x, l.trim.end, 100), o: lprop(x, l.trim.offset, 0, (v) => [r3(v * 3.6)]), m: 1 });
  // Lottie draws the first style item on top: strokes (last one first), then the fill.
  const strokes = [l.stroke, ...(l.extraStrokes ?? [])].filter((s): s is Stroke => !!s && s.width > 0).reverse();
  for (const st of strokes) items.push(strokeItem(x, st, size));
  // Fills drawn over the first come before it (Lottie draws the first style item on top).
  for (const f of [...(l.extraFills ?? [])].reverse()) items.push(paintItems(x, f, 'fill', size, { r: l.fillRule === 'evenodd' ? 2 : 1 }));
  if (l.fill) items.push(paintItems(x, l.fill, 'fill', size, { r: l.fillRule === 'evenodd' ? 2 : 1 }));
  items.push({ ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } });
  return [{ ty: 'gr', nm: l.name, it: items }];
}

// ---- text ----

function fontKey(x: X, family: string, weight: number, italic: boolean): string {
  const style = `${weight >= 700 ? 'Bold' : weight >= 600 ? 'SemiBold' : weight >= 500 ? 'Medium' : weight <= 300 ? 'Light' : 'Regular'}${italic ? ' Italic' : ''}`;
  const key = `${family.replace(/\s+/g, '')}-${style.replace(/\s+/g, '')}`;
  if (!x.fonts.has(key)) x.fonts.set(key, { fName: key, fFamily: family, fStyle: style, ascent: 75 });
  return key;
}

function textData(x: X, l: TextLayer): J {
  const st = l.style;
  if (l.scroll) x.notes.add('Crawls and rolls are left still.');
  if (st.fill.type !== 'solid') x.notes.add('Gradient text is drawn in its first color.');
  if (/\[(b|i|c|s|f|v)[=\]]/.test(l.text)) x.notes.add('Inline styling in text (bold, color…) is drawn plain.');
  const lay = textLayout(l, x.values, x.tokens, x.measure, x.p.variables, x.p.textStyles);
  const words = lay.lines.map((ln) => ln.glyphs.map((g) => g.ch).join('')).join('\r') || plainText(fill(l.text, x.values, x.p.variables));
  const family = resolveFont(st.font, x.tokens);
  const fc = color(x, st.fill.type === 'solid' ? st.fill.color : (st.fill.stops[0]?.color ?? '#ffffff'));
  const size = lay.size;
  const lh = size * st.lineHeight;
  // How far the first line sits below where it would with the words at the top of the box (middle, bottom).
  const firstTop = lay.lines[0] ? lay.lines[0].y - (lh * 0.5 + size * 0.35) : 0;
  const doc: J = {
    s: r3(size),
    f: fontKey(x, family, st.weight, st.italic),
    t: st.caps ? words.toUpperCase() : words,
    j: st.align === 'right' ? 1 : st.align === 'center' ? 2 : st.align === 'justify' ? 3 : 0,
    tr: r3((st.tracking / Math.max(1, size)) * 1000),
    lh: r3(lh),
    ls: 0,
    fc: [fc[0], fc[1], fc[2]],
    sz: [r3(l.box[0]), r3(Math.max(l.box[1], lay.height + size))],
    ps: [0, r3(firstTop)],
  };
  if (st.stroke && st.stroke.width > 0 && st.stroke.paint.type === 'solid') {
    const sc = color(x, st.stroke.paint.color);
    doc.sc = [sc[0], sc[1], sc[2]];
    doc.sw = st.stroke.width * 2;
    doc.of = false;
  }
  return { d: { k: [{ s: doc, t: 0 }] }, p: {}, m: { g: 1, a: { a: 0, k: [0, 0] } }, a: (l.animators ?? []).map((a) => animatorJson(x, a, size)) };
}

const SHAPES = { square: 1, rampUp: 2, rampDown: 3, triangle: 4, smooth: 6 } as const;

/** A Titler text animator as a Lottie range selector and its properties. */
function animatorJson(x: X, a: TextAnimator, size: number): J {
  if (a.blur) x.notes.add('Blur in text animators is left out.');
  if (a.reverse) x.notes.add('Text animators counted from the end run from the start.');
  const props: J = {};
  if (a.opacity) props.o = lprop(x, a.opacity, 100, (v) => [r3(v)]);
  if (a.position) props.p = lprop(x, a.position, [0, 0], (v) => [r3(v[0]), r3(v[1]), 0]);
  if (a.scale) props.s = lprop(x, a.scale, 100, (v) => [r3(v), r3(v), 100]);
  if (a.rotation) props.r = lprop(x, a.rotation, 0, (v) => [r3(v)]);
  if (a.tracking) props.t = lprop(x, a.tracking, 0, (v) => [r3((v / Math.max(1, size)) * 1000)]);
  if (a.color) {
    const c = color(x, a.color);
    props.fc = { a: 0, k: [c[0], c[1], c[2], 1] };
  }
  return {
    nm: a.name,
    s: {
      t: 0,
      xe: { a: 0, k: 0 },
      ne: { a: 0, k: 0 },
      a: { a: 0, k: 100 },
      b: a.by === 'char' ? 2 : a.by === 'word' ? 3 : 4,
      rn: 0,
      sh: SHAPES[a.shape] ?? 1,
      s: lprop(x, a.start, 0, (v) => [r3(v)]),
      e: lprop(x, a.end, 100, (v) => [r3(v)]),
      o: lprop(x, a.offset, 0, (v) => [r3(v)]),
      r: 1,
    },
    a: props,
  };
}

// ---- layers ----

function revealMask(x: X, l: Layer): J | null {
  const rv = l.reveal;
  if (!rv) return null;
  const anim = [rv.left, rv.right, rv.top, rv.bottom].some((p) => isAnimated(p) || p?.x);
  const still = [rv.left, rv.right, rv.top, rv.bottom].every((p) => !isAnimated(p) && !p?.x && !(p as { v?: number } | undefined)?.v);
  if (still) return null;
  const at = (t: number): PathData => {
    const [w0, h0] = contentSize(l, t, x.p);
    const w = w0 || 4000;
    const h = h0 || 1000;
    const L = valueAt(rv.left, t, 0) / 100;
    const R = valueAt(rv.right, t, 0) / 100;
    const T = valueAt(rv.top, t, 0) / 100;
    const B = valueAt(rv.bottom, t, 0) / 100;
    const x0 = w * L;
    const x1 = Math.max(x0, w * (1 - R));
    const y0 = h * T;
    const y1 = Math.max(y0, h * (1 - B));
    return { closed: true, v: [{ p: [x0, y0] }, { p: [x1, y0] }, { p: [x1, y1] }, { p: [x0, y1] }] };
  };
  // A wipe: the box at every frame where it moves (within the layer's time).
  const pt = anim ? bakedPath(x, at, l.start, l.end) : { a: 0, k: lpath(at(l.start)) };
  return { inv: false, mode: 'i', pt, o: { a: 0, k: 100 }, x: { a: 0, k: 0 }, nm: 'Wipe' };
}

function bakedPath(x: X, at: (t: number) => PathData, from: number, to: number): J {
  const frames = Math.min(3000, Math.max(1, Math.ceil((to - from) * x.fr)));
  const k: J[] = [];
  let prev = '';
  for (let f = 0; f <= frames; f++) {
    const t = from + f / x.fr;
    const p = lpath(at(t));
    const s = JSON.stringify(p);
    if (s === prev && f < frames) continue;
    prev = s;
    k.push({ t: r3(t * x.fr), s: [p], o: { x: [0], y: [0] }, i: { x: [1], y: [1] } });
  }
  return k.length > 1 ? { a: 1, k } : { a: 0, k: (k[0]!.s as J[])[0] };
}

const BLEND: Record<string, number> = { normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5, add: 16 };

function layerJson(x: X, l: Layer, ind: number, w: number, h: number): J | null {
  const base: J = {
    ddd: 0,
    ind,
    nm: l.name,
    sr: 1,
    ip: r3(l.start * x.fr),
    op: r3(l.end * x.fr),
    st: 0,
    bm: BLEND[l.blend ?? 'normal'] ?? 0,
  };
  if (!l.visible) base.hd = true;
  if (l.effects?.some((e) => e.on)) x.notes.add('Effects (shadows, glows, blur, color…) are left out.');
  if (l.blur && (isAnimated(l.blur) || (l.blur as { v?: number }).v)) x.notes.add('Layer blur is left out.');
  const masks: J[] = (l.masks ?? []).map((m) => ({
    inv: !!m.inverted,
    mode: m.mode === 'subtract' ? 's' : m.mode === 'intersect' ? 'i' : 'a',
    pt: m.morph?.length ? pathKeysJson(x, m.morph) : { a: 0, k: lpath(m.path) },
    o: lprop(x, m.opacity, 100),
    x: { a: 0, k: 0 },
    ...(m.feather ? { f: lprop(x, m.feather, 0, (v) => [r3(v), r3(v)]) } : {}),
    nm: m.name,
  }));
  const wipe = revealMask(x, l);
  if (wipe) {
    if (!masks.length) wipe.mode = 'a';
    masks.push(wipe);
  }
  if (masks.length) {
    base.hasMask = true;
    base.masksProperties = masks;
  }
  if (l.transform.rotationX || l.transform.rotationY || l.transform.z) base.ddd = 1;
  switch (l.type) {
    case 'null':
      return { ...base, ty: 3, ks: transform(x, l) };
    case 'shape':
      return { ...base, ty: 4, ks: transform(x, l), shapes: shapeContents(x, l) };
    case 'text':
      return { ...base, ty: 5, ks: transform(x, l), t: textData(x, l) };
    case 'image': {
      const filled = fill(l.asset, x.values).trim();
      const asset = x.p.assets.find((a) => a.id === filled);
      const src = asset?.src ?? filled;
      if (!src || src.includes('{{')) return null;
      if (!src.startsWith('data:')) x.notes.add('Pictures that are links (not inside the title) stay links.');
      const iw = asset?.width ?? l.size[0];
      const ih = asset?.height ?? l.size[1];
      let dw = l.size[0];
      let dh = l.size[1];
      if (l.fit !== 'stretch' && iw && ih) {
        const k = l.fit === 'contain' ? Math.min(l.size[0] / iw, l.size[1] / ih) : Math.max(l.size[0] / iw, l.size[1] / ih);
        dw = iw * k;
        dh = ih * k;
        if (l.fit === 'cover' && (dw > l.size[0] + 0.5 || dh > l.size[1] + 0.5)) x.notes.add('Pictures that fill their box are not cropped to it.');
      }
      const id = `image_${x.seq++}`;
      x.assets.push({ id, w: r3(dw), h: r3(dh), u: '', p: src, e: src.startsWith('data:') ? 1 : 0 });
      return { ...base, ty: 2, refId: id, ks: transform(x, l, [-(l.size[0] - dw) / 2, -(l.size[1] - dh) / 2]) };
    }
    case 'video':
      x.notes.add('Videos are left out (Lottie has none).');
      return null;
    case 'group': {
      if (l.combine) x.notes.add('Combined shapes (union, subtract…) are drawn as separate shapes.');
      const id = `group_${l.id}`;
      x.assets.push({ id, nm: l.name, w, h, layers: layersJson(x, l.children, w, h) });
      return { ...base, ty: 0, refId: id, w, h, ks: transform(x, l) };
    }
    case 'comp': {
      const inner = x.p.compositions.find((c) => c.id === l.comp);
      if (!inner) return null;
      // A copy with its own field values gets its own precomp (Lottie has no fields).
      const own = Object.entries(l.values ?? {}).filter(([, v]) => v);
      const id = own.length ? `comp_${inner.id}_${l.id}` : `comp_${inner.id}`;
      if (!x.done.has(id)) {
        x.done.add(id);
        const outer = x.index;
        const outerValues = x.values;
        x.index = layerIndex(inner);
        if (own.length) x.values = { ...outerValues, ...Object.fromEntries(own.map(([k, v]) => [k, fill(v, outerValues)])) };
        x.assets.push({ id, nm: inner.name, w: inner.width, h: inner.height, fr: x.fr, layers: layersJson(x, inner.layers, inner.width, inner.height) });
        x.index = outer;
        x.values = outerValues;
      }
      return { ...base, ty: 0, refId: id, w: inner.width, h: inner.height, st: r3(l.offset * x.fr), ks: transform(x, l) };
    }
  }
}

/** Layers in Lottie's order (top first, like the Titler's), with mattes placed above the layers they cut. */
function layersJson(x: X, layers: Layer[], w: number, h: number): J[] {
  const out: J[] = [];
  const ind = new Map<string, number>();
  let n = 1;
  for (const l of layers) ind.set(l.id, n++);
  const mattes = new Set(layers.map((l) => l.matte?.layer).filter(Boolean) as string[]);
  for (const l of layers) {
    if (mattes.has(l.id) && !l.matte) continue;
    const j = layerJson(x, l, ind.get(l.id)!, w, h);
    if (!j) continue;
    if (l.parent) {
      if (ind.has(l.parent)) j.parent = ind.get(l.parent);
      else x.notes.add('Parents in another group are left out.');
    }
    if (l.matte) {
      const src = layers.find((q) => q.id === l.matte!.layer);
      const mj = src ? layerJson(x, src, n++, w, h) : null;
      if (mj) {
        mj.td = 1;
        if (src?.parent && ind.has(src.parent)) mj.parent = ind.get(src.parent);
        out.push(mj);
        j.tt = { alpha: 1, alphaInverted: 2, luma: 3, lumaInverted: 4 }[l.matte.mode];
      }
    }
    out.push(j);
  }
  return out;
}

/** The title (its main composition, or `opts.comp`) as Lottie JSON. */
export function toLottie(p: TitleProject, opts: LottieExportOptions = {}): LottieExport {
  const comp: Composition = p.compositions.find((c) => c.id === (opts.comp ?? p.main)) ?? p.compositions[0]!;
  const x: X = {
    p,
    fr: comp.fps,
    tokens: tokensFor(p, opts.brand),
    values: valuesFor(p, opts.values),
    measure: opts.measure ?? roughMeasure,
    assets: [],
    fonts: new Map(),
    notes: new Set(),
    done: new Set(),
    seq: 0,
    index: layerIndex(comp),
  };
  if (p.variables.length) x.notes.add('Fields are written in with their values now (Lottie has no fields).');
  const before = setExprScope(exprScopeFor(p));
  let layers: J[];
  try {
    layers = layersJson(x, comp.layers, comp.width, comp.height);
  } finally {
    setExprScope(before);
  }
  const m = comp.markers;
  const markers: J[] = [
    { tm: 0, cm: 'in', dr: r3(m.inEnd * x.fr) },
    { tm: r3(m.outStart * x.fr), cm: 'out', dr: r3((comp.duration - m.outStart) * x.fr) },
  ];
  if (m.loop) markers.push({ tm: r3(m.loop.start * x.fr), cm: 'loop', dr: r3((m.loop.end - m.loop.start) * x.fr) });
  for (const q of comp.cues) markers.push({ tm: r3(q.t * x.fr), cm: q.name, dr: 0 });
  if (comp.background) {
    const c = color(x, comp.background);
    layers.push({
      ddd: 0,
      ind: layers.length + 1,
      ty: 1,
      nm: 'Background',
      sr: 1,
      ks: { a: { a: 0, k: [0, 0, 0] }, p: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: r3(c[3] * 100) } },
      sw: comp.width,
      sh: comp.height,
      sc: '#' + c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join(''),
      ip: 0,
      op: r3(comp.duration * x.fr),
      st: 0,
      bm: 0,
    });
  }
  const json: J = {
    v: '5.12.2',
    fr: x.fr,
    ip: 0,
    op: r3(comp.duration * x.fr),
    w: comp.width,
    h: comp.height,
    nm: p.name,
    ddd: 0,
    assets: x.assets,
    fonts: { list: [...x.fonts.values()] },
    layers,
    markers,
    meta: { g: 'Lumora Titler' },
  };
  return { json, notes: [...x.notes] };
}
