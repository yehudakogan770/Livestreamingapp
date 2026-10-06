// Making the film: each frame is drawn by the same compositor as the viewer
// (every frame decoded exactly), encoded by the computer's video encoder, and
// written next to the film; then FFmpeg adds the sound.
import {
  ALL_FORMATS,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  UrlSource,
  VideoSampleSink,
  WebMOutputFormat,
  canEncodeVideo,
} from 'mediabunny';
import type { VideoSample } from 'mediabunny';
import { current, rate } from '../model/seq';
import type { MediaItem, Project, Sequence } from '../model/types';
import { inApp, mediaUrl, native, onExportProgress } from '../native';
import { parseCube, type Cube } from '../render/color';
import { Compositor, type Pictures } from '../render/compositor';
import { allLayers, frameOps, type Layer, type Op } from '../render/frame';
import { rateAt } from '../model/remap';
import { isAiMask, matteFor, mattes } from '../vision/mattes';
import { exportSources } from '../player/files';
import { finishJobs, type FinishOptions, type SoundFormat } from './audioplan';
import { manageNative } from '../manage/native';
import { renderCache } from '../cache/manager';

export interface ExportSettings {
  /** Output height (the width follows the sequence's shape). */
  height: number;
  /** Megabits per second. */
  mbps: number;
  /** Just the sound. */
  sound: SoundFormat | null;
  range: { from: number; to: number };
  /** Even out the loudness (true: −16 LUFS), or FFmpeg's loudness filter for a target. */
  loudness: boolean | string;
  out: string;
  /** The picture is encoded by FFmpeg from the frames drawn (delivery presets: H.265, ProRes, hardware encoders…). */
  pipe?: PipePlan;
  /** The sound codec, chapters and captions of a delivery preset. */
  finish?: FinishOptions;
  /** Text files the last run reads (chapters, captions), by name in the work folder. */
  files?: [string, string][];
  /** Just the picture (image sequences, GIF): no sound is made. */
  pictureOnly?: boolean;
}

/** How FFmpeg encodes the frames. */
export interface PipePlan {
  args: string[];
  /** The size frames are drawn at. */
  render: { width: number; height: number };
  /** Keep transparency. */
  alpha: boolean;
  /** The software encoder's arguments, used when the hardware encoder fails at the start. */
  fallback?: string[];
  /** Where the picture is (for joining with the sound). */
  file: string;
}

export interface ExportState {
  stage: 'picture' | 'sound' | 'done' | 'error' | 'stopped';
  /** 0–1. */
  done: number;
  message: string;
  /** Seconds left (a guess). */
  left: number | null;
  path: string | null;
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/** One clip's frames, decoded in order. */
class Reader {
  private it: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private cur: VideoSample | null = null;
  private next: VideoSample | null = null;
  private done = false;
  private last = -Infinity;
  used = 0;
  constructor(
    private sink: VideoSampleSink,
    private start: number,
  ) {}

  /** The frame showing at a time (seconds into the file). */
  async at(t: number): Promise<VideoSample | null> {
    // Going backwards (a reversed clip) or far ahead: start again from there.
    if (t < this.last - 1e-6 || (this.cur && t > this.cur.timestamp + 5)) await this.reset(t);
    this.last = t;
    if (!this.it) {
      this.it = this.sink.samples(Math.max(0, t - 0.0005));
      this.done = false;
    }
    if (!this.cur && !this.done) {
      const r = await this.it.next();
      if (r.done) this.done = true;
      else this.cur = r.value;
    }
    while (!this.done) {
      if (!this.next) {
        const r = await this.it.next();
        if (r.done) {
          this.done = true;
          break;
        }
        this.next = r.value;
      }
      if (this.next.timestamp <= t + 1e-4) {
        this.cur?.close();
        this.cur = this.next;
        this.next = null;
      } else break;
    }
    return this.cur;
  }

  private async reset(t: number) {
    this.cur?.close();
    this.next?.close();
    this.cur = null;
    this.next = null;
    await this.it?.return();
    this.it = this.sink.samples(Math.max(0, t - 0.0005));
    this.done = false;
    this.start = t;
  }

