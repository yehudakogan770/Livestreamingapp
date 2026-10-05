// Turns a clip's node grade into GPU passes. The plan leaves out nodes that do
// nothing, so a grade with one untouched node costs nothing. The same math is
// written here in TypeScript (gradePixel) to check the GPU program against;
// keep the two in step with GRADE_FS in shaders.ts.
import { BASIC_PARAMS, WHEEL_PARAMS, type CurveSet, type GradeNow, type NodeNow, type StepNow } from '../model/grade';
import { curvesImage, flatCurve, wheelColor } from './color';

export type RGB = [number, number, number];

export interface GradePlan {
  /** The steps to run, in order (only ones that change something). */
  steps: StepNow[];
  /** Show this node's matte (in black and white) after the steps, instead of the rest. */
  matte: NodeNow | null;
}

// The pivot only matters with contrast, and the hue turn is a part of its own.
const BASIC_KEYS = BASIC_PARAMS.filter((x) => x.key !== 'hue' && x.key !== 'pivot');

/** Which parts of a node change the picture. */
export function nodeParts(n: NodeNow) {
  const basic = BASIC_KEYS.some((x) => (n.p[x.key] ?? x.def) !== x.def);
  const wheels = WHEEL_PARAMS.some((x) => (n.p[x.key] ?? 0) !== 0);
  const c = n.curves;
  const curves = !!c?.master && !(flatCurve(c.master) && flatCurve(c.r) && flatCurve(c.g) && flatCurve(c.b));
  const hsl = (n.p.hslShift ?? 0) !== 0 || (n.p.hslSat ?? 0) !== 0 || (n.p.hslLight ?? 0) !== 0;
  const hue = (n.p.hue ?? 0) !== 0;
  return { basic, wheels, curves, hsl, hue };
}

/** The node doesn't change any color (whatever its qualifier or window says). */
export function idle(n: NodeNow): boolean {
  const p = nodeParts(n);
  return !p.basic && !p.wheels && !p.curves && !p.hsl && !p.hue;
}

/** One kind of step from a group's nodes: none, a single serial node, or the group. */
function group(kind: 'parallel' | 'layer', nodes: NodeNow[]): StepNow[] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) return [{ kind: 'serial', node: nodes[0] as NodeNow }];
  return [{ kind, nodes }];
}

/**
 * What to draw for a grade. Nodes that change nothing are left out (in a
 * layer mix only from the bottom, since a node higher up still shows the
 * picture as it came in, over the nodes under it).
 */
export function planGrade(g: GradeNow, matteNode: string | null = null): GradePlan {
  const steps: StepNow[] = [];
  for (const s of g.steps) {
    const nodes = s.kind === 'serial' ? [s.node] : s.nodes;
    const shown = matteNode ? nodes.find((n) => n.id === matteNode) : undefined;
    if (shown) return { steps, matte: shown };
    if (s.kind === 'serial') steps.push(...(idle(s.node) ? [] : [s]));
    else if (s.kind === 'parallel')
      steps.push(
        ...group(
          'parallel',
          s.nodes.filter((n) => !idle(n)),
        ),
      );
    else {
      const from = s.nodes.findIndex((n) => !idle(n));
      steps.push(...group('layer', from < 0 ? [] : s.nodes.slice(from)));
    }
  }
  return { steps, matte: null };
}

// ---- Numbers for the GPU program ----

const wheel = (n: NodeNow, w: string, k: number): RGB => {
  const c = wheelColor(n.p[`${w}X`] ?? 0, n.p[`${w}Y`] ?? 0);
  const l = (n.p[w] ?? 0) / 100;
  return c.map((v) => v * k + l) as RGB;
};

/** Lift, gamma and gain as the Color wheels effect has always worked them out, and the offset wheel. */
export function wheelVectors(n: NodeNow): { lift: RGB; gamma: RGB; gain: RGB; offset: RGB } {
  return {
    lift: wheel(n, 'lift', 0.15).map((v) => v * 0.5) as RGB,
    gamma: wheel(n, 'gamma', 0.25).map((v) => 1 + v) as RGB,
    gain: wheel(n, 'gain', 0.3).map((v) => 1 + v) as RGB,
    offset: wheel(n, 'offset', 0.2).map((v) => v * 0.5) as RGB,
  };
}

