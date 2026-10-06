// Auto color match: make one clip's colors look like a reference clip's. The
// pictures' statistics are compared in CIE Lab (a perceptual space: lightness
// and two color axes), and the change that moves one onto the other (each
// axis's average and spread, or its whole histogram for lightness) is written
// as an ordinary grade node, a saturation amount and three color curves, so
// it can be seen and tweaked on the Color page like any other node.
import { changeGrade, addSerial, allNodes, newNode, gradeAt, shownGrade, updateNode, type Grade, type GradeNode, type NodeNow } from '../model/grade';
import type { Clip } from '../model/types';
import { basicPx, gradePx, nodeUniforms, planGrade, type RGB } from '../render/grade';
import type { CurvePoints } from '../render/color';

export type Lab = [number, number, number];

// ---- sRGB ↔ Lab (D65) ----

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
const WHITE: RGB = [0.95047, 1, 1.08883];
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
const fInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

export function rgbToLab(c: RGB): Lab {
  const r = toLinear(Math.max(0, Math.min(1, c[0])));
  const g = toLinear(Math.max(0, Math.min(1, c[1])));
  const b = toLinear(Math.max(0, Math.min(1, c[2])));
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WHITE[0];
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / WHITE[1];
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / WHITE[2];
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb([L, a, bb]: Lab): RGB {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;
  const x = fInv(fx) * WHITE[0];
  const y = fInv(fy) * WHITE[1];
  const z = fInv(fz) * WHITE[2];
  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const g = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const b = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [toGamma(r), toGamma(g), toGamma(b)].map((v) => Math.max(0, Math.min(1, v))) as RGB;
}

// ---- Statistics ----

/** Pixels looked at: colors 0–1, with how much each one counts (skin can count more). */
export interface Pixels {
  rgb: Float32Array;
  weight: Float32Array;
  /** 1 where the pixel is skin (of a person), else 0. */
  skin: Uint8Array;
  /** Where each pixel is (0–1 across and down), for windows in a grade. */
  uv: Float32Array;
}

export function makePixels(n: number): Pixels {
  return { rgb: new Float32Array(n * 3), weight: new Float32Array(n).fill(1), skin: new Uint8Array(n), uv: new Float32Array(n * 2).fill(0.5) };
}

export const pixelCount = (p: Pixels): number => p.weight.length;

export function joinPixels(list: Pixels[]): Pixels {
  const n = list.reduce((a, p) => a + pixelCount(p), 0);
  const out = makePixels(n);
  let o = 0;
  for (const p of list) {
    out.rgb.set(p.rgb, o * 3);
    out.weight.set(p.weight, o);
    out.skin.set(p.skin, o);
    out.uv.set(p.uv, o * 2);
    o += pixelCount(p);
  }
  return out;
}

export interface LabStats {
  mean: Lab;
  std: Lab;
  /** Lightness at 0, 1, …, 100 percent of the pixels (for histogram matching). */
  quantiles: Float32Array;
  /** Average chroma (how colorful). */
  chroma: number;
  count: number;
}

export const QUANTILES = 101;

/** Each Lab axis's weighted mean and spread, and the lightness histogram (as quantiles). */
export function labStats(p: Pixels, only?: (i: number) => boolean): LabStats {
  const n = pixelCount(p);
  const labs: Lab[] = [];
  const ws: number[] = [];
  for (let i = 0; i < n; i++) {
    if (only && !only(i)) continue;
    const w = p.weight[i] as number;
    if (w <= 0) continue;
    labs.push(rgbToLab([p.rgb[i * 3] as number, p.rgb[i * 3 + 1] as number, p.rgb[i * 3 + 2] as number]));
    ws.push(w);
  }
  const total = ws.reduce((a, b) => a + b, 0) || 1;
  const mean: Lab = [0, 0, 0];
  let chroma = 0;
  labs.forEach((l, i) => {
    const w = ws[i] as number;
    for (let k = 0; k < 3; k++) mean[k] = (mean[k] as number) + (l[k] as number) * w;
    chroma += Math.hypot(l[1], l[2]) * w;
  });
  for (let k = 0; k < 3; k++) mean[k] = (mean[k] as number) / total;
  const std: Lab = [0, 0, 0];
  labs.forEach((l, i) => {
    const w = ws[i] as number;
    for (let k = 0; k < 3; k++) std[k] = (std[k] as number) + ((l[k] as number) - (mean[k] as number)) ** 2 * w;
  });
  for (let k = 0; k < 3; k++) std[k] = Math.sqrt((std[k] as number) / total);
  // Weighted lightness quantiles.
  const order = labs.map((l, i) => [l[0], ws[i] as number] as const).sort((a, b) => a[0] - b[0]);
  const quantiles = new Float32Array(QUANTILES);
  let acc = 0;
  let j = 0;
  for (let q = 0; q < QUANTILES; q++) {
    const want = (q / (QUANTILES - 1)) * total;
    while (j < order.length - 1 && acc + (order[j]?.[1] ?? 0) < want) acc += order[j++]?.[1] ?? 0;
    quantiles[q] = order[j]?.[0] ?? 0;
  }
  return { mean, std, quantiles, chroma: chroma / total, count: labs.length };
}

// ---- The transfer ----

export interface MatchOptions {
  /** Match the whole lightness histogram (not only its average and spread). */
  histogram: boolean;
  /** Skin tones count more, and are pulled toward the reference's skin. */
  skin: boolean;
  /** 0–1: how much of the change to make. */
  amount: number;
}

export const MATCH_DEFAULTS: MatchOptions = { histogram: false, skin: true, amount: 1 };

/** How a Lab color is moved: per axis, scale around the source's average then move to the reference's (and a lightness table). */
export interface LabTransfer {
  src: Lab;
  ref: Lab;
  scale: Lab;
  /** Lightness in → out (QUANTILES steps of source quantiles), or null for mean and spread only. */
  table: { from: Float32Array; to: Float32Array } | null;
  /** Extra color push (a, b) for skin. */
  push: [number, number];
  amount: number;
}

const clampRatio = (r: number) => Math.max(0.4, Math.min(2.5, Number.isFinite(r) ? r : 1));

export function planTransfer(src: LabStats, ref: LabStats, o: MatchOptions, skin?: { src: LabStats; ref: LabStats } | null): LabTransfer {
  const scale = [0, 1, 2].map((k) => clampRatio((ref.std[k] as number) / Math.max(1e-3, src.std[k] as number))) as Lab;
  const t: LabTransfer = { src: src.mean, ref: ref.mean, scale, table: null, push: [0, 0], amount: Math.max(0, Math.min(1, o.amount)) };
  if (o.histogram && src.count > 0 && ref.count > 0) t.table = { from: src.quantiles, to: ref.quantiles };
  if (o.skin && skin && skin.src.count >= 20 && skin.ref.count >= 20) {
    // Where the source's skin would land, and how far that is from the reference's skin (half of it is made up).
    const moved = applyLab(skin.src.mean, { ...t, amount: 1 });
    t.push = [((skin.ref.mean[1] as number) - (moved[1] as number)) * 0.5, ((skin.ref.mean[2] as number) - (moved[2] as number)) * 0.5];
  }
  return t;
}

/** Piecewise-linear lookup in a rising table. */
function lookup(from: Float32Array, to: Float32Array, x: number): number {
  const n = from.length;
  if (x <= (from[0] as number)) return (to[0] as number) + (x - (from[0] as number));
  if (x >= (from[n - 1] as number)) return (to[n - 1] as number) + (x - (from[n - 1] as number));
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((from[mid] as number) <= x) lo = mid;
    else hi = mid;
  }
  const a = from[lo] as number;
  const b = from[hi] as number;
  const k = b - a > 1e-6 ? (x - a) / (b - a) : 0;
  return (to[lo] as number) + k * ((to[hi] as number) - (to[lo] as number));
}

