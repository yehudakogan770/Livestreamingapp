// The Titler renderer: draws a composition at a time t with Canvas 2D. Pure
// and deterministic: the same project, time, values and pictures always give
// the same pixels. Used by the designer, Lumora's screens and recordings (and
// the unified engine's overlay renderer), and Lumora Studio's title clips.

import { fill, resolveColor, resolveFont, tokensFor, valuesFor } from './binding';
import { num, vec } from './easing';
import { layoutText, type Glyph, type Measure, type TextLayout } from './layout';
import { IDENTITY, localMatrix, mul, scale as scaleM, type Mat } from './matrix';
import { ellipsePath, rectPath, traceTrimmed, tracePath } from './paths';
import type { Asset, BrandTokens, Composition, Effect, Layer, Paint, PathData, ShapeLayer, TextAnimator, TextLayer, TitleProject, Values, Vec2 } from './types';

/** A 2D canvas context (browser, OffscreenCanvas or a test canvas). */
export type Ctx = CanvasRenderingContext2D;

/** A canvas the renderer can draw a layer into on its own. */
export interface Surface {
  width: number;
  height: number;
  getContext(kind: '2d'): unknown;
}

export interface RenderEnv {
  /** A new canvas (masks, mattes, effects and precomps are drawn on their own first). */
  createCanvas(w: number, h: number): Surface | null;
  /** A picture by its source (data URL, file or URL), ready to draw, or null while it loads. */
  image(src: string): CanvasImageSource | null;
  /** A frame of a video or image sequence at `time` seconds, or null. */
  video?(asset: Asset, time: number): CanvasImageSource | null;
}

export interface RenderOptions {
  /** The composition (the project's main one when left out). */
  comp?: string;
  /** Composition time, seconds. */
  time: number;
  /** Seconds since the graphic was taken (crawls and rolls keep moving through loops); `time` when left out. */
  clock?: number;
  values?: Values;
  brand?: Partial<BrandTokens>;
  env: RenderEnv;
  /** The size drawn at (the composition is scaled to it); its own size when left out. */
  width?: number;
  height?: number;
  /** Layers not drawn (the designer's hidden-while-editing, solo). */
  skip?: (layer: Layer) => boolean;
}

interface Frame {
  project: TitleProject;
  tokens: BrandTokens;
  values: Values;
  env: RenderEnv;
  clock: number;
  skip?: (layer: Layer) => boolean;
  depth: number;
  /** Device pixels per composition pixel (for blur and feather sizes). */
  px: number;
}

const MAX_DEPTH = 6;

/** Draw a composition. The context's transform is left as it was. */
export function renderFrame(ctx: Ctx, project: TitleProject, opts: RenderOptions): void {
  const comp = project.compositions.find((c) => c.id === (opts.comp ?? project.main)) ?? project.compositions[0];
  if (!comp) return;
  const w = opts.width ?? comp.width;
  const h = opts.height ?? comp.height;
  const base: Mat = scaleM(w / comp.width, h / comp.height);
  const f: Frame = {
    project,
    tokens: tokensFor(project, opts.brand),
    values: valuesFor(project, opts.values),
    env: opts.env,
    clock: opts.clock ?? opts.time,
    skip: opts.skip,
    depth: 0,
    px: Math.min(w / comp.width, h / comp.height),
  };
  ctx.save();
  const m0 = ctx.getTransform ? ctx.getTransform() : null;
  const outer: Mat = m0 ? [m0.a, m0.b, m0.c, m0.d, m0.e, m0.f] : IDENTITY;
  drawComp(ctx, comp, opts.time, mul(outer, base), f);
  ctx.restore();
}

/** Every layer of a composition by id (inside groups too). */
export function layerIndex(comp: Composition): Map<string, Layer> {
  const out = new Map<string, Layer>();
  const walk = (list: Layer[]) => {
    for (const l of list) {
      out.set(l.id, l);
      if (l.type === 'group') walk(l.children);
    }
  };
  walk(comp.layers);
  return out;
}

