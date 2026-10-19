// The brush engine. A stroke turns pointer samples (with pen pressure) into
// dabs spaced along the path (scatter, jitter, elliptical and sampled tips,
// texture, dual brush), and accumulates them into a coverage buffer the way
// Photoshop does: Flow builds up toward each dab's Opacity, never past it.
// Each frame the touched pixels are recomputed once from the stroke's
// original pixels and that coverage by a pixel operation (paint with a
// blend mode, erase, clone, dodge…), so long strokes stay fast.

import { Raster, TileEdit, TILE, tileKey, intersect, type TileSwap } from './raster';
import type { Rect } from './types';
import { getPattern, patternAt } from './patterns';

export interface BrushTip {
  /** Diameter in pixels. */
  size: number;
  /** 0..1 */
  hardness: number;
  /** Fraction of the diameter between dabs. */
  spacing: number;
  /** Degrees and roundness 0..1 (elliptical tips). */
  angle: number;
  roundness: number;
  /** Scattering, 0..1 of the diameter, and dabs per spacing step. */
  scatter: number;
  count: number;
  /** Size jitter 0..1 and whether pen pressure sets size / opacity / flow. */
  sizeJitter: number;
  angleJitter: number;
  pressureSize: boolean;
  pressureOpacity: boolean;
  pressureFlow: boolean;
  /** A texture (pattern id) and its depth 0..1. */
  texture: string | null;
  textureDepth: number;
  textureScale: number;
  /** Dual brush: a second tip that masks the first. */
  dual: { size: number; spacing: number; scatter: number } | null;
  /** Smoothing of the stroke 0..1 (lazy mouse). */
  smoothing: number;
  /** A sampled tip (from Define Brush Preset): 8-bit alpha, w × h. */
  sampled?: { w: number; h: number; data: Uint8Array } | null;
}

export const defaultTip = (size = 30, hardness = 0): BrushTip => ({
  size,
  hardness,
  spacing: 0.25,
  angle: 0,
  roundness: 1,
  scatter: 0,
  count: 1,
  sizeJitter: 0,
  angleJitter: 0,
  pressureSize: true,
  pressureOpacity: false,
  pressureFlow: false,
  texture: null,
  textureDepth: 0.5,
  textureScale: 1,
  dual: null,
  smoothing: 0.1,
  sampled: null,
});

export interface StrokeSample {
  x: number;
  y: number;
  /** 0..1 (mice: 1, or 0.5 for pens reporting none). */
  pressure: number;
}

export interface Dab {
  x: number;
  y: number;
  /** Diameter. */
  size: number;
  angle: number;
  roundness: number;
  /** Coverage this dab adds (flow). */
  flow: number;
  /** The most coverage it can bring a pixel to (opacity). */
  cap: number;
}

/** A small seeded random (strokes repeat the same way when replayed by actions). */
export class Rand {
  private s: number;
  constructor(seed = 1234567) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 4294967296;
  }
}

/** Turns pointer samples into dabs. */
export class DabSpacer {
  private last: StrokeSample | null = null;
  private carry = 0;
  private sm: { x: number; y: number } | null = null;
  private readonly rand: Rand;

  constructor(
    readonly tip: BrushTip,
    readonly flow: number,
    readonly opacity: number,
    seed = 1,
  ) {
    this.rand = new Rand(seed);
  }

  private dabAt(x: number, y: number, pressure: number, out: Dab[]): void {
    const t = this.tip;
    const pr = Math.max(0.02, Math.min(1, pressure));
    let size = t.size * (t.pressureSize ? pr : 1);
    if (t.sizeJitter > 0) size *= 1 - t.sizeJitter * this.rand.next();
    size = Math.max(1, size);
    const flow = this.flow * (t.pressureFlow ? pr : 1);
    const cap = this.opacity * (t.pressureOpacity ? pr : 1);
    const n = Math.max(1, Math.round(t.count));
    for (let i = 0; i < n; i++) {
      let dx = 0,
        dy = 0;
      if (t.scatter > 0) {
        const a = this.rand.next() * Math.PI * 2;
        const r = this.rand.next() * t.scatter * t.size;
        dx = Math.cos(a) * r;
        dy = Math.sin(a) * r;
      }
      const angle = t.angle + (t.angleJitter > 0 ? (this.rand.next() - 0.5) * 360 * t.angleJitter : 0);
      out.push({ x: x + dx, y: y + dy, size, angle, roundness: t.roundness, flow, cap });
    }
  }

