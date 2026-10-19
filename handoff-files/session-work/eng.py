p='editor/app/src/player/engine.ts'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a, s.count(a))
    s=s.replace(a,b)
rep("""import { frameOps, videoNeeds, type Layer, type Op } from '../render/frame';
import { audioAt, dbToGain, heardTracks, type Heard } from './audio';
import { VoiceChain, type Measure } from './voice';

const fileOf = (m: MediaItem): string => mediaUrl(m.proxy ?? m.path);
""","""import { allLayers, frameOps, sourceAt, videoNeeds, type Layer, type Op } from '../render/frame';
import { audioAt, dbToGain, heardTracks, type Heard } from './audio';
import { playbackFile } from './files';
import { FrameCache, aheadCount, framesAhead } from './framecache';
import { VoiceChain, type Measure } from './voice';

/** Sound and stills: the original, or its edit-friendly copy. */
const fileOf = (m: MediaItem): string => mediaUrl(m.proxy ?? m.path);

/** How playback is keeping up (for the dropped-frame light). */
export interface PlaybackStats {
  /** Frames drawn while playing. */
  drawn: number;
  /** Frames skipped because drawing fell behind. */
  dropped: number;
  /** Frames drawn while a picture wasn't decoded in time (an older frame or nothing was shown). */
  late: number;
  /** How long drawing a frame takes (ms, averaged). */
  composeMs: number;
}

/** How often the panels hear about the playhead while playing (the playhead line and clock follow every frame on their own). */
const UI_EVERY_MS = 100;
""")
rep("""  /** Plays to the out mark and stops (or loops back to the in mark). */
  loop = false;
""","""  /** Plays to the out mark and stops (or loops back to the in mark). */
  loop = false;
  /** Frames decoded ahead of the playhead (backwards, fast, stepping, and the first frames after cuts). */
  readonly cache = new FrameCache();
  private proxies = true;
  private frameListeners = new Set<(frame: number) => void>();
  private lastEmit = 0;
  private lastDrawn = -1;
  /** Video elements say when they show a new frame, so nothing is drawn twice for nothing. */
  private rvfc = false;
  private opsAt: { p: Project | null; frame: number } = { p: null, frame: -1 };
  private ahead: { frame: number; layers: Layer[] } = { frame: -1e9, layers: [] };
  readonly stats: PlaybackStats = { drawn: 0, dropped: 0, late: 0, composeMs: 0 };

  constructor() {
    this.cache.onReady = () => (this.dirty = true);
  }

  /** Play heavy files from their lighter proxies (when made). The film is always made from the originals. */
  get useProxies(): boolean {
    return this.proxies;
  }
  set useProxies(v: boolean) {
    if (v === this.proxies) return;
    this.proxies = v;
    this.dirty = true;
  }

  private videoFile(m: MediaItem): string {
    return mediaUrl(playbackFile(m, this.proxies));
  }

  /** Start counting dropped frames again. */
  resetStats() {
    Object.assign(this.stats, { drawn: 0, dropped: 0, late: 0 });
  }
""")
rep("""  private emit() {
    for (const f of this.listeners) f();
  }""","""  private emit() {
    this.lastEmit = performance.now();
    for (const f of this.listeners) f();
    this.tellFrame();
  }

  /**
   * Hear the playhead every frame (for things drawn straight to the page, like
   * the playhead line and the clock, without the panels drawing again).
   */
  subscribeFrame = (f: (frame: number) => void): (() => void) => {
    this.frameListeners.add(f);
    return () => this.frameListeners.delete(f);
  };
  private tellFrame() {
    for (const f of this.frameListeners) f(this.frame);
  }""")
rep("""    for (const s of this.sounds.values()) s.el.removeAttribute('src');
    this.videos.clear();
    this.sounds.clear();""","""    for (const s of this.sounds.values()) s.el.removeAttribute('src');
    this.videos.clear();
    this.sounds.clear();
    this.cache.clear();""")
rep("""    this.speed = speed;
    this.playing = true;
    this.from = { frame: this.frame, at: performance.now() };
    this.emit();""","""    this.speed = speed;
    this.playing = true;
    this.from = { frame: this.frame, at: performance.now() };
    this.lastDrawn = -1;
    this.emit();""")
rep("""    this.frame = Math.max(0, Math.min(Math.max(len, frame), Math.round(frame)));
    this.from = { frame: this.frame, at: performance.now() };
    this.dirty = true;
    this.emit();""","""    this.frame = Math.max(0, Math.min(Math.max(len, frame), Math.round(frame)));
    this.from = { frame: this.frame, at: performance.now() };
    this.dirty = true;
    this.lastDrawn = -1;
    this.emit();""")
