// Frame-exact video for renders and exports: a video layer's frame at a
// render time is decoded from the file itself (demuxed by mediabunny,
// decoded with WebCodecs), never taken from a playing <video> element that
// may lag a frame or two behind a seek. Live playback keeps the element (it
// is smooth); renders wrap their environment with exactVideoEnv() and wait
// for the frames each frame needs.

import type { RenderEnv } from './render';
import type { Asset } from './types';

/** A decoded frame: where it starts and how long it shows (seconds from the file's start). */
export interface DecodedFrame {
  timestamp: number;
  duration: number;
  image: CanvasImageSource;
}

/** Frames in presentation order from `start` on (the one showing at `start` first). */
export interface FrameStream {
  next(): Promise<DecodedFrame | null>;
  close(): void;
}

export type OpenFrames = (asset: Asset, start: number) => Promise<FrameStream>;

/** Containers keep times to the millisecond (WebM): a frame within 1 ms counts as started. */
const EPS = 1e-3;

interface State {
  stream: FrameStream;
  cur: DecodedFrame | null;
  next: DecodedFrame | null;
  /** Past the last frame. */
  ended: boolean;
}

/**
 * The frame showing at a time, for each video, decoding forward from where it
 * was (renders go frame by frame, so each frame is decoded once); going back,
 * or jumping far ahead, starts again from the nearest key frame.
 */
export class ExactVideo {
  private states = new Map<string, State>();
  private busy = new Map<string, Promise<unknown>>();

  constructor(private readonly open: OpenFrames) {}

  async frameAt(asset: Asset, t: number): Promise<CanvasImageSource | null> {
    // One request at a time per video (they share a decoder).
    const prev = this.busy.get(asset.id) ?? Promise.resolve();
    const run = prev.then(() => this.step(asset, Math.max(0, t)));
    this.busy.set(
      asset.id,
      run.catch(() => null),
    );
    return run;
  }

  /** The frame's start time that frameAt(t) gives (tests). */
  async timestampAt(asset: Asset, t: number): Promise<number | null> {
    await this.frameAt(asset, t);
    return this.states.get(asset.id)?.cur?.timestamp ?? null;
  }

  private async restart(asset: Asset, t: number): Promise<State> {
    this.states.get(asset.id)?.stream.close();
    const stream = await this.open(asset, t);
    const s: State = { stream, cur: await stream.next(), next: null, ended: false };
    s.next = s.cur ? await stream.next() : null;
    s.ended = !s.next;
    this.states.set(asset.id, s);
    return s;
  }

  private async step(asset: Asset, t: number): Promise<CanvasImageSource | null> {
    let s = this.states.get(asset.id);
    const far = s?.cur && t > s.cur.timestamp + 3;
    if (!s || !s.cur || t < s.cur.timestamp - EPS || far) s = await this.restart(asset, t);
    while (s.next && s.next.timestamp <= t + EPS) {
      s.cur = s.next;
      s.next = await s.stream.next();
    }
    return s.cur?.image ?? null;
  }

  close(): void {
    for (const s of this.states.values()) s.stream.close();
    this.states.clear();
  }
}

/** Frames of a video file through mediabunny (WebCodecs), from a URL the browser can read. */
export function mediabunnyFrames(urlFor: (src: string) => string): OpenFrames {
  const inputs = new Map<string, Promise<{ sink: import('mediabunny').CanvasSink; first: number }>>();
  return async (asset, start) => {
    let got = inputs.get(asset.id);
    if (!got) {
      got = (async () => {
        const mb = await import('mediabunny');
        const url = asset.src.startsWith('data:') || asset.src.startsWith('blob:') ? asset.src : urlFor(asset.src);
        const blob = await fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`The video could not be read (${r.status}).`))));
        const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) throw new Error('This video can’t be decoded here.');
        const first = await track.getFirstTimestamp();
        return { sink: new mb.CanvasSink(track, { alpha: true }), first };
      })();
      inputs.set(asset.id, got);
      got.catch(() => inputs.delete(asset.id));
    }
    const { sink, first } = await got;
    const it = sink.canvases(first + start);
    return {
      async next() {
        const r = await it.next();
        if (r.done || !r.value) return null;
        return { timestamp: r.value.timestamp - first, duration: r.value.duration, image: r.value.canvas as CanvasImageSource };
      },
      close() {
        void it.return(undefined);
      },
    };
  };
}

/**
 * Frames from a <video> element, waiting for each seek to land (for files
 * WebCodecs can't read): slower, and as exact as the browser's seeking.
 */
export function elementFrames(urlFor: (src: string) => string): OpenFrames {
  return async (asset, start) => {
    if (typeof document === 'undefined') throw new Error('No video element here.');
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.src = asset.src.startsWith('data:') || asset.src.startsWith('blob:') ? asset.src : urlFor(asset.src);
    await new Promise<void>((ok, bad) => {
      v.onloadeddata = () => ok();
      v.onerror = () => bad(new Error('The video could not be read.'));
    });
    const fps = asset.fps || 30;
    let n = Math.floor(start * fps + EPS);
    const seek = (t: number) =>
      new Promise<void>((ok) => {
        v.onseeked = () => ok();
        // Into the middle of the frame, so rounding never lands on the one before.
        v.currentTime = Math.min(Math.max(0, v.duration - 0.001), t + 0.5 / fps);
      });
    return {
      async next() {
        const t = n / fps;
        if (v.duration && t >= v.duration) return null;
        await seek(t);
        const c = document.createElement('canvas');
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        c.getContext('2d')?.drawImage(v, 0, 0);
        n++;
        return { timestamp: t, duration: 1 / fps, image: c };
      },
      close() {
        v.removeAttribute('src');
        v.load();
      },
    };
  };
}

/** WebCodecs first; a file it can't read falls back to the element. */
export function bestFrames(urlFor: (src: string) => string): OpenFrames {
  const exact = mediabunnyFrames(urlFor);
  const element = elementFrames(urlFor);
  const broken = new Set<string>();
  return async (asset, start) => {
    if (!broken.has(asset.id) && typeof VideoDecoder !== 'undefined') {
      try {
        return await exact(asset, start);
      } catch {
        broken.add(asset.id);
      }
    }
    return element(asset, start);
  };
}

/**
 * A render environment whose videos are frame-exact: draw a frame, and if it
 * asked for video frames that weren't ready, `settle()` decodes them and says
 * to draw it again. Everything else comes from `base`.
 */
export function exactVideoEnv(base: RenderEnv, open: OpenFrames): RenderEnv & { settle(): Promise<boolean>; close(): void } {
  const video = new ExactVideo(open);
  const ready = new Map<string, { t: number; image: CanvasImageSource | null }>();
  const missing = new Map<string, { asset: Asset; t: number }>();
  const key = (a: Asset, t: number) => `${a.id}|${Math.round(t * 1e5)}`;
  return {
    ...base,
    video(asset, t) {
      if (asset.kind === 'sequence') return base.video?.(asset, t) ?? null;
      const k = key(asset, t);
      const got = ready.get(k);
      if (got) return got.image;
      missing.set(k, { asset, t });
      return null;
    },
    async settle() {
      if (!missing.size) return false;
      const want = [...missing.entries()].sort((a, b) => a[1].t - b[1].t);
      missing.clear();
      // Frames of earlier render frames are no longer needed.
      ready.clear();
      for (const [k, { asset, t }] of want) ready.set(k, { t, image: await video.frameAt(asset, t).catch(() => null) });
      return true;
    },
    close() {
      video.close();
      ready.clear();
    },
  };
}