  /** Dabs for the next sample (the first sample makes one dab). */
  add(p: StrokeSample): Dab[] {
    const out: Dab[] = [];
    // Smoothing: follow the pointer with a lag.
    const k = Math.min(0.95, Math.max(0, this.tip.smoothing));
    if (!this.sm) this.sm = { x: p.x, y: p.y };
    else {
      this.sm.x += (p.x - this.sm.x) * (1 - k);
      this.sm.y += (p.y - this.sm.y) * (1 - k);
    }
    const cur = { x: this.sm.x, y: this.sm.y, pressure: p.pressure };
    if (!this.last) {
      this.dabAt(cur.x, cur.y, cur.pressure, out);
      this.last = cur;
      this.carry = 0;
      return out;
    }
    const L = this.last;
    const dist = Math.hypot(cur.x - L.x, cur.y - L.y);
    if (dist < 1e-6) return out;
    let at = this.carry;
    for (;;) {
      const pr = L.pressure + (cur.pressure - L.pressure) * Math.min(1, at / dist);
      const size = Math.max(1, this.tip.size * (this.tip.pressureSize ? Math.max(0.02, pr) : 1));
      const step = Math.max(0.5, size * Math.max(0.01, this.tip.spacing));
      if (at === 0) at = step;
      if (at > dist) {
        this.carry = at - dist;
        break;
      }
      const f = at / dist;
      this.dabAt(L.x + (cur.x - L.x) * f, L.y + (cur.y - L.y) * f, pr, out);
      at += step;
    }
    this.last = cur;
    return out;
  }

  /** Catch up to the pointer at the end of a smoothed stroke. */
  finish(p: StrokeSample): Dab[] {
    if (!this.sm || this.tip.smoothing <= 0) return [];
    const out: Dab[] = [];
    for (let i = 0; i < 12; i++) out.push(...this.add(p));
    return out;
  }
}

/** Coverage of a dab at a pixel offset (dx, dy from its center), 0..1. */
export function dabCoverage(tip: BrushTip, d: Dab, dx: number, dy: number, aliased = false): number {
  const r = d.size / 2;
  // Into the tip's own frame (angle, roundness).
  const a = (-d.angle * Math.PI) / 180;
  let u = dx * Math.cos(a) - dy * Math.sin(a);
  let v = dx * Math.sin(a) + dy * Math.cos(a);
  v /= Math.max(0.01, d.roundness);
  if (tip.sampled) {
    const s = tip.sampled;
    const scale = Math.max(s.w, s.h) / d.size;
    const sx = u * scale + s.w / 2 - 0.5,
      sy = v * scale + s.h / 2 - 0.5;
    const x0 = Math.floor(sx),
      y0 = Math.floor(sy);
    const fx = sx - x0,
      fy = sy - y0;
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= s.w || y >= s.h ? 0 : s.data[y * s.w + x]! / 255);
    return at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
  }
  const dist = Math.sqrt(u * u + v * v);
  if (aliased) return dist <= r ? 1 : 0;
  if (dist >= r + 0.5) return 0;
  const h = tip.hardness;
  if (h >= 0.999 || r < 1.5) return Math.min(1, Math.max(0, r + 0.5 - dist));
  const t = dist / r;
  if (t <= h) return 1;
  const q = Math.min(1, (t - h) / (1 - h));
  // A Gaussian-like falloff that reaches zero at the edge.
  const e = Math.exp(-4.5 * q * q);
  return Math.max(0, (e - 0.011109) / (1 - 0.011109));
}

type Cov = Map<number, Float32Array>;