  async close() {
    this.cur?.close();
    this.next?.close();
    await this.it?.return().catch(() => undefined);
  }
}

/**
 * One clip's frames read from the original by FFmpeg (files the app can't
 * decode: ProRes, DNxHR, 10-bit, HDR…), in order, at the size the film needs.
 */
export class FfmpegReader {
  private id: number | null = null;
  /** The file time of the next frame FFmpeg will hand over. */
  private expect = -Infinity;
  private cur: ImageData | null = null;
  used = 0;
  constructor(
    private path: string,
    private width: number,
    private height: number,
    /** File seconds per frame of the film. */
    private step: number,
  ) {}

  /** Read in order (one frame on from the last), or start again from here. */
  static continues(expect: number, t: number, step: number): boolean {
    return Math.abs(t - expect) <= Math.abs(step) * 0.5 + 1e-6;
  }

  async at(t: number): Promise<ImageData | null> {
    if (this.cur && Math.abs(t - (this.expect - this.step)) < 1e-6) return this.cur;
    if (this.id === null || this.step <= 0 || !FfmpegReader.continues(this.expect, t, this.step)) {
      await this.close();
      this.id = await native.framesOpen(this.path, Math.max(0, t), 1 / Math.abs(this.step || 1 / 30), this.width, this.height);
    }
    const bytes = await native.framesNext(this.id);
    this.expect = t + this.step;
    if (bytes.length !== this.width * this.height * 4) return this.cur;
    this.cur = new ImageData(new Uint8ClampedArray(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.length), this.width, this.height);
    return this.cur;
  }

  async close() {
    if (this.id !== null) await native.framesClose(this.id).catch(() => undefined);
    this.id = null;
  }
}

type Route = { via: 'decoder'; sink: VideoSampleSink; rotation: number } | { via: 'ffmpeg'; path: string } | null;

/** Every picture a frame needs, decoded exactly (also used by the render cache). */
export class Sources {
  private routes = new Map<string, Promise<Route>>();
  private readers = new Map<string, Reader>();
  private ffReaders = new Map<string, FfmpegReader>();
  private images = new Map<string, ImageBitmap | null>();
  private cubes = new Map<string, Cube | null>();
  private turned = new Map<string, OffscreenCanvas | HTMLCanvasElement>();
  /** Decoded frames for the frame being drawn, by clip. */
  frames = new Map<string, TexImageSource>();

  constructor(
    /** The film's size (frames read through FFmpeg are made no bigger). */
    private size: { width: number; height: number },
    private fps: number,
  ) {}

  /** How a file's pictures are read: the original first (the app's decoder, else FFmpeg), its edit-friendly copy last. */
  private route(m: MediaItem): Promise<Route> {
    let r = this.routes.get(m.id);
    if (!r) {
      r = (async (): Promise<Route> => {
        for (const s of exportSources(m, inApp())) {
          if (s.via === 'ffmpeg') return { via: 'ffmpeg', path: s.path };
          const ok = await (async () => {
            const input = new Input({ source: new UrlSource(mediaUrl(s.path)), formats: ALL_FORMATS });
            const track = await input.getPrimaryVideoTrack();
            if (!track || !(await track.canDecode())) return null;
            // HDR is tone-mapped by FFmpeg (the app's decoder would show it washed out).
            if (s.path === m.path && inApp() && (await track.hasHighDynamicRange().catch(() => false))) return null;
            return { via: 'decoder' as const, sink: new VideoSampleSink(track), rotation: track.rotation };
          })().catch(() => null);
          if (ok) return ok;
        }
        return null;
      })();
      this.routes.set(m.id, r);
    }
    return r;
  }

  /** A frame turned upright (phones record turned and say so in the file). */
  private upright(key: string, sample: VideoSample): TexImageSource {
    const w = sample.displayWidth;
    const h = sample.displayHeight;
    let c = this.turned.get(key);
    if (!c || c.width !== w || c.height !== h) {
      c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
      this.turned.set(key, c);
    }
    const ctx = c.getContext('2d') as CanvasRenderingContext2D | null;
    if (ctx) sample.draw(ctx, 0, 0, w, h);
    return c;
  }