export function applyLab(c: Lab, t: LabTransfer): Lab {
  const out = [0, 1, 2].map((k) => ((c[k] as number) - (t.src[k] as number)) * (t.scale[k] as number) + (t.ref[k] as number)) as Lab;
  if (t.table) out[0] = lookup(t.table.from, t.table.to, c[0]);
  out[1] += t.push[0];
  out[2] += t.push[1];
  return [0, 1, 2].map((k) => (c[k] as number) + ((out[k] as number) - (c[k] as number)) * t.amount) as Lab;
}

export const applyRgb = (c: RGB, t: LabTransfer): RGB => labToRgb(applyLab(rgbToLab(c), t));

// ---- As a grade node ----

/** The node's saturation (percent) that makes the picture about as colorful as the transfer does. */
function saturationFor(p: Pixels, t: LabTransfer): number {
  let before = 0;
  let after = 0;
  const n = pixelCount(p);
  const center = applyLab(t.src, t);
  for (let i = 0; i < n; i++) {
    const w = p.weight[i] as number;
    const lab = rgbToLab([p.rgb[i * 3] as number, p.rgb[i * 3 + 1] as number, p.rgb[i * 3 + 2] as number]);
    const moved = applyLab(lab, t);
    // Colorfulness around the picture's own average color (a cast is the curves' job).
    before += Math.hypot(lab[1] - (t.src[1] as number), lab[2] - (t.src[2] as number)) * w;
    after += Math.hypot(moved[1] - center[1], moved[2] - center[2]) * w;
  }
  const k = before > 1e-6 ? after / before : 1;
  return Math.round(Math.max(30, Math.min(200, k * 100)));
}

