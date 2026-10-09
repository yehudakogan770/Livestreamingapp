// Fills the RAM preview cache: frames from the playhead on are rendered in
// small slices between screen updates (never holding up the interface), at
// the size the canvas shows them, and kept as ImageBitmaps. Edits throw away
// only the frames they change; new pictures or fonts arriving start again.

import type { BrowserEnv } from '../core/browserEnv';
import { renderFrame, type Ctx } from '../core/render';
import type { Layer } from '../core/types';
import { affectedSpans, FrameCache, ramSetting } from './frameCache';
import { compOf } from './ops';
import type { Store } from './store';

const hasVideo = (ls: Layer[]): Layer[] => ls.flatMap((l) => (l.type === 'video' ? [l] : l.type === 'group' ? hasVideo(l.children) : []));

export class RamPreview {
  readonly cache = new FrameCache<ImageBitmap>(ramSetting() * 1024 * 1024);
  /** Device pixels per composition pixel the canvas shows (set by the viewport). */
  scale = 0.5;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private surface: OffscreenCanvas | null = null;
  private un: (() => void)[] = [];

  constructor(
    private readonly store: Store,
    private readonly env: BrowserEnv,
  ) {}

  /** Can this browser keep frames? (OffscreenCanvas with bitmaps.) */
  static get supported(): boolean {
    return typeof OffscreenCanvas !== 'undefined' && typeof OffscreenCanvas.prototype.transferToImageBitmap === 'function';
  }

  /** The size frames are kept at for the current composition. */
  frameSize(): [number, number] {
    const c = this.store.comp();
    const k = Math.min(1, Math.max(0.1, this.scale));
    return [Math.max(2, Math.round(c.width * k)), Math.max(2, Math.round(c.height * k))];
  }

  private keyNow(): string {
    const s = this.store.get();
    const [w, h] = this.frameSize();
    return `${s.compId}|${w}x${h}|${JSON.stringify(s.values)}|${JSON.stringify(s.brand)}`;
  }

  start(): void {
    if (!RamPreview.supported || !this.stopped) return;
    this.stopped = false;
    let prev = this.store.get().project;
    this.un.push(
      this.store.subscribe(() => {
        const s = this.store.get();
        if (s.project !== prev) {
          this.cache.invalidate(affectedSpans(prev, s.project, s.compId), compOf(s.project, s.compId).fps);
          prev = s.project;
        }
        this.cache.setKey(this.keyNow());
        this.kick();
      }),
      this.env.onReady(() => {
        // A picture or font arrived: frames drawn without it are wrong.
        this.cache.clear();
        this.kick();
      }),
    );
    this.cache.setKey(this.keyNow());
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.un.forEach((f) => f());
    this.un = [];
    this.cache.clear();
  }

  setCapMb(mb: number): void {
    this.cache.capBytes = mb * 1024 * 1024;
    this.cache.clear();
    this.kick();
  }

  /** A frame to show instead of drawing, when there is one (playback only). */
  frameAt(t: number): ImageBitmap | null {
    const s = this.store.get();
    if (s.cue) return null;
    this.cache.setKey(this.keyNow());
    const c = compOf(s.project, s.compId);
    return this.cache.get(Math.floor(t * c.fps + 1e-6)) ?? null;
  }

  private kick() {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.slice();
    }, 0);
  }

  /** The frames worth keeping: from the playhead on, as many as fit, round the composition. */
  wanted(): number[] {
    const s = this.store.get();
    const c = compOf(s.project, s.compId);
    const total = Math.max(1, Math.round(c.duration * c.fps));
    const [w, h] = this.frameSize();
    const fit = Math.floor(this.cache.capBytes / (w * h * 4));
    const n = Math.min(total, fit);
    const first = Math.min(total - 1, Math.max(0, Math.floor(s.time * c.fps + 1e-6)));
    const videos = hasVideo(c.layers).filter((l) => l.visible);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const f = (first + i) % total;
      const t = f / c.fps;
      // Video frames come from a playing element: drawn live, not kept.
      if (videos.some((l) => t >= l.start && t < l.end)) continue;
      out.push(f);
    }
    return out;
  }

  private slice() {
    if (this.stopped) return;
    if (typeof document !== 'undefined' && document.hidden) {
      this.timer = setTimeout(() => ((this.timer = null), this.slice()), 500);
      return;
    }
    const s = this.store.get();
    if (s.cue || s.editingText) return;
    const budget = s.playing ? 5 : 10;
    const t0 = performance.now();
    const want = this.wanted();
    const keep = new Set(want);
    const c = compOf(s.project, s.compId);
    const [w, h] = this.frameSize();
    let did = false;
    for (const f of want) {
      if (performance.now() - t0 > budget) break;
      if (this.cache.has(f)) continue;
      if (!this.surface || this.surface.width !== w || this.surface.height !== h) this.surface = new OffscreenCanvas(w, h);
      const ctx = this.surface.getContext('2d') as unknown as Ctx | null;
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      try {
        renderFrame(ctx, s.project, {
          comp: c.id,
          time: f / c.fps,
          clock: f / c.fps,
          values: s.values,
          brand: s.brand ?? undefined,
          env: this.env,
          width: w,
          height: h,
        });
      } catch {
        continue;
      }
      if (!this.cache.put(f, this.surface.transferToImageBitmap(), (n) => keep.has(n))) break;
      did = true;
    }
    if (did || want.some((f) => !this.cache.has(f))) {
      if (want.some((f) => !this.cache.has(f))) this.timer = setTimeout(() => ((this.timer = null), this.slice()), s.playing ? 4 : 0);
    }
  }
}
