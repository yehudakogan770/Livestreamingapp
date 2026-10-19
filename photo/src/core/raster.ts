// Sparse tiled rasters: 256×256 tiles kept in a map by tile position (tiles
// may sit outside the canvas, so moved layers keep their pixels). A missing
// tile is empty (transparent, or a mask's background). Values are stored at
// the document's depth: 8-bit (0..255), 16-bit (0..65535) or 32-bit float.
//
// Tiles are shared between rasters and history steps by reference and are
// never changed once an edit is committed: an edit (TileEdit) copies a tile
// the first time it touches it and keeps the old one for undo.

import type { Depth, Rect } from './types';

export const TILE = 256;
export const TILE_SHIFT = 8;
export type TileArray = Uint8Array | Uint16Array | Float32Array;

export interface Tile {
  data: TileArray;
  /** Changes whenever the tile's pixels change (the GPU uploads tiles whose version moved). */
  v: number;
}

let versions = 1;
export const nextVersion = () => ++versions;

const OFF = 32768;
export const tileKey = (tx: number, ty: number) => (tx + OFF) * 65536 + (ty + OFF);
export const keyX = (k: number) => Math.floor(k / 65536) - OFF;
export const keyY = (k: number) => (k % 65536) - OFF;

export function newTileArray(depth: Depth, channels: number): TileArray {
  const n = TILE * TILE * channels;
  return depth === 8 ? new Uint8Array(n) : depth === 16 ? new Uint16Array(n) : new Float32Array(n);
}

const scaleOf = (depth: Depth) => (depth === 8 ? 255 : depth === 16 ? 65535 : 1);

let rasterIds = 1;

export class Raster {
  readonly depth: Depth;
  readonly channels: 1 | 4;
  tiles: Map<number, Tile>;
  /** Changes on every change (cheap test for caches). */
  version = nextVersion();
  readonly id = rasterIds++;

  constructor(depth: Depth, channels: 1 | 4, tiles?: Map<number, Tile>) {
    this.depth = depth;
    this.channels = channels;
    this.tiles = tiles ?? new Map();
  }

  get scale(): number {
    return scaleOf(this.depth);
  }

  /** A copy sharing the tiles (cheap; tiles are immutable once committed). */
  clone(): Raster {
    return new Raster(this.depth, this.channels, new Map(this.tiles));
  }

  /** A deep copy (new tile arrays). */
  deepClone(): Raster {
    const t = new Map<number, Tile>();
    for (const [k, tile] of this.tiles) t.set(k, { data: tile.data.slice(), v: nextVersion() });
    return new Raster(this.depth, this.channels, t);
  }

  isEmpty(): boolean {
    return this.tiles.size === 0;
  }

  touchVersion(): void {
    this.version = nextVersion();
  }