/** Pool-adjacent-violators: the closest rising sequence (weighted). */
export function rising(ys: number[], ws: number[]): number[] {
  const blocks: { y: number; w: number; n: number }[] = [];
  ys.forEach((y, i) => {
    blocks.push({ y, w: ws[i] as number, n: 1 });
    while (blocks.length > 1 && (blocks[blocks.length - 2] as { y: number }).y > (blocks[blocks.length - 1] as { y: number }).y) {
      const b = blocks.pop() as { y: number; w: number; n: number };
      const a = blocks.pop() as { y: number; w: number; n: number };
      const w = a.w + b.w;
      blocks.push({ y: w > 0 ? (a.y * a.w + b.y * b.w) / w : (a.y + b.y) / 2, w, n: a.n + b.n });
    }
  });
  return blocks.flatMap((b) => Array<number>(b.n).fill(b.y));
}

const BINS = 8;

/**
 * A curve (points 0–1) that maps each value of one channel, `xs`, to the
 * wanted value, `ys`: the wanted values averaged in bins of the input, kept
 * rising, with the ends carried on.
 */
export function fitCurve(xs: Float32Array, ys: Float32Array, ws: Float32Array): CurvePoints {
  const sx = new Float64Array(BINS);
  const sy = new Float64Array(BINS);
  const sw = new Float64Array(BINS);
  for (let i = 0; i < xs.length; i++) {
    const x = Math.max(0, Math.min(1, xs[i] as number));
    const b = Math.min(BINS - 1, Math.floor(x * BINS));
    const w = ws[i] as number;
    sx[b] = (sx[b] as number) + x * w;
    sy[b] = (sy[b] as number) + (ys[i] as number) * w;
    sw[b] = (sw[b] as number) + w;
  }
  const px: number[] = [];
  const py: number[] = [];
  const pw: number[] = [];
  for (let b = 0; b < BINS; b++) {
    const w = sw[b] as number;
    if (w <= 1e-6) continue;
    px.push((sx[b] as number) / w);
    py.push((sy[b] as number) / w);
    pw.push(w);
  }
  if (px.length === 0)
    return [
      [0, 0],
      [1, 1],
    ];
  const ry = rising(py, pw);
  const pts: CurvePoints = px.map((x, i) => [x, Math.max(0, Math.min(1, ry[i] as number))]);
  // The ends: carried on at the same offset as the nearest bin (so there is no jump).
  const first = pts[0] as [number, number];
  const last = pts[pts.length - 1] as [number, number];
  const out: CurvePoints = [];
  if (first[0] > 0.02) out.push([0, Math.max(0, Math.min(first[1], first[1] - first[0]))]);
  out.push(...pts);
  if (last[0] < 0.98) out.push([1, Math.min(1, Math.max(last[1], last[1] + (1 - last[0])))]);
  // Points too close together make the curve wobble.
  return out.filter((p, i) => i === 0 || p[0] - (out[i - 1] as [number, number])[0] > 0.015).map(([x, y]) => [round(x), round(y)]);
}
const round = (v: number) => Math.round(v * 1000) / 1000;

export const MATCH_LABEL = 'Color match';

