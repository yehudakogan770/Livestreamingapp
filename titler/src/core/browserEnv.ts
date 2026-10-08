// Drawing in a browser window: pictures loaded once and kept, videos and
// image sequences read frame by frame, fonts from the project loaded.

import type { RenderEnv, Surface } from './render';
import type { Asset, TitleProject } from './types';

export interface BrowserEnv extends RenderEnv {
  /** Called when a picture, frame or font arrives (draw again). */
  onReady: (fn: () => void) => () => void;
  /** Load the project's fonts and pictures; resolves when they are ready. */
  prepare(p: TitleProject, extraSrcs?: string[]): Promise<void>;
}

/** Turns a file path into something the browser can load (the host's file server). */
export type UrlFor = (src: string) => string;

const fontFaces = new Map<string, Promise<void>>();

export function browserEnv(urlFor: UrlFor = (s) => s): BrowserEnv {
  const images = new Map<string, HTMLImageElement>();
  const videos = new Map<string, HTMLVideoElement>();
  const listeners = new Set<() => void>();
  const ready = () => listeners.forEach((fn) => fn());

  const image = (src: string): CanvasImageSource | null => {
    if (!src) return null;
    let img = images.get(src);
    if (!img) {
      if (typeof Image === 'undefined') return null;
      img = new Image();
      img.decoding = 'async';
      img.onload = ready;
      img.src = src.startsWith('data:') || src.startsWith('blob:') ? src : urlFor(src);
      images.set(src, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  };

  const env: BrowserEnv = {
    createCanvas(w: number, h: number): Surface | null {
      if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h)) as unknown as Surface;
      if (typeof document === 'undefined') return null;
      const c = document.createElement('canvas');
      c.width = Math.max(1, w);
      c.height = Math.max(1, h);
      return c;
    },
    image,
    video(asset: Asset, time: number) {
      if (asset.kind === 'sequence' && asset.frames?.length) {
        const n = Math.min(asset.frames.length - 1, Math.max(0, Math.floor(time * (asset.fps || 30))));
        return image(asset.frames[n]!);
      }
      if (typeof document === 'undefined') return null;
      let v = videos.get(asset.id);
      if (!v) {
        v = document.createElement('video');
        v.muted = true;
        v.preload = 'auto';
        v.crossOrigin = 'anonymous';
        v.src = asset.src.startsWith('data:') || asset.src.startsWith('blob:') ? asset.src : urlFor(asset.src);
        v.onseeked = ready;
        v.onloadeddata = ready;
        videos.set(asset.id, v);
      }
      if (v.readyState < 2) return null;
      const want = v.duration ? Math.min(time, v.duration - 0.001) : time;
      if (Math.abs(v.currentTime - want) > 0.02 && !v.seeking) v.currentTime = want;
      return v;
    },
    onReady(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async prepare(p, extra = []) {
      const fonts = p.assets.filter((a) => a.kind === 'font' && a.family);
      await Promise.all(fonts.map((f) => loadFont(f.family!, f.src.startsWith('data:') ? f.src : urlFor(f.src))));
      const srcs = [...p.assets.filter((a) => a.kind === 'image' || a.kind === 'svg').map((a) => a.src), ...extra];
      await Promise.all(
        srcs.map(
          (s) =>
            new Promise<void>((resolve) => {
              if (image(s)) return resolve();
              const img = images.get(s);
              if (!img) return resolve();
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            }),
        ),
      );
      ready();
    },
  };
  return env;
}

/** Load a font file under a family name (once). */
export function loadFont(family: string, url: string): Promise<void> {
  const key = `${family}|${url.slice(0, 200)}|${url.length}`;
  let p = fontFaces.get(key);
  if (!p) {
    p =
      typeof FontFace === 'undefined' || typeof document === 'undefined'
        ? Promise.resolve()
        : new FontFace(family, `url(${JSON.stringify(url)})`)
            .load()
            .then((face) => {
              document.fonts.add(face);
            })
            .catch(() => {});
    fontFaces.set(key, p);
  }
  return p;
}

/** Ask the browser for the fonts a project's text uses (canvas does not load them by itself). */
export function requestFonts(families: string[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  return Promise.all(families.flatMap((f) => [400, 700].map((w) => document.fonts.load(`${w} 40px "${f}"`).catch(() => [])))).then(() => {});
}
