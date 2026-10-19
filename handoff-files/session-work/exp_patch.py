p = 'export/exporter.ts'
s = open(p).read()


def rep(a, b):
    global s
    assert a in s, a
    s = s.replace(a, b, 1)


rep("""import { allLayers, frameOps, type Layer, type Op } from '../render/frame';
""", """import { allLayers, frameOps, type Layer, type Op } from '../render/frame';
import { rateAt } from '../model/remap';
""")
rep("""      if (src?.kind !== 'video') continue;
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
    }""", """      if (src?.kind !== 'video') continue;
      const route = await this.route(src.media);
      if (!route) continue;
      await this.decode(l, l.key, src.time, route, frame);
      // Time remapping between two frames of the file: the second one too (its own reader, so each reads in order).
      if (src.next) await this.decode(l, `${l.key}#next`, src.next.time, route, frame);
    }""")
rep("""  readonly pictures: Pictures = {
    picture: (layer: Layer) => {
      const src = layer.source;
      if (src?.kind === 'image') return this.images.get(src.media.id) ?? null;
      return this.frames.get(layer.key) ?? null;
    },""", """  /** One frame of a clip's file, decoded exactly, kept under `key` for drawing. */
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
    next: (layer: Layer) => this.frames.get(`${layer.key}#next`) ?? null,""")
open(p, 'w').write(s)
