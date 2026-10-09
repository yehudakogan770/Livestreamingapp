// Plays the sequence: video files follow the playhead, the picture is drawn
// by the compositor, and the sound goes through each track's volume, the
// clip's effects, and the meters.
import { mediaUrl } from '../native';
import { current, rate, seqLength } from '../model/seq';
import type { MediaItem, Project, Sequence } from '../model/types';
import { Compositor, type Pictures } from '../render/compositor';
import { parseCube, type Cube } from '../render/color';
import { builtinCube } from '../render/luts';
import { allLayers, frameOps, sourceAt, videoNeeds, type Layer, type Op } from '../render/frame';
import { rateAt } from '../model/remap';
import { matteFor, mattes } from '../vision/mattes';
import type { NativeTick } from '../render/native/client';
import { audioAt, dbToGain, heardTracks, type Heard } from './audio';
import { playbackFile } from './files';
import { FrameCache, aheadCount, frameKey, framesAhead } from './framecache';
import { VoiceChain, type Measure } from './voice';
import { applyStageFx, makeStage, routeStage, type Stage } from './stage';
import { MASTER, mixOf } from '../model/mix';

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
  /** Frames drawn in the last second while playing (what playback achieves). */
  fps: number;
  /** Frames drawn from the render cache while playing. */
  cached: number;
}

/** How often the panels hear about the playhead while playing (the playhead line and clock follow every frame on their own). */
const UI_EVERY_MS = 100;

interface VideoSlot {
  el: HTMLVideoElement;
  src: string;
  used: number;
}

interface SoundSlot {
  el: HTMLAudioElement;
  src: string;
  used: number;
  input: MediaElementAudioSourceNode | null;
  gain: GainNode | null;
  eq: BiquadFilterNode[];
  lowCut: BiquadFilterNode | null;
  comp: DynamicsCompressorNode | null;
  makeup: GainNode | null;
  limit: DynamicsCompressorNode | null;
  /** Voice cleanup, loudness and ducking. */
  voice: VoiceChain | null;
  pan: StereoPannerNode | null;
  track: string;
}

export interface Levels {
  /** dB, left and right, per audio track and for everything ("master"). */
  [track: string]: [number, number];
}

const EMPTY_LEVELS: [number, number] = [-90, -90];

