import { mediaUrl } from '../native';
import { heardTracks, layout, locate, placedTitles, type Angle, type Project } from '../model/project';
import { drawTitle, titleAlpha } from '../titles';

/** What the viewer shows at a film time: one camera, or two during a dissolve. */
export interface Shot {
  a: { angle: string; event: number };
  b: { angle: string; event: number; mix: number } | null;
  /** The event time everything else follows. */
  event: number;
}

export function shotAt(p: Project, t: number): Shot | null {
  const s = locate(p.clips, t);
  if (!s) return null;
  const len = s.clip.out - s.clip.in;
  const into = t - s.start;
  const next = p.clips[s.index + 1];
  const prev = p.clips[s.index - 1];
  if (next && next.fade > 0 && into > len - next.fade / 2) {
    const before = len - into;
    return {
      a: { angle: s.clip.angle, event: s.event },
      b: { angle: next.angle, event: next.in - before, mix: 0.5 - before / next.fade },
      event: s.event,
    };
  }
  if (prev && s.clip.fade > 0 && into < s.clip.fade / 2) {
    return {
      a: { angle: prev.angle, event: prev.out + into },
      b: { angle: s.clip.angle, event: s.event, mix: 0.5 + into / s.clip.fade },
      event: s.event,
    };
  }
  return { a: { angle: s.clip.angle, event: s.event }, b: null, event: s.event };
}

const fileTime = (m: { startMs: number; offsetMs: number; durationMs: number }, event: number): number | null => {
  const ms = event - m.startMs - m.offsetMs;
  return ms >= 0 && ms < m.durationMs ? ms / 1000 : null;
};

interface Sound {
  el: HTMLAudioElement;
  gain: GainNode | null;
  path: string;
}

/**
 * Plays the edit: every camera and microphone file plays together, kept on
 * the same moment of the event, and the viewer draws the camera that is on.
 */
export class Player {
  private p: Project | null = null;
  private videos = new Map<string, HTMLVideoElement>();
  private paths = new Map<string, string>();
  private sounds = new Map<string, Sound>();
  private audio: AudioContext | null = null;
  private t = 0;
  private playing = false;
  private rate = 1;
  private from = { t: 0, at: 0 };
  private frame = 0;
  private canvas: HTMLCanvasElement | null = null;
  private listeners = new Set<() => void>();
  /** Every camera keeps playing (for the camera wall), or only the one on. */
  wall = true;

