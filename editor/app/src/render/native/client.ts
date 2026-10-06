// Native playback (beta): the program monitor drawn by the native GPU engine
// (crates/studio-engine) instead of WebGL. The page keeps every editing
// decision, the sound and the playhead; for each frame it records the passes
// the WebGL compositor would run (./record.ts) and sends them, a few frames
// ahead while playing. The engine decodes the video itself (hardware decoding
// through FFmpeg), draws, and shows each frame at its moment in a window
// placed over the viewer. Anything it can't draw yet is drawn by WebGL, frame
// by frame; if it can't start, WebGL simply carries on.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { inApp } from '../../native';
import { rate } from '../../model/seq';
import type { Project, Sequence } from '../../model/types';
import type { Pictures } from '../compositor';
import { frameOps, type Op } from '../frame';
import { encodeFrame } from './message';
import { nativePrograms } from './programs';
import { Recorder, Unsupported, type Recorded } from './record';
import { NativeResources } from './resources';

export type NativeStatus = 'off' | 'starting' | 'on' | 'failed' | 'unavailable';

/** What the viewer is doing this screen refresh. */
export interface NativeTick {
  p: Project;
  s: Sequence;
  /** The playhead (with its fraction while playing). */
  at: number;
  ops: Op[];
  playing: boolean;
  speed: number;
  /** Something changed (an edit, a picture loaded). */
  dirty: boolean;
  matte: { clip: string; node: string } | null;
  pictures: Pictures;
  proxies: boolean;
  quality: number;
  /** The size the viewer shows the picture at (CSS pixels). */
  shown: { w: number; h: number };
  canvas: HTMLCanvasElement | null;
  stats: { drawn: number; dropped: number; late: number; composeMs: number };
}

/**
 * Whether the native engine draws this frame: it is on and running, nothing
 * covers the viewer, and the frame has nothing it can't draw.
 */
export function useNative(o: { enabled: boolean; status: NativeStatus; covered: boolean; frameOk: boolean }): boolean {
  return o.enabled && o.status === 'on' && !o.covered && o.frameOk;
}

/** The size frames are drawn at (as the WebGL path: no bigger than shown, lighter while playing if asked). */
export function frameSize(s: Sequence, shownH: number, dpr: number, playing: boolean, quality: number): { w: number; h: number } {
  const fitH = Math.min(s.height, Math.max(90, shownH * dpr));
  const h = Math.max(2, Math.round(fitH * (playing ? quality : 1)));
  return { w: Math.max(2, Math.round((h * s.width) / s.height)), h };
}

/** Frames sent ahead of the playhead while playing. */
export function aheadFrames(fps: number, speed: number): number {
  return Math.max(2, Math.min(12, Math.ceil(fps * 0.25 * Math.max(1, Math.abs(speed)))));
}

/** The programs a frame runs that the engine said it can't. */
export function brokenIn(rec: Recorded, broken: Set<string>): string | null {
  for (const p of rec.passes) if (p.p && broken.has(p.p)) return p.p;
  return null;
}

const KEY = 'lumora-native-playback';
const SYNC_MS = 250;

interface Note {
  kind: 'presented' | 'fallback';
  frame: number;
  dropped?: number;
  late?: number;
  ms?: number;
  reason?: string;
}

export class NativePlayback {
  enabled = false;
  /** Turned on or off by the person on this computer (never: it may be offered, see ./suggest.ts). */
  chosen = false;
  status: NativeStatus = 'off';
  /** Why it isn't on (shown in the viewer's light), or which graphics card it runs on. */
  message = '';
  mode: 'window' | 'offscreen' = 'window';
  /** Something over the viewer that the native window would hide (moving handles, guides): WebGL draws. */
  blocked = false;
  /** Tell the person something (once per problem). */
  onNote: ((text: string) => void) | null = null;

  private listeners = new Set<() => void>();
  private res = new NativeResources();
  private broken = new Set<string>();
  private unlisten: (() => void) | null = null;
  private shownNative = false;
  private rect = { x: 0, y: 0, w: 0, h: 0, visible: false };
  private run = { p: null as Project | null, playing: false, speed: 0, fps: 30, start: 0, synced: 0, anchor: 0, anchorAt: 0 };
  /** Frames already sent for this run (with the project they were made from). */
  private sent = new Set<number>();
  private still: { p: Project | null; frame: number; key: string } = { p: null, frame: -1, key: '' };
  private frameOk = true;
  private overlay: HTMLCanvasElement | null = null;
  private pulling = false;
  /** Frames the engine refused in a row. */
  private errors = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor() {
    try {
      const v = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
      this.enabled = v === '1';
      this.chosen = v !== null;
    } catch {
      this.enabled = false;
    }
  }

  subscribe = (f: () => void): (() => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  snapshot = (): string => `${this.enabled}|${this.status}|${this.message}`;
  private changed() {
    for (const f of this.listeners) f();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.chosen = true;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // Not kept: fine.
    }
    if (!on) void this.stop();
    else if (this.status === 'failed') this.status = 'off';
    this.changed();
  }

