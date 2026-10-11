// The GPU compositor: one per open document. Layer rasters live on the GPU
// as textures updated tile by tile; the composite (the flattened document,
// premultiplied, for the screen) is kept and only the parts that changed
// are drawn again — a brush dab redraws a few hundred pixels, not the
// picture. Changes are found by comparing the layer tree with the last one
// drawn (records are immutable) and by the tiles' versions.
//
// Drawing walks the layers bottom to top in chunks (2048 px, or 1024 when
// layer styles need room around), ping-ponging between scratch targets, one
// pair per nesting level (groups, clipping groups).

import { GPU } from './context';
import { Program, makeTarget, freeTarget, drawInto, clearTarget, makeTexture, type Target } from './gl';
import { Raster, TILE, keyX, keyY, intersect, union, expand } from '../core/raster';
import { blendIndex } from '../core/blend';
import { compile, isIdentity, type Compiled } from '../core/adjust';
import { gradientRamp } from '../core/gradient';
import { gradientEnds } from '../core/composite';
import { getPattern } from '../core/patterns';
import { pathMask } from '../core/selection';
import { styleReach, hasStyles, type LayerStyles } from '../core/styles';
import type { Depth, Doc, FillContent, Layer, Rect } from '../core/types';
import type { VectorPath } from '../core/path';

const CH = 2048;
const CH_FX = 1024;
const MAX_REACH = 500;
const GROW = 1024;
const MARGIN = 512;

/** Live changes drawn without touching the document (moving, transforming). */
export interface Overrides {
  /** Layers shown moved by (dx, dy) while dragging. */
  offsets?: Map<string, [number, number]>;
  /** Layers shown with other pixels (a transform being previewed). */
  rasters?: Map<string, Raster>;
  /** Layers left out. */
  hide?: Set<string>;
  /**
   * Layers shown through a transform (Free Transform's preview): `inv` maps
   * document pixels to the source raster's pixels (3×3, row-major); `raster`
   * replaces the layer's own pixels when given; `bounds` is where it lands.
   */
  transforms?: Map<string, { inv: number[]; raster?: Raster; bounds: Rect }>;
}

class RasterTex {
  tex: WebGLTexture | null = null;
  x0 = 0;
  y0 = 0;
  w = 0;
  h = 0;
  readonly uploaded = new Map<number, number>();
  constructor(
    readonly depth: Depth,
    readonly channels: 1 | 4,
  ) {}
}

interface Snap {
  rec: Layer;
  bounds: Rect | null;
  off: string;
}

export class Compositor {
  readonly gpu: GPU;
  readonly gl: WebGL2RenderingContext;
  comp: Target | null = null;
  private w = 0;
  private h = 0;
  private depth: Depth = 8;
  private texs = new Map<Raster, RasterTex>();
  private prev = new Map<string, Snap>();
  private dirty: Rect | null = null;
  private lutCache = new WeakMap<object, { c: Compiled; t1?: WebGLTexture; t3?: WebGLTexture; n: number }>();
  private vmaskCache = new WeakMap<VectorPath, { tex: WebGLTexture; w: number; h: number }>();
  private rampCache = new Map<string, WebGLTexture>();
  private patCache = new Map<string, WebGLTexture>();
  private dummies: { f: WebGLTexture; u: WebGLTexture } | null = null;
  /** The composite changed since mipmaps were made. */
  mipsStale = true;
  private profileKey = '';
  /** Wall time of the last draw (for the status bar's performance readout). */
  lastMs = 0;

  constructor(gpu: GPU) {
    this.gpu = gpu;
    this.gl = gpu.gl;
  }

  dispose(): void {
    const gl = this.gl;
    freeTarget(gl, this.comp);
    this.comp = null;
    for (const t of this.texs.values()) if (t.tex) gl.deleteTexture(t.tex);
    this.texs.clear();
    for (const t of this.rampCache.values()) gl.deleteTexture(t);
    for (const t of this.patCache.values()) gl.deleteTexture(t);
    this.rampCache.clear();
    this.patCache.clear();
    this.prev.clear();
  }

  /** Draw everything again next time. */
  invalidate(r?: Rect | null): void {
    this.dirty = r ? union(this.dirty, r) : { x: 0, y: 0, w: this.w, h: this.h };
  }

  private dummy(): { f: WebGLTexture; u: WebGLTexture } {
    if (!this.dummies) {
      const gl = this.gl;
      this.dummies = {
        f: makeTexture(gl, 1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST, new Uint8Array(4)),
        u: makeTexture(gl, 1, 1, gl.RGBA16UI, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, gl.NEAREST, new Uint16Array(4)),
      };
    }
    return this.dummies;
  }

  /** Bind placeholders to the samplers a draw doesn't use (WebGL needs every sampler bound to the right type). */
  private fill(p: Program, names: string[], intNames: string[] = []): void {
    const d = this.dummy();
    for (const n of names) if (!p.has(n)) p.tex(n, d.f);
    for (const n of intNames) if (!p.has(n)) p.tex(n, this.depth === 16 ? d.u : d.f);
  }

  // ---- textures for rasters ----

  private format(depth: Depth, ch: 1 | 4): [number, number, number] {
    const gl = this.gl;
    if (depth === 8) return ch === 4 ? [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE] : [gl.R8, gl.RED, gl.UNSIGNED_BYTE];
    if (depth === 16) return ch === 4 ? [gl.RGBA16UI, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT] : [gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT];
    return ch === 4 ? [gl.RGBA32F, gl.RGBA, gl.FLOAT] : [gl.R32F, gl.RED, gl.FLOAT];
  }

