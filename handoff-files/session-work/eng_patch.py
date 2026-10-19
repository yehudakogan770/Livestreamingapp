p = 'player/engine.ts'
s = open(p).read()


def rep(a, b, n=1):
    global s
    assert s.count(a) >= n, a
    s = s.replace(a, b)


rep("""import { allLayers, frameOps, sourceAt, videoNeeds, type Layer, type Op } from '../render/frame';
""", """import { allLayers, frameOps, sourceAt, videoNeeds, type Layer, type Op } from '../render/frame';
import { rateAt } from '../model/remap';
""")
rep("""      const r = dir * l.clip.speed * (l.clip.reverse ? -1 : 1);""", """      const r = dir * rateAt(l.clip, l.local);""", 2)
rep("""      const time = sourceAt(l.clip, local, fps);
      this.cache.want(this.videoFile(m), framesAhead({ time, fps: mfps, step, count, duration: m.duration }), mfps);""", """      const time = sourceAt(l.clip, local, fps);
      const times = framesAhead({ time, fps: mfps, step, count, duration: m.duration });
      // Time remapping between two frames: the second one too.
      if (l.source.next && !times.includes(l.source.next.time)) times.unshift(l.source.next.time);
      this.cache.want(this.videoFile(m), times, mfps);""")
rep("""      if (!this.playing || r < 0 || Math.abs(r) > 2) want(l, l.local, aheadCount(r, this.playing));""", """      if (!this.playing || r < 0 || Math.abs(r) > 2 || l.source.next) want(l, l.local, aheadCount(r, this.playing));""")
rep("""      const r = this.speed * layer.clip.speed * (layer.clip.reverse ? -1 : 1);""", """      const r = this.speed * rateAt(layer.clip, layer.local);""")
rep("""      this.follow(slot.el, h.time, true, this.speed * h.clip.speed);""", """      this.follow(slot.el, h.time, true, this.speed * rateAt(h.clip, frame - h.clip.start));""")
rep("""    // AI masks: worked out in the background, from the playhead on, the first time they're needed.""", """    // Time remapping between two frames of a file: the second, once decoded (until then the first is shown alone).
    next: (layer: Layer) => {
      const src = layer.source;
      if (src?.kind !== 'video' || !src.next) return null;
      return this.cache.frame(this.videoFile(src.media), src.next.time, src.media.fps || 30) ?? null;
    },
    // AI masks: worked out in the background, from the playhead on, the first time they're needed.""")
open(p, 'w').write(s)
