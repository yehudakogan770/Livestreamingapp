// The unified engine's overlay renderer: one per engine screen (Live, Back),
// in a hidden window of its own (src-tauri/src/live.rs opens it). It draws
// the screen's graphics — titles, lower thirds, scoreboards, countdowns,
// lyrics, slides, stage visuals, the 3D logo, the stinger, PANIC's logo —
// with the recorder's own Canvas code (ProgramCompositor in graphics-only
// mode: the same fonts, animations and show clock), each into its own
// transparent plane, and sends the engine only the rectangles that changed.
// Nothing changes: nothing is sent. See docs/ENGINE.md, "Overlay renderer".

import { ProgramCompositor } from '../broadcast/compositor';
import { drawCaptions } from '../broadcast/captionLayer';
import type { EngineClient } from './client';
import type { CaptionsInPicture } from './engineCaptions';
import { drawMonitorWords, monitorMoving } from './monitorWords';
import { area, dirtyRects, Pacer } from './overlayDirty';
import { multiviewPlanes, nextPlanes, overlayPlanes, planeKey, type PlaneSpec } from './overlayPlanes';
import { cutRect, encodeWire, type WireRecord } from './overlayWire';
import { drawMultiviewWords, drawTimecode, timecodeText, type MvLayout } from './multiviewLabels';
import type { ScreenId } from './types/ScreenId';
import type { Show } from './types/Show';

interface Plane {
  spec: PlaneSpec;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** What the engine has (null: nothing yet, i.e. transparent). */
  sent: Uint32Array | null;
  /** What it was last drawn from (planes that say so are not drawn again while it stays the same). */
  stamp: string | null;
}

