// Plays the sequence: video files follow the playhead, the picture is drawn
// by the compositor, and the sound goes through each track's volume, the
// clip's effects, and the meters.
import { mediaUrl } from '../native';
import { current, rate, seqLength } from '../model/seq';
import type { MediaItem, Project, Sequence } from '../model/types';
import { Compositor, type Pictures } from '../render/compositor';
import { parseCube, type Cube } from '../render/color';
import { frameOps, videoNeeds, type Layer, type Op } from '../render/frame';
import { audioAt, dbToGain, heardTracks, type Heard } from './audio';

const fileOf = (m: MediaItem): string => mediaUrl(m.proxy ?? m.path);

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
  pan: StereoPannerNode | null;
  track: string;
}

interface TrackBus {
  gain: GainNode;
  pan: StereoPannerNode;
  meter: AnalyserNode;
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
  private buses = new Map<string, TrackBus>();
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
  /** Draw at full size, half or a quarter while playing (a lighter load). */
  quality: 1 | 0.5 | 0.25 = 1;
  /** Where the viewer is: the size the canvas is shown at. */
  private shown = { w: 960, h: 540 };
  /** Plays to the out mark and stops (or loops back to the in mark). */
  loop = false;

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
    for (const f of this.listeners) f();
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
    this.emit();
  }

  step(frames: number) {
    if (this.playing) this.pause();
    this.seek(Math.round(this.frame) + frames);
  }

  redraw() {
    this.dirty = true;
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
  };

  private draw(ops: Op[], s: Sequence) {
    const c = this.compositor;
    if (!c) return;
    // No bigger than the viewer shows it (sharp on high-density screens), and lighter while playing if asked.
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const fitH = Math.min(s.height, Math.max(90, this.shown.h * dpr));
    const h = Math.round(fitH * (this.playing ? this.quality : 1));
    const w = Math.round((h * s.width) / s.height);
    c.resize(w, h, s.height);
    try {
      c.render(ops, this.pictures, s.background);
    } catch (e) {
      console.error(e);
    }
    this.onFrame?.();
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
      return v && v.el.readyState >= 2 ? v.el : null;
    },
    cube: (path: string) => {
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
    // Get the next second ready too, so cuts don't wait for the file to load.
    if (this.playing && this.speed > 0 && this.p) {
      const ahead = frameOps(this.p, s, frame + Math.round(fps * 0.8));
      for (const n of videoNeeds(ahead)) if (!needs.some((x) => x.key === n.key)) needs.push({ ...n, time: n.time, key: n.key });
    }
    const showing = new Set(videoNeeds(ops).map((n) => n.key));
    for (const n of needs) {
      let slot = this.videos.get(n.key);
      const src = fileOf(n.media);
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
    for (const t of s.tracks) {
      if (t.kind !== 'audio') continue;
      let bus = this.buses.get(t.id);
      if (!bus) {
        const gain = ctx.createGain();
        const pan = ctx.createStereoPanner();
        const meter = ctx.createAnalyser();
        meter.fftSize = 1024;
        gain.connect(pan).connect(this.master);
        pan.connect(meter);
        bus = { gain, pan, meter };
        this.buses.set(t.id, bus);
      }
      bus.gain.gain.value = heard.has(t.id) ? dbToGain(t.volume) : 0;
      bus.pan.pan.value = t.pan;
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
    let node: AudioNode = slot.input;
    for (const n of [slot.gain, slot.lowCut, ...slot.eq, slot.comp, slot.makeup, slot.limit, slot.pan]) {
      node.connect(n);
      node = n;
    }
    this.route(slot);
  }

  private route(slot: SoundSlot) {
    if (!slot.pan) return;
    slot.pan.disconnect();
    const bus = this.buses.get(slot.track);
    if (bus) slot.pan.connect(bus.gain);
  }

  private syncSound(s: Sequence, frame: number) {
    if (!this.p) return;
    const now = performance.now();
    const heard = this.playing && this.speed > 0 && this.speed <= 2 ? audioAt(this.p, s, frame) : [];
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
      this.follow(slot.el, h.time, true, this.speed * h.clip.speed);
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