  /** The tiles' area (not trimmed to the painted pixels). */
  tileBounds(): Rect | null {
    if (this.tiles.size === 0) return null;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const k of this.tiles.keys()) {
      const tx = keyX(k),
        ty = keyY(k);
      if (tx < x0) x0 = tx;
      if (ty < y0) y0 = ty;
      if (tx > x1) x1 = tx;
      if (ty > y1) y1 = ty;
    }
    return { x: x0 * TILE, y: y0 * TILE, w: (x1 - x0 + 1) * TILE, h: (y1 - y0 + 1) * TILE };
  }

  private boundsCache: { v: number; b: Rect | null } | null = null;

  /** contentBounds(), remembered until the raster changes. */
  contentBoundsCached(): Rect | null {
    if (this.boundsCache && this.boundsCache.v === this.version) return this.boundsCache.b;
    const b = this.contentBounds();
    this.boundsCache = { v: this.version, b };
    return b;
  }

  /** The painted pixels' bounds (alpha, or the value for 1-channel rasters, above zero). */
  contentBounds(): Rect | null {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    const c = this.channels;
    const a = c - 1;
    for (const [k, tile] of this.tiles) {
      const bx = keyX(k) * TILE,
        by = keyY(k) * TILE;
      const d = tile.data;
      for (let y = 0; y < TILE; y++) {
        const row = y * TILE * c;
        let first = -1,
          last = -1;
        for (let x = 0; x < TILE; x++) {
          if (d[row + x * c + a]! > 0) {
            if (first < 0) first = x;
            last = x;
          }
        }
        if (first >= 0) {
          if (bx + first < x0) x0 = bx + first;
          if (bx + last > x1) x1 = bx + last;
          if (by + y < y0) y0 = by + y;
          if (by + y > y1) y1 = by + y;
        }
      }
    }
    if (x0 === Infinity) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /**
   * The pixels of `r` as floats 0..1 (32-bit: as stored), `channels` per pixel,
   * row by row. Outside the tiles: `empty` (all channels).
   */
  read(r: Rect, out?: Float32Array, empty = 0): Float32Array {
    const c = this.channels;
    const dst = out ?? new Float32Array(r.w * r.h * c);
    if (empty !== 0) dst.fill(empty);
    else if (out) dst.fill(0);
    const inv = 1 / this.scale;
    const tx0 = Math.floor(r.x / TILE),
      ty0 = Math.floor(r.y / TILE);
    const tx1 = Math.floor((r.x + r.w - 1) / TILE),
      ty1 = Math.floor((r.y + r.h - 1) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const tile = this.tiles.get(tileKey(tx, ty));
        if (!tile) continue;
        const d = tile.data;
        const ox = tx * TILE,
          oy = ty * TILE;
        const sx0 = Math.max(r.x, ox),
          sy0 = Math.max(r.y, oy);
        const sx1 = Math.min(r.x + r.w, ox + TILE),
          sy1 = Math.min(r.y + r.h, oy + TILE);
        const n = (sx1 - sx0) * c;
        for (let y = sy0; y < sy1; y++) {
          let s = ((y - oy) * TILE + (sx0 - ox)) * c;
          let o = ((y - r.y) * r.w + (sx0 - r.x)) * c;
          if (inv === 1) {
            for (let i = 0; i < n; i++) dst[o++] = d[s++]!;
          } else {
            for (let i = 0; i < n; i++) dst[o++] = d[s++]! * inv;
          }
        }
      }
    }
    return dst;
  }

  /**
   * Write floats (0..1, `channels` per pixel) into `r`. With an edit, tiles are
   * copied on first touch (undo); without one, tiles are changed in place
   * (only for rasters no history step holds yet).
   */
  write(r: Rect, src: Float32Array, edit?: TileEdit | null, skipEmpty = false): void {
    const c = this.channels;
    const scale = this.scale;
    const int = this.depth !== 32;
    const tx0 = Math.floor(r.x / TILE),
      ty0 = Math.floor(r.y / TILE);
    const tx1 = Math.floor((r.x + r.w - 1) / TILE),
      ty1 = Math.floor((r.y + r.h - 1) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const ox = tx * TILE,
          oy = ty * TILE;
        const sx0 = Math.max(r.x, ox),
          sy0 = Math.max(r.y, oy);
        const sx1 = Math.min(r.x + r.w, ox + TILE),
          sy1 = Math.min(r.y + r.h, oy + TILE);
        const n = (sx1 - sx0) * c;
        if (skipEmpty && !this.tiles.has(tileKey(tx, ty))) {
          // Leave missing tiles missing when the part written is empty.
          let any = false;
          for (let y = sy0; y < sy1 && !any; y++) {
            let o = ((y - r.y) * r.w + (sx0 - r.x)) * c;
            for (let i = 0; i < n; i++)
              if (src[o++] !== 0) {
                any = true;
                break;
              }
          }
          if (!any) continue;
        }
        const tile = edit ? edit.touch(tx, ty) : this.ensure(tx, ty);
        const d = tile.data;
        for (let y = sy0; y < sy1; y++) {
          let s = ((y - oy) * TILE + (sx0 - ox)) * c;
          let o = ((y - r.y) * r.w + (sx0 - r.x)) * c;
          if (!int) {
            for (let i = 0; i < n; i++) d[s++] = src[o++]!;
          } else {
            for (let i = 0; i < n; i++) {
              const v = src[o++]!;
              d[s++] = v <= 0 ? 0 : v >= 1 ? scale : Math.round(v * scale);
            }
          }
        }
        tile.v = nextVersion();
      }
    }
    this.version = nextVersion();
  }

  /** A tile to change in place (made if missing). */
  ensure(tx: number, ty: number): Tile {
    const k = tileKey(tx, ty);
    let t = this.tiles.get(k);
    if (!t) {
      t = { data: newTileArray(this.depth, this.channels), v: nextVersion() };
      this.tiles.set(k, t);
    }
    return t;
  }

  /** One pixel (0..1 floats). */
  pixel(x: number, y: number, out: Float32Array | number[] = new Float32Array(this.channels)): Float32Array | number[] {
    const tile = this.tiles.get(tileKey(x >> TILE_SHIFT, y >> TILE_SHIFT));
    const c = this.channels;
    if (!tile) {
      for (let i = 0; i < c; i++) out[i] = 0;
      return out;
    }
    const inv = 1 / this.scale;
    const o = (((y & (TILE - 1)) * TILE + (x & (TILE - 1))) * c) | 0;
    for (let i = 0; i < c; i++) out[i] = tile.data[o + i]! * inv;
    return out;
  }

  /** Drop tiles that are entirely empty (after an edit; keeps memory down). */
  prune(keys?: Iterable<number>): void {
    const list = keys ? [...keys] : [...this.tiles.keys()];
    const a = this.channels - 1;
    const c = this.channels;
    for (const k of list) {
      const t = this.tiles.get(k);
      if (!t) continue;
      const d = t.data;
      let empty = true;
      for (let i = a; i < d.length; i += c) {
        if (d[i] !== 0) {
          empty = false;
          break;
        }
      }
      if (empty) this.tiles.delete(k);
    }
  }

  /** Bytes held by the tiles. */
  bytes(): number {
    let n = 0;
    for (const t of this.tiles.values()) n += t.data.byteLength;
    return n;
  }

  /** The raster moved by (dx, dy) pixels (a new raster; whole-tile moves share tiles). */
  shifted(dx: number, dy: number): Raster {
    dx = Math.round(dx);
    dy = Math.round(dy);
    if (dx === 0 && dy === 0) return this.clone();
    if (dx % TILE === 0 && dy % TILE === 0) {
      const t = new Map<number, Tile>();
      for (const [k, tile] of this.tiles) t.set(tileKey(keyX(k) + dx / TILE, keyY(k) + dy / TILE), tile);
      return new Raster(this.depth, this.channels, t);
    }
    const out = new Raster(this.depth, this.channels);
    const b = this.tileBounds();
    if (!b) return out;
    // Row bands keep memory small for large layers.
    const band = TILE;
    for (let y = b.y; y < b.y + b.h; y += band) {
      const r = { x: b.x, y, w: b.w, h: Math.min(band, b.y + b.h - y) };
      const px = this.read(r);
      out.write({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }, px, null, true);
    }
    out.prune();
    return out;
  }

  /** Raster with the same pixels at another depth. */
  convert(depth: Depth): Raster {
    if (depth === this.depth) return this.clone();
    const out = new Raster(depth, this.channels);
    const from = this.scale;
    const to = scaleOf(depth);
    for (const [k, tile] of this.tiles) {
      const d = newTileArray(depth, this.channels);
      const s = tile.data;
      const f = to / from;
      if (depth === 32) for (let i = 0; i < s.length; i++) d[i] = s[i]! / from;
      else for (let i = 0; i < s.length; i++) d[i] = Math.max(0, Math.min(to, Math.round(s[i]! * f)));
      out.tiles.set(k, { data: d, v: nextVersion() });
    }
    return out;
  }

  /** A raster from straight-alpha floats (`channels` per pixel) placed at (x, y). */
  static fromFloats(depth: Depth, channels: 1 | 4, r: Rect, data: Float32Array): Raster {
    const out = new Raster(depth, channels);
    out.write(r, data, null, true);
    out.prune();
    return out;
  }

  /** A raster from 8-bit RGBA (canvas ImageData). */
  static fromRGBA8(depth: Depth, w: number, h: number, data: Uint8ClampedArray | Uint8Array, x = 0, y = 0): Raster {
    const out = new Raster(depth, 4);
    const rows = TILE;
    for (let y0 = 0; y0 < h; y0 += rows) {
      const hh = Math.min(rows, h - y0);
      const f = new Float32Array(w * hh * 4);
      const base = y0 * w * 4;
      for (let i = 0; i < f.length; i++) f[i] = data[base + i]! / 255;
      out.write({ x, y: y + y0, w, h: hh }, f, null, true);
    }
    out.prune();
    return out;
  }

  /** A filled 1-channel raster covering `r` with `value`. */
  static filled(depth: Depth, channels: 1 | 4, r: Rect, value: number[]): Raster {
    const out = new Raster(depth, channels);
    const rows = TILE;
    for (let y0 = 0; y0 < r.h; y0 += rows) {
      const hh = Math.min(rows, r.h - y0);
      const f = new Float32Array(r.w * hh * channels);
      for (let i = 0; i < f.length; i += channels) for (let c = 0; c < channels; c++) f[i + c] = value[c]!;
      out.write({ x: r.x, y: r.y + y0, w: r.w, h: hh }, f, null);
    }
    return out;
  }
}