/** The group each layer is in (none for top-level layers). */
export function groupOf(comp: Composition): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (list: Layer[], g: string | null) => {
    for (const l of list) {
      if (g) out.set(l.id, g);
      if (l.type === 'group') walk(l.children, l.id);
    }
  };
  walk(comp.layers, null);
  return out;
}

/** A layer's matrix in composition space: its parents' (and groups') then its own. */
export function worldMatrix(comp: Composition, layer: Layer, t: number, index = layerIndex(comp), groups = groupOf(comp)): Mat {
  let m = ownMatrix(layer, t);
  const seen = new Set([layer.id]);
  let cur: Layer | undefined = layer;
  while (cur) {
    const pid: string | undefined = cur.parent ?? groups.get(cur.id);
    const p: Layer | undefined = pid ? index.get(pid) : undefined;
    if (!p || seen.has(p.id)) break;
    seen.add(p.id);
    m = mul(ownMatrix(p, t), m);
    cur = p;
  }
  return m;
}

export function ownMatrix(layer: Layer, t: number): Mat {
  const tr = layer.transform;
  return localMatrix(vec(tr.anchor, t, [0, 0]), vec(tr.position, t, [0, 0]), vec(tr.scale, t, [100, 100]), num(tr.rotation, t, 0));
}

/** Layers other layers use as their track matte (not drawn on their own). */
function matteSources(comp: Composition): Set<string> {
  const out = new Set<string>();
  for (const l of layerIndex(comp).values()) if (l.matte?.layer) out.add(l.matte.layer);
  return out;
}

const active = (l: Layer, t: number) => l.visible && t >= l.start && t < l.end;

function drawComp(ctx: Ctx, comp: Composition, t: number, base: Mat, f: Frame) {
  if (comp.background) {
    const bg = resolveColor(comp.background, f.tokens, f.values, 'transparent');
    ctx.save();
    setMatrix(ctx, base);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, comp.width, comp.height);
    ctx.restore();
  }
  const index = layerIndex(comp);
  const groups = groupOf(comp);
  const mattes = matteSources(comp);
  const scene: Scene = { comp, t, base, f, index, groups, mattes };
  drawList(ctx, comp.layers, 1, scene);
}

interface Scene {
  comp: Composition;
  t: number;
  base: Mat;
  f: Frame;
  index: Map<string, Layer>;
  groups: Map<string, string>;
  mattes: Set<string>;
}

function drawList(ctx: Ctx, layers: Layer[], alpha: number, s: Scene) {
  for (let n = layers.length - 1; n >= 0; n--) {
    const l = layers[n]!;
    if (!active(l, s.t) || s.mattes.has(l.id) || s.f.skip?.(l)) continue;
    drawLayer(ctx, l, alpha, s);
  }
}

function setMatrix(ctx: Ctx, m: Mat) {
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
}

function effectsOn(l: Layer): Effect[] {
  return (l.effects ?? []).filter((e) => e.on);
}

function needsOwnCanvas(l: Layer): boolean {
  return !!(l.masks?.length || l.matte || effectsOn(l).length || (l.blend && l.blend !== 'normal' && l.type === 'group'));
}

const BLEND: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  add: 'lighter',
};