  private async start() {
    if (!inApp()) {
      this.status = 'unavailable';
      this.message = 'Native playback needs the installed app.';
      this.changed();
      return;
    }
    this.status = 'starting';
    this.changed();
    try {
      const started = await invoke<{ adapter: string; mode: 'window' | 'offscreen' }>('native_view_start', {
        programs: nativePrograms(),
      });
      this.mode = started.mode;
      this.message = started.adapter;
      this.res.reset();
      this.broken.clear();
      this.sent.clear();
      this.still = { p: null, frame: -1, key: '' };
      this.rect = { x: 0, y: 0, w: 0, h: 0, visible: false };
      if (!this.unlisten) {
        const stop = await listen<Note>('native-view', (e) => this.heard(e.payload));
        this.unlisten = stop;
      }
      this.status = this.enabled ? 'on' : 'off';
      if (!this.enabled) await this.stop();
    } catch (e) {
      this.status = 'failed';
      this.message = e instanceof Error ? e.message : String(e);
      this.onNote?.(`Native playback could not start, so the viewer uses WebGL: ${this.message}`);
    }
    this.changed();
  }

  async stop() {
    const was = this.status;
    this.status = 'off';
    this.shownNative = false;
    this.overlay?.remove();
    this.overlay = null;
    if (was === 'on' || was === 'starting') await invoke('native_view_stop').catch(() => undefined);
    this.changed();
  }

  /** The engine's news: frames shown (for the dropped-frame light), and frames it couldn't draw. */
  private stats: NativeTick['stats'] | null = null;
  private heard(n: Note) {
    if (n.kind === 'presented' && this.stats && this.run.playing) {
      const s = this.stats;
      s.dropped = n.dropped ?? 0;
      s.late = n.late ?? 0;
      s.composeMs = n.ms ?? s.composeMs;
      s.drawn = Math.max(0, Math.abs(n.frame - this.run.start) - s.dropped);
    } else if (n.kind === 'fallback') {
      const reason = n.reason ?? '';
      // A program the graphics card couldn't build: frames using it are drawn by WebGL from now on.
      const name = /^(\w+):/.exec(reason)?.[1];
      if (name && name !== 'video' && name !== 'missing') this.broken.add(name);
      if (reason.startsWith('missing picture')) this.res.reset();
      this.still.key = '';
      console.warn('native playback:', reason);
    }
  }

  /** Whether something on the page sits over the viewer (a menu, a dialog). */
  private covered(canvas: HTMLCanvasElement): boolean {
    if (this.blocked || typeof document === 'undefined') return true;
    const r = canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return true;
    if (document.querySelector('[aria-modal="true"]')) return true;
    for (const el of document.querySelectorAll('[role="menu"], [role="listbox"]')) {
      const m = el.getBoundingClientRect();
      if (m.right > r.left && m.left < r.right && m.bottom > r.top && m.top < r.bottom) return true;
    }
    // Anything else drawn over its middle.
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && hit !== canvas && !canvas.parentElement?.contains(hit);
  }

  /** Keep the native window over the viewer's picture (device pixels), shown or hidden. */
  private place(canvas: HTMLCanvasElement, visible: boolean) {
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const r = canvas.getBoundingClientRect();
    const next = { x: Math.round(r.left * dpr), y: Math.round(r.top * dpr), w: Math.round(r.width * dpr), h: Math.round(r.height * dpr), visible };
    const was = this.rect;
    if (next.x === was.x && next.y === was.y && next.w === was.w && next.h === was.h && next.visible === was.visible) return;
    this.rect = next;
    if (this.mode === 'offscreen') {
      if (this.overlay) this.overlay.style.display = visible ? '' : 'none';
      return;
    }
    void invoke('native_view_place', next).catch(() => undefined);
  }

  private record(t: NativeTick, frame: number, ops: Op[], size: { w: number; h: number }): Recorded | null {
    try {
      const rec = new Recorder(this.res, size.w, size.h, t.s.height, t.matte).frame(ops, t.s.background);
      return brokenIn(rec, this.broken) ? null : rec;
    } catch (e) {
      if (e instanceof Unsupported) return null;
      console.error(e);
      return null;
    }
  }

  private send(frame: number, rec: Recorded, now: boolean) {
    const { uploads, free } = this.res.take();
    const bytes = encodeFrame(frame, rec, uploads, free, now);
    // One at a time, so the engine gets pictures before the frames that use them.
    this.chain = this.chain
      .then(() => invoke('native_view_frame', bytes))
      .then(() => {
        this.errors = 0;
        if (this.mode === 'offscreen') void this.pull();
      })
      .catch((e) => {
        // The engine missed a picture or stopped: everything is sent again (and after a few tries, WebGL takes over).
        this.res.reset();
        this.sent.clear();
        this.still.key = '';
        console.warn('native playback:', e);
        if (++this.errors > 5) {
          this.message = e instanceof Error ? e.message : String(e);
          this.onNote?.(`Native playback stopped, so the viewer uses WebGL: ${this.message}`);
          void this.stop().then(() => {
            this.status = 'failed';
            this.changed();
          });
        } else void invoke('native_view_reset').catch(() => undefined);
      });
  }

