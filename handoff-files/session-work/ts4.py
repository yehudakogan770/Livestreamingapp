def edit(p, pairs):
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (p, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('editor/app/src/export/exporter.ts', [
("""import { allLayers, frameOps, type Layer, type Op } from '../render/frame';
import { finishJobs, type SoundFormat } from './audioplan';""","""import { allLayers, frameOps, type Layer, type Op } from '../render/frame';
import { exportSources } from '../player/files';
import { finishJobs, type SoundFormat } from './audioplan';"""),
("""class Sources {
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
""","""/**
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
    this.cur = new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.length), this.width, this.height);
    return this.cur;
  }

  async close() {
    if (this.id !== null) await native.framesClose(this.id).catch(() => undefined);
    this.id = null;
  }
}

type Route = { via: 'decoder'; sink: VideoSampleSink; rotation: number } | { via: 'ffmpeg'; path: string } | null;

class Sources {
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
"""),
("""  async prepare(ops: Op[], frame: number, readText: (p: string) => Promise<string>) {
    for (const f of this.frames.values()) f.close();
    this.frames.clear();""","""  async prepare(ops: Op[], frame: number, readText: (p: string) => Promise<string>) {
    for (const f of this.frames.values()) if (typeof VideoFrame !== 'undefined' && f instanceof VideoFrame) f.close();
    this.frames.clear();"""),
("""      if (src?.kind !== 'video') continue;
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
  }""","""      if (src?.kind !== 'video') continue;
      const route = await this.route(src.media);
      if (!route) continue;
      if (route.via === 'ffmpeg') {
        let f = this.ffReaders.get(l.key);
        if (!f) {
          const m = src.media;
          const h = Math.max(2, Math.round(Math.min(m.height || this.size.height, this.size.height) / 2) * 2);
          const w = Math.max(2, Math.round((h * (m.width || 16)) / (m.height || 9) / 2) * 2);
          f = new FfmpegReader(route.path, w, h, (l.clip.speed * (l.clip.reverse ? -1 : 1)) / this.fps);
          this.ffReaders.set(l.key, f);
        }
        f.used = frame;
        const img = await f.at(src.time);
        if (img) this.frames.set(l.key, img);
        continue;
      }
      let r = this.readers.get(l.key);
      if (!r) {
        r = new Reader(route.sink, src.time);
        this.readers.set(l.key, r);
      }
      r.used = frame;
      const sample = await r.at(src.time);
      if (sample) this.frames.set(l.key, route.rotation ? this.upright(l.key, sample) : sample.toVideoFrame());
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
  }"""),
("""  async close() {
    for (const f of this.frames.values()) f.close();
    for (const r of this.readers.values()) await r.close();""","""  async close() {
    for (const f of this.frames.values()) if (typeof VideoFrame !== 'undefined' && f instanceof VideoFrame) f.close();
    for (const r of this.readers.values()) await r.close();
    for (const r of this.ffReaders.values()) await r.close();"""),
("""    const sources = new Sources();""","""    const sources = new Sources({ width, height }, fps);"""),
])
print('ok')