  /** Get every picture the frame needs, decoded exactly. */
  async prepare(ops: Op[], frame: number, readText: (p: string) => Promise<string>) {
    for (const f of this.frames.values()) if (typeof VideoFrame !== 'undefined' && f instanceof VideoFrame) f.close();
    this.frames.clear();
    // Every layer, including the ones inside nested sequences.
    const layers: Layer[] = allLayers(ops);
    for (const l of layers) {
      for (const e of l.effects) {
        const path = e.type === 'lut' && typeof e.d.path === 'string' ? e.d.path : '';
        if (path && !this.cubes.has(path))
          this.cubes.set(
            path,
            await readText(path)
              .then(parseCube)
              .catch(() => null),
          );
      }
    }
    for (const l of layers) {
      const src = l.source;
      if (src?.kind === 'image' && !this.images.has(src.media.id)) {
        const blob = await fetch(mediaUrl(src.media.proxy ?? src.media.path)).then((r) => r.blob());
        this.images.set(src.media.id, await createImageBitmap(blob, { premultiplyAlpha: 'none' }).catch(() => null));
      }
      if (src?.kind !== 'video') continue;
      const route = await this.route(src.media);
      if (!route) continue;
      await this.decode(l, l.key, src.time, route, frame);
      // Time remapping between two frames of the file: the second one too (its own reader, so each reads in order).
      if (src.next) await this.decode(l, `${l.key}#next`, src.next.time, route, frame);
    }
    // Clips that are over.
    for (const [k, r] of this.readers) {
      if (frame - r.used > 2) {
        void r.close();
        this.readers.delete(k);
      }
    }
    for (const [k, r] of this.ffReaders) {
      if (frame - r.used > 2) {
        void r.close();
        this.ffReaders.delete(k);
      }
    }
  }

  /** One frame of a clip's file, decoded exactly, kept under `key` for drawing. */
  private async decode(l: Layer, key: string, time: number, route: NonNullable<Route>, frame: number) {
    if (l.source?.kind !== 'video') return;
    if (route.via === 'ffmpeg') {
      let f = this.ffReaders.get(key);
      if (!f) {
        const m = l.source.media;
        const h = Math.max(2, Math.round(Math.min(m.height || this.size.height, this.size.height) / 2) * 2);
        const w = Math.max(2, Math.round((h * (m.width || 16)) / (m.height || 9) / 2) * 2);
        // A remapped clip changes speed: FFmpeg reads at normal speed and starts again where it jumps.
        const r = l.clip.remap ? 1 : rateAt(l.clip, l.local);
        f = new FfmpegReader(route.path, w, h, r / this.fps);
        this.ffReaders.set(key, f);
      }
      f.used = frame;
      const img = await f.at(time);
      if (img) this.frames.set(key, img);
      return;
    }
    let r = this.readers.get(key);
    if (!r) {
      r = new Reader(route.sink, time);
      this.readers.set(key, r);
    }
    r.used = frame;
    const sample = await r.at(time);
    if (sample) this.frames.set(key, route.rotation ? this.upright(key, sample) : sample.toVideoFrame());
  }

  readonly pictures: Pictures = {
    picture: (layer: Layer) => {
      const src = layer.source;
      if (src?.kind === 'image') return this.images.get(src.media.id) ?? null;
      return this.frames.get(layer.key) ?? null;
    },
    next: (layer: Layer) => this.frames.get(`${layer.key}#next`) ?? null,
    cube: (path: string) => this.cubes.get(path) ?? null,
    matte: (layer: Layer, effect) => matteFor(layer, effect),
  };

  /** AI masks: any frame not worked out yet is done now, from the exact frame decoded (the film waits for it). */
  async mattes(ops: Op[]) {
    for (const l of allLayers(ops))
      for (const e of l.effects) if (isAiMask(e.type)) await mattes.ensure(l, e, this.pictures.picture(l) as CanvasImageSource | null);
  }

  async close() {
    for (const f of this.frames.values()) if (typeof VideoFrame !== 'undefined' && f instanceof VideoFrame) f.close();
    for (const r of this.readers.values()) await r.close();
    for (const r of this.ffReaders.values()) await r.close();
    for (const b of this.images.values()) b?.close();
  }
}

/** What the computer can encode: H.264 (best) or VP9. */
export async function pictureCodec(width: number, height: number, mbps: number): Promise<'avc' | 'vp9'> {
  return (await canEncodeVideo('avc', { width, height, bitrate: mbps * 1e6 }).catch(() => false)) ? 'avc' : 'vp9';
}

export class Exporter {
  private stopped = false;
  private paused: { resume: () => void; wait: Promise<void> } | null = null;
  /** Something worth telling about how it was made (e.g. the software encoder took over). */
  note = '';
  constructor(
    private p: Project,
    private o: ExportSettings,
    private report: (s: ExportState) => void,
  ) {}

  stop() {
    this.stopped = true;
    this.resume();
  }

