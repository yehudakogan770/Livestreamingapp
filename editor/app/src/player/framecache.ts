// Decoded frames kept ready around the playhead. Files the computer's video
// decoder (WebCodecs) can read are decoded ahead of the playhead, a batch at a
// time, at the size the viewer shows them; the frames wait in a store with a
// memory budget (the least recently used go first). Playing backwards, fast
// shuttling, stepping and scrubbing are then drawn from frames already made
// instead of waiting for a video element to seek, and the first frames after
// a cut are ready before the cut is reached.

/** A store of decoded frames with a memory budget: the least recently used are let go first. */
export class FrameStore<T> {
  private map = new Map<string, { v: T; bytes: number }>();
  private used = 0;
  constructor(
    public budget: number,
    private release: (v: T) => void = () => {},
  ) {}

  get size(): number {
    return this.map.size;
  }
  get bytes(): number {
    return this.used;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  /** A frame (it becomes the most recently used). */
  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    this.map.set(key, e);
    return e.v;
  }

  /** Look without making it recent. */
  peek(key: string): T | undefined {
    return this.map.get(key)?.v;
  }

  put(key: string, v: T, bytes: number) {
    const had = this.map.get(key);
    if (had) {
      this.used -= had.bytes;
      this.map.delete(key);
      if (had.v !== v) this.release(had.v);
    }
    this.map.set(key, { v, bytes });
    this.used += bytes;
    this.trim();
  }

  delete(key: string) {
    const e = this.map.get(key);
    if (!e) return;
    this.map.delete(key);
    this.used -= e.bytes;
    this.release(e.v);
  }

  /** Let go of the oldest until the store is within its budget (the newest always stays). */
  trim() {
    for (const [k, e] of this.map) {
      if (this.used <= this.budget || this.map.size <= 1) break;
      this.map.delete(k);
      this.used -= e.bytes;
      this.release(e.v);
    }
  }

  clear() {
    for (const e of this.map.values()) this.release(e.v);
    this.map.clear();
    this.used = 0;
  }
}

/** A frame of a file, as a key: the file and the frame number on the file's own frame grid. */
export const frameKey = (file: string, time: number, fps: number): string => `${file}#${Math.round(time * fps + 1e-6)}`;

/** The time of a frame on the file's grid (the frame showing at `time`). */
export const snapTime = (time: number, fps: number): number => Math.round(time * fps + 1e-6) / fps;

export interface Ahead {
  /** Seconds into the file now. */
  time: number;
  /** The file's frame rate. */
  fps: number;
  /** Seconds of the file per frame of the sequence (the clip's speed over the sequence's rate); negative going backwards. */
  step: number;
  /** Frames wanted. */
  count: number;
  /** The file's length (seconds), so nothing past it is asked for. */
  duration: number;
}

/**
 * The file times to have decoded next, in the order they will be shown: from
 * the frame showing now, one sequence frame at a time in the direction of
 * play (each on the file's frame grid, without repeats).
 */
export function framesAhead(a: Ahead): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const last = Math.max(0, a.duration - 1 / Math.max(1, a.fps));
  for (let i = 0; i < a.count * 4 && out.length < a.count; i++) {
    const t = a.time + a.step * i;
    if (t < -1e-6 || t > last + 1e-6) break;
    const idx = Math.round(Math.max(0, t) * a.fps + 1e-6);
    if (seen.has(idx)) {
      if (a.step === 0) break;
      continue;
    }
    seen.add(idx);
    out.push(idx / a.fps);
  }
  return out;
}

/** What a batch decode should ask for: the wanted times not in the store yet, sorted for one pass through the file. */
export function missing(file: string, times: number[], fps: number, have: (key: string) => boolean): number[] {
  return times.filter((t) => !have(frameKey(file, t, fps))).sort((a, b) => a - b);
}

/** How many frames to keep ready at a playback speed (more going fast or backwards, where seeking is slow). */
export function aheadCount(speed: number, playing: boolean): number {
  if (!playing) return 4;
  const s = Math.abs(speed);
  if (speed < 0) return 24;
  if (s > 2) return 20;
  return 10;
}

// ---- decoding (WebCodecs through mediabunny) ----