/** The node's settings as the GPU program's numbers (the curves picture is bound separately). */
export function nodeUniforms(n: NodeNow): Record<string, number | number[]> {
  const parts = nodeParts(n);
  const p = (k: string, d = 0) => n.p[k] ?? d;
  const w = wheelVectors(n);
  const q = n.qualifier;
  const win = n.window;
  return {
    uUseBasic: parts.basic ? 1 : 0,
    uUseWheels: parts.wheels ? 1 : 0,
    uUseCurves: parts.curves ? 1 : 0,
    uUseHsl: parts.hsl ? 1 : 0,
    uUseHue: parts.hue ? 1 : 0,
    uBasicA: [p('exposure'), p('contrast') / 100, p('pivot', 50) / 100, p('highlights') / 100],
    uBasicB: [p('shadows') / 100, p('whites') / 100, p('blacks') / 100, p('temperature') / 100],
    uBasicC: [p('tint') / 100, p('saturation', 100) / 100, p('vibrance') / 100, p('hue') / 360],
    uLift: w.lift,
    uGamma: w.gamma,
    uGain: w.gain,
    uOffset: w.offset,
    uCurveMix: p('curveMix', 100) / 100,
    uHslA: [p('hslHue', 30) / 360, p('hslRange', 30) / 360, p('hslShift') / 360, p('hslSat') / 100],
    uHslLight: p('hslLight') / 100,
    uUseQual: q ? 1 : 0,
    uQHue: q ? [q.hue / 360, q.hueWidth / 720, q.soft / 500, q.invert ? 1 : 0] : [0, 0, 0, 0],
    uQBand: q ? [q.satLo / 100, q.satHi / 100, q.lumLo / 100, q.lumHi / 100] : [0, 1, 0, 1],
    uUseWin: win ? 1 : 0,
    uWin: win ? [win.x, win.y, Math.max(0.001, win.w / 2), Math.max(0.001, win.h / 2)] : [0.5, 0.5, 1, 1],
    uWinOpt: win ? [win.shape === 'rect' ? 1 : 0, win.soft / 100, win.invert ? 1 : 0] : [0, 0, 0],
  };
}

// ---- The same math in TypeScript (for checking; the GPU draws the picture) ----

const luma = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const fract = (x: number) => x - Math.floor(x);
const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const map3 = (c: RGB, f: (v: number, i: number) => number): RGB => [f(c[0], 0), f(c[1], 1), f(c[2], 2)];

export function rgb2hsv([r, g, b]: RGB): RGB {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [fract(h / 6), max > 0 ? d / max : 0, max];
}
export function hsv2rgb([h, s, v]: RGB): RGB {
  const k = (n: number) => fract(h + n / 3) * 6;
  return map3([0, 2, 1], (n) => v * lerp(1, Math.max(0, Math.min(1, Math.abs(k(n) - 3) - 1)), s));
}

/** Basic correction (exposure, white balance, tones, contrast around a pivot, saturation). */
export function basicPx(c: RGB, u: Record<string, number | number[]>): RGB {
  const [exposure, contrast, pivot, hi] = u.uBasicA as number[] as [number, number, number, number];
  const [sh, wh, bl, temp] = u.uBasicB as number[] as [number, number, number, number];
  const [tint, sat, vib] = u.uBasicC as number[] as [number, number, number];
  let x = map3(c, (v) => v * 2 ** exposure);
  x = [x[0] * (1 + temp * 0.25 + tint * 0.1), x[1] * (1 - tint * 0.2), x[2] * (1 - temp * 0.25 + tint * 0.1)];
  let l = luma(x);
  const hw = smoothstep(0.35, 1, l);
  const sw = 1 - smoothstep(0, 0.65, l);
  x = map3(x, (v) => v + v * hi * 0.6 * hw);
  x = map3(x, (v) => v + sh * 0.35 * sw * (1 - v));
  const lo = -bl * 0.15;
  const top = 1 - wh * 0.2;
  x = map3(x, (v) => (v - lo) / Math.max(0.05, top - lo));
  x = map3(x, (v) => (v - pivot) * (1 + contrast) + pivot);
  l = luma(x);
  const s = Math.max(...x) - Math.min(...x);
  const k = sat * (1 + vib * (1 - s));
  return map3(x, (v) => Math.max(0, lerp(l, v, k)));
}

export function wheelsPx(c: RGB, lift: RGB, gamma: RGB, gain: RGB): RGB {
  return map3(c, (v, i) => Math.max(0, v * (gain[i] as number) + (lift[i] as number) * (1 - v)) ** (1 / Math.max(gamma[i] as number, 0.05)));
}

/** Curves, read the way the GPU reads the 256-step curves picture (blended between steps). */
export function curvesPx(c: RGB, set: CurveSet, amount: number): RGB {
  const img = curvesImage(set);
  const look = (v: number, ch: number) => {
    const x = v * 255;
    const i = Math.min(254, Math.floor(x));
    return lerp(img[i * 4 + ch] as number, img[(i + 1) * 4 + ch] as number, x - i) / 255;
  };
  return map3(c, (v, i) => {
    const x = Math.max(0, Math.min(1, v));
    return lerp(x, look(x, i), amount);
  });
}