function drawLayer(ctx: Ctx, l: Layer, alpha: number, s: Scene) {
  if (l.type === 'null') return;
  const t = s.t;
  const opacity = (alpha * Math.max(0, Math.min(100, num(l.transform.opacity, t, 100)))) / 100;
  if (opacity <= 0.0005) return;
  const world = mul(s.base, worldMatrix(s.comp, l, t, s.index, s.groups));
  if (!needsOwnCanvas(l)) {
    ctx.save();
    ctx.globalAlpha = opacity;
    if (l.blend && l.blend !== 'normal') ctx.globalCompositeOperation = BLEND[l.blend] ?? 'source-over';
    const blur = num(l.blur, t, 0) * s.f.px;
    if (blur > 0.05) ctx.filter = `blur(${round(blur)}px)`;
    drawContent(ctx, l, world, opacity, s);
    ctx.restore();
    return;
  }
  // On its own canvas first: masks, the matte and effects, then onto the picture.
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const surf = s.f.env.createCanvas(cw, ch);
  const own = surf?.getContext('2d') as Ctx | null;
  if (!surf || !own) {
    ctx.save();
    ctx.globalAlpha = opacity;
    drawContent(ctx, l, world, opacity, s);
    ctx.restore();
    return;
  }
  own.save();
  const blur = num(l.blur, t, 0) * s.f.px;
  if (blur > 0.05) own.filter = `blur(${round(blur)}px)`;
  drawContent(own, l, world, 1, s);
  own.restore();
  if (l.masks?.length) applyMasks(own, l, world, s);
  if (l.matte) applyMatte(own, l, s);
  const fx = effectsOn(l);
  for (const e of fx) if (e.type === 'blur') blurCanvas(own, num(e.amount, t, 0) * s.f.px, s);
  for (const e of fx) if (e.type === 'fill') tintCanvas(own, resolveColor(e.color, s.f.tokens, s.f.values));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = opacity;
  if (l.blend && l.blend !== 'normal') ctx.globalCompositeOperation = BLEND[l.blend] ?? 'source-over';
  for (const e of fx) {
    if (e.type !== 'dropShadow' && e.type !== 'glow') continue;
    // The layer's shape in the effect's color, softened, drawn under it.
    const tint = s.f.env.createCanvas(cw, ch);
    const tc = tint?.getContext('2d') as Ctx | null;
    if (!tint || !tc) continue;
    tc.drawImage(surf as CanvasImageSource, 0, 0);
    tintCanvas(tc, resolveColor(e.color, s.f.tokens, s.f.values, e.type === 'glow' ? '#ffffff' : '#000000'));
    const soft = (e.type === 'dropShadow' ? num(e.softness, t, 10) : num(e.radius, t, 12)) * s.f.px;
    const dist = e.type === 'dropShadow' ? num(e.distance, t, 6) * s.f.px : 0;
    const ang = e.type === 'dropShadow' ? (e.angle * Math.PI) / 180 : 0;
    ctx.save();
    ctx.globalAlpha = opacity * (num(e.opacity, t, e.type === 'glow' ? 50 : 60) / 100);
    if (soft > 0.05) ctx.filter = `blur(${round(soft / 2)}px)`;
    ctx.drawImage(tint as CanvasImageSource, Math.cos(ang) * dist, Math.sin(ang) * dist);
    ctx.restore();
  }
  ctx.drawImage(surf as CanvasImageSource, 0, 0);
  ctx.restore();
}

function blurCanvas(c: Ctx, amount: number, s: Scene) {
  if (amount <= 0.05) return;
  const copy = s.f.env.createCanvas(c.canvas.width, c.canvas.height);
  const cc = copy?.getContext('2d') as Ctx | null;
  if (!copy || !cc) return;
  cc.drawImage(c.canvas as CanvasImageSource, 0, 0);
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  c.filter = `blur(${round(amount)}px)`;
  c.drawImage(copy as CanvasImageSource, 0, 0);
  c.restore();
}

function tintCanvas(c: Ctx, color: string) {
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = color;
  c.fillRect(0, 0, c.canvas.width, c.canvas.height);
  c.restore();
}

function applyMasks(c: Ctx, l: Layer, world: Mat, s: Scene) {
  const masks = l.masks ?? [];
  const surf = s.f.env.createCanvas(c.canvas.width, c.canvas.height);
  const m = surf?.getContext('2d') as Ctx | null;
  if (!surf || !m) return;
  const W = c.canvas.width;
  const H = c.canvas.height;
  const first = masks[0]!;
  if (first.mode !== 'add') {
    m.fillStyle = '#000';
    m.fillRect(0, 0, W, H);
  }
  for (const mask of masks) {
    m.save();
    m.globalAlpha = Math.max(0, Math.min(1, num(mask.opacity, s.t, 100) / 100));
    m.globalCompositeOperation = mask.mode === 'add' ? 'source-over' : mask.mode === 'subtract' ? 'destination-out' : 'destination-in';
    const feather = num(mask.feather, s.t, 0) * s.f.px;
    if (feather > 0.05) m.filter = `blur(${round(feather / 2)}px)`;
    m.fillStyle = '#000';
    m.beginPath();
    if (mask.inverted) {
      m.setTransform(1, 0, 0, 1, 0, 0);
      m.rect(-W, -H, W * 3, H * 3);
    }
    setMatrix(m, world);
    tracePath(m, mask.path);
    m.fill(mask.inverted ? 'evenodd' : 'nonzero');
    m.restore();
  }
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(surf as CanvasImageSource, 0, 0);
  c.restore();
}