interface Decoder {
  ok: Promise<boolean>;
  sink: {
    canvasesAtTimestamps(ts: number[]): AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number } | null, void, unknown>;
  } | null;
  busy: boolean;
  width: number;
}

/** A canvas made by the decoder (let go of when it leaves the store). */
export type Picture = HTMLCanvasElement | OffscreenCanvas;

/**
 * Decodes frames of files into a store, a batch at a time per file, at the
 * size the viewer needs. Files the computer can't decode this way are left
 * to the video elements.
 */
export class FrameCache {
  readonly store: FrameStore<Picture>;
  private decoders = new Map<string, Decoder>();
  /** Called when new frames are ready (the viewer draws again). */
  onReady: () => void = () => {};
  /** How tall decoded frames are made (the viewer's size). */
  height = 540;
  /** Turned off where WebCodecs isn't there (tests, older systems). */
  enabled = typeof VideoDecoder !== 'undefined';
  /** Frames decoded so far (for the stats). */
  decoded = 0;

  constructor(budgetBytes = 384 * 1024 * 1024) {
    this.store = new FrameStore<Picture>(budgetBytes, (c) => {
      // Give the canvas's memory back straight away.
      c.width = 0;
      c.height = 0;
    });
  }

  /** The frame of a file at a time, if decoded. */
  frame(file: string, time: number, fps: number): Picture | undefined {
    return this.store.get(frameKey(file, time, fps));
  }

  /** The nearest decoded frame at or before a time (within `within` frames), for a cut that isn't ready yet. */
  near(file: string, time: number, fps: number, within = 3): Picture | undefined {
    const idx = Math.round(time * fps + 1e-6);
    for (let i = 0; i <= within; i++) {
      const v = this.store.peek(`${file}#${idx - i}`) ?? this.store.peek(`${file}#${idx + i}`);
      if (v) return v;
    }
    return undefined;
  }

  /** Can this file be decoded here? (Found out once per file.) */
  usable(url: string): Promise<boolean> {
    return this.decoder(url).ok;
  }

  /** Have these times of a file decoded (in the background; `onReady` when they are). */
  want(url: string, times: number[], fps: number) {
    if (!this.enabled || !times.length) return;
    const d = this.decoder(url);
    if (d.busy) return;
    const need = missing(url, times, fps, (k) => this.store.has(k));
    if (!need.length) return;
    d.busy = true;
    void (async () => {
      try {
        if (!(await d.ok) || !d.sink) return;
        let n = 0;
        for await (const got of d.sink.canvasesAtTimestamps(need)) {
          const t = need[n++];
          if (!got || t === undefined) continue;
          const c = got.canvas;
          this.store.put(frameKey(url, t, fps), c, c.width * c.height * 4);
          this.decoded++;
          this.onReady();
        }
      } catch {
        // A file that stops decoding is left to the video elements.
      } finally {
        d.busy = false;
      }
    })();
  }

  private decoder(url: string): Decoder {
    const h = Math.max(90, Math.round(this.height));
    let d = this.decoders.get(url);
    if (d && d.width !== h) {
      // The viewer changed size: frames are made at the new size from now on.
      this.decoders.delete(url);
      d = undefined;
    }
    if (d) return d;
    const made: Decoder = { ok: Promise.resolve(false), sink: null, busy: false, width: h };
    made.ok = this.enabled
      ? (async () => {
          const mb = await import('mediabunny');
          const input = new mb.Input({ source: new mb.UrlSource(url), formats: mb.ALL_FORMATS });
          const track = await input.getPrimaryVideoTrack();
          if (!track || !(await track.canDecode())) return false;
          // Rotation in the file is applied; HDR files are left to their edit-friendly copies.
          if (await track.hasHighDynamicRange().catch(() => false)) return false;
          made.sink = new mb.CanvasSink(track, { height: Math.min(h, await track.getDisplayHeight()), fit: 'contain' });
          return true;
        })().catch(() => false)
      : Promise.resolve(false);
    this.decoders.set(url, made);
    return made;
  }

  /** Let go of everything (the project is closed). */
  clear() {
    this.store.clear();
    this.decoders.clear();
  }
}