  private zeros = new Map<string, ArrayBufferView>();
  private zeroTile(depth: Depth, ch: number): ArrayBufferView {
    const k = `${depth}:${ch}`;
    let z = this.zeros.get(k);
    if (!z) {
      const n = TILE * TILE * ch;
      z = depth === 8 ? new Uint8Array(n) : depth === 16 ? new Uint16Array(n) : new Float32Array(n);
      this.zeros.set(k, z);
    }
    return z;
  }

  /**
   * Bring a raster's texture up to date. Returns the changed area (document
   * coordinates, before any move offset).
   */
  syncRaster(r: Raster): { rt: RasterTex; changed: Rect | null } {
    const gl = this.gl;
    let rt = this.texs.get(r);
    if (!rt) {
      rt = new RasterTex(r.depth, r.channels);
      this.texs.set(r, rt);
    }
    this.used.add(r);
    let changed: Rect | null = null;
    const tb = r.tileBounds();
    const limit = { x: -MARGIN, y: -MARGIN, w: this.w + 2 * MARGIN, h: this.h + 2 * MARGIN };
    const want = tb ? intersect(tb, limit) : null;
    // Grow the texture in steps so painting near its edge doesn't reallocate each time.
    if (want && (!rt.tex || want.x < rt.x0 || want.y < rt.y0 || want.x + want.w > rt.x0 + rt.w || want.y + want.h > rt.y0 + rt.h)) {
      const max = this.gpu.caps.maxTexture;
      const span = (a: number, b: number, lo: number, hi: number) => {
        const s = Math.max(lo, Math.floor(a / GROW) * GROW - 0);
        const e = Math.min(hi, Math.ceil(b / GROW) * GROW);
        return [Math.floor(s / TILE) * TILE, Math.ceil(e / TILE) * TILE] as [number, number];
      };
      let [x0, x1] = span(want.x, want.x + want.w, limit.x, limit.x + limit.w);
      let [y0, y1] = span(want.y, want.y + want.h, limit.y, limit.y + limit.h);
      if (rt.tex) {
        x0 = Math.min(x0, rt.x0);
        y0 = Math.min(y0, rt.y0);
        x1 = Math.max(x1, rt.x0 + rt.w);
        y1 = Math.max(y1, rt.y0 + rt.h);
      }
      if (x1 - x0 > max) x1 = x0 + Math.floor(max / TILE) * TILE;
      if (y1 - y0 > max) y1 = y0 + Math.floor(max / TILE) * TILE;
      if (rt.tex) gl.deleteTexture(rt.tex);
      const [internal, format, type] = this.format(r.depth, r.channels);
      rt.tex = makeTexture(gl, x1 - x0, y1 - y0, internal, format, type, gl.NEAREST);
      rt.x0 = x0;
      rt.y0 = y0;
      rt.w = x1 - x0;
      rt.h = y1 - y0;
      rt.uploaded.clear();
      changed = { x: x0, y: y0, w: rt.w, h: rt.h };
    }
    if (!rt.tex) return { rt, changed: null };
    const [, format, type] = this.format(r.depth, r.channels);
    gl.bindTexture(gl.TEXTURE_2D, rt.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (const [k, t] of r.tiles) {
      if (rt.uploaded.get(k) === t.v) continue;
      const x = keyX(k) * TILE - rt.x0,
        y = keyY(k) * TILE - rt.y0;
      if (x < 0 || y < 0 || x + TILE > rt.w || y + TILE > rt.h) continue;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, TILE, TILE, format, type, t.data);
      rt.uploaded.set(k, t.v);
      changed = union(changed, { x: x + rt.x0, y: y + rt.y0, w: TILE, h: TILE });
    }
    // Tiles that went away (undo, erase): clear them.
    for (const k of [...rt.uploaded.keys()]) {
      if (r.tiles.has(k)) continue;
      const x = keyX(k) * TILE - rt.x0,
        y = keyY(k) * TILE - rt.y0;
      rt.uploaded.delete(k);
      if (x < 0 || y < 0 || x + TILE > rt.w || y + TILE > rt.h) continue;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, TILE, TILE, format, type, this.zeroTile(r.depth, r.channels));
      changed = union(changed, { x: x + rt.x0, y: y + rt.y0, w: TILE, h: TILE });
    }
    return { rt, changed };
  }

  private used = new Set<Raster>();

  private bindRaster(p: Program, name: string, r: Raster, off: [number, number] = [0, 0]): void {
    const { rt } = this.syncRaster(r);
    if (!rt.tex) {
      p.tex(name, r.depth === 16 ? this.dummy().u : this.dummy().f);
      p.iv2(`${name}Origin`, 0, 0).iv2(`${name}Size`, 0, 0);
      return;
    }
    p.tex(name, rt.tex);
    p.iv2(`${name}Origin`, rt.x0 + off[0], rt.y0 + off[1]).iv2(`${name}Size`, rt.w, rt.h);
  }

  // ---- what changed ----

  private rasterOf(l: Layer, ov: Overrides): Raster | null {
    const o = ov.rasters?.get(l.id);
    if (o) return o;
    return 'raster' in l ? l.raster : null;
  }

  private offsetOf(l: Layer, ov: Overrides): [number, number] {
    return ov.offsets?.get(l.id) ?? [0, 0];
  }

  private extent(l: Layer, ov: Overrides): Rect | null {
    const canvas = { x: 0, y: 0, w: this.w, h: this.h };
    const xf = ov.transforms?.get(l.id);
    if (xf) {
      const reach = Math.min(MAX_REACH, styleReach(l.styles));
      return reach ? expand(xf.bounds, reach) : xf.bounds;
    }
    if (l.kind === 'group') {
      let r: Rect | null = null;
      for (const c of l.children) r = union(r, this.extent(c, ov));
      if (r && l.styles) r = expand(r, Math.min(MAX_REACH, styleReach(l.styles)));
      return r;
    }
    if (l.kind === 'adjust' || l.kind === 'fill') return canvas;
    const r = this.rasterOf(l, ov);
    let b = r?.tileBounds() ?? null;
    if (!b) return null;
    const [dx, dy] = this.offsetOf(l, ov);
    b = { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
    const reach = Math.min(MAX_REACH, styleReach(l.styles));
    return reach ? expand(b, reach) : b;
  }

  private static same(a: Layer, b: Layer): boolean {
    if (a === b) return true;
    const A = a as unknown as Record<string, unknown>,
      B = b as unknown as Record<string, unknown>;
    const ka = Object.keys(A);
    if (ka.length !== Object.keys(B).length) return false;
    for (const k of ka) {
      if (k === 'name' || k === 'children' || k === 'open') continue;
      if (A[k] !== B[k]) return false;
    }
    return true;
  }

  private diff(doc: Doc, ov: Overrides): void {
    const seen = new Set<string>();
    const visit = (layers: Layer[], shown: boolean) => {
      for (const l of layers) {
        seen.add(l.id);
        const vis = shown && l.visible && !ov.hide?.has(l.id);
        const xf = ov.transforms?.get(l.id);
        const off = this.offsetOf(l, ov).join(',') + (ov.rasters?.has(l.id) ? `:r${ov.rasters.get(l.id)!.id}` : '') + (vis ? '' : ':h') + (xf ? `:x${xf.inv.map((v) => v.toFixed(5)).join(',')}:${xf.raster?.id ?? ''}` : '');
        const prev = this.prev.get(l.id);
        let b: Rect | null | undefined;
        const bounds = () => (b === undefined ? (b = vis ? this.extent(l, ov) : null) : b);
        if (!prev) this.dirty = union(this.dirty, bounds());
        else if (!Compositor.same(prev.rec, l) || prev.off !== off) this.dirty = union(this.dirty, union(prev.bounds, bounds() ?? this.extent(l, ov)));
        this.prev.set(l.id, { rec: l, bounds: vis ? bounds() : this.extent(l, ov), off });
        if (l.kind === 'group') visit(l.children, vis);
        if (!vis) continue;
        // Pixels that changed.
        const r = this.rasterOf(l, ov);
        const [dx, dy] = this.offsetOf(l, ov);
        const reach = Math.min(MAX_REACH, styleReach(l.styles));
        if (r) {
          const { changed } = this.syncRaster(r);
          if (changed) this.dirty = union(this.dirty, expand({ x: changed.x + dx, y: changed.y + dy, w: changed.w, h: changed.h }, reach));
        }
        if (l.mask) {
          const { changed } = this.syncRaster(l.mask.raster);
          if (changed) this.dirty = union(this.dirty, expand(changed, reach));
        }
      }
    };
    visit(doc.layers, true);
    for (const [id, s] of this.prev) {
      if (seen.has(id)) continue;
      this.dirty = union(this.dirty, s.bounds);
      this.prev.delete(id);
    }
  }

  /** Make the composite current. Returns true when anything was drawn. */
  render(doc: Doc, ov: Overrides = {}): boolean {
    const gl = this.gl;
    const pk = `${doc.width}x${doc.height}:${doc.depth}`;
    if (pk !== this.profileKey || !this.comp) {
      this.dispose();
      this.profileKey = pk;
      this.w = doc.width;
      this.h = doc.height;
      this.depth = doc.depth;
      const f = this.gpu.caps.floatTargets ? gl.RGBA16F : gl.RGBA8;
      this.comp = makeTarget(gl, this.w, this.h, f, gl.LINEAR_MIPMAP_LINEAR);
      this.dirty = { x: 0, y: 0, w: this.w, h: this.h };
    }
    this.used.clear();
    this.diff(doc, ov);
    const r = this.dirty ? intersect(this.dirty, { x: 0, y: 0, w: this.w, h: this.h }) : null;
    this.dirty = null;
    if (!r) return false;
    const t0 = performance.now();
    this.drawRegion(doc, ov, r, this.comp);
    this.mipsStale = true;
    this.lastMs = performance.now() - t0;
    this.collect();
    return true;
  }

  /** Free textures of rasters no longer drawn (deleted layers, old history). */
  private collectTick = 0;
  private collect(): void {
    if (++this.collectTick % 30) return;
    const live = new Set<Raster>();
    const add = (layers: Layer[]) => {
      for (const l of layers) {
        if ('raster' in l) live.add(l.raster);
        if (l.mask) live.add(l.mask.raster);
        if (l.kind === 'group') add(l.children);
      }
    };
    for (const s of this.prev.values()) add([s.rec]);
    for (const [r, t] of this.texs) {
      if (live.has(r) || this.used.has(r)) continue;
      if (t.tex) this.gl.deleteTexture(t.tex);
      this.texs.delete(r);
    }
  }

  ensureMips(): void {
    if (!this.comp || !this.mipsStale) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.comp.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.mipsStale = false;
  }

  /** The document's pixels over `r` (straight alpha, floats), drawn fresh (export, eyedropper). */
  read(doc: Doc, r: Rect, ov: Overrides = {}): Float32Array {
    const gl = this.gl;
    if (!this.comp) this.render(doc, ov);
    const out = new Float32Array(r.w * r.h * 4);
    const ch = this.chunkSize(doc, ov);
    for (let y = r.y; y < r.y + r.h; y += ch) {
      for (let x = r.x; x < r.x + r.w; x += ch) {
        const c = { x, y, w: Math.min(ch, r.x + r.w - x), h: Math.min(ch, r.y + r.h - y) };
        const res = this.drawChunk(doc, ov, c);
        gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo);
        const buf = new Float32Array(c.w * c.h * 4);
        if (res.internal === gl.RGBA8) {
          const b8 = new Uint8Array(c.w * c.h * 4);
          gl.readPixels(0, 0, c.w, c.h, gl.RGBA, gl.UNSIGNED_BYTE, b8);
          for (let i = 0; i < b8.length; i++) buf[i] = b8[i]! / 255;
        } else gl.readPixels(0, 0, c.w, c.h, gl.RGBA, gl.FLOAT, buf);
        for (let yy = 0; yy < c.h; yy++) out.set(buf.subarray(yy * c.w * 4, (yy + 1) * c.w * 4), ((c.y - r.y + yy) * r.w + (c.x - r.x)) * 4);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  /** A small premultiplied RGBA8 picture of the composite (Navigator, previews). */
  thumbnail(maxSide: number): { w: number; h: number; data: Uint8Array } | null {
    if (!this.comp) return null;
    const gl = this.gl;
    const s = Math.min(1, maxSide / Math.max(this.w, this.h));
    const w = Math.max(1, Math.round(this.w * s)),
      h = Math.max(1, Math.round(this.h * s));
    this.ensureMips();
    const t = this.gpu.fxTarget('thumb', w, h);
    const p = this.gpu.program('resample');
    p.tex('uSrc', this.comp.tex).v2('uSrcSize', this.w, this.h).f('uRatio', 1 / s).i('uChan', 2);
    drawInto(gl, t, 0, 0, w, h);
    const data = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { w, h, data };
  }

  private chunkSize(doc: Doc, ov: Overrides): number {
    const styled = (layers: Layer[]): boolean => layers.some((l) => (l.visible && !ov.hide?.has(l.id) && hasStyles(l.styles)) || (l.kind === 'group' && styled(l.children)));
    return Math.min(this.gpu.caps.maxTexture, styled(doc.layers) ? CH_FX : CH);
  }

  private drawRegion(doc: Doc, ov: Overrides, r: Rect, into: Target): void {
    const gl = this.gl;
    const ch = this.chunkSize(doc, ov);
    for (let y = r.y; y < r.y + r.h; y += ch) {
      for (let x = r.x; x < r.x + r.w; x += ch) {
        const c = { x, y, w: Math.min(ch, r.x + r.w - x), h: Math.min(ch, r.y + r.h - y) };
        const res = this.drawChunk(doc, ov, c);
        const p = this.gpu.program('copy');
        p.tex('uSrc', res.tex).iv2('uOffset', c.x, c.y).i('uPremul', 1);
        drawInto(gl, into, c.x, c.y, c.w, c.h);
      }
    }
  }

  // ---- drawing ----

  private size = CH;
  private levels: { t: Target[]; cur: number }[] = [];

  private level(i: number): { t: Target[]; cur: number } {
    while (this.levels.length <= i) this.levels.push({ t: [], cur: 0 });
    const L = this.levels[i]!;
    L.t = this.gpu.stack(this.depth, i, this.size);
    return L;
  }

  /** Draw one chunk; returns the target holding it (straight alpha). */
  private drawChunk(doc: Doc, ov: Overrides, c: Rect): Target {
    this.size = c.w > CH_FX || c.h > CH_FX ? CH : this.chunkSize(doc, ov) === CH_FX ? CH_FX : CH;
    if (this.size < Math.max(c.w, c.h)) this.size = CH;
    this.levels = [];
    const L = this.level(0);
    L.cur = 0;
    clearTarget(this.gl, L.t[0]!, c.w, c.h);
    this.drawList(doc, ov, doc.layers, 0, c);
    return L.t[L.cur]!;
  }

  private visible(l: Layer, ov: Overrides): boolean {
    return l.visible && !ov.hide?.has(l.id);
  }

  private drawList(doc: Doc, ov: Overrides, layers: Layer[], lv: number, c: Rect, preserve = false): void {
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]!;
      if (l.clip && i > 0) continue;
      const clipped: Layer[] = [];
      for (let j = i + 1; j < layers.length && layers[j]!.clip; j++) clipped.push(layers[j]!);
      if (!this.visible(l, ov)) continue;
      const ext = this.extent(l, ov);
      if (!ext || !intersect(ext, c)) continue;
      if (clipped.some((x) => this.visible(x, ov))) this.drawClip(doc, ov, l, clipped, lv, c, preserve);
      else this.drawLayer(doc, ov, l, lv, c, preserve);
    }
  }

  private swap(lv: number): void {
    const L = this.levels[lv]!;
    L.cur = 1 - L.cur;
  }

  private front(lv: number): Target {
    const L = this.levels[lv]!;
    return L.t[L.cur]!;
  }

  private back(lv: number): Target {
    const L = this.levels[lv]!;
    return L.t[1 - L.cur]!;
  }

  private maskUniforms(p: Program, doc: Doc, l: Layer): void {
    const m = l.mask;
    if (m && m.enabled) {
      this.bindRaster(p, 'uMask', m.raster);
      p.i('uHasMask', 1).f('uMaskBg', m.background).f('uMaskDensity', m.density);
    } else p.i('uHasMask', 0);
    if (l.vmask && l.vmask.enabled) {
      p.tex('uVMask', this.vmaskTex(doc, l.vmask.path)).i('uHasVMask', 1);
    } else p.i('uHasVMask', 0);
  }

  private vmaskTex(doc: Doc, path: VectorPath): WebGLTexture {
    const c = this.vmaskCache.get(path);
    if (c && c.w === doc.width && c.h === doc.height) return c.tex;
    if (c) this.gl.deleteTexture(c.tex);
    const m = pathMask(doc.width, doc.height, path, true);
    const gl = this.gl;
    const tex = makeTexture(gl, doc.width, doc.height, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.NEAREST, m.data);
    this.vmaskCache.set(path, { tex, w: doc.width, h: doc.height });
    return tex;
  }

  private rampTex(key: string, data: Float32Array): WebGLTexture {
    let t = this.rampCache.get(key);
    if (!t) {
      const gl = this.gl;
      t = makeTexture(gl, data.length / 4, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, data);
      this.rampCache.set(key, t);
      if (this.rampCache.size > 64) {
        const first = this.rampCache.keys().next().value as string;
        gl.deleteTexture(this.rampCache.get(first)!);
        this.rampCache.delete(first);
      }
    }
    return t;
  }

  private patternTex(id: string): { tex: WebGLTexture; w: number; h: number } {
    const p = getPattern(id);
    let t = this.patCache.get(p.id);
    if (!t) {
      const gl = this.gl;
      t = makeTexture(gl, p.img.w, p.img.h, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, p.img.data);
      this.patCache.set(p.id, t);
    }
    return { tex: t, w: p.img.w, h: p.img.h };
  }

  /** Set the layer program's source uniforms for a layer's content. */
  private sourceUniforms(p: Program, doc: Doc, ov: Overrides, l: Layer): void {
    const xf = ov.transforms?.get(l.id);
    if (xf && l.kind !== 'fill') {
      const r = xf.raster ?? this.rasterOf(l, ov);
      p.i('uSrcKind', 0);
      if (r) this.bindRaster(p, 'uSrc', r);
      const m = xf.inv;
      // GLSL wants columns.
      p.i('uHasXform', 1).m3('uXform', [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!]);
      return;
    }
    if (l.kind === 'fill') this.fillUniforms(p, doc, l.content);
    else {
      const r = this.rasterOf(l, ov);
      p.i('uSrcKind', 0);
      if (r) this.bindRaster(p, 'uSrc', r, this.offsetOf(l, ov));
    }
  }

  private fillUniforms(p: Program, doc: Doc, f: FillContent): void {
    if (f.type === 'solid') {
      p.i('uSrcKind', 1).v4('uColor', f.color[0], f.color[1], f.color[2], f.color[3]);
    } else if (f.type === 'pattern') {
      const t = this.patternTex(f.pattern);
      p.i('uSrcKind', 3).tex('uPattern', t.tex).iv2('uPatSize', t.w, t.h).f('uPatScale', f.scale).v2('uPatOffset', f.ox, f.oy);
    } else {
      const key = JSON.stringify([f.gradient, f.reverse]);
      p.i('uSrcKind', 2).tex('uRamp', this.rampTex(key, gradientRamp(f.gradient, 256, f.reverse)));
      const style = ['linear', 'radial', 'angle', 'reflected', 'diamond'].indexOf(f.style);
      const [x0, y0, x1, y1] = gradientEnds(f, doc);
      p.i('uGradStyle', style).v2('uG0', x0, y0).v2('uG1', x1, y1).i('uDither', this.depth === 8 && f.dither !== false ? 1 : 0);
    }
  }

  private layerProgram(): Program {
    return this.gpu.program('layer', this.depth).i('uHasXform', 0);
  }

  private finishLayer(p: Program, lv: number, c: Rect): void {
    this.fill(p, ['uBack', 'uRamp', 'uPattern', 'uFloat', 'uVMask', 'uMask'], ['uSrc']);
    drawInto(this.gl, this.back(lv), 0, 0, c.w, c.h);
    this.swap(lv);
  }

  /** Draw a float texture (a group's or clipping group's result) over the backdrop. */
  private drawFloat(doc: Doc, l: Layer, src: Target, lv: number, c: Rect, alpha: number, mode: number, preserve: boolean, withMask = true): void {
    const p = this.layerProgram();
    p.tex('uBack', this.front(lv).tex).iv2('uOrigin', c.x, c.y).i('uBackEmpty', 0);
    p.i('uSrcKind', 4).tex('uFloat', src.tex).iv2('uFloatOrigin', c.x, c.y).iv2('uFloatSize', c.w, c.h);
    if (withMask) this.maskUniforms(p, doc, l);
    else p.i('uHasMask', 0).i('uHasVMask', 0);
    p.f('uAlpha', alpha).i('uMode', mode).i('uPreserve', preserve ? 1 : 0).i('uDither', 0);
    this.finishLayer(p, lv, c);
  }

  private drawClip(doc: Doc, ov: Overrides, base: Layer, clipped: Layer[], lv: number, c: Rect, preserve: boolean): void {
    const sub = this.level(lv + 1);
    sub.cur = 0;
    clearTarget(this.gl, sub.t[0]!, c.w, c.h);
    this.drawLayer(doc, ov, { ...base, blend: 'normal', opacity: 1 } as Layer, lv + 1, c, false);
    for (const k of clipped) if (this.visible(k, ov)) this.drawLayer(doc, ov, k, lv + 1, c, true);
    this.drawFloat(doc, base, this.front(lv + 1), lv, c, base.opacity, blendIndex(base.blend), preserve, false);
  }

  private drawLayer(doc: Doc, ov: Overrides, l: Layer, lv: number, c: Rect, preserve: boolean): void {
    const gl = this.gl;
    if (l.kind === 'group') {
      const masked = (l.mask && l.mask.enabled) || (l.vmask && l.vmask.enabled);
      if (l.passThrough && !preserve) {
        if (l.opacity >= 1 && !masked) {
          this.drawList(doc, ov, l.children, lv, c);
          return;
        }
        // Over a copy of the backdrop, then mixed back by opacity and mask.
        const sub = this.level(lv + 1);
        sub.cur = 0;
        const cp = this.gpu.program('copy');
        cp.tex('uSrc', this.front(lv).tex).iv2('uOffset', 0, 0).i('uPremul', 0);
        drawInto(gl, sub.t[0]!, 0, 0, c.w, c.h);
        this.drawList(doc, ov, l.children, lv + 1, c);
        const p = this.gpu.program('mix', this.depth);
        p.tex('uBefore', this.front(lv).tex).tex('uAfter', this.front(lv + 1).tex).iv2('uOrigin', c.x, c.y);
        this.maskUniforms(p, doc, l);
        p.f('uAlpha', l.opacity);
        this.fill(p, ['uBefore', 'uAfter', 'uVMask', 'uMask']);
        drawInto(gl, this.back(lv), 0, 0, c.w, c.h);
        this.swap(lv);
        return;
      }
      const sub = this.level(lv + 1);
      sub.cur = 0;
      clearTarget(gl, sub.t[0]!, c.w, c.h);
      this.drawList(doc, ov, l.children, lv + 1, c);
      if (hasStyles(l.styles)) this.drawStyled(doc, ov, l, lv, c, preserve, this.front(lv + 1));
      else this.drawFloat(doc, l, this.front(lv + 1), lv, c, l.opacity * l.fill, blendIndex(l.blend), preserve);
      return;
    }
    if (l.kind === 'adjust') {
      this.drawAdjust(doc, l, lv, c);
      return;
    }
    if (hasStyles(l.styles)) {
      this.drawStyled(doc, ov, l, lv, c, preserve, null);
      return;
    }
    const p = this.layerProgram();
    p.tex('uBack', this.front(lv).tex).iv2('uOrigin', c.x, c.y).i('uBackEmpty', 0);
    this.sourceUniforms(p, doc, ov, l);
    this.maskUniforms(p, doc, l);
    p.f('uAlpha', l.opacity * l.fill).i('uMode', blendIndex(l.blend)).i('uPreserve', preserve ? 1 : 0);
    if (l.kind !== 'fill') p.i('uDither', 0);
    this.finishLayer(p, lv, c);
  }

  private drawAdjust(doc: Doc, l: Extract<Layer, { kind: 'adjust' }>, lv: number, c: Rect): void {
    if (isIdentity(l.adjust, l.params) && l.blend === 'normal') return;
    const gl = this.gl;
    let cached = this.lutCache.get(l.params as object);
    const ctx = { trc: doc.depth === 32 ? ({ type: 'linear' } as const) : doc.profile.trc };
    if (!cached) {
      const comp = compile(l.adjust, l.params, ctx);
      cached = { c: comp, n: 0 };
      if (comp.kind === 'lut1d') {
        cached.t1 = makeTexture(gl, comp.n, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, comp.data);
        cached.n = comp.n;
      } else if (comp.kind === 'lut3d') {
        const n = comp.size;
        // Re-lay the table as (n·n) × n: x = r + n·b, y = g.
        const d = new Float32Array(n * n * n * 4);
        for (let b = 0; b < n; b++)
          for (let g = 0; g < n; g++)
            for (let r = 0; r < n; r++) {
              const src = ((b * n + g) * n + r) * 4;
              const dst = (g * n * n + r + n * b) * 4;
              d[dst] = comp.data[src]!;
              d[dst + 1] = comp.data[src + 1]!;
              d[dst + 2] = comp.data[src + 2]!;
              d[dst + 3] = 1;
            }
        cached.t3 = makeTexture(gl, n * n, n, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, d);
        cached.n = n;
      }
      this.lutCache.set(l.params as object, cached);
    }
    if (cached.c.kind === 'identity' && l.blend === 'normal') return;
    const p = this.gpu.program('adjust', this.depth);
    p.tex('uBack', this.front(lv).tex).iv2('uOrigin', c.x, c.y);
    const kind = cached.c.kind === 'lut1d' ? 1 : cached.c.kind === 'lut3d' ? 2 : cached.c.kind === 'threshold' ? 3 : 1;
    p.i('uKind', kind);
    if (cached.t1) p.tex('uLut1', cached.t1).i('uLut1N', cached.n);
    if (cached.t3) p.tex('uLut3', cached.t3).i('uLut3N', cached.n);
    if (cached.c.kind === 'threshold') p.f('uThreshold', cached.c.level);
    if (cached.c.kind === 'identity') {
      // Identity table with a blend mode: a 2-entry ramp 0..1.
      p.tex('uLut1', this.rampTex('identity', new Float32Array([0, 0, 0, 1, 1, 1, 1, 1]))).i('uLut1N', 2).i('uKind', 1);
    }
    p.i('uLinear', doc.depth === 32 ? 1 : 0);
    this.maskUniforms(p, doc, l);
    p.f('uAlpha', l.opacity * l.fill).i('uMode', blendIndex(l.blend));
    this.fill(p, ['uBack', 'uLut1', 'uLut3', 'uVMask', 'uMask']);
    drawInto(gl, this.back(lv), 0, 0, c.w, c.h);
    this.swap(lv);
  }

  // ---- layer styles ----

  /**
   * A layer with effects: its own pixels (with its mask) drawn alone around
   * the chunk, blurred / distance-mapped as each effect needs, and each
   * effect laid over the backdrop in Photoshop's order.
   */
  private drawStyled(doc: Doc, ov: Overrides, l: Layer, lv: number, c: Rect, preserve: boolean, groupSrc: Target | null): void {
    const gl = this.gl;
    const st = l.styles as LayerStyles;
    const reach = Math.min(MAX_REACH, styleReach(st));
    const E = expand(c, reach);
    // S: the layer alone (straight alpha) over E.
    const S = this.gpu.fxTarget('S', E.w, E.h);
    clearTarget(gl, S, E.w, E.h);
    {
      const p = this.layerProgram();
      p.i('uBackEmpty', 1).iv2('uOrigin', E.x, E.y);
      if (groupSrc) p.i('uSrcKind', 4).tex('uFloat', groupSrc.tex).iv2('uFloatOrigin', c.x, c.y).iv2('uFloatSize', c.w, c.h);
      else this.sourceUniforms(p, doc, ov, l);
      this.maskUniforms(p, doc, l);
      p.f('uAlpha', 1).i('uMode', 0).i('uPreserve', 0).i('uDither', 0);
      this.fill(p, ['uBack', 'uRamp', 'uPattern', 'uFloat', 'uVMask', 'uMask'], ['uSrc']);
      drawInto(gl, S, 0, 0, E.w, E.h);
    }
    const op = l.opacity;
    const blurs = new Map<string, { t: Target; scale: number }>();
    const blur = (sigma: number, inverted: boolean) => {
      const key = `${sigma.toFixed(2)}:${inverted}`;
      let b = blurs.get(key);
      if (!b) {
        b = this.blur(S, E, sigma, inverted, blurs.size);
        blurs.set(key, b);
      }
      return b;
    };
    const fx = (kind: number, setup: (p: Program) => void, b?: { t: Target; scale: number }) => {
      const p = this.gpu.program('fx');
      p.tex('uBack', this.front(lv).tex).iv2('uOrigin', c.x, c.y).tex('uS', S.tex).iv2('uE', E.x, E.y).i('uFx', kind);
      if (b) p.tex('uB', b.t.tex).v2('uBSize', b.t.w, b.t.h).f('uBScale', b.scale);
      p.v2('uShift', 0, 0).v2('uShift2', 0, 0).i('uFlag', 0).f('uSpread', 0);
      setup(p);
      this.fill(p, ['uBack', 'uS', 'uB', 'uJ', 'uJ2', 'uRamp', 'uPattern']);
      drawInto(gl, this.back(lv), 0, 0, c.w, c.h);
      this.swap(lv);
    };
    const shift = (angle: number, dist: number): [number, number] => [-Math.cos((angle * Math.PI) / 180) * dist, Math.sin((angle * Math.PI) / 180) * dist];
    const sig = (size: number, spread: number) => Math.max(0.3, (size * (1 - spread)) / 2);

    if (st.dropShadow?.on) {
      const d = st.dropShadow;
      const b = blur(sig(d.size, d.spread), false);
      const [sx, sy] = shift(d.angle, d.distance);
      fx(1, (p) => p.v3('uColor', ...d.color).f('uOpacity', d.opacity * op).i('uMode', blendIndex(d.blend)).f('uSpread', d.spread).v2('uShift', sx, sy).i('uFlag', d.knockout ? 1 : 0), b);
    }
    if (st.outerGlow?.on) {
      const g = st.outerGlow;
      const b = blur(sig(g.size, g.spread), false);
      fx(2, (p) => p.v3('uColor', ...g.color).f('uOpacity', g.opacity * op).i('uMode', blendIndex(g.blend)).f('uSpread', g.spread), b);
    }
    // The layer's own pixels (with Fill).
    {
      const p = this.layerProgram();
      p.tex('uBack', this.front(lv).tex).iv2('uOrigin', c.x, c.y).i('uBackEmpty', 0);
      p.i('uSrcKind', 4).tex('uFloat', S.tex).iv2('uFloatOrigin', E.x, E.y).iv2('uFloatSize', E.w, E.h);
      p.i('uHasMask', 0).i('uHasVMask', 0);
      p.f('uAlpha', op * l.fill).i('uMode', blendIndex(l.blend)).i('uPreserve', preserve ? 1 : 0).i('uDither', 0);
      this.finishLayer(p, lv, c);
    }
    const bounds = this.extent({ ...l, styles: undefined } as Layer, ov) ?? c;
    if (st.patternOverlay?.on) {
      const po = st.patternOverlay;
      const t = this.patternTex(po.pattern);
      fx(8, (p) => p.tex('uPattern', t.tex).iv2('uPatSize', t.w, t.h).f('uPatScale', po.scale).v2('uPatOffset', 0, 0).f('uOpacity', po.opacity * op).i('uMode', blendIndex(po.blend)));
    }
    if (st.gradientOverlay?.on) {
      const g = st.gradientOverlay;
      const cx = bounds.x + bounds.w / 2,
        cy = bounds.y + bounds.h / 2;
      const a = (g.angle * Math.PI) / 180;
      const half = ((Math.abs(Math.cos(a)) * bounds.w + Math.abs(Math.sin(a)) * bounds.h) / 2) * g.scale;
      const centered = g.style !== 'linear';
      const style = ['linear', 'radial', 'angle', 'reflected', 'diamond'].indexOf(g.style);
      fx(7, (p) =>
        p
          .tex('uRamp', this.rampTex(JSON.stringify([g.gradient, g.reverse]), gradientRamp(g.gradient, 256, g.reverse)))
          .i('uGradStyle', style)
          .v2('uG0', centered ? cx : cx - Math.cos(a) * half, centered ? cy : cy + Math.sin(a) * half)
          .v2('uG1', cx + Math.cos(a) * half, cy - Math.sin(a) * half)
          .f('uOpacity', g.opacity * op)
          .i('uMode', blendIndex(g.blend)),
      );
    }
    if (st.colorOverlay?.on) {
      const co = st.colorOverlay;
      fx(6, (p) => p.v3('uColor', ...co.color).f('uOpacity', co.opacity * op).i('uMode', blendIndex(co.blend)));
    }
    if (st.satin?.on) {
      const s = st.satin;
      const b = blur(Math.max(0.3, s.size / 2), false);
      const [sx, sy] = shift(s.angle, s.distance);
      fx(5, (p) => p.v3('uColor', ...s.color).f('uOpacity', s.opacity * op).i('uMode', blendIndex(s.blend)).v2('uShift', sx, sy).v2('uShift2', -sx, -sy).i('uFlag', s.invert ? 1 : 0), b);
    }
    if (st.innerGlow?.on) {
      const g = st.innerGlow;
      const b = blur(sig(g.size, g.spread), true);
      fx(4, (p) => p.v3('uColor', ...g.color).f('uOpacity', g.opacity * op).i('uMode', blendIndex(g.blend)).f('uSpread', g.spread).i('uFlag', g.source === 'center' ? 1 : 0), b);
    }
    if (st.innerShadow?.on) {
      const d = st.innerShadow;
      const b = blur(sig(d.size, d.spread), true);
      const [sx, sy] = shift(d.angle, d.distance);
      fx(3, (p) => p.v3('uColor', ...d.color).f('uOpacity', d.opacity * op).i('uMode', blendIndex(d.blend)).f('uSpread', d.spread).v2('uShift', sx, sy), b);
    }
    if (st.stroke?.on) {
      const s = st.stroke;
      const steps = Math.ceil(s.size) + 2;
      const outside = s.position !== 'inside' ? this.jfa(S, E, false, steps, 'J') : null;
      const inside = s.position !== 'outside' ? this.jfa(S, E, true, steps, 'K') : null;
      fx(9, (p) => {
        if (outside) p.tex('uJ', outside.tex);
        if (inside) p.tex('uJ2', inside.tex);
        p.v3('uColor', ...s.color)
          .f('uOpacity', s.opacity * op)
          .i('uMode', blendIndex(s.blend))
          .f('uSize', s.size)
          .i('uFlag', s.position === 'outside' ? 0 : s.position === 'inside' ? 1 : 2);
      });
    }
    if (st.bevel?.on) {
      const bv = st.bevel;
      const b = blur(Math.max(0.5, bv.size / 2 + bv.soften / 2), false);
      const a = (bv.angle * Math.PI) / 180,
        al = (bv.altitude * Math.PI) / 180;
      const style = { inner: 0, outer: 1, emboss: 2, pillow: 3 }[bv.style];
      fx(
        10,
        (p) =>
          p
            .v3('uColor', ...bv.highlightColor)
            .v3('uColor2', ...bv.shadowColor)
            .f('uOpacity', bv.highlightOpacity * op)
            .f('uOpacity2', bv.shadowOpacity * op)
            .i('uMode', blendIndex(bv.highlightBlend))
            .i('uMode2', blendIndex(bv.shadowBlend))
            .v3('uLight', Math.cos(al) * Math.cos(a), -Math.cos(al) * Math.sin(a), Math.sin(al))
            .f('uDepth', bv.depth)
            .f('uSize', Math.max(1, bv.size))
            .i('uFlag', bv.direction === 'down' ? 1 : 0)
            .i('uBevelStyle', style),
        b,
      );
    }
  }

  /** Gaussian blur of S's alpha (or 1 − alpha) over E, at a reduced scale for large sigmas. */
  private blur(S: Target, E: Rect, sigma: number, inverted: boolean, slot: number): { t: Target; scale: number } {
    const gl = this.gl;
    let scale = 1;
    while (sigma / scale > 3 && scale < 32) scale *= 2;
    // Halve step by step (bilinear = exact 2×2 average), the first step picking the channel.
    let src = S;
    let w = E.w,
      h = E.h;
    let chan = inverted ? 1 : 0;
    let level = 0;
    const res = (lvl: number, ab: string) => this.gpu.fxTarget(`b${slot}:${lvl}:${ab}`, Math.ceil(E.w / (1 << lvl)) + 1, Math.ceil(E.h / (1 << lvl)) + 1);
    {
      const t = res(0, 'a');
      const p = this.gpu.program('resample');
      p.tex('uSrc', src.tex).v2('uSrcSize', src.w, src.h).f('uRatio', 1).i('uChan', chan);
      drawInto(gl, t, 0, 0, w, h);
      src = t;
      chan = 2;
    }
    while ((1 << level) < scale) {
      level++;
      const nw = Math.ceil(E.w / (1 << level)),
        nh = Math.ceil(E.h / (1 << level));
      const t = res(level, 'a');
      const p = this.gpu.program('resample');
      p.tex('uSrc', src.tex).v2('uSrcSize', src.w, src.h).f('uRatio', 2).i('uChan', 2);
      drawInto(gl, t, 0, 0, nw, nh);
      src = t;
      w = nw;
      h = nh;
    }
    const s = sigma / scale;
    if (s >= 0.3) {
      const tmp = res(level, 'b');
      const p = this.gpu.program('blur');
      p.tex('uSrc', src.tex).iv2('uDir', 1, 0).f('uSigma', Math.min(4, s)).iv2('uSize', w, h);
      drawInto(gl, tmp, 0, 0, w, h);
      const p2 = this.gpu.program('blur');
      p2.tex('uSrc', tmp.tex).iv2('uDir', 0, 1).f('uSigma', Math.min(4, s)).iv2('uSize', w, h);
      drawInto(gl, src, 0, 0, w, h);
    }
    return { t: src, scale };
  }

  /** Nearest seed for every pixel of E (jump flooding), seeds where S is inside (or outside). */
  private jfa(S: Target, E: Rect, inside: boolean, maxDist: number, name: string): Target {
    const gl = this.gl;
    const a = this.gpu.fxTarget(`${name}a`, E.w, E.h),
      b = this.gpu.fxTarget(`${name}b`, E.w, E.h);
    const p = this.gpu.program('jfaInit');
    p.tex('uSrc', S.tex).i('uInside', inside ? 1 : 0);
    drawInto(gl, a, 0, 0, E.w, E.h);
    let src = a,
      dst = b;
    let step = 1;
    while (step * 2 <= maxDist) step *= 2;
    for (; step >= 1; step = Math.floor(step / 2)) {
      const q = this.gpu.program('jfaStep');
      q.tex('uSrc', src.tex).i('uStep', step).iv2('uSize', E.w, E.h);
      drawInto(gl, dst, 0, 0, E.w, E.h);
      [src, dst] = [dst, src];
    }
    return src;
  }
}