function applyMatte(c: Ctx, l: Layer, s: Scene) {
  const src = l.matte ? s.index.get(l.matte.layer) : undefined;
  const W = c.canvas.width;
  const H = c.canvas.height;
  const surf = s.f.env.createCanvas(W, H);
  const m = surf?.getContext('2d') as Ctx | null;
  if (!surf || !m || !l.matte) return;
  if (src && src.visible && s.t >= src.start && s.t < src.end) drawLayer(m, src, 1, { ...s, mattes: new Set() });
  const mode = l.matte.mode;
  if (mode === 'luma' || mode === 'lumaInverted') {
    const img = m.getImageData(0, 0, W, H);
    const d = img.data;
    for (let k = 0; k < d.length; k += 4) {
      const a = d[k + 3]! / 255;
      const luma = a > 0 ? (0.2126 * d[k]! + 0.7152 * d[k + 1]! + 0.0722 * d[k + 2]!) / a / 255 : 0;
      const v = mode === 'luma' ? luma * a : 1 - luma * a;
      d[k] = d[k + 1] = d[k + 2] = 0;
      d[k + 3] = Math.round(Math.max(0, Math.min(1, v)) * 255);
    }
    m.putImageData(img, 0, 0);
  }
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = mode === 'alphaInverted' ? 'destination-out' : 'destination-in';
  c.drawImage(surf as CanvasImageSource, 0, 0);
  c.restore();
}

/** The box a layer's content fills, layer space (for reveals, hit tests and handles). */
export function contentSize(l: Layer, t: number, project?: TitleProject): Vec2 {
  switch (l.type) {
    case 'text':
      return l.box;
    case 'shape':
      if (l.shape === 'path' && l.path) {
        let x1 = 0;
        let y1 = 0;
        for (const v of l.path.v) {
          x1 = Math.max(x1, v.p[0]);
          y1 = Math.max(y1, v.p[1]);
        }
        return [x1, y1];
      }
      return vec(l.size, t, [100, 100]);
    case 'image':
    case 'video':
      return l.size;
    case 'comp': {
      const c = project?.compositions.find((x) => x.id === l.comp);
      return c ? [c.width, c.height] : [0, 0];
    }
    default:
      return [0, 0];
  }
}