/** The grade node that does a transfer on these pixels: a saturation amount, then r, g, b curves fitted to the wanted colors. */
export function matchNode(p: Pixels, t: LabTransfer, label = MATCH_LABEL): GradeNode {
  const saturation = saturationFor(p, t);
  const now: NodeNow = { id: 'fit', p: { saturation }, curves: null, qualifier: null, window: null };
  const u = nodeUniforms(now);
  const n = pixelCount(p);
  const xs = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const ys = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const c: RGB = [p.rgb[i * 3] as number, p.rgb[i * 3 + 1] as number, p.rgb[i * 3 + 2] as number];
    const s = saturation === 100 ? c : basicPx(c, u);
    const want = applyRgb(c, t);
    for (let k = 0; k < 3; k++) {
      (xs[k] as Float32Array)[i] = s[k] as number;
      (ys[k] as Float32Array)[i] = want[k] as number;
    }
  }
  const curve = (k: number) => fitCurve(xs[k] as Float32Array, ys[k] as Float32Array, p.weight);
  return {
    ...newNode(label),
    p: saturation === 100 ? {} : { saturation },
    curves: {
      master: [
        [0, 0],
        [1, 1],
      ],
      r: curve(0),
      g: curve(1),
      b: curve(2),
    },
  };
}

/** The colors after a clip's grade as it is now (at a frame of the clip). */
export function graded(clip: Clip, p: Pixels, frame: number, aspect: number): Pixels {
  const plan = planGrade(gradeAt(shownGrade(clip), frame));
  if (plan.steps.length === 0) return p;
  const out = { ...p, rgb: new Float32Array(p.rgb.length) };
  const n = pixelCount(p);
  for (let i = 0; i < n; i++) {
    const c = gradePx(
      plan,
      [p.rgb[i * 3] as number, p.rgb[i * 3 + 1] as number, p.rgb[i * 3 + 2] as number],
      [p.uv[i * 2] as number, p.uv[i * 2 + 1] as number],
      aspect,
    );
    out.rgb[i * 3] = Math.max(0, Math.min(1, c[0]));
    out.rgb[i * 3 + 1] = Math.max(0, Math.min(1, c[1]));
    out.rgb[i * 3 + 2] = Math.max(0, Math.min(1, c[2]));
  }
  return out;
}

/** The pixels after one node (to check a match). */
export function afterNode(node: GradeNode, p: Pixels): Pixels {
  const g: Grade = { steps: [{ kind: 'serial', node }] };
  return graded({ effects: [{ id: 'g', type: 'grade', on: true, p: {}, d: g as unknown as Record<string, unknown> }] } as unknown as Clip, p, 0, 16 / 9);
}

/** Put a match node at the end of a clip's grade (an earlier match node is replaced, in its place). */
export function withMatchNode(c: Clip, node: GradeNode): Clip {
  return changeGrade(c, (g) => {
    const old = allNodes(g).find((n) => n.label === node.label);
    if (old) return updateNode(g, old.id, () => ({ ...node, id: old.id }));
    // A grade with only its first, untouched node: the match goes in that node.
    const nodes = allNodes(g);
    const only = nodes.length === 1 ? nodes[0] : undefined;
    if (only && !only.label && Object.keys(only.p).length === 0 && !only.curves && !only.qualifier && !only.window)
      return updateNode(g, only.id, () => ({ ...node, id: only.id }));
    return addSerial(g, nodes[nodes.length - 1]?.id ?? null, node);
  });
}

/** Skin by color alone (YCbCr box that holds most skin tones), for when no person mask can be made. */
export function skinColor(c: RGB): boolean {
  const [r, g, b] = c.map((v) => v * 255) as RGB;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  return y > 40 && y < 245 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

/** Skin pixels count this much more than others when skin-tone aware. */
export const SKIN_WEIGHT = 4;

/** The whole match: statistics of both, the transfer, and the node. */
export function matchColors(target: Pixels, reference: Pixels, o: MatchOptions): { node: GradeNode; transfer: LabTransfer } {
  const weigh = (p: Pixels): Pixels => (o.skin ? { ...p, weight: p.weight.map((w, i) => (p.skin[i] ? w * SKIN_WEIGHT : w)) } : p);
  const tp = weigh(target);
  const rp = weigh(reference);
  const ts = labStats(tp);
  const rs = labStats(rp);
  const skin = o.skin ? { src: labStats(target, (i) => target.skin[i] === 1), ref: labStats(reference, (i) => reference.skin[i] === 1) } : null;
  const transfer = planTransfer(ts, rs, o, skin);
  return { node: matchNode(tp, transfer), transfer };
}