  /** Start drawing (when the editing screen shows). */
  start() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.tick);
  }

  /** Stop playing and drawing (the files stay ready). */
  stop() {
    this.pause();
    cancelAnimationFrame(this.frame);
  }

  get time(): number {
    return this.t;
  }
  get isPlaying(): boolean {
    return this.playing;
  }
  get speed(): number {
    return this.rate;
  }
  get length(): number {
    return this.p ? layout(this.p.clips).total : 0;
  }

  subscribe(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  private emit() {
    for (const f of this.listeners) f();
  }

  setCanvas(c: HTMLCanvasElement | null) {
    this.canvas = c;
  }

  /** The camera's own video (shown in the camera wall too). */
  videoFor(angle: string): HTMLVideoElement | undefined {
    return this.videos.get(angle);
  }

  setProject(p: Project) {
    this.p = p;
    for (const a of p.angles) {
      if (this.paths.get(a.id) === a.path) continue;
      this.videos.get(a.id)?.removeAttribute('src');
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.playsInline = true;
      v.crossOrigin = 'anonymous';
      v.src = mediaUrl(a.path);
      v.className = 'cam-video';
      this.videos.set(a.id, v);
      this.paths.set(a.id, a.path);
    }
    for (const id of [...this.videos.keys()]) {
      if (!p.angles.some((a) => a.id === id)) {
        this.videos.get(id)?.removeAttribute('src');
        this.videos.delete(id);
        this.paths.delete(id);
      }
    }
    for (const tr of p.tracks) {
      const have = this.sounds.get(tr.id);
      if (have && have.path === tr.path) continue;
      have?.el.removeAttribute('src');
      const el = new Audio();
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      el.src = mediaUrl(tr.path);
      const s: Sound = { el, gain: null, path: tr.path };
      if (this.audio) this.connect(s);
      this.sounds.set(tr.id, s);
    }
    for (const id of [...this.sounds.keys()]) {
      if (!p.tracks.some((x) => x.id === id)) {
        this.sounds.get(id)?.el.removeAttribute('src');
        this.sounds.delete(id);
      }
    }
    this.levels();
    if (this.t > this.length) this.t = this.length;
    this.sync(true);
  }

  private connect(s: Sound) {
    if (!this.audio || s.gain) return;
    try {
      const src = this.audio.createMediaElementSource(s.el);
      s.gain = this.audio.createGain();
      src.connect(s.gain).connect(this.audio.destination);
    } catch {
      s.gain = null;
    }
  }

  /** Track volumes (mute, solo, and boost above full through Web Audio). */
  private levels() {
    if (!this.p) return;
    const heard = new Set(heardTracks(this.p).map((x) => x.id));
    for (const tr of this.p.tracks) {
      const s = this.sounds.get(tr.id);
      if (!s) continue;
      const g = heard.has(tr.id) ? 10 ** (tr.gainDb / 20) : 0;
      if (s.gain) {
        s.gain.gain.value = g;
        s.el.volume = 1;
      } else s.el.volume = Math.min(1, g);
      s.el.muted = g === 0;
    }
  }

  play() {
    if (!this.p || this.playing) return;
    if (!this.audio && typeof AudioContext !== 'undefined') {
      this.audio = new AudioContext();
      for (const s of this.sounds.values()) this.connect(s);
      this.levels();
    }
    void this.audio?.resume();
    if (this.t >= this.length - 1) this.t = 0;
    this.playing = true;
    this.from = { t: this.t, at: performance.now() };
    this.emit();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.rate = 1;
    for (const v of this.videos.values()) v.pause();
    for (const s of this.sounds.values()) s.el.pause();
    this.sync(true);
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Play faster (L pressed again): 1×, 2×, 4×. */
  faster() {
    if (!this.playing) {
      this.play();
      return;
    }
    this.from = { t: this.t, at: performance.now() };
    this.rate = this.rate >= 4 ? 1 : this.rate * 2;
    this.emit();
  }

  seek(t: number) {
    this.t = Math.max(0, Math.min(this.length, t));
    this.from = { t: this.t, at: performance.now() };
    this.sync(true);
    this.emit();
  }

  private tick = () => {
    this.frame = requestAnimationFrame(this.tick);
    if (!this.p) return;
    if (this.playing) {
      const t = this.from.t + (performance.now() - this.from.at) * this.rate;
      if (t >= this.length) {
        this.t = this.length;
        this.pause();
      } else this.t = t;
      this.sync(false);
      this.emit();
    }
    this.draw();
  };

  /** Keep every file on the right moment (gently while playing, exactly when stopped). */
  private sync(hard: boolean) {
    const p = this.p;
    if (!p) return;
    const shot = shotAt(p, this.t);
    if (!shot) return;
    const want = new Map<string, number>();
    for (const a of p.angles) want.set(a.id, shot.event);
    want.set(shot.a.angle, shot.a.event);
    if (shot.b) want.set(shot.b.angle, shot.b.event);
    for (const a of p.angles) {
      const v = this.videos.get(a.id);
      if (!v) continue;
      const on = a.id === shot.a.angle || a.id === shot.b?.angle;
      this.follow(v, fileTime(a, want.get(a.id) ?? shot.event), hard, this.wall || on);
    }
    for (const tr of p.tracks) {
      const s = this.sounds.get(tr.id);
      if (s) this.follow(s.el, fileTime(tr, shot.event), hard, !s.el.muted);
    }
  }

  private follow(el: HTMLMediaElement, at: number | null, hard: boolean, active: boolean) {
    if (at === null || !active) {
      if (!el.paused) el.pause();
      if (at !== null && hard && Math.abs(el.currentTime - at) > 0.02) el.currentTime = at;
      return;
    }
    if (!this.playing) {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - at) > 0.02 && !el.seeking) el.currentTime = at;
      return;
    }
    const drift = el.currentTime - at;
    if (el.paused || Math.abs(drift) > 0.3 || hard) {
      if (Math.abs(drift) > 0.05) el.currentTime = at;
      el.playbackRate = this.rate;
      if (el.paused) void el.play().catch(() => {});
      return;
    }
    // A little ahead or behind: catch up by playing a touch slower or faster.
    el.playbackRate = this.rate * Math.max(0.9, Math.min(1.1, 1 - drift * 0.8));
  }

  private draw() {
    const c = this.canvas;
    const p = this.p;
    if (!c || !p) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const shot = shotAt(p, this.t);
    if (!shot) return;
    const picture = (angle: string, event: number, alpha: number) => {
      const a = p.angles.find((x) => x.id === angle);
      const v = this.videos.get(angle);
      if (!a || !v || fileTime(a, event) === null || v.readyState < 2) return false;
      const vw = v.videoWidth || a.width || 16;
      const vh = v.videoHeight || a.height || 9;
      const s = Math.min(w / vw, h / vh);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.filter = lookFilter(a);
      ctx.drawImage(v, (w - vw * s) / 2, (h - vh * s) / 2, vw * s, vh * s);
      ctx.restore();
      return true;
    };
    const shown = picture(shot.a.angle, shot.a.event, 1);
    if (shot.b) picture(shot.b.angle, shot.b.event, Math.max(0, Math.min(1, shot.b.mix)));
    if (!shown && !shot.b) {
      const a = p.angles.find((x) => x.id === shot.a.angle);
      ctx.fillStyle = '#6d7178';
      ctx.font = `400 ${Math.round(h * 0.032)}px 'Segoe UI', sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(a && fileTime(a, shot.a.event) === null ? `${a.name} was not recording here` : 'Loading…', w / 2, h / 2);
    }
    for (const { title, start } of placedTitles(p)) {
      const alpha = titleAlpha(this.t - start, title.length);
      if (alpha > 0) drawTitle(ctx, title, w, h, alpha);
    }
  }
}

/** The SVG filter that shows a camera's color settings (see LookFilters). */
export const lookFilter = (a: Angle): string => (a.look.brightness || a.look.contrast || a.look.saturation || a.look.warmth ? `url(#look-${a.id})` : 'none');