function drawContent(ctx: Ctx, l: Layer, world: Mat, alpha: number, s: Scene) {
  if (l.type === 'group') {
    drawList(ctx, l.children, alpha, s);
    return;
  }
  setMatrix(ctx, world);
  const t = s.t;
  let size = contentSize(l, t, s.f.project);
  if (l.type === 'shape' && l.fitTo) {
    const fit = fittedBox(ctx, l, s);
    if (fit) {
      ctx.translate(fit.dx, 0);
      size = [fit.w, fit.h];
    }
  }
  if (l.reveal) {
    const L = num(l.reveal.left, t, 0) / 100;
    const R = num(l.reveal.right, t, 0) / 100;
    const T = num(l.reveal.top, t, 0) / 100;
    const B = num(l.reveal.bottom, t, 0) / 100;
    if (L + R >= 1 || T + B >= 1) return;
    if (L || R || T || B) {
      // A reveal on a text box with no size clips to a generous area around it.
      const w = size[0] || 4000;
      const h = size[1] || 1000;
      ctx.beginPath();
      ctx.rect(w * L, h * T, w * (1 - L - R), h * (1 - T - B));
      ctx.clip();
    }
  }
  switch (l.type) {
    case 'shape':
      drawShape(ctx, l, size, s);
      break;
    case 'text':
      drawText(ctx, l, s);
      break;
    case 'image': {
      const src = imageSource(l.asset, s);
      const img = src ? s.f.env.image(src) : null;
      if (img) drawFitted(ctx, img, l.size, l.fit);
      break;
    }
    case 'video': {
      const asset = s.f.project.assets.find((a) => a.id === l.asset);
      if (asset && s.f.env.video) {
        let vt = t - l.start + l.offset;
        const len = asset.frames?.length && asset.fps ? asset.frames.length / asset.fps : 0;
        if (l.loop && len > 0) vt %= len;
        const frame = s.f.env.video(asset, vt);
        if (frame) drawFitted(ctx, frame, l.size, l.fit);
      }
      break;
    }
    case 'comp': {
      const inner = s.f.project.compositions.find((c) => c.id === l.comp);
      if (!inner || s.f.depth >= MAX_DEPTH) break;
      const f2: Frame = { ...s.f, depth: s.f.depth + 1 };
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, inner.width, inner.height);
      ctx.clip();
      drawComp(ctx, inner, t - l.offset, world, f2);
      ctx.restore();
      break;
    }
  }
}

/** An image layer's picture: an asset id, a {{variable}} or a source as it is. */
function imageSource(ref: string, s: Scene): string | null {
  const filled = fill(ref, s.f.values).trim();
  if (!filled || filled.includes('{{')) return null;
  const asset = s.f.project.assets.find((a) => a.id === filled);
  return asset ? asset.src : filled;
}

function drawFitted(ctx: Ctx, img: CanvasImageSource, box: Vec2, fit: 'contain' | 'cover' | 'stretch') {
  const anyImg = img as { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number };
  const iw = anyImg.naturalWidth || anyImg.videoWidth || (anyImg.width as number) || 0;
  const ih = anyImg.naturalHeight || anyImg.videoHeight || (anyImg.height as number) || 0;
  if (!iw || !ih) return;
  if (fit === 'stretch') {
    ctx.drawImage(img, 0, 0, box[0], box[1]);
    return;
  }
  const k = fit === 'contain' ? Math.min(box[0] / iw, box[1] / ih) : Math.max(box[0] / iw, box[1] / ih);
  const dw = iw * k;
  const dh = ih * k;
  if (fit === 'cover') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, box[0], box[1]);
    ctx.clip();
  }
  ctx.drawImage(img, (box[0] - dw) / 2, (box[1] - dh) / 2, dw, dh);
  if (fit === 'cover') ctx.restore();
}

function paintStyle(ctx: Ctx, p: Paint, w: number, h: number, s: Scene): string | CanvasGradient {
  const color = (c: string) => resolveColor(c, s.f.tokens, s.f.values);
  if (p.type === 'solid') return color(p.color);
  const stops = [...p.stops].sort((a, b) => a.at - b.at);
  let g: CanvasGradient;
  if (p.type === 'linear') {
    const a = ((p.angle - 90) * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const half = Math.abs((w / 2) * dx) + Math.abs((h / 2) * dy);
    g = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
  } else g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2);
  for (const st of stops) g.addColorStop(Math.max(0, Math.min(1, st.at)), color(st.color));
  return g;
}

export function shapePath(l: ShapeLayer, t: number, size?: Vec2): PathData {
  if (l.shape === 'path') return l.path ?? { closed: false, v: [] };
  const [w, h] = size ?? vec(l.size, t, [100, 100]);
  return l.shape === 'ellipse' ? ellipsePath(w, h) : rectPath(w, h, num(l.roundness, t, 0));
}

