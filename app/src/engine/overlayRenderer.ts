// The unified engine's overlay renderer: one per engine screen (Live, Back),
// in a hidden window of its own (src-tauri/src/live.rs opens it). It draws
// the screen's graphics — titles, lower thirds, scoreboards, countdowns,
// lyrics, slides, stage visuals, the 3D logo, the stinger, PANIC's logo —
// with the recorder's own Canvas code (ProgramCompositor in graphics-only
// mode: the same fonts, animations and show clock), each into its own
// transparent plane, and sends the engine only the rectangles that changed.
// Nothing changes: nothing is sent. See docs/ENGINE.md, "Overlay renderer".

import { ProgramCompositor } from '../broadcast/compositor';
import type { EngineClient } from './client';
import { area, dirtyRects, Pacer } from './overlayDirty';
import { overlayPlanes, planeKey, type PlaneSpec } from './overlayPlanes';
import { cutRect, encodeWire, type WireRecord } from './overlayWire';
import type { ScreenId } from './types/ScreenId';
import type { Show } from './types/Show';

interface Plane {
  spec: PlaneSpec;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** What the engine has (null: nothing yet, i.e. transparent). */
  sent: Uint32Array | null;
}

export interface OverlayStats {
  frames: number;
  sent: number;
  bytes: number;
  /** Time to draw, read and compare the last frame (ms). */
  drawMs: number;
  planes: number;
}

/** Sends one message to the engine (resolves when it has it). */
export type Send = (bytes: Uint8Array) => Promise<void>;

export class OverlayRenderer {
  private readonly compositor: ProgramCompositor;
  private readonly planes = new Map<string, Plane>();
  private readonly pacer: Pacer;
  private show: Show | null = null;
  /** The engine lost track (a refused frame): start over with a reset. */
  private resync = true;
  /** How far ahead of the clock a frame is drawn, so it is on the screen at its time (ms). */
  private lead = 0;
  private timer: { stop: () => void } | null = null;
  readonly stats: OverlayStats = { frames: 0, sent: 0, bytes: 0, drawMs: 0, planes: 0 };

  constructor(
    client: EngineClient,
    readonly screen: ScreenId,
    readonly width: number,
    readonly height: number,
    fps: number,
    private readonly send: Send,
    private readonly clock: () => number = Date.now,
  ) {
    this.compositor = new ProgramCompositor(client, width, height, screen === 'back' ? 'back' : 'live');
    this.compositor.graphicsOnly = true;
    this.pacer = new Pacer(fps);
  }

  setShow(show: Show): void {
    this.show = show;
    this.compositor.setShow(show);
    this.pacer.wake(this.clock());
  }

  /** Draw on a timer that keeps going in a hidden window. */
  start(): void {
    if (this.timer) return;
    this.timer = ticker(1000 / Math.max(this.pacer.fps, 1), () => this.tick());
  }

  stop(): void {
    this.timer?.stop();
    this.timer = null;
  }

  dispose(): void {
    this.stop();
    this.compositor.dispose();
    this.planes.clear();
  }

  /** One turn of the timer: draw if it is time and the last frame has arrived. */
  tick(): void {
    const now = this.clock();
    if (!this.show || !this.pacer.due(now)) return;
    const message = this.frame(now + this.lead);
    if (!message) return;
    this.pacer.wake(now);
    this.pacer.sending(true);
    const t0 = performance.now();
    this.send(message)
      .then(
        () => {
          // Half the round trip, plus a frame's wait in the engine, smoothed.
          const trip = performance.now() - t0;
          this.lead = Math.min(50, this.lead * 0.8 + (trip / 2 + 500 / this.pacer.fps) * 0.2);
          this.stats.sent++;
          this.stats.bytes += message.byteLength;
        },
        () => {
          // The engine didn't take it: it gets everything again.
          this.resync = true;
        },
      )
      .finally(() => this.pacer.sending(false));
  }

  /** Draw every plane for time `at`; the message with what changed (null: nothing did). */
  frame(at: number): Uint8Array | null {
    const show = this.show;
    if (!show) return null;
    const t0 = performance.now();
    const records: WireRecord[] = [];
    if (this.resync) {
      records.push({ op: 'reset', screen: this.screen, at });
      for (const p of this.planes.values()) p.sent = null;
      this.resync = false;
    }
    const specs = overlayPlanes(show, this.screen, at, this.width, this.height);
    const wanted = new Set(specs.map(planeKey));
    this.compositor.beginPlanes();
    for (const spec of specs) {
      const key = planeKey(spec);
      let p = this.planes.get(key);
      if (!p) {
        const canvas = document.createElement('canvas');
        canvas.width = spec.w;
        canvas.height = spec.h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) continue;
        p = { spec, canvas, ctx, sent: null };
        this.planes.set(key, p);
      }
      p.spec = spec;
      this.compositor.drawPlane(p.ctx, spec, at);
      const img = p.ctx.getImageData(0, 0, spec.w, spec.h).data;
      const now = new Uint32Array(img.buffer, img.byteOffset, spec.w * spec.h);
      const rects = dirtyRects(p.sent, now, spec.w, spec.h);
      if (rects.length) {
        records.push({
          op: 'patch',
          screen: this.screen,
          name: spec.name,
          w: spec.w,
          h: spec.h,
          at,
          // A big change goes whole (one copy, no seams).
          rects:
            area(rects) > 0.6 * spec.w * spec.h
              ? [{ rect: { x: 0, y: 0, w: spec.w, h: spec.h }, pixels: img }]
              : rects.map((rect) => ({ rect, pixels: cutRect(img, spec.w, rect) })),
        });
        p.sent = now;
      }
    }
    for (const [key, p] of this.planes) {
      if (wanted.has(key)) continue;
      this.planes.delete(key);
      if (p.spec.kind === 'top') this.compositor.endSting();
      if (p.sent) records.push({ op: 'clear', screen: this.screen, name: p.spec.name, w: p.spec.w, h: p.spec.h, at });
    }
    this.stats.frames++;
    this.stats.planes = this.planes.size;
    this.stats.drawMs = performance.now() - t0;
    return records.length ? encodeWire(records) : null;
  }
}

/**
 * Calls `fn` every `ms`. In a worker where it can be: a hidden window's own
 * timers are slowed down by the web view; a worker's are not.
 */
export function ticker(ms: number, fn: () => void): { stop: () => void } {
  try {
    const src = `let t=null;onmessage=(e)=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    w.onmessage = fn;
    w.postMessage(ms);
    return {
      stop: () => {
        w.postMessage(0);
        w.terminate();
      },
    };
  } catch {
    const id = setInterval(fn, ms);
    return { stop: () => clearInterval(id) };
  }
}