/** One edit's changes to a raster: the tiles it replaced (for undo) and the new ones. */
export class TileEdit {
  readonly raster: Raster;
  readonly before = new Map<number, Tile | undefined>();

  constructor(raster: Raster) {
    this.raster = raster;
  }

  /** The tile to change: copied (or made) the first time this edit touches it. */
  touch(tx: number, ty: number): Tile {
    const k = tileKey(tx, ty);
    const cur = this.raster.tiles.get(k);
    if (this.before.has(k)) return cur ?? this.raster.ensure(tx, ty);
    this.before.set(k, cur);
    const t: Tile = { data: cur ? cur.data.slice() : newTileArray(this.raster.depth, this.raster.channels), v: nextVersion() };
    this.raster.tiles.set(k, t);
    return t;
  }

  /** The tile as it was before this edit (missing: empty). */
  original(tx: number, ty: number): Tile | undefined {
    const k = tileKey(tx, ty);
    return this.before.has(k) ? this.before.get(k) : this.raster.tiles.get(k);
  }

  get changed(): boolean {
    return this.before.size > 0;
  }

  /** Finish: empty tiles are dropped; returns the swap for the history. */
  commit(prune = true): TileSwap {
    if (prune) this.raster.prune(this.before.keys());
    const after = new Map<number, Tile | undefined>();
    for (const k of this.before.keys()) after.set(k, this.raster.tiles.get(k));
    this.raster.touchVersion();
    return { raster: this.raster, before: new Map(this.before), after };
  }

  /** Put the tiles back as they were (a cancelled edit). */
  revert(): void {
    for (const [k, t] of this.before) {
      if (t) this.raster.tiles.set(k, t);
      else this.raster.tiles.delete(k);
    }
    this.before.clear();
    this.raster.touchVersion();
  }
}

/** Tiles swapped by an edit: undo puts `before` back, redo `after`. */
export interface TileSwap {
  raster: Raster;
  before: Map<number, Tile | undefined>;
  after: Map<number, Tile | undefined>;
}

export function applySwap(s: TileSwap, which: 'before' | 'after'): void {
  for (const [k, t] of s[which]) {
    if (t) {
      t.v = nextVersion();
      s.raster.tiles.set(k, t);
    } else s.raster.tiles.delete(k);
  }
  s.raster.touchVersion();
}

/** Rect helpers. */
export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w),
    y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null;
}

export function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function expand(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

export function roundOut(r: Rect): Rect {
  const x = Math.floor(r.x),
    y = Math.floor(r.y);
  return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
}