function drawShape(ctx: Ctx, l: ShapeLayer, size: Vec2, s: Scene) {
  const t = s.t;
  const path = shapePath(l, t, l.fitTo ? size : undefined);
  const trim = l.trim;
  const ts = trim ? num(trim.start, t, 0) : 0;
  const te = trim ? num(trim.end, t, 100) : 100;
  const to = trim ? num(trim.offset, t, 0) : 0;
  const trimmed = !!trim && (Math.abs(te - ts) < 100 || to !== 0);
  if (l.fill && !trimmed) {
    ctx.beginPath();
    tracePath(ctx, path);
    ctx.fillStyle = paintStyle(ctx, l.fill, size[0], size[1], s);
    ctx.fill();
  }
  if (l.stroke && l.stroke.width > 0) {
    ctx.beginPath();
    if (trimmed) traceTrimmed(ctx, path, ts, te, to);
    else tracePath(ctx, path);
    ctx.strokeStyle = paintStyle(ctx, l.stroke.paint, size[0], size[1], s);
    ctx.lineWidth = l.stroke.width;
    ctx.lineJoin = l.stroke.join ?? 'miter';
    ctx.lineCap = l.stroke.cap ?? 'butt';
    if (l.stroke.dash?.length) ctx.setLineDash(l.stroke.dash);
    ctx.stroke();
  }
}

/** A box following a text layer's words: its width (and height), and how far it moves to stay aligned. */
export function fittedBox(
  ctx: Ctx,
  l: ShapeLayer,
  s: { t: number; f: { values: Values; tokens: BrandTokens; project: TitleProject }; index: Map<string, Layer> },
): { dx: number; w: number; h: number } | null {
  const fit = l.fitTo;
  const text = fit ? s.index.get(fit.layer) : undefined;
  if (!fit || !text || text.type !== 'text') return null;
  const lay = textLayout(text, s.f.values, s.f.tokens, canvasMeasure(ctx), s.f.project.variables);
  const base = vec(l.size, s.t, [100, 100]);
  const min = fit.min ?? [0, 0];
  const empty = !lay.lines.some((x) => x.glyphs.length);
  const w = empty ? min[0] : Math.max(min[0], lay.width + fit.pad[0] * 2);
  const h = fit.axis === 'both' ? Math.max(min[1], lay.height + fit.pad[1] * 2) : base[1];
  const align = text.style.align;
  const dx = align === 'center' ? (base[0] - w) / 2 : align === 'right' ? base[0] - w : 0;
  return { dx, w, h };
}

// ---- text ----

const layoutCache = new Map<string, TextLayout>();

/** The layout of a text layer's words (cached; the same inputs give the same layout). */
export function textLayout(l: TextLayer, values: Values, tokens: BrandTokens, measure: Measure, vars?: TitleProject['variables']): TextLayout {
  const text = fill(l.text, values, vars);
  const family = resolveFont(l.style.font, tokens);
  const key = JSON.stringify([text, l.style, family, l.box, l.wrap, l.fit, l.minSize, l.maxLines]);
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const out = layoutText(text, l.style, family, { w: l.box[0], h: l.box[1], wrap: l.wrap, fit: l.fit, minSize: l.minSize, maxLines: l.maxLines }, measure);
  if (layoutCache.size > 400) layoutCache.clear();
  layoutCache.set(key, out);
  return out;
}