rep("""      this.frame = f;
      this.emit();
    }
    const frame = Math.floor(this.frame);
    const ops = frameOps(this.p, s, frame);
    this.lastOps = ops;
    this.syncVideo(ops, s, frame, fps);
    this.syncSound(s, frame);
    if (this.playing || this.dirty) {
      this.draw(ops, s);
      this.dirty = false;
    }
  };""","""      this.frame = f;
      // The playhead line and clock follow every frame; the panels a few times a second.
      this.tellFrame();
      if (performance.now() - this.lastEmit >= UI_EVERY_MS) this.emit();
    }
    const frame = Math.floor(this.frame);
    // The frame's layers are worked out once per frame (not every screen refresh).
    let ops = this.lastOps;
    if (this.opsAt.p !== this.p || this.opsAt.frame !== frame) {
      ops = frameOps(this.p, s, frame);
      this.lastOps = ops;
      this.opsAt = { p: this.p, frame };
    }
    this.syncVideo(ops, s, frame, fps);
    this.syncSound(s, frame);
    this.prefetch(ops, s, frame, fps);
    // Drawn when something changed: a new frame, a video showing a new picture, or an edit.
    if (this.dirty || (this.playing && (frame !== this.lastDrawn || !this.rvfc))) {
      if (this.playing && frame !== this.lastDrawn) {
        if (this.lastDrawn >= 0) {
          const jump = Math.abs(frame - this.lastDrawn);
          const allowed = Math.max(1, Math.ceil(Math.abs(this.speed)));
          if (jump > allowed && jump < fps * 2) this.stats.dropped += jump - allowed;
        }
        this.stats.drawn++;
        this.lastDrawn = frame;
      }
      this.dirty = false;
      const t0 = performance.now();
      this.draw(ops, s);
      this.stats.composeMs = this.stats.composeMs * 0.9 + (performance.now() - t0) * 0.1;
    }
  };

  /** Get frames decoded before they are needed. */
  private prefetch(ops: Op[], s: Sequence, frame: number, fps: number) {
    if (!this.cache.enabled || !this.p) return;
    const dir = this.playing ? this.speed : 0;
    const want = (l: Layer, local: number, count: number) => {
      if (l.source?.kind !== 'video') return;
      const m = l.source.media;
      const mfps = m.fps || 30;
      const r = dir * l.clip.speed * (l.clip.reverse ? -1 : 1);
      // Stopped: the frame and the next few (for stepping); playing: the frames coming up.
      const step = r === 0 ? 1 / mfps : r / fps;
      const time = sourceAt(l.clip, local, fps);
      this.cache.want(this.videoFile(m), framesAhead({ time, fps: mfps, step, count, duration: m.duration }), mfps);
    };
    for (const l of allLayers(ops)) {
      if (l.source?.kind !== 'video') continue;
      const r = dir * l.clip.speed * (l.clip.reverse ? -1 : 1);
      // Video elements follow normal forward playback well; decoded frames carry the rest.
      if (!this.playing || r < 0 || Math.abs(r) > 2) want(l, l.local, aheadCount(r, this.playing));
    }
    // The first frames of clips about to start (looked for every few frames).
    if (!this.playing || this.speed <= 0) return;
    if (Math.abs(frame - this.ahead.frame) >= 6) {
      const next = frameOps(this.p, s, frame + Math.round(fps * 0.8 * this.speed));
      const now = new Set(allLayers(ops).map((l) => l.key));
      this.ahead = { frame, layers: allLayers(next).filter((l) => l.source?.kind === 'video' && !now.has(l.key)) };
    }
    for (const l of this.ahead.layers) want(l, Math.max(0, frame - l.clip.start), 8);
  }""")
rep("""    const h = Math.round(fitH * (this.playing ? this.quality : 1));
    const w = Math.round((h * s.width) / s.height);""","""    const h = Math.round(fitH * (this.playing ? this.quality : 1));
    const w = Math.round((h * s.width) / s.height);
    this.cache.height = fitH;""")
rep("""      if (src.kind !== 'video') return null;
      const v = this.videos.get(layer.key);
      return v && v.el.readyState >= 2 ? v.el : null;
    },""","""      if (src.kind !== 'video') return null;
      const v = this.videos.get(layer.key);
      const el = v && v.el.readyState >= 2 ? v.el : null;
      const url = this.videoFile(src.media);
      const mfps = src.media.fps || 30;
      const exact = this.cache.frame(url, src.time, mfps);
      const r = this.speed * layer.clip.speed * (layer.clip.reverse ? -1 : 1);
      // Stopped, backwards or fast: the exact decoded frame is best (a video element would still be seeking).
      if (!this.playing || r < 0 || Math.abs(r) > 2) {
        if (exact) return exact;
        if (this.playing) this.stats.late++;
        return el ?? this.cache.near(url, src.time, mfps) ?? null;
      }
      // Playing forward: the video element, or a decoded frame while it gets going after a cut.
      if (el && !el.seeking) return el;
      const ready = exact ?? this.cache.near(url, src.time, mfps);
      if (!exact) this.stats.late++;
      return ready ?? el;
    },""")
rep("""    for (const n of needs) {
      let slot = this.videos.get(n.key);
      const src = fileOf(n.media);""","""    for (const n of needs) {
      let slot = this.videos.get(n.key);
      const src = this.videoFile(n.media);""")
rep("""    el.addEventListener('seeked', () => (this.dirty = true));
    el.addEventListener('loadeddata', () => (this.dirty = true));
    return { el, src: '', used: 0 };""","""    el.addEventListener('seeked', () => (this.dirty = true));
    el.addEventListener('loadeddata', () => (this.dirty = true));
    if (typeof el.requestVideoFrameCallback === 'function') {
      this.rvfc = true;
      const shown = () => {
        this.dirty = true;
        el.requestVideoFrameCallback(shown);
      };
      el.requestVideoFrameCallback(shown);
    }
    return { el, src: '', used: 0 };""")
open(p,'w').write(s)
print('ok')