/** What the renderer draws besides its screen's graphics (`live_engine_renderer_wants`). */
export interface RendererWants {
  /** The engine's multiview layout while it shows the multiview (its words are drawn here). */
  multiview: MvLayout | null;
  /** The Next preview's graphics (while the control window or the multiview shows them). */
  next: boolean;
  /** The stage monitor's words (the Monitor in the engine's window). */
  monitor: boolean;
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
  /** The engine's multiview layout while it shows the multiview (its words are drawn here). */
  private multiview: MvLayout | null = null;
  /** The Next preview's graphics and the Monitor's words are wanted now. */
  private wants = { next: false, monitor: false };
  /** The live captions to write into the stream (Live only). */
  private captions: CaptionsInPicture | null = null;
  /** Counts up with each new version of the show (for the planes' stamps). */
  private version = 0;
  private readonly fps: number;
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
    this.fps = fps;
  }

  setShow(show: Show): void {
    this.show = show;
    this.version++;
    this.compositor.setShow(show);
    this.pacer.wake(this.clock());
  }

  /** The engine opened, changed or (null) closed its multiview. */
  setMultiview(layout: MvLayout | null): void {
    if (JSON.stringify(layout) === JSON.stringify(this.multiview)) return;
    this.multiview = layout;
    this.version++;
    this.pacer.wake(this.clock());
  }

  /** What the engine wants drawn besides the screen's graphics now. */
  setWants(w: RendererWants): void {
    this.setMultiview(w.multiview);
    if (w.next === this.wants.next && w.monitor === this.wants.monitor) return;
    this.wants = { next: w.next, monitor: w.monitor };
    this.pacer.wake(this.clock());
  }

  /** The live captions to write into the stream now (null: none). */
  setCaptions(c: CaptionsInPicture | null): void {
    const now = c && c.lines.length ? c : null;
    if (JSON.stringify(now) === JSON.stringify(this.captions)) return;
    this.captions = now;
    this.version++;
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
    const live = this.screen === 'live';
    if (this.resync) {
      records.push({ op: 'reset', screen: this.screen, at });
      // The Live Screen's renderer also draws the Monitor's words.
      if (live && this.wants.monitor) records.push({ op: 'reset', screen: 'monitor', at });
      for (const p of this.planes.values()) {
        p.sent = null;
        p.stamp = null;
      }
      this.resync = false;
    }
    const specs = overlayPlanes(show, this.screen, at, this.width, this.height);
    const mv = this.multiview;
    if (mv && live) {
      specs.push({ kind: 'multiview', name: 'mv', w: mv.width, h: mv.height });
      if (mv.clock) specs.push({ kind: 'timecode', name: 'tc', w: mv.clock[2], h: mv.clock[3] });
      const tc = mv.tiles.find((t) => t.timecode)?.timecode;
      if (tc) specs.push({ kind: 'timecode', name: 'tc2', w: tc[2], h: tc[3] });
      // Graphics inputs' tiles while they aren't on air (on air, their `g:` plane serves).
      const onAir = new Set(specs.map((p) => p.name));
      specs.push(...multiviewPlanes(show, mv.tiles, onAir, this.width / this.height));
    }
    // Next is drawn half size (its graphics only while someone looks at it).
    if (this.wants.next) specs.push(...nextPlanes(show, this.screen, Math.round(this.width / 2), Math.round(this.height / 2)));
    if (live && this.captions) specs.push({ kind: 'captions', name: 'cap', w: this.width, h: this.height });
    if (live && this.wants.monitor) specs.push({ kind: 'monitor', name: 'mon', w: this.width, h: this.height, screen: 'monitor' });
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
        p = { spec, canvas, ctx, sent: null, stamp: null };
        this.planes.set(key, p);
      }
      p.spec = spec;
      // Planes whose looks follow a stamp are drawn (and compared) only when it changes.
      const stamp = this.stampOf(spec, show, at);
      if (stamp !== null && stamp === p.stamp && p.sent) continue;
      p.stamp = stamp;
      this.drawSpec(p.ctx, spec, show, at);
      const img = p.ctx.getImageData(0, 0, spec.w, spec.h).data;
      const now = new Uint32Array(img.buffer, img.byteOffset, spec.w * spec.h);
      const rects = dirtyRects(p.sent, now, spec.w, spec.h);
      if (rects.length) {
        records.push({
          op: 'patch',
          screen: screenOf(spec, this.screen),
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
      if (p.sent) records.push({ op: 'clear', screen: screenOf(p.spec, this.screen), name: p.spec.name, w: p.spec.w, h: p.spec.h, at });
    }
    this.stats.frames++;
    this.stats.planes = this.planes.size;
    this.stats.drawMs = performance.now() - t0;
    return records.length ? encodeWire(records) : null;
  }

  /** Draw one plane (cleared first). */
  private drawSpec(ctx: CanvasRenderingContext2D, spec: PlaneSpec, show: Show, at: number): void {
    const mv = this.multiview;
    switch (spec.kind) {
      case 'multiview':
        if (mv) drawMultiviewWords(ctx, mv, show, at);
        return;
      case 'timecode':
        drawTimecode(ctx, spec.w, spec.h, timecodeText(new Date(at), this.fps), spec.name === 'tc', mv?.scale ?? 1);
        return;
      case 'captions':
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, spec.w, spec.h);
        if (this.captions) drawCaptions(ctx, spec.w, spec.h, this.captions.lines, this.captions.look);
        return;
      case 'monitor':
        drawMonitorWords(ctx, spec.w, spec.h, show, at);
        return;
      default:
        this.compositor.drawPlane(ctx, spec, at);
    }
  }

  /**
   * What a plane's looks follow, for planes that say (null: drawn every
   * time). The multiview's words change with the show and once a second;
   * the captions with their lines; the Monitor with the show, ten times a
   * second (a running countdown), every frame while it flashes or the
   * teleprompter rolls.
   */
  private stampOf(spec: PlaneSpec, show: Show, at: number): string | null {
    switch (spec.kind) {
      case 'multiview':
        return `${this.version}|${Math.floor(at / 1000)}`;
      case 'captions':
        return `${this.version}`;
      case 'monitor':
        return monitorMoving(show, at) ? null : `${this.version}|${Math.floor(at / 100)}`;
      default:
        return null;
    }
  }
}

/** The screen a plane belongs to (the Monitor's words come from the Live Screen's renderer). */
const screenOf = (spec: PlaneSpec, screen: ScreenId): ScreenId => ('screen' in spec && spec.screen ? spec.screen : screen);

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
