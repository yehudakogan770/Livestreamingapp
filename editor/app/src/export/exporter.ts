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
import { finishJobs, type SoundFormat } from './audioplan';

export interface ExportSettings {
  /** Output height (the width follows the sequence's shape). */
  height: number;
  /** Megabits per second. */
  mbps: number;
  /** Just the sound. */
  sound: SoundFormat | null;
  range: { from: number; to: number };
  loudness: boolean;
  out: string;
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

class Sources {
  private inputs = new Map<string, Promise<VideoSampleSink | null>>();
  private readers = new Map<string, Reader>();
  private images = new Map<string, ImageBitmap | null>();
  private cubes = new Map<string, Cube | null>();
  /** Decoded frames for the frame being drawn, by clip. */
  frames = new Map<string, VideoFrame>();

  private sink(m: MediaItem): Promise<VideoSampleSink | null> {
    const file = m.proxy ?? m.path;
    let s = this.inputs.get(file);
    if (!s) {
      s = (async () => {
        const input = new Input({ source: new UrlSource(mediaUrl(file)), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) return null;
        return new VideoSampleSink(track);
      })().catch(() => null);
      this.inputs.set(file, s);
    }
    return s;
  }

  /** Get every picture the frame needs, decoded exactly. */
  async prepare(ops: Op[], frame: number, readText: (p: string) => Promise<string>) {
    for (const f of this.frames.values()) f.close();
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
      const sink = await this.sink(src.media);
      if (!sink) continue;
      let r = this.readers.get(l.key);
      if (!r) {
        r = new Reader(sink, src.time);
        this.readers.set(l.key, r);
      }
      r.used = frame;
      const sample = await r.at(src.time);
      if (sample) this.frames.set(l.key, sample.toVideoFrame());
    }
    // Clips that are over.
    for (const [k, r] of this.readers) {
      if (frame - r.used > 2) {
        void r.close();
        this.readers.delete(k);
      }
    }
  }

  readonly pictures: Pictures = {
    picture: (layer: Layer) => {
      const src = layer.source;
      if (src?.kind === 'image') return this.images.get(src.media.id) ?? null;
      return this.frames.get(layer.key) ?? null;
    },
    cube: (path: string) => this.cubes.get(path) ?? null,
  };

  async close() {
    for (const f of this.frames.values()) f.close();
    for (const r of this.readers.values()) await r.close();
    for (const b of this.images.values()) b?.close();
  }
}

/** What the computer can encode: H.264 (best) or VP9. */
export async function pictureCodec(width: number, height: number, mbps: number): Promise<'avc' | 'vp9'> {
  return (await canEncodeVideo('avc', { width, height, bitrate: mbps * 1e6 }).catch(() => false)) ? 'avc' : 'vp9';
}

export class Exporter {
  private stopped = false;
  constructor(
    private p: Project,
    private o: ExportSettings,
    private report: (s: ExportState) => void,
  ) {}

  stop() {
    this.stopped = true;
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
        video = await this.picture(s, fps, from, to, tmp, t0);
        if (this.stopped) throw new Error('Stopped.');
      }
      if (!inApp()) {
        this.report({ stage: 'done', done: 1, message: 'Done (the sound is added in the app).', left: 0, path: null });
        return;
      }
      this.report({ stage: 'sound', done: video ? 0.86 : 0, message: video ? 'Adding the sound…' : 'Making the sound…', left: null, path: null });
      const jobs = finishJobs(this.p, s, this.o.range, video, this.o.sound ?? 'aac', this.o.loudness);
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
        native.exportStart({ jobs }, this.o.out, tmp).catch((e: unknown) => {
          stop();
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
      tmp = '';
      this.report({ stage: 'done', done: 1, message: 'The film is ready.', left: 0, path: this.o.out });
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
    const sources = new Sources();
    const readText = (p: string) => native.readText(p);
    try {
      for (let f = from; f < to; f++) {
        if (this.stopped) break;
        if (failed) throw failed;
        const ops = frameOps(this.p, s, f);
        await sources.prepare(ops, f, readText);
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

  /** In the browser (trying screens out): the picture file made. */
  lastBuffer: ArrayBuffer | null = null;
}

/** A sensible bit rate for a picture size (megabits per second). */
export function suggestedMbps(height: number, fps: number, quality: 'high' | 'good' | 'small'): number {
  const base = height >= 2160 ? 45 : height >= 1440 ? 24 : height >= 1080 ? 14 : 7;
  const k = quality === 'high' ? 1.6 : quality === 'good' ? 1 : 0.55;
  return Math.round(base * k * (fps > 40 ? 1.5 : 1));
}