/** Measure with a canvas context (fonts as the canvas has them). */
export function canvasMeasure(ctx: Ctx): Measure {
  return (font, text) => {
    if (!text) return 0;
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

/** How much of a unit (0–1) an animator's range selects. */
export function selection(a: TextAnimator, unit: number, count: number, t: number): number {
  if (count <= 0) return 0;
  const u = a.reverse ? count - 1 - unit : unit;
  const off = num(a.offset, t, 0);
  let lo = (num(a.start, t, 0) + off) / 100;
  let hi = (num(a.end, t, 100) + off) / 100;
  if (lo > hi) [lo, hi] = [hi, lo];
  const u0 = u / count;
  const u1 = (u + 1) / count;
  if (a.shape === 'square') {
    const overlap = Math.max(0, Math.min(u1, hi) - Math.max(u0, lo));
    return overlap / (u1 - u0);
  }
  const c = (u0 + u1) / 2;
  if (c < lo || c > hi || hi - lo <= 0) return 0;
  const f = (c - lo) / (hi - lo);
  switch (a.shape) {
    case 'rampUp':
      return f;
    case 'rampDown':
      return 1 - f;
    case 'triangle':
      return 1 - Math.abs(2 * f - 1);
    case 'smooth':
      return 0.5 - 0.5 * Math.cos(2 * Math.PI * f);
  }
  return 0;
}

interface GlyphLook {
  alpha: number;
  dx: number;
  dy: number;
  scale: number;
  rot: number;
  blur: number;
  track: number;
  color: string | null;
}

function glyphLook(g: Glyph, l: TextLayer, lay: TextLayout, t: number, indexInLine: number): GlyphLook {
  const look: GlyphLook = { alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, blur: 0, track: 0, color: null };
  for (const a of l.animators ?? []) {
    const unit = a.by === 'char' ? g.char : a.by === 'word' ? g.word : g.line;
    if (unit < 0 && a.by !== 'line') {
      // Spaces follow the letter before them (they draw nothing).
      continue;
    }
    const amt = selection(a, unit, lay.counts[a.by], t);
    if (amt <= 0) continue;
    if (a.opacity) look.alpha *= 1 + (num(a.opacity, t, 100) / 100 - 1) * amt;
    if (a.position) {
      const p = vec(a.position, t, [0, 0]);
      look.dx += p[0] * amt;
      look.dy += p[1] * amt;
    }
    if (a.scale) look.scale *= 1 + (num(a.scale, t, 100) / 100 - 1) * amt;
    if (a.rotation) look.rot += num(a.rotation, t, 0) * amt;
    if (a.blur) look.blur += num(a.blur, t, 0) * amt;
    if (a.tracking) look.track += num(a.tracking, t, 0) * amt * indexInLine;
    if (a.color && amt >= 0.5) look.color = a.color;
  }
  return look;
}

function drawText(ctx: Ctx, l: TextLayer, s: Scene) {
  const t = s.t;
  const f = s.f;
  const lay = textLayout(l, f.values, f.tokens, canvasMeasure(ctx), f.project.variables);
  const st = l.style;
  const family = resolveFont(st.font, f.tokens);
  const bw = l.box[0] || lay.width;
  const bh = l.box[1] || lay.height;
  const fillFor = (color: string | null) => (color ? resolveColor(color, f.tokens, f.values) : paintStyle(ctx, st.fill, bw, bh, s));
  const baseFill = fillFor(null);
  const stroke = st.stroke && st.stroke.width > 0 ? st.stroke : null;
  const strokeStyle = stroke ? paintStyle(ctx, stroke.paint, bw, bh, s) : null;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const animated = !!l.animators?.length;
  // Tabular figures, no kerning and justified lines are placed letter by letter.
  const perGlyph = st.figures === 'tabular' || st.kerning === 'none' || st.align === 'justify';
  const up = (g: Glyph) => (g.style.shift ? (g.style.shift / 100) * lay.size : 0);

  const scroll = l.scroll;
  if (scroll && scroll.speed > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, bw, bh);
    ctx.clip();
    // Copy k of the words enters from the far edge of the box at clock·speed = k·span.
    const moved = Math.max(0, f.clock) * scroll.speed;
    const crawl = scroll.mode === 'crawl';
    const extent = crawl ? lay.width : lay.height;
    const span = Math.max(1, extent + Math.max(0, scroll.gap));
    const edge = crawl ? bw : bh;
    const first = Math.max(0, Math.floor((moved - edge - extent) / span));
    const top = lay.lines[0] ? lay.lines[0].y - lay.size * st.lineHeight * 0.5 - lay.size * 0.35 : 0;
    for (let k = first; k < first + 200; k++) {
      const at = edge - moved + k * span;
      if (at >= edge) break;
      if (crawl) drawLines(at - (lay.lines[0]?.x ?? 0), 0);
      else drawLines(0, at - top);
    }
    ctx.restore();
    return;
  }
  drawLines(0, 0);

  function drawLines(ox: number, oy: number) {
    for (const line of lay.lines) {
      if (!animated && !st.rtl && st.tracking === 0 && !perGlyph) {
        // Whole runs at once (fast; keeps the font's kerning and shaping).
        let k = 0;
        while (k < line.glyphs.length) {
          const g0 = line.glyphs[k]!;
          let text = '';
          let j = k;
          while (j < line.glyphs.length && line.glyphs[j]!.style === g0.style) text += line.glyphs[j++]!.ch;
          ctx.font = fontFor(g0);
          const x = ox + line.x + g0.x;
          const y = oy + line.y - up(g0);
          if (stroke && strokeStyle) strokeIt(text, x, y);
          ctx.fillStyle = g0.style.color ? fillFor(g0.style.color) : baseFill;
          ctx.fillText(text, x, y);
          k = j;
        }
        continue;
      }
      if (st.rtl) {
        // Right to left: each line drawn whole (the browser orders the letters).
        ctx.save();
        ctx.direction = 'rtl';
        ctx.textAlign = 'right';
        const text = line.glyphs.map((g) => g.ch).join('');
        const g0 = line.glyphs[0];
        if (g0) {
          ctx.font = fontFor(g0);
          const look = animated ? glyphLook(g0, l, lay, t, 0) : null;
          if (look) ctx.globalAlpha *= Math.max(0, look.alpha);
          const x = ox + bw - line.x + (look?.dx ?? 0);
          const y = oy + line.y + (look?.dy ?? 0);
          if (stroke && strokeStyle) strokeIt(text, x, y);
          ctx.fillStyle = baseFill;
          ctx.fillText(text, x, y);
        }
        ctx.restore();
        continue;
      }
      let i = 0;
      for (const g of line.glyphs) {
        if (g.ch === ' ') {
          i++;
          continue;
        }
        const look = animated ? glyphLook(g, l, lay, t, i) : null;
        i++;
        if (look && look.alpha <= 0.002) continue;
        ctx.font = fontFor(g);
        const x = ox + line.x + g.x + (g.ox ?? 0) + (look ? look.dx + look.track : 0);
        const y = oy + line.y - up(g) + (look ? look.dy : 0);
        const color = look?.color ?? g.style.color;
        const fs = color ? fillFor(color) : baseFill;
        if (look && (look.alpha < 1 || look.scale !== 1 || look.rot || look.blur > 0.05)) {
          ctx.save();
          ctx.globalAlpha *= Math.max(0, Math.min(1, look.alpha));
          if (look.blur > 0.05) ctx.filter = `blur(${round(look.blur * f.px)}px)`;
          const cx = x + g.w / 2;
          ctx.translate(cx, y);
          if (look.rot) ctx.rotate((look.rot * Math.PI) / 180);
          if (look.scale !== 1) ctx.scale(look.scale, look.scale);
          if (stroke && strokeStyle) strokeIt(g.ch, -g.w / 2, 0);
          ctx.fillStyle = fs;
          ctx.fillText(g.ch, -g.w / 2, 0);
          ctx.restore();
        } else {
          if (stroke && strokeStyle) strokeIt(g.ch, x, y);
          ctx.fillStyle = fs;
          ctx.fillText(g.ch, x, y);
        }
      }
    }
  }

  function fontFor(g: Glyph): string {
    const run = g.style;
    const weight = run.bold ? Math.max(700, st.weight) : st.weight;
    const italic = run.italic || st.italic ? 'italic ' : '';
    const px = (lay.size * run.scale) / 100;
    return `${italic}${weight} ${round(px)}px "${run.font ?? family}", "Inter", "Segoe UI", system-ui, sans-serif`;
  }

  function strokeIt(text: string, x: number, y: number) {
    if (!stroke || !strokeStyle) return;
    ctx.save();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = stroke.width * 2;
    ctx.lineJoin = stroke.join ?? 'round';
    ctx.strokeText(text, x, y);
    ctx.restore();
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
