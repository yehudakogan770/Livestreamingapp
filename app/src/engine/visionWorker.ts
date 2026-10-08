// The unified engine's vision worker: a hidden window (`overlay-vision`,
// opened by src-tauri/src/live.rs only while an input uses background
// removal, blur behind people or auto-framing) that runs the same
// person-finding models as the Standard engine (vision.ts: InputVision) on
// small frames the engine sends of those cameras — and only those — and
// answers with each camera's person mask, the shot auto-framing aims for
// and the picture (or virtual set) to put behind the people. The engine
// draws them in its shader and moves the shot smoothly itself. See
// crates/live-engine/src/vision.rs (and its "Latency" note).

import { InputVision, visionPaused, type Mask, type Shot } from './vision';
import { decodeFrames, encodeResults, type VisionImage, type VisionOut } from './visionWire';
import { setPictures } from '../visuals/sets';
import type { AutoFrame } from './types/AutoFrame';
import type { Background } from './types/Background';
import type { Show } from './types/Show';
import type { Source } from './types/Source';

/** What the worker needs of a model (InputVision; a fake in the tests). */
export interface VisionModel {
  mask: Mask | null;
  readonly aim: Shot;
  broken: boolean;
  update(el: HTMLCanvasElement, w: number, h: number, bg: Background, af: AutoFrame, outW: number, now: number, moving: boolean): void;
}

/** The pictures behind (and in front of) an input's people: what they are (`key`) and their pixels. */
export interface Backdrop {
  key: string;
  back: VisionImage | null;
  front: VisionImage | null;
}

export interface VisionDeps {
  /** The engine's newest small frames (waits a moment for some: a long poll). */
  frames: () => Promise<ArrayBuffer | Uint8Array>;
  /** Send what was found (rejects when the engine wants everything again). */
  send: (bytes: Uint8Array) => Promise<void>;
  /** How wide the engine's screens are (for "keep it sharp"). */
  outW: number;
  /** The picture behind an input's people ('wait': still loading). */
  backdrop?: (src: Source, show: Show) => Backdrop | 'wait';
  makeModel?: () => VisionModel;
  clock?: () => number;
}

/** Pictures behind people are sent at most this wide. */
const BACK_W = 1280;

/** A canvas (or picture) as RGBA, at most BACK_W wide. */
export function pixelsOf(src: HTMLCanvasElement | HTMLImageElement): VisionImage | null {
  const sw = src instanceof HTMLImageElement ? src.naturalWidth : src.width;
  const sh = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
  if (!sw || !sh) return null;
  const w = Math.min(BACK_W, sw);
  const h = Math.max(1, Math.round((sh * w) / sw));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h);
  return { w, h, rgba: ctx.getImageData(0, 0, w, h).data };
}

/** The pictures behind an input's people as the Standard processor uses them (`mediaUrl`: a file's address). */
export function makeBackdrop(mediaUrl: (path: string) => string): (src: Source, show: Show) => Backdrop | 'wait' {
  const images = new Map<string, HTMLImageElement>();
  return (src, show) => {
    const bg = src.background;
    if (bg.mode === 'set' && bg.set) {
      const p = setPictures(bg.set, show.event.brand.accent, show.event.name);
      if (!p) return { key: 'none', back: null, front: null };
      return { key: `set|${bg.set}|${show.event.brand.accent}|${show.event.name}`, back: pixelsOf(p.back), front: p.front ? pixelsOf(p.front) : null };
    }
    if (bg.mode === 'picture' && bg.picture) {
      let img = images.get(bg.picture);
      if (!img) {
        img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = mediaUrl(bg.picture);
        images.set(bg.picture, img);
      }
      if (!img.complete) return 'wait';
      return { key: `picture|${bg.picture}`, back: img.naturalWidth ? pixelsOf(img) : null, front: null };
    }
    return { key: 'none', back: null, front: null };
  };
}

export class VisionWorker {
  private show: Show | null = null;
  private readonly models = new Map<string, VisionModel>();
  private readonly canvases = new Map<string, HTMLCanvasElement>();
  /** What the engine has of each input's pictures behind (their key). */
  private readonly sent = new Map<string, string>();
  private running = false;
  readonly stats = { frames: 0, answers: 0, refused: 0 };

  constructor(private readonly deps: VisionDeps) {}

  setShow(show: Show): void {
    this.show = show;
    for (const id of [...this.models.keys()]) {
      if (!show.sources.some((s) => s.id === id)) {
        this.models.delete(id);
        this.canvases.delete(id);
        this.sent.delete(id);
      }
    }
  }

  /** Keep answering until stopped. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      while (this.running) {
        try {
          await this.step();
        } catch {
          // The engine stopped or is starting again: look again shortly.
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    };
    void loop();
  }

  stop(): void {
    this.running = false;
  }

  /** Wait for the engine's next frames, run the models on them and answer. */
  async step(): Promise<void> {
    const frames = decodeFrames(await this.deps.frames());
    const show = this.show;
    if (!show || !frames.length) return;
    const now = (this.deps.clock ?? (() => performance.now()))();
    const out: VisionOut[] = [];
    for (const f of frames) {
      const src = show.sources.find((s) => s.id === f.id);
      if (!src) continue;
      const bg = src.background;
      // A PTZ camera is steered instead (optical zoom): no digital zoom here.
      const af = src.ptz ? { ...src.autoFrame, enabled: false } : src.autoFrame;
      let model = this.models.get(f.id);
      if (!model) {
        model = this.deps.makeModel?.() ?? new InputVision();
        this.models.set(f.id, model);
      }
      const canvas = this.canvasFor(f.id, f.w, f.h);
      if (canvas) canvas.getContext('2d')?.putImageData(new ImageData(f.rgba, f.w, f.h), 0, 0);
      if (canvas) model.update(canvas, f.w, f.h, bg, af, this.deps.outW, now, true);
      this.stats.frames++;
      const paused = visionPaused(now) || model.broken;
      const r: VisionOut = {
        id: f.id,
        mask: bg.mode !== 'keep' && !paused ? model.mask : null,
        shot: af.enabled && !paused ? model.aim : null,
      };
      const b =
        bg.mode === 'picture' || bg.mode === 'set'
          ? (this.deps.backdrop?.(src, show) ?? { key: 'none', back: null, front: null })
          : { key: 'none', back: null, front: null };
      if (b !== 'wait' && (this.sent.get(f.id) ?? 'none') !== b.key) {
        r.back = b.back;
        r.front = b.front;
        this.sent.set(f.id, b.key);
      }
      out.push(r);
    }
    if (!out.length) return;
    try {
      await this.deps.send(encodeResults(out));
      this.stats.answers++;
    } catch {
      // The engine started again (a new graphics device): everything goes again.
      this.stats.refused++;
      this.sent.clear();
    }
  }

  private canvasFor(id: string, w: number, h: number): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    let c = this.canvases.get(id);
    if (!c) {
      c = document.createElement('canvas');
      this.canvases.set(id, c);
    }
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return c;
  }
}