/** What a stroke does with the pixels under its coverage. */
export interface PixelOp {
  /**
   * New pixels for `r` from the stroke's original pixels (`orig`, the raster's
   * channels per pixel) and coverage (`cov`, 0..1 per pixel, zero outside the
   * stroke); write them to `out`.
   */
  apply(r: Rect, orig: Float32Array, cov: Float32Array, out: Float32Array): void;
  /** A dab-by-dab tool (smudge): changes the working pixels at each dab instead. */
  perDab?: (dab: Dab, stroke: BrushStroke) => void;
}

export interface StrokeOptions {
  tip: BrushTip;
  flow: number;
  opacity: number;
  /** Selection coverage at a document pixel (null: everything). */
  selection?: ((x: number, y: number) => number) | null;
  /** Limit to the canvas (painting outside it is pointless). */
  bounds: Rect;
  aliased?: boolean;
  /** Build up while held still (airbrush). */
  buildUp?: boolean;
  seed?: number;
}

/** One stroke on one raster. */
export class BrushStroke {
  readonly edit: TileEdit;
  readonly raster: Raster;
  private cov: Cov = new Map();
  private dual: Cov | null = null;
  private spacer: DabSpacer;
  private dualSpacer: DabSpacer | null = null;
  /** Area changed since the last flush. */
  private pending: Rect | null = null;
  /** Everything the stroke touched. */
  touched: Rect | null = null;
  readonly o: StrokeOptions;
  readonly op: PixelOp;
  lastDab: Dab | null = null;

  constructor(raster: Raster, op: PixelOp, o: StrokeOptions) {
    this.raster = raster;
    this.edit = new TileEdit(raster);
    this.op = op;
    this.o = o;
    this.spacer = new DabSpacer(o.tip, o.flow, o.opacity, o.seed ?? 1);
    if (o.tip.dual) {
      this.dual = new Map();
      this.dualSpacer = new DabSpacer(
        { ...o.tip, size: o.tip.dual.size, spacing: o.tip.dual.spacing, scatter: o.tip.dual.scatter, hardness: 1, sampled: null, dual: null, smoothing: 0 },
        1,
        1,
        (o.seed ?? 1) + 7,
      );
    }
  }

  private covTile(map: Cov, tx: number, ty: number): Float32Array {
    const k = tileKey(tx, ty);
    let t = map.get(k);
    if (!t) {
      t = new Float32Array(TILE * TILE);
      map.set(k, t);
    }
    return t;
  }

  /** Coverage at a document pixel. */
  coverage(x: number, y: number): number {
    const t = this.cov.get(tileKey(x >> 8, y >> 8));
    return t ? t[(y & 255) * TILE + (x & 255)]! : 0;
  }