  /** Offscreen (not Windows): fetch the frame drawn and show it over the viewer. */
  private async pull() {
    if (this.pulling) return;
    this.pulling = true;
    try {
      const buf = new Uint8Array(await invoke<ArrayBuffer>('native_view_pixels'));
      if (buf.length > 16 && this.overlay) {
        const v = new DataView(buf.buffer, buf.byteOffset);
        const w = v.getUint32(8, true);
        const h = v.getUint32(12, true);
        const ctx = this.overlay.getContext('2d');
        if (ctx && w && h && buf.length >= 16 + w * h * 4) {
          if (this.overlay.width !== w || this.overlay.height !== h) Object.assign(this.overlay, { width: w, height: h });
          ctx.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset + 16, w * h * 4), w, h), 0, 0);
        }
      }
    } catch {
      // The next frame tries again.
    }
    this.pulling = false;
  }

  private ensureOverlay(canvas: HTMLCanvasElement) {
    if (this.mode !== 'offscreen' || this.overlay?.parentElement === canvas.parentElement) return;
    this.overlay?.remove();
    const o = document.createElement('canvas');
    o.className = canvas.className;
    o.style.pointerEvents = 'none';
    canvas.after(o);
    this.overlay = o;
  }

  /**
   * Draw this screen refresh natively, if it can be. False: the WebGL path
   * draws it (native is off, starting, covered, or the frame needs something
   * only WebGL does).
   */
  drive(t: NativeTick): boolean {
    if (!this.enabled) return false;
    if (this.status === 'off') void this.start();
    const canvas = t.canvas;
    if (this.status !== 'on') return false;
    if (!canvas) {
      // No viewer on the page now: the native window hides.
      if (this.rect.visible) {
        this.rect = { ...this.rect, visible: false };
        if (this.mode === 'window') void invoke('native_view_place', this.rect).catch(() => undefined);
      }
      return false;
    }
    this.stats = t.stats;
    this.res.pictures = t.pictures;
    this.res.proxies = t.proxies;
    const covered = this.covered(canvas);
    const fps = rate(t.s);
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const size = frameSize(t.s, t.shown.h, dpr, t.playing, t.quality);
    const frame = Math.floor(t.at);
    const now = performance.now();
    this.res.begin(now);
    if (this.mode === 'offscreen') this.ensureOverlay(canvas);

    const run = this.run;
    if (t.playing) {
      const fresh = !run.playing || run.speed !== t.speed || run.fps !== fps;
      // The page's clock jumped (looping, a click on the timeline while playing).
      const expect = run.anchor + ((now - run.anchorAt) / 1000) * fps * t.speed;
      const jumped = !fresh && Math.abs(t.at - expect) > 2 + Math.abs(t.speed);
      if (fresh || jumped) {
        Object.assign(run, { playing: true, speed: t.speed, fps, start: frame, synced: now, p: t.p, anchor: t.at, anchorAt: now });
        this.sent.clear();
        void invoke('native_view_play', { frame: t.at, fps, speed: t.speed }).catch(() => undefined);
      } else if (now - run.synced > SYNC_MS) {
        run.synced = now;
        void invoke('native_view_sync', { frame: t.at, fps, speed: t.speed }).catch(() => undefined);
      }
      if (run.p !== t.p) {
        // An edit while playing: the frames ahead are made again.
        run.p = t.p;
        this.sent.clear();
      }
      // This frame and a few ahead, each sent once.
      const dir = t.speed < 0 ? -1 : 1;
      const step = Math.max(1, Math.round(Math.abs(t.speed)));
      for (let i = 0; i <= aheadFrames(fps, t.speed); i++) {
        const f = frame + dir * i * step;
        if (f < 0 || this.sent.has(f)) continue;
        const rec = this.record(t, f, i === 0 ? t.ops : frameOps(t.p, t.s, f), size);
        if (!rec) continue;
        this.sent.add(f);
        this.send(f, rec, false);
      }
      // Only frames the engine can draw are sent: this one is native if it was.
      this.frameOk = this.sent.has(frame);
      for (const f of this.sent) if ((f - frame) * dir < -fps) this.sent.delete(f);
    } else {
      if (run.playing) {
        run.playing = false;
        this.sent.clear();
        void invoke('native_view_play', { frame: t.at, fps, speed: 0 }).catch(() => undefined);
      }
      // A stopped frame: drawn when it or anything about it changes.
      const key = `${size.w}x${size.h}|${t.matte?.clip ?? ''}:${t.matte?.node ?? ''}`;
      if (covered) this.still.key = '';
      else if (t.dirty || (!this.shownNative && this.frameOk) || this.still.p !== t.p || this.still.frame !== frame || this.still.key !== key) {
        const rec = this.record(t, frame, t.ops, size);
        this.frameOk = !!rec;
        this.still = { p: t.p, frame, key };
        if (rec) this.send(frame, rec, true);
      }
    }
    const native = useNative({ enabled: this.enabled, status: this.status, covered, frameOk: this.frameOk });
    this.place(canvas, native);
    this.shownNative = native;
    return native;
  }
}

/** The one native viewer. */
export const nativePlayback = new NativePlayback();