export class Engine {
  private p: Project | null = null;
  private videos = new Map<string, VideoSlot>();
  private sounds = new Map<string, SoundSlot>();
  private images = new Map<string, HTMLImageElement>();
  private cubes = new Map<string, Cube | 'loading' | 'bad'>();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private masterMeters: AnalyserNode[] = [];
  /** Each sound track's and bus's stage (by its id), and the whole mix's. */
  private buses = new Map<string, Stage>();
  private mixStage: Stage | null = null;
  private compositor: Compositor | null = null;
  private frame = 0;
  private playing = false;
  private speed = 1;
  private from = { frame: 0, at: 0 };
  private raf = 0;
  private dirty = true;
  private listeners = new Set<() => void>();
  private lastOps: Op[] = [];
  /** Read a LUT file's text (the app reads it from disk). */
  readText: ((path: string) => Promise<string>) | null = null;
  /** Called with each drawn frame (for the scopes). */
  onFrame: (() => void) | null = null;
  /** Others told of each drawn frame (the exposure overlay in the viewer). */
  private watchers = new Set<() => void>();
  /** Be told of each drawn frame (until the returned function is called). */
  watchFrames(f: () => void): () => void {
    this.watchers.add(f);
    this.dirty = true;
    return () => this.watchers.delete(f);
  }
  /** A grade node's matte shown instead of its clip's picture (Color page). */
  private matte: { clip: string; node: string } | null = null;
  /** Draw at full size, half or a quarter while playing (a lighter load). */
  quality: 1 | 0.5 | 0.25 = 1;
  /** Where the viewer is: the size the canvas is shown at. */
  private shown = { w: 960, h: 540 };
  /** Plays to the out mark and stops (or loops back to the in mark). */
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
  private ahead: { p: Project | null; frame: number; ops: Op[] } = { p: null, frame: -1e9, ops: [] };
  readonly stats: PlaybackStats = { drawn: 0, dropped: 0, late: 0, composeMs: 0, fps: 0, cached: 0 };
  /** Native playback (beta): draws the program monitor instead of WebGL when it can (render/native/client.ts). */
  native: { drive(t: NativeTick): boolean } | null = null;
  /** When frames were drawn while playing (the last second's, for the frame rate achieved). */
  private drawTimes: number[] = [];
  /** Cached pictures of heavy stretches (the render cache), when made and up to date. */
  cached: ((p: Project, s: Sequence, frame: number) => Op[] | null) | null = null;

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
    Object.assign(this.stats, { drawn: 0, dropped: 0, late: 0, fps: 0, cached: 0 });
    this.drawTimes = [];
  }

  /** The project being played (null before one is opened). */
  get project(): Project | null {
    return this.p;
  }

  /** The sequence's frame rate (what playback aims for). */
  get targetFps(): number {
    return this.seq ? rate(this.seq) : 30;
  }

  /**
   * What to draw at a frame: the render cache's picture when it has one and
   * its file is ready to show, else every layer (the cache file is loaded
   * meanwhile, so the next frames come from it).
   */
  private opsFor(s: Sequence, frame: number, slot: 'now' | 'ahead'): Op[] {
    const p = this.p as Project;
    // A grade node's matte shows the real layers.
    const c = this.matte ? null : (this.cached?.(p, s, frame) ?? null);
    this.warming.delete(slot);
    // While playing through a cached stretch it stays cached (a video catching up shows its nearest decoded frame).
    const still =
      slot === 'now' && this.playing && c?.[0]?.kind === 'layer' && this.lastOps[0]?.kind === 'layer' && this.lastOps[0].layer.key === c[0].layer.key;
    if (c && (still || this.ready(c))) return c;
    if (c) this.warming.set(slot, c);
    return frameOps(p, s, frame);
  }

  /** Cached pictures being loaded (shown once ready). */
  private warming = new Map<'now' | 'ahead', Op[]>();

  /** Can a cached picture be shown now (its video showing, or the frame decoded)? */
  private ready(ops: Op[]): boolean {
    const op = ops[0];
    const l = op?.kind === 'layer' ? op.layer : null;
    if (l?.source?.kind !== 'video') return true;
    const v = this.videos.get(l.key);
    if (v && v.el.readyState >= 2 && !v.el.seeking) return true;
    return !!this.cache.store.peek(frameKey(this.videoFile(l.source.media), l.source.time, l.source.media.fps || 30));
  }

  get time(): number {
    return this.frame;
  }
  get isPlaying(): boolean {
    return this.playing;
  }
  get rate(): number {
    return this.speed;
  }
  get ops(): Op[] {
    return this.lastOps;
  }
  get gl(): Compositor | null {
    return this.compositor;
  }

  subscribe = (f: () => void): (() => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  private emit() {
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
  }

  private get seq(): Sequence | null {
    return this.p ? current(this.p) : null;
  }

  setCanvas(canvas: HTMLCanvasElement | null) {
    if (!canvas) {
      this.compositor = null;
      return;
    }
    if (this.compositor?.canvas === canvas) return;
    this.compositor = new Compositor(canvas);
    this.dirty = true;
  }

  /** The size the viewer shows the picture at (it is drawn no bigger than needed). */
  setShown(w: number, h: number) {
    this.shown = { w, h };
    this.dirty = true;
  }

  setProject(p: Project) {
    const before = this.p;
    this.p = p;
    if (before && current(before).id !== current(p).id) this.frame = current(p).playhead;
    const len = seqLength(current(p));
    if (this.frame > len) this.frame = len;
    this.dirty = true;
    this.updateBuses();
    // A new AI mask frame is ready: draw again.
    mattes.onReady = () => (this.dirty = true);
  }

  start() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  stop() {
    this.pause();
    cancelAnimationFrame(this.raf);
  }

  /** Let go of every file (the project is closed). */
  release() {
    this.stop();
    for (const v of this.videos.values()) v.el.removeAttribute('src');
    for (const s of this.sounds.values()) s.el.removeAttribute('src');
    this.videos.clear();
    this.sounds.clear();
    this.cache.clear();
    void this.ctx?.close();
    this.ctx = null;
  }

  // ---- transport ----

  play(speed = 1) {
    if (!this.p) return;
    this.audio();
    const len = seqLength(current(this.p));
    if (speed > 0 && this.frame >= len - 1) this.frame = 0;
    this.speed = speed;
    this.playing = true;
    this.from = { frame: this.frame, at: performance.now() };
    this.lastDrawn = -1;
    this.emit();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.speed = 1;
    this.frame = Math.round(this.frame);
    for (const v of this.videos.values()) v.el.pause();
    for (const s of this.sounds.values()) s.el.pause();
    this.dirty = true;
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  /** J/K/L: each press of L (or J) plays faster forward (or backward). */
  shuttle(dir: 1 | -1) {
    if (!this.playing || Math.sign(this.speed) !== dir) return this.play(dir);
    const next = Math.min(8, Math.abs(this.speed) * 2) * dir;
    this.speed = next;
    this.from = { frame: this.frame, at: performance.now() };
    this.emit();
  }

  seek(frame: number) {
    const len = this.seq ? seqLength(this.seq) : 0;
    this.frame = Math.max(0, Math.min(Math.max(len, frame), Math.round(frame)));
    this.from = { frame: this.frame, at: performance.now() };
    this.dirty = true;
    this.lastDrawn = -1;
    this.emit();
  }

  step(frames: number) {
    if (this.playing) this.pause();
    this.seek(Math.round(this.frame) + frames);
  }

  redraw() {
    this.dirty = true;
  }

  /** Show a grade node's matte in the viewer (null: the picture). */
  setMatte(m: { clip: string; node: string } | null) {
    if (m?.clip === this.matte?.clip && m?.node === this.matte?.node) return;
    this.matte = m;
    this.redraw();
  }

  // ---- each screen refresh ----

  private tick = () => {
    this.raf = requestAnimationFrame(this.tick);
    const s = this.seq;
    if (!s || !this.p) return;
    const fps = rate(s);
    if (this.playing) {
      const len = seqLength(s);
      let f = this.from.frame + ((performance.now() - this.from.at) / 1000) * fps * this.speed;
      const stopAt = this.loop && s.outPoint !== null ? s.outPoint : len;
      if (this.speed > 0 && f >= stopAt) {
        if (this.loop && s.inPoint !== null && s.outPoint !== null) {
          this.from = { frame: s.inPoint, at: performance.now() };
          f = s.inPoint;
        } else {
          this.frame = Math.max(0, stopAt);
          this.pause();
          return;
        }
      }
      if (f <= 0 && this.speed < 0) {
        this.frame = 0;
        this.pause();
        return;
      }
      this.frame = f;
      // The playhead line and clock follow every frame; the panels a few times a second.
      this.tellFrame();
      if (performance.now() - this.lastEmit >= UI_EVERY_MS) this.emit();
    }
    const frame = Math.floor(this.frame);
    // A cached picture that was loading is ready: show it.
    const now = this.warming.get('now');
    if (now && this.ready(now)) {
      this.warming.delete('now');
      this.opsAt.frame = -1;
      this.dirty = true;
    }
    // The frame's layers are worked out once per frame (not every screen refresh).
    let ops = this.lastOps;
    if (this.opsAt.p !== this.p || this.opsAt.frame !== frame) {
      ops = this.opsFor(s, frame, 'now');
      this.lastOps = ops;
      this.opsAt = { p: this.p, frame };
    }
    if (this.driveNative(ops, s, frame)) return;
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
        if (ops.length === 1 && ops[0]?.kind === 'layer' && ops[0].layer.key.startsWith('rcache:')) this.stats.cached++;
        const now = performance.now();
        this.drawTimes.push(now);
        while (this.drawTimes.length && (this.drawTimes[0] as number) < now - 1000) this.drawTimes.shift();
        this.stats.fps = this.drawTimes.length;
        this.lastDrawn = frame;
      }
      this.dirty = false;
      const t0 = performance.now();
      this.draw(ops, s);
      this.stats.composeMs = this.stats.composeMs * 0.9 + (performance.now() - t0) * 0.1;
    }
  };

  /** The native engine draws the frame (true), or the WebGL path below does. */
  private driveNative(ops: Op[], s: Sequence, frame: number): boolean {
    const n = this.native;
    if (!n || !this.p) return false;
    const c = this.compositor;
    const t = { p: this.p, s, at: this.frame, ops, playing: this.playing, speed: this.speed, dirty: this.dirty, matte: this.matte };
    const extra = { pictures: this.pictures, proxies: this.proxies, quality: this.quality, shown: this.shown, stats: this.stats };
    if (!n.drive({ ...t, ...extra, canvas: c ? (c.canvas as HTMLCanvasElement) : null })) return false;
    // It decodes its own video: the page's players rest. The sound carries on here.
    for (const v of this.videos.values()) if (!v.el.paused) v.el.pause();
    this.syncSound(s, frame);
    // Stopped with the scopes open: they read the WebGL picture, so it is drawn too (one frame).
    if (this.dirty && !this.playing && (this.onFrame || this.watchers.size)) this.draw(ops, s);
    this.dirty = false;
    return true;
  }

  /** Get frames decoded before they are needed. */
  private prefetch(ops: Op[], s: Sequence, frame: number, fps: number) {
    if (!this.cache.enabled || !this.p) return;
    const dir = this.playing ? this.speed : 0;
    const want = (l: Layer, local: number, count: number) => {
      if (l.source?.kind !== 'video') return;
      const m = l.source.media;
      const mfps = m.fps || 30;
      const r = dir * rateAt(l.clip, l.local);
      // Stopped: the frame and the next few (for stepping); playing: the frames coming up.
      const step = r === 0 ? 1 / mfps : r / fps;
      const time = sourceAt(l.clip, local, fps);
      const times = framesAhead({ time, fps: mfps, step, count, duration: m.duration });
      // Time remapping between two frames: the second one too.
      if (l.source.next && !times.includes(l.source.next.time)) times.unshift(l.source.next.time);
      this.cache.want(this.videoFile(m), times, mfps);
    };
    for (const l of allLayers(ops)) {
      if (l.source?.kind !== 'video') continue;
      const r = dir * rateAt(l.clip, l.local);
      // Video elements follow normal forward playback well; decoded frames carry the rest.
      if (!this.playing || r < 0 || Math.abs(r) > 2 || l.source.next) want(l, l.local, aheadCount(r, this.playing));
    }
    // The first frames of clips about to start (looked for every few frames).
    if (!this.playing || this.speed <= 0) return;
    const now = new Set(allLayers(ops).map((l) => l.key));
    for (const l of allLayers(this.aheadOps(s, frame, fps))) if (l.source?.kind === 'video' && !now.has(l.key)) want(l, Math.max(0, frame - l.clip.start), 8);
  }

  /** What shows a little ahead of the playhead (worked out every few frames, not every refresh). */
  private aheadOps(s: Sequence, frame: number, fps: number): Op[] {
    const a = this.ahead;
    if (!this.p) return [];
    if (a.p !== this.p || Math.abs(frame - a.frame) >= 6) {
      this.ahead = { p: this.p, frame, ops: this.opsFor(s, frame + Math.round(fps * 0.8 * Math.max(1, this.speed)), 'ahead') };
    }
    return this.ahead.ops;
  }

  private draw(ops: Op[], s: Sequence) {
    const c = this.compositor;
    if (!c) return;
    // No bigger than the viewer shows it (sharp on high-density screens), and lighter while playing if asked.
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const fitH = Math.min(s.height, Math.max(90, this.shown.h * dpr));
    const h = Math.round(fitH * (this.playing ? this.quality : 1));
    const w = Math.round((h * s.width) / s.height);
    this.cache.height = fitH;
    c.resize(w, h, s.height);
    c.matte = this.matte;
    try {
      c.render(ops, this.pictures, s.background);
    } catch (e) {
      console.error(e);
    }
    this.onFrame?.();
    for (const f of this.watchers) f();
  }

  /** The pictures for each layer, for the compositor. */
  readonly pictures: Pictures = {
    picture: (layer: Layer) => {
      const src = layer.source;
      if (!src) return null;
      if (src.kind === 'image') {
        let img = this.images.get(src.media.id);
        if (!img) {
          img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => (this.dirty = true);
          img.src = fileOf(src.media);
          this.images.set(src.media.id, img);
        }
        return img.complete && img.naturalWidth ? img : null;
      }
      if (src.kind !== 'video') return null;
      const v = this.videos.get(layer.key);
      const el = v && v.el.readyState >= 2 ? v.el : null;
      const url = this.videoFile(src.media);
      const mfps = src.media.fps || 30;
      const exact = this.cache.frame(url, src.time, mfps);
      const r = this.speed * rateAt(layer.clip, layer.local);
      // Stopped, backwards or fast: the exact decoded frame is best (a video element would still be seeking).
      if (!this.playing || r < 0 || Math.abs(r) > 2 || src.next) {
        if (exact) return exact;
        if (this.playing) this.stats.late++;
        return el ?? this.cache.near(url, src.time, mfps) ?? null;
      }
      // Playing forward: the video element, or a decoded frame while it gets going after a cut.
      if (el && !el.seeking) return el;
      const ready = exact ?? this.cache.near(url, src.time, mfps);
      if (!exact) this.stats.late++;
      return ready ?? el;
    },
    // Time remapping between two frames of a file: the second, once decoded (until then the first is shown alone).
    next: (layer: Layer) => {
      const src = layer.source;
      if (src?.kind !== 'video' || !src.next) return null;
      return this.cache.frame(this.videoFile(src.media), src.next.time, src.media.fps || 30) ?? null;
    },
    // AI masks: worked out in the background, from the playhead on, the first time they're needed.
    matte: (layer, effect) =>
      matteFor(layer, effect, () => {
        if (this.p) mattes.analyze(this.p, layer.clip, effect.id, layer.fps, layer.local);
      }),
    cube: (path: string) => {
      const builtin = builtinCube(path);
      if (builtin) return builtin;
      const have = this.cubes.get(path);
      if (have && typeof have === 'object') return have;
      if (!have && this.readText) {
        this.cubes.set(path, 'loading');
        void this.readText(path)
          .then((t) => {
            this.cubes.set(path, parseCube(t));
            this.dirty = true;
          })
          .catch(() => this.cubes.set(path, 'bad'));
      }
      return null;
    },
  };

  private syncVideo(ops: Op[], s: Sequence, frame: number, fps: number) {
    const now = performance.now();
    const needs = videoNeeds(ops);
    // Render cache files about to be shown are loaded too.
    for (const w of this.warming.values()) for (const n of videoNeeds(w)) if (!needs.some((x) => x.key === n.key)) needs.push(n);
    // Get the next second ready too, so cuts don't wait for the file to load.
    if (this.playing && this.speed > 0 && this.p) {
      for (const n of videoNeeds(this.aheadOps(s, frame, fps))) if (!needs.some((x) => x.key === n.key)) needs.push(n);
    }
    const showing = new Set(videoNeeds(ops).map((n) => n.key));
    for (const n of needs) {
      let slot = this.videos.get(n.key);
      const src = this.videoFile(n.media);
      if (!slot) {
        slot = this.reuseVideo(src) ?? this.newVideo();
        this.videos.set(n.key, slot);
      }
      if (slot.src !== src) {
        slot.src = src;
        slot.el.src = src;
      }
      slot.used = now;
      const clipRate = n.rate;
      this.follow(slot.el, n.time, showing.has(n.key) && this.playing, this.speed * clipRate);
    }
    // Let go of videos no longer needed for a while.
    for (const [k, v] of this.videos) {
      if (now - v.used > 4000) {
        v.el.pause();
        this.videos.delete(k);
        this.spare.push(v);
      }
    }
    while (this.spare.length > 6) {
      const v = this.spare.shift();
      v?.el.removeAttribute('src');
      v?.el.load();
    }
  }

  private spare: VideoSlot[] = [];

  private reuseVideo(src: string): VideoSlot | null {
    const i = this.spare.findIndex((v) => v.src === src);
    if (i < 0) return this.spare.shift() ?? null;
    const [v] = this.spare.splice(i, 1);
    return v ?? null;
  }

  private newVideo(): VideoSlot {
    const el = document.createElement('video');
    el.muted = true;
    el.preload = 'auto';
    el.playsInline = true;
    el.crossOrigin = 'anonymous';
    el.addEventListener('seeked', () => (this.dirty = true));
    el.addEventListener('loadeddata', () => (this.dirty = true));
    if (typeof el.requestVideoFrameCallback === 'function') {
      this.rvfc = true;
      const shown = () => {
        this.dirty = true;
        el.requestVideoFrameCallback(shown);
      };
      el.requestVideoFrameCallback(shown);
    }
    return { el, src: '', used: 0 };
  }

  /** Keep a file on the right moment: gently while playing, exactly when stopped. */
  private follow(el: HTMLMediaElement, at: number, active: boolean, r: number) {
    if (!active || r <= 0 || Math.abs(r) > 4) {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - at) > 0.015 && !el.seeking) el.currentTime = at;
      return;
    }
    const drift = el.currentTime - at;
    if (el.paused || Math.abs(drift) > 0.25) {
      if (Math.abs(drift) > 0.04) el.currentTime = at;
      el.playbackRate = r;
      if (el.paused) void el.play().catch(() => {});
      return;
    }
    el.playbackRate = r * Math.max(0.92, Math.min(1.08, 1 - drift * 0.8));
  }

  // ---- sound ----

  /** The sound system starts on the first play (browsers need a click first). */
  private audio() {
    if (this.ctx || typeof AudioContext === 'undefined') {
      void this.ctx?.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    const split = ctx.createChannelSplitter(2);
    this.master.connect(ctx.destination);
    this.master.connect(split);
    this.masterMeters = [0, 1].map((i) => {
      const a = ctx.createAnalyser();
      a.fftSize = 1024;
      split.connect(a, i);
      return a;
    });
    this.updateBuses();
    for (const s of this.sounds.values()) this.wire(s);
  }

  private updateBuses() {
    const ctx = this.ctx;
    const s = this.seq;
    if (!ctx || !s || !this.master) return;
    const heard = heardTracks(s);
    const mix = mixOf(s);
    // The whole mix: its processing and level, then the listening level.
    if (!this.mixStage) this.mixStage = makeStage(ctx);
    const ms = this.mixStage;
    applyStageFx(ms, mix.fx);
    ms.gain.gain.value = dbToGain(mix.volume);
    routeStage(ms, 'out', this.master);
    const stage = (id: string): Stage => {
      let st = this.buses.get(id);
      if (!st) {
        st = makeStage(ctx);
        this.buses.set(id, st);
      }
      return st;
    };
    for (const b of mix.buses) {
      const st = stage(b.id);
      applyStageFx(st, b.fx);
      st.gain.gain.value = b.off ? 0 : dbToGain(b.volume);
      st.pan.pan.value = b.pan;
      routeStage(st, MASTER, ms.input);
    }
    for (const t of s.tracks) {
      if (t.kind !== 'audio') continue;
      const st = stage(t.id);
      applyStageFx(st, t.fx);
      st.gain.gain.value = heard.has(t.id) ? dbToGain(t.volume) : 0;
      st.pan.pan.value = t.pan;
      const bus = t.bus && mix.buses.some((b) => b.id === t.bus) ? t.bus : null;
      routeStage(st, bus ?? MASTER, bus ? stage(bus).input : ms.input);
    }
  }

  private wire(slot: SoundSlot) {
    const ctx = this.ctx;
    if (!ctx || slot.input) return;
    try {
      slot.input = ctx.createMediaElementSource(slot.el);
    } catch {
      return;
    }
    slot.gain = ctx.createGain();
    slot.lowCut = ctx.createBiquadFilter();
    slot.lowCut.type = 'highpass';
    slot.lowCut.frequency.value = 10;
    const bands: [BiquadFilterType, number][] = [
      ['lowshelf', 100],
      ['peaking', 400],
      ['peaking', 2500],
      ['highshelf', 8000],
    ];
    slot.eq = bands.map(([type, f]) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = 0.9;
      b.gain.value = 0;
      return b;
    });
    slot.comp = ctx.createDynamicsCompressor();
    slot.comp.threshold.value = 0;
    slot.comp.ratio.value = 1;
    slot.makeup = ctx.createGain();
    slot.limit = ctx.createDynamicsCompressor();
    slot.limit.threshold.value = 0;
    slot.limit.ratio.value = 1;
    slot.limit.attack.value = 0.001;
    slot.pan = ctx.createStereoPanner();
    const v = new VoiceChain(ctx);
    slot.voice = v;
    let node: AudioNode = slot.input;
    for (const n of [slot.gain, slot.lowCut, ...slot.eq, v.input]) {
      node.connect(n);
      node = n;
    }
    node = v.output;
    for (const n of [slot.comp, slot.makeup, slot.limit, v.postIn]) {
      node.connect(n);
      node = n;
    }
    v.postOut.connect(slot.pan);
    this.route(slot);
  }

  private route(slot: SoundSlot) {
    if (!slot.pan) return;
    slot.pan.disconnect();
    const bus = this.buses.get(slot.track);
    if (bus) slot.pan.connect(bus.input);
  }

  private syncSound(s: Sequence, frame: number) {
    if (!this.p) return;
    const now = performance.now();
    const heard = this.playing && this.speed > 0 && this.speed <= 2 ? audioAt(this.p, s, frame) : [];
    // How loud the speech tracks are now (what ducked clips listen to).
    this.speechDb = -120;
    if (heard.some((h) => h.duck)) for (const t of s.tracks) if (t.role === 'dialogue') this.speechDb = Math.max(this.speechDb, this.busLevel(t.id));
    for (const h of heard) {
      let slot = this.sounds.get(h.key);
      const src = fileOf(h.media);
      if (!slot) {
        slot = this.spareSounds.find((x) => x.src === src) ?? this.spareSounds[0] ?? this.newSound();
        this.spareSounds = this.spareSounds.filter((x) => x !== slot);
        this.sounds.set(h.key, slot);
      }
      if (slot.src !== src) {
        slot.src = src;
        slot.el.src = src;
      }
      if (slot.track !== h.track.id) {
        slot.track = h.track.id;
        this.route(slot);
      }
      slot.used = now;
      this.applySound(slot, h);
      this.follow(slot.el, h.time, true, this.speed * rateAt(h.clip, frame - h.clip.start));
    }
    for (const [k, slot] of this.sounds) {
      if (heard.some((h) => h.key === k)) continue;
      if (!slot.el.paused) slot.el.pause();
      if (now - slot.used > 3000) {
        this.sounds.delete(k);
        this.spareSounds.push(slot);
      }
    }
    while (this.spareSounds.length > 8) {
      const x = this.spareSounds.shift();
      if (x) {
        x.el.removeAttribute('src');
        x.src = '';
      }
    }
  }

  private spareSounds: SoundSlot[] = [];
  private speechDb = -120;
  /** Each clip's loudness heard so far (for Loudness normalize while editing). */
  private loudness = new Map<string, Measure>();
  private levelBuf = new Float32Array(1024);

  /** A track's level now (RMS, dB). */
  private busLevel(track: string): number {
    const bus = this.buses.get(track);
    if (!bus) return -120;
    bus.meter.getFloatTimeDomainData(this.levelBuf);
    let sum = 0;
    for (const v of this.levelBuf) sum += v * v;
    const ms = sum / this.levelBuf.length;
    return ms > 1e-12 ? 10 * Math.log10(ms) : -120;
  }

  private newSound(): SoundSlot {
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    const slot: SoundSlot = {
      el,
      src: '',
      used: 0,
      input: null,
      gain: null,
      eq: [],
      lowCut: null,
      comp: null,
      makeup: null,
      limit: null,
      voice: null,
      pan: null,
      track: '',
    };
    this.wire(slot);
    return slot;
  }

  private applySound(slot: SoundSlot, h: Heard) {
    if (!slot.gain) {
      slot.el.volume = Math.min(1, h.gain);
      return;
    }
    slot.gain.gain.value = h.gain;
    if (slot.pan) slot.pan.pan.value = h.pan;
    const eq = h.effects.find((e) => e.type === 'eq');
    const bands = ['low', 'lowMid', 'highMid', 'high'];
    slot.eq.forEach((b, i) => (b.gain.value = eq ? (eq.p[bands[i] as string] ?? 0) : 0));
    if (slot.lowCut) slot.lowCut.frequency.value = Math.max(10, eq?.p.lowCut ?? 0);
    const comp = h.effects.find((e) => e.type === 'compressor');
    const voice = h.effects.find((e) => e.type === 'voice');
    if (slot.comp && slot.makeup) {
      if (comp) {
        slot.comp.threshold.value = comp.p.threshold ?? -20;
        slot.comp.ratio.value = comp.p.ratio ?? 4;
        slot.comp.attack.value = (comp.p.attack ?? 10) / 1000;
        slot.comp.release.value = (comp.p.release ?? 150) / 1000;
        slot.makeup.gain.value = dbToGain(comp.p.makeup ?? 0);
      } else if (voice) {
        const k = (voice.p.amount ?? 50) / 100;
        slot.comp.threshold.value = -12 - 18 * k;
        slot.comp.ratio.value = 1 + 3 * k;
        slot.makeup.gain.value = dbToGain(6 * k);
      } else {
        slot.comp.threshold.value = 0;
        slot.comp.ratio.value = 1;
        slot.makeup.gain.value = 1;
      }
    }
    if (voice && !eq) {
      const k = (voice.p.amount ?? 50) / 100;
      (slot.eq[0] as BiquadFilterNode).gain.value = -4 * k;
      (slot.eq[2] as BiquadFilterNode).gain.value = 4 * k;
      if (slot.lowCut) slot.lowCut.frequency.value = 80;
    }
    const limit = h.effects.find((e) => e.type === 'limiter');
    if (slot.limit) {
      slot.limit.threshold.value = limit ? (limit.p.ceiling ?? -1) : 0;
      slot.limit.ratio.value = limit ? 20 : 1;
    }
    if (slot.voice) {
      let m = this.loudness.get(h.key);
      if (!m) {
        m = { sum: 0, n: 0 };
        this.loudness.set(h.key, m);
      }
      slot.voice.apply(h, this.speechDb, m);
    }
  }

  /** Sound levels right now, for the meters. */
  levels(): Levels {
    const out: Levels = {};
    const peak = (a: AnalyserNode): number => {
      const buf = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(buf);
      let m = 0;
      for (const v of buf) m = Math.max(m, Math.abs(v));
      return m > 0 ? Math.max(-90, 20 * Math.log10(m)) : -90;
    };
    if (!this.ctx || !this.playing) {
      out.master = EMPTY_LEVELS;
      return out;
    }
    const [l, r] = this.masterMeters;
    out.master = l && r ? [peak(l), peak(r)] : EMPTY_LEVELS;
    for (const [id, bus] of this.buses) {
      const v = peak(bus.meter);
      out[id] = [v, v];
    }
    return out;
  }

  /** The overall volume (the master fader). */
  setMaster(db: number) {
    if (this.master) this.master.gain.value = dbToGain(db);
  }
}
