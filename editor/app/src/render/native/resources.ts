// The pictures a native frame reads that the page makes: words and shapes
// (drawn on a canvas, as the WebGL path draws them), stills, curve tables,
// LUTs and AI-mask mattes. Each is sent once (by a name that changes when the
// picture does) and let go when no frame has used it for a while.
import { drawTitler, titlerStamp } from '../../titler/titlerClip';
import { curvesImage, hexToRgb, type CurveSet } from '../color';
import type { Pictures } from '../compositor';
import type { EffectNow, Layer } from '../frame';
import { drawShape, shapeStamp } from '../shape';
import { drawText, textStamp } from '../text';
import type { MediaItem } from '../../model/types';
import type { Upload } from './message';
import { curveUsed, type Resources } from './record';

/** Let go of a picture after this long unused (well past the frames sent ahead). */
const KEEP_MS = 3000;
/** The biggest still sent (bigger ones are made smaller, keeping their shape). */
const MAX_STILL = 4096;

/** A short, stable name for a long description. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The file the engine decodes for a clip (null: none it can read). */
export function nativeFile(m: MediaItem, proxies: boolean): string | null {
  if (proxies && m.playbackProxy) return m.playbackProxy;
  if (m.missing) return m.proxy ?? null;
  // HDR is shown from its edit-friendly (tone-mapped) copy, as the WebGL path shows it.
  if (m.source?.hdr && m.proxy) return m.proxy;
  return m.path;
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function canvas(w: number, h: number): Canvas2D | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h).getContext('2d');
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d');
}

export class NativeResources implements Resources {
  /** What the engine has, and when a frame last used it. */
  private sent = new Map<string, number>();
  private uploads: Upload[] = [];
  private now = 0;
  pictures: Pictures | null = null;
  proxies = true;

  /** Start a frame (pictures new for it are gathered until `take`). */
  begin(now: number) {
    this.now = now;
    this.uploads = [];
  }

  /** The pictures to send with this frame, and the ones to let go. */
  take(): { uploads: Upload[]; free: string[] } {
    const free: string[] = [];
    for (const [id, used] of this.sent) {
      if (this.now - used > KEEP_MS) {
        free.push(id);
        this.sent.delete(id);
      }
    }
    const uploads = this.uploads;
    this.uploads = [];
    return { uploads, free };
  }

  /** The engine forgot everything (it started again). */
  reset() {
    this.sent.clear();
    this.uploads = [];
  }

  /** Have a picture sent unless the engine has it. */
  private use(id: string, make: () => Omit<Upload, 'id'> | null): boolean {
    if (this.sent.has(id) || this.uploads.some((u) => u.id === id)) {
      this.sent.set(id, this.now);
      return true;
    }
    const u = make();
    if (!u) return false;
    this.uploads.push({ id, ...u });
    this.sent.set(id, this.now);
    return true;
  }

  videoSource(layer: Layer): { path: string; w: number; h: number } | null {
    const src = layer.source;
    if (src?.kind !== 'video') return null;
    const path = nativeFile(src.media, this.proxies);
    if (!path || !src.media.width || !src.media.height) return null;
    return { path, w: src.media.width, h: src.media.height };
  }

  image(layer: Layer): { id: string; w: number; h: number } | null {
    const src = layer.source;
    if (src?.kind !== 'image') return null;
    const pic = this.pictures?.picture(layer) as HTMLImageElement | null | undefined;
    const nw = pic?.naturalWidth ?? (pic as { width?: number } | null | undefined)?.width ?? 0;
    const nh = pic?.naturalHeight ?? (pic as { height?: number } | null | undefined)?.height ?? 0;
    if (!pic || !nw || !nh) return null;
    const k = Math.min(1, MAX_STILL / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * k));
    const h = Math.max(1, Math.round(nh * k));
    const id = `img:${src.media.id}|${hash(`${src.media.path}|${w}x${h}`)}`;
    const ok = this.use(id, () => {
      const ctx = canvas(w, h);
      if (!ctx) return null;
      ctx.drawImage(pic as CanvasImageSource, 0, 0, w, h);
      return { w, h, d: 0, kind: 'straight', data: new Uint8Array(ctx.getImageData(0, 0, w, h).data.buffer) };
    });
    return ok ? { id, w, h } : null;
  }

  text(layer: Layer, w: number, h: number): string | null {
    const src = layer.source;
    if (src?.kind !== 'text' && src?.kind !== 'shape' && src?.kind !== 'titler') return null;
    const look = src.kind === 'shape' ? shapeStamp(src.shape, src.local) : src.kind === 'titler' ? titlerStamp(src) : textStamp(src.text, src.local, src.length, layer.fps);
    const id = `text:${layer.key}|${hash(`${w}x${h}|${look}`)}`;
    const ok = this.use(id, () => {
      const ctx = canvas(w, h);
      if (!ctx) return null;
      ctx.clearRect(0, 0, w, h);
      if (src.kind === 'shape') drawShape(ctx as CanvasRenderingContext2D, src.shape, w, h, src.local);
      else if (src.kind === 'titler') drawTitler(ctx as CanvasRenderingContext2D, src, w, h);
      else drawText(ctx as CanvasRenderingContext2D, src.text, w, h, src.local, src.length, layer.fps);
      return { w, h, d: 0, kind: 'straight', data: new Uint8Array(ctx.getImageData(0, 0, w, h).data.buffer) };
    });
    return ok ? id : null;
  }

  color(hex: string): string {
    const id = `color:${hex}`;
    this.use(id, () => {
      const [r, g, b] = hexToRgb(hex);
      return { w: 1, h: 1, d: 0, kind: 'straight', data: new Uint8Array([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255]) };
    });
    return id;
  }

  curve(key: string, set: CurveSet | null | undefined): string | null {
    if (!curveUsed(set)) return null;
    const id = `curve:${key}|${hash(JSON.stringify(set))}`;
    return this.use(id, () => ({ w: 256, h: 1, d: 0, kind: 'raw', data: curvesImage(set) })) ? id : null;
  }

  lut(path: string): { id: string; size: number } | null {
    const cube = this.pictures?.cube?.(path);
    if (!cube) return null;
    const id = `lut:${hash(path)}|${cube.size}`;
    const ok = this.use(id, () => {
      const n = cube.size ** 3;
      const bytes = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) {
        bytes[i * 4] = Math.round(Math.max(0, Math.min(1, cube.data[i * 3] as number)) * 255);
        bytes[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, cube.data[i * 3 + 1] as number)) * 255);
        bytes[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, cube.data[i * 3 + 2] as number)) * 255);
        bytes[i * 4 + 3] = 255;
      }
      return { w: cube.size, h: cube.size, d: cube.size, kind: 'raw', data: bytes };
    });
    return ok ? { id, size: cube.size } : null;
  }

  matte(layer: Layer, effect: EffectNow): { id: string; w: number; h: number } | null {
    const m = this.pictures?.matte?.(layer, effect);
    if (!m || !m.w || !m.h) return null;
    const id = `matte:${layer.key}:${effect.id}|${hash(m.stamp)}`;
    const ok = this.use(id, () => ({ w: m.w, h: m.h, d: 0, kind: 'alpha', data: m.data.subarray(0, m.w * m.h) }));
    return ok ? { id, w: m.w, h: m.h } : null;
  }
}