export function hslPx(c: RGB, hue: number, range: number, shift: number, sat: number, light: number): RGB {
  const h = rgb2hsv(c);
  const d = Math.abs(fract(h[0] - hue + 0.5) - 0.5);
  const w = (1 - smoothstep(range * 0.5, range, d)) * smoothstep(0.05, 0.2, h[1]);
  return hsv2rgb([fract(h[0] + shift * w), Math.max(0, Math.min(1, h[1] * (1 + sat * w))), Math.max(0, Math.min(4, h[2] * (1 + light * w)))]);
}

/** How much a node applies at a pixel (1 everywhere without a qualifier or window). `uv` is 0–1 across and down. */
export function mattePx(n: NodeNow, c: RGB, uv: [number, number], aspect: number): number {
  const u = nodeUniforms(n);
  let m = 1;
  if (n.qualifier) {
    const [hue, half, soft, inv] = u.uQHue as [number, number, number, number];
    const [sLo, sHi, lLo, lHi] = u.uQBand as [number, number, number, number];
    const s = Math.max(soft, 1e-4);
    const x = map3(c, (v) => Math.max(0, Math.min(1, v)));
    const h = rgb2hsv(x);
    const d = Math.abs(fract(h[0] - hue + 0.5) - 0.5);
    const hk = half >= 0.5 ? 1 : 1 - smoothstep(half, half + s, d);
    const band = (v: number, lo: number, hi: number) => smoothstep(lo - s, lo, v) * (1 - smoothstep(hi, hi + s, v));
    const q = hk * band(h[1], sLo, sHi) * band(luma(x), lLo, lHi);
    m *= inv > 0.5 ? 1 - q : q;
  }
  if (n.window) {
    const [cx, cy, hw, hh] = u.uWin as [number, number, number, number];
    const [shape, soft, inv] = u.uWinOpt as [number, number, number];
    const dx = ((uv[0] - cx) * aspect) / hw;
    const dy = (uv[1] - cy) / hh;
    const d = shape > 0.5 ? Math.max(Math.abs(dx), Math.abs(dy)) - 1 : Math.hypot(dx, dy) - 1;
    const a = smoothstep(0, 1, -d / Math.max(soft, 1e-4));
    m *= inv > 0.5 ? 1 - a : a;
  }
  return m;
}

/** One node on one pixel: its correction, mixed over `base` by its matte. */
export function nodePx(n: NodeNow, c: RGB, base: RGB, uv: [number, number], aspect: number): RGB {
  const u = nodeUniforms(n);
  const m = mattePx(n, c, uv, aspect);
  let x = c;
  if (u.uUseBasic) x = basicPx(x, u);
  if (u.uUseWheels) {
    x = wheelsPx(x, u.uLift as RGB, u.uGamma as RGB, u.uGain as RGB);
    x = map3(x, (v, i) => v + ((u.uOffset as RGB)[i] as number));
  }
  if (u.uUseCurves && n.curves) x = curvesPx(x, n.curves, u.uCurveMix as number);
  if (u.uUseHsl) {
    const [hue, range, shift, sat] = u.uHslA as [number, number, number, number];
    x = hslPx(x, hue, range, shift, sat, u.uHslLight as number);
  }
  if (u.uUseHue) {
    const h = rgb2hsv(map3(x, (v) => Math.max(0, v)));
    x = hsv2rgb([fract(h[0] + ((u.uBasicC as number[])[3] as number)), h[1], h[2]]);
  }
  return map3(base, (b, i) => lerp(b, x[i] as number, m));
}

/** A whole plan on one pixel, as the GPU passes do it. */
export function gradePx(plan: GradePlan, c: RGB, uv: [number, number] = [0.5, 0.5], aspect = 16 / 9): RGB {
  let cur = c;
  for (const s of plan.steps) {
    const input = cur;
    if (s.kind === 'serial') cur = nodePx(s.node, input, input, uv, aspect);
    else if (s.kind === 'parallel') {
      // Each node's change from the input, added up.
      cur = input;
      for (const n of s.nodes) {
        const o = nodePx(n, input, input, uv, aspect);
        cur = map3(cur, (v, i) => Math.max(0, v + (o[i] as number) - (input[i] as number)));
      }
    } else {
      // Bottom first; each node above shows through its matte.
      cur = nodePx(s.nodes[0] as NodeNow, input, input, uv, aspect);
      for (const n of s.nodes.slice(1)) cur = nodePx(n, input, cur, uv, aspect);
    }
  }
  if (plan.matte) {
    const m = mattePx(plan.matte, cur, uv, aspect);
    return [m, m, m];
  }
  return cur;
}