  private stamp(map: Cov, d: Dab, tip: BrushTip, accumulate: boolean): Rect | null {
    const r = d.size / 2 + 1;
    const box = intersect({ x: Math.floor(d.x - r), y: Math.floor(d.y - r), w: Math.ceil(r * 2) + 2, h: Math.ceil(r * 2) + 2 }, this.o.bounds);
    if (!box) return null;
    const tex = tip.texture ? getPattern(tip.texture) : null;
    const px = [0, 0, 0, 0];
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) {
        let a = dabCoverage(tip, d, x + 0.5 - d.x, y + 0.5 - d.y, this.o.aliased);
        if (a <= 0) continue;
        if (tex) {
          patternAt(tex, x, y, tip.textureScale, px);
          const lum = 0.299 * px[0]! + 0.587 * px[1]! + 0.114 * px[2]!;
          a *= 1 - tip.textureDepth * (1 - lum);
        }
        const t = this.covTile(map, x >> 8, y >> 8);
        const i = (y & 255) * TILE + (x & 255);
        const c = t[i]!;
        if (accumulate) {
          // Flow builds up toward the dab's opacity.
          if (c < d.cap) t[i] = c + (d.cap - c) * Math.min(1, a * d.flow);
        } else t[i] = Math.max(c, a);
      }
    }
    return box;
  }

  /** Add a pointer sample; returns the area to redraw (after flush()). */
  add(p: StrokeSample): void {
    const dabs = this.spacer.add(p);
    this.dabs(dabs, p);
  }

  /** Stamp again where the pointer rests (airbrush). */
  hold(p: StrokeSample): void {
    if (!this.o.buildUp) return;
    const t = this.o.tip;
    this.dabs(
      [
        {
          x: p.x,
          y: p.y,
          size: t.size * (t.pressureSize ? p.pressure : 1),
          angle: t.angle,
          roundness: t.roundness,
          flow: this.o.flow * 0.25,
          cap: this.o.opacity,
        },
      ],
      p,
    );
  }

  private dabs(dabs: Dab[], p: StrokeSample): void {
    if (this.dualSpacer && this.dual)
      for (const d of this.dualSpacer.add(p)) this.stamp(this.dual, d, { ...this.o.tip, hardness: 1, sampled: null, texture: null }, false);
    for (const d of dabs) {
      if (this.op.perDab) {
        this.flush();
        this.op.perDab(d, this);
        this.lastDab = d;
        continue;
      }
      const box = this.stamp(this.cov, d, this.o.tip, true);
      if (box) {
        this.pending = unionR(this.pending, box);
        this.touched = unionR(this.touched, box);
      }
      this.lastDab = d;
    }
  }

  /** Mark an area changed by a per-dab tool. */
  markTouched(r: Rect): void {
    this.touched = unionR(this.touched, r);
    this.pending = unionR(this.pending, r);
  }

  end(p: StrokeSample): void {
    this.dabs(this.spacer.finish(p), p);
  }

  /** Recompute the pixels under the new coverage. Returns the area changed. */
  flush(): Rect | null {
    const r = this.pending;
    this.pending = null;
    if (!r || this.op.perDab) return r;
    const ch = this.raster.channels;
    const orig = this.readOriginal(r);
    const cov = new Float32Array(r.w * r.h);
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const dx = r.x + x,
          dy = r.y + y;
        let c = this.coverage(dx, dy);
        if (c <= 0) continue;
        if (this.dual) {
          const t = this.dual.get(tileKey(dx >> 8, dy >> 8));
          c *= t ? t[(dy & 255) * TILE + (dx & 255)]! : 0;
        }
        if (this.o.selection) c *= this.o.selection(dx, dy);
        cov[y * r.w + x] = c;
      }
    }
    const out = new Float32Array(r.w * r.h * ch);
    this.op.apply(r, orig, cov, out);
    // Only pixels under the stroke change.
    for (let i = 0; i < r.w * r.h; i++) if (cov[i] === 0) for (let k = 0; k < ch; k++) out[i * ch + k] = orig[i * ch + k]!;
    this.raster.write(r, out, this.edit, true);
    return r;
  }

  /** The raster's pixels over `r` as they were before this stroke. */
  readOriginal(r: Rect): Float32Array {
    const tmp = new Raster(this.raster.depth, this.raster.channels);
    // Tiles as they were: the edit's "before" for touched tiles, the live ones otherwise.
    const tx0 = Math.floor(r.x / TILE),
      ty0 = Math.floor(r.y / TILE),
      tx1 = Math.floor((r.x + r.w - 1) / TILE),
      ty1 = Math.floor((r.y + r.h - 1) / TILE);
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = this.edit.original(tx, ty);
        if (t) tmp.tiles.set(tileKey(tx, ty), t);
      }
    return tmp.read(r);
  }

  /** Current working pixels (for per-dab tools). */
  readCurrent(r: Rect): Float32Array {
    return this.raster.read(r);
  }

  writeCurrent(r: Rect, px: Float32Array): void {
    this.raster.write(r, px, this.edit, true);
  }

  commit(): TileSwap | null {
    this.flush();
    if (!this.edit.changed) return null;
    return this.edit.commit();
  }

  cancel(): void {
    this.edit.revert();
  }
}

function unionR(a: Rect | null, b: Rect): Rect {
  if (!a) return b;
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