  /** Hold between frames until resumed. */
  pause() {
    if (this.paused) return;
    let resume = () => {};
    const wait = new Promise<void>((r) => (resume = r));
    this.paused = { resume, wait };
  }

  resume() {
    const p = this.paused;
    this.paused = null;
    p?.resume();
  }

  get isPaused(): boolean {
    return this.paused !== null;
  }

  private async gate() {
    while (this.paused) await this.paused.wait;
  }

  async run(): Promise<void> {
    const s = current(this.p);
    const fps = rate(s);
    const { from, to } = this.o.range;
    const frames = to - from;
    const seconds = frames / fps;
    const t0 = performance.now();
    let tmp = '';
    try {
      if (frames <= 0) throw new Error('There is nothing to export: the film is empty.');
      if (inApp()) tmp = await native.exportFolder(this.o.out);
      let video: { file: string; copy: boolean; crf: number } | null = null;
      if (!this.o.sound) {
        video = this.o.pipe && inApp() ? await this.pipePicture(this.o.pipe, s, fps, from, to, tmp, t0) : await this.picture(s, fps, from, to, tmp, t0);
        if (this.stopped) throw new Error('Stopped.');
      }
      if (this.o.pictureOnly && inApp()) {
        void native.exportAbandon(tmp);
        tmp = '';
        this.report({ stage: 'done', done: 1, message: this.note || 'Ready.', left: 0, path: this.o.out });
        return;
      }
      await this.gate();
      if (!inApp()) {
        this.report({ stage: 'done', done: 1, message: 'Done (the sound is added in the app).', left: 0, path: null });
        return;
      }
      this.report({ stage: 'sound', done: video ? 0.86 : 0, message: video ? 'Adding the sound…' : 'Making the sound…', left: null, path: null });
      const jobs = finishJobs(this.p, s, this.o.range, video, this.o.sound ?? 'aac', this.o.loudness, this.o.finish);
      const base = video ? 0.86 : 0;
      await new Promise<void>((resolve, reject) => {
        const stop = onExportProgress((pr) => {
          if (pr.finished) {
            stop();
            if (pr.error) reject(new Error(pr.error));
            else resolve();
            return;
          }
          this.report({
            stage: 'sound',
            done: base + (1 - base) * pr.done,
            message: video ? 'Adding the sound…' : 'Making the sound…',
            left: null,
            path: null,
          });
        });
        native.exportStart({ jobs, files: this.o.files ?? [] }, this.o.out, tmp).catch((e: unknown) => {
          stop();
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
      tmp = '';
      this.report({ stage: 'done', done: 1, message: this.note || 'The film is ready.', left: 0, path: this.o.out });
      void seconds;
    } catch (e) {
      if (tmp) void native.exportAbandon(tmp);
      const msg = e instanceof Error ? e.message : String(e);
      this.report({ stage: this.stopped ? 'stopped' : 'error', done: 0, message: this.stopped ? 'Stopped.' : msg, left: null, path: null });
    }
  }

  /** Draw and encode every frame. */
  private async picture(s: Sequence, fps: number, from: number, to: number, tmp: string, t0: number) {
    const height = even(Math.min(this.o.height, 4320));
    const width = even((height * s.width) / s.height);
    const codec = await pictureCodec(width, height, this.o.mbps);
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
    const gl = new Compositor(canvas);
    gl.resize(width, height, s.height);
    const file = codec === 'avc' ? 'video.mp4' : 'video.webm';
    const path = tmp ? `${tmp}${tmp.includes('\\') ? '\\' : '/'}${file}` : file;
    let writing = Promise.resolve();
    let failed: Error | null = null;
    const target = inApp()
      ? new StreamTarget(
          new WritableStream({
            write: (chunk) => {
              writing = writing
                .then(() => native.writeChunk(path, chunk.position, chunk.data))
                .catch((e: unknown) => {
                  failed = e instanceof Error ? e : new Error(String(e));
                });
              return writing;
            },
          }),
          { chunked: true },
        )
      : new BufferTarget();
    const output = new Output({ format: codec === 'avc' ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(), target });
    const source = new CanvasSource(canvas, {
      codec,
      // VP9 is only a step on the way (it becomes H.264 at the end): kept very good.
      bitrate: (codec === 'avc' ? this.o.mbps : this.o.mbps * 2) * 1e6,
      keyFrameInterval: 2,
      latencyMode: 'quality',
    });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    const sources = new Sources({ width, height }, fps);
    const readText = (p: string) => native.readText(p);
    try {
      for (let f = from; f < to; f++) {
        await this.gate();
        if (this.stopped) break;
        if (failed) throw failed;
        // Cached pictures only when they match the film (full size, high quality) and the setting allows it.
        const ops = renderCache.exportOps(this.p, s, f, height) ?? frameOps(this.p, s, f);
        await sources.prepare(ops, f, readText);
        await sources.mattes(ops);
        gl.render(ops, sources.pictures, s.background);
        await source.add((f - from) / fps, 1 / fps);
        if ((f - from) % 5 === 0) {
          const done = (f - from + 1) / (to - from);
          const spent = (performance.now() - t0) / 1000;
          this.report({
            stage: 'picture',
            done: done * (inApp() ? 0.86 : 1),
            message: `Frame ${f - from + 1} of ${to - from}`,
            left: done > 0.02 ? (spent / done) * (1 - done) * 1.1 : null,
            path: null,
          });
        }
      }
      if (this.stopped) {
        await output.cancel();
        return null;
      }
      await output.finalize();
      await writing;
      if (failed) throw failed;
      if (!inApp() && target instanceof BufferTarget && target.buffer) this.lastBuffer = target.buffer;
    } finally {
      await sources.close();
    }
    return { file: `{tmp}/${file}`, copy: codec === 'avc', crf: this.o.mbps >= 30 ? 14 : this.o.mbps >= 15 ? 17 : 21 };
  }

  /** Draw every frame and hand it to FFmpeg (a hardware encoder that fails at the start is swapped for the software one). */
  private async pipePicture(pipe: PipePlan, s: Sequence, fps: number, from: number, to: number, tmp: string, t0: number) {
    const { width, height } = pipe.render;
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
    const gl = new Compositor(canvas);
    gl.resize(width, height, s.height);
    const readText = (p: string) => native.readText(p);
    const share = this.o.pictureOnly ? 1 : 0.86;
    const encode = async (args: string[]): Promise<{ sent: number; error: Error | null }> => {
      const id = await manageNative.encodeOpen(args, tmp, this.o.out, width * height * 4);
      const sources = new Sources({ width, height }, fps);
      let sent = 0;
      try {
        for (let f = from; f < to; f++) {
          await this.gate();
          if (this.stopped) break;
          const ops = renderCache.exportOps(this.p, s, f, height) ?? frameOps(this.p, s, f);
          await sources.prepare(ops, f, readText);
          await sources.mattes(ops);
          await manageNative.encodeFrame(id, gl.readFrame(ops, sources.pictures, s.background, pipe.alpha));
          sent += 1;
          if ((f - from) % 5 === 0) {
            const done = (f - from + 1) / (to - from);
            const spent = (performance.now() - t0) / 1000;
            this.report({
              stage: 'picture',
              done: done * share,
              message: `Frame ${f - from + 1} of ${to - from}`,
              left: done > 0.02 ? (spent / done) * (1 - done) * 1.1 : null,
              path: null,
            });
          }
        }
        if (this.stopped) {
          await manageNative.encodeAbort(id);
          return { sent, error: null };
        }
        await manageNative.encodeClose(id);
        return { sent, error: null };
      } catch (e) {
        await manageNative.encodeAbort(id).catch(() => undefined);
        return { sent, error: e instanceof Error ? e : new Error(String(e)) };
      } finally {
        await sources.close();
      }
    };
    let r = await encode(pipe.args);
    if (r.error && pipe.fallback && r.sent < 12 && !this.stopped) {
      this.note = 'The graphics card’s encoder could not start: made with the software encoder.';
      r = await encode(pipe.fallback);
    }
    if (r.error) throw r.error;
    if (this.stopped) return null;
    return { file: pipe.file, copy: true, crf: 0 };
  }

  /** In the browser (trying screens out): the picture file made. */
  lastBuffer: ArrayBuffer | null = null;
}

/** A sensible bit rate for a picture size (megabits per second). */
export function suggestedMbps(height: number, fps: number, quality: 'high' | 'good' | 'small'): number {
  const base = height >= 2160 ? 45 : height >= 1440 ? 24 : height >= 1080 ? 14 : 7;
  const k = quality === 'high' ? 1.6 : quality === 'good' ? 1 : 0.55;
  return Math.round(base * k * (fps > 40 ? 1.5 : 1));
}
