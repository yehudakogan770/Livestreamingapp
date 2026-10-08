// Picture smarts, offline, on the operator's computer: taking the background
// away without a green screen (a person "mask"), and auto-framing (a wide
// camera that zooms in on and follows the people in it). The models are
// bundled with Lumora (public/models) and load the first time they're used.
//
// Safety first: if the models can't load or a frame fails, the picture is
// simply shown as it is. Nothing here may ever stop the show.

import type { ImageSegmenter, ObjectDetector } from '@mediapipe/tasks-vision';
import type { AutoFrame } from './types/AutoFrame';
import type { Background } from './types/Background';

/** A person found in the picture: a box in 0 – 1 of the picture's size. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the shot is: its center (0 – 1) and how far it is zoomed in (1: the whole picture). */
export interface Shot {
  cx: number;
  cy: number;
  zoom: number;
}

export const WIDE: Shot = { cx: 0.5, cy: 0.5, zoom: 1 };

/**
 * How far a camera can zoom in and stay sharp: as many times as it has more
 * pixels than the picture it goes into (a 4K camera in a 1080p stream: 2×),
 * with a little allowance nobody can see. Without "keep it sharp": up to 3×.
 */
export function maxZoom(cameraWidth: number, outputWidth: number, keepSharp: boolean): number {
  if (!keepSharp) return 3;
  if (!cameraWidth || !outputWidth) return 1;
  return Math.min(3, Math.max(1, (cameraWidth / outputWidth) * 1.15));
}

/** The part of the picture to frame (everyone, or the main person), tight shots keeping the top (head and shoulders). */
export function subject(people: Box[], f: Pick<AutoFrame, 'who' | 'tightness'>): (Box & { pad: number }) | null {
  if (people.length === 0) return null;
  let b: Box;
  if (f.who === 'main') {
    b = people.reduce((a, p) => (p.w * p.h > a.w * a.h ? p : a));
  } else {
    const x0 = Math.min(...people.map((p) => p.x));
    const y0 = Math.min(...people.map((p) => p.y));
    const x1 = Math.max(...people.map((p) => p.x + p.w));
    const y1 = Math.max(...people.map((p) => p.y + p.h));
    b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const t = Math.min(1, Math.max(0, f.tightness));
  // Tight shots keep the top of the person (head and shoulders), not the feet.
  const keep = t > 0.5 ? 1 - (t - 0.5) * 1.1 : 1;
  // Room around them: generous when loose, close when tight.
  return { ...b, h: b.h * keep, pad: 1.6 - 0.45 * t };
}

/** How many times closer the shot should be to frame the subject well (below 1: wider). */
export const wantedZoom = (b: Box & { pad: number }) => Math.min(1 / (b.w * b.pad), 1 / (b.h * b.pad));

/** The shot that frames the people found, as the settings ask. */
export function frameFor(people: Box[], f: Pick<AutoFrame, 'who' | 'tightness'>, limit: number): Shot {
  const b = subject(people, f);
  if (!b) return WIDE;
  const zoom = Math.min(limit, Math.max(1, wantedZoom(b)));
  const half = 0.5 / zoom;
  const clampC = (c: number) => Math.min(1 - half, Math.max(half, c));
  return { cx: clampC(b.x + b.w / 2), cy: clampC(b.y + b.h / 2), zoom };
}

/** Move the shot a step toward where it should be: calm, never jumpy. */
export function stepShot(cur: Shot, target: Shot, speed: number, dtMs: number): Shot {
  const rate = 0.5 + Math.min(1, Math.max(0, speed)) * 3;
  const k = 1 - Math.exp((-rate * Math.min(dtMs, 200)) / 1000);
  const zoom = Math.exp(Math.log(cur.zoom) + (Math.log(target.zoom) - Math.log(cur.zoom)) * k);
  return { cx: cur.cx + (target.cx - cur.cx) * k, cy: cur.cy + (target.cy - cur.cy) * k, zoom };
}

/** A new target only when people really moved (small moves are ignored, so the shot stays still). */
export function worthMoving(target: Shot, next: Shot): boolean {
  const room = 0.06 / target.zoom;
  return Math.abs(next.cx - target.cx) > room || Math.abs(next.cy - target.cy) > room || Math.abs(Math.log(next.zoom / target.zoom)) > 0.12;
}

/** The picture processor's zoom and pan (see chroma.ts) for a shot. */
export function shotToView(s: Shot): { zoom: number; panX: number; panY: number } {
  const room = 0.5 - 0.5 / s.zoom;
  if (room < 1e-4) return { zoom: 1, panX: 0, panY: 0 };
  const clamp = (v: number) => Math.min(1, Math.max(-1, v));
  return { zoom: s.zoom, panX: clamp((s.cx - 0.5) / room), panY: clamp((s.cy - 0.5) / room) };
}

// ---------------------------------------------------------------------------
// The models (one of each, shared by every input in this window).

interface Models {
  segmenter: ImageSegmenter | null;
  detector: ObjectDetector | null;
}

let models: Promise<Models> | null = null;
let failed = false;

async function load(): Promise<Models> {
  const mp = await import('@mediapipe/tasks-vision');
  const files = await mp.FilesetResolver.forVisionTasks(new URL('mediapipe', document.baseURI).href);
  const make = async <T>(f: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T | null> => {
    try {
      return await f('GPU');
    } catch {
      try {
        return await f('CPU');
      } catch {
        return null;
      }
    }
  };
  const segmenter = await make((delegate) =>
    mp.ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: new URL('models/selfie_segmenter.tflite', document.baseURI).href, delegate },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    }),
  );
  const detector = await make((delegate) =>
    mp.ObjectDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: new URL('models/efficientdet_lite0.tflite', document.baseURI).href, delegate },
      runningMode: 'VIDEO',
      categoryAllowlist: ['person'],
      scoreThreshold: 0.35,
      maxResults: 8,
    }),
  );
  return { segmenter, detector };
}

/** The models, loading them the first time (null while loading, or if they can't run here). */
function ready(): Models | null {
  if (failed) return null;
  if (!models) {
    models = load();
    models.then(
      (m) => (loaded = m),
      () => (failed = true),
    );
  }
  return loaded;
}
let loaded: Models | null = null;

/**
 * The safety net: when the models take too long (the computer is too busy),
 * they pause for a while and pictures show as they are, so the show stays
 * smooth. Shared by every input in this window.
 */
const BUSY_MS = 28;
const PAUSE_MS = 30_000;
let cost = 0;
let pausedUntil = 0;
/** The picture smarts are paused because the computer is too busy. */
export const visionPaused = (now = performance.now()) => now < pausedUntil;
/** Note how long one model call took; too long on average pauses them all. */
export function noteCost(ms: number, now = performance.now()): void {
  cost = cost * 0.9 + ms * 0.1;
  if (cost > BUSY_MS) {
    pausedUntil = now + PAUSE_MS;
    cost = 0;
  }
}

/** Every model call gets a later time than the last (the models ask for it). */
let lastStamp = 0;
const stamp = () => (lastStamp = Math.max(lastStamp + 1, performance.now()));

type Picture = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/** A person mask: how sure the model is each spot is a person, 0 – 255. */
export interface Mask {
  data: Uint8Array;
  w: number;
  h: number;
}

/**
 * One input's picture smarts: its person mask and its auto-framed shot,
 * kept up to date as frames come.
 */
export class InputVision {
  mask: Mask | null = null;
  shot: Shot = WIDE;
  /** The people found the last time it looked (auto-framing). */
  people: Box[] = [];
  /** When it last looked for people. */
  lookedAt = 0;
  private target: Shot = WIDE;
  private lastMask = 0;
  private lastLook = 0;
  private lastStep = 0;
  private seenAt = 0;
  private stillDone = false;
  /** A frame failed: this input is left alone from now on. */
  broken = false;

  /** Where auto-framing aims now (the shot moves toward it). */
  get aim(): Shot {
    return this.target;
  }

  /**
   * Bring this input up to date with a new frame of `el` (sized w × h).
   * `outW` is how wide it is shown (for "keep it sharp"). `moving`: frames
   * of a moving picture (a camera's frames drawn on a canvas, for the
   * unified engine); by default only a video element is one.
   */
  update(el: Picture, w: number, h: number, bg: Background, af: AutoFrame, outW: number, now = performance.now(), moving?: boolean): void {
    if (this.broken || !w || !h) return;
    if (visionPaused(now)) {
      this.mask = null;
      this.shot = WIDE;
      return;
    }
    const m = ready();
    if (!m) return;
    const still = moving === undefined ? !(el instanceof HTMLVideoElement) : !moving;
    try {
      // The mask, up to 30 times a second (a still picture: once).
      if (bg.mode !== 'keep' && m.segmenter && (still ? !this.stillDone : now - this.lastMask >= 33)) {
        this.lastMask = now;
        this.stillDone = still;
        const t0 = performance.now();
        const r = m.segmenter.segmentForVideo(el, stamp());
        if (!still) noteCost(performance.now() - t0, now);
        const conf = r.confidenceMasks?.[0];
        if (conf) {
          const f = conf.getAsFloat32Array();
          const prev = this.mask && this.mask.w === conf.width && this.mask.h === conf.height ? this.mask.data : null;
          const data = new Uint8Array(f.length);
          // Blended with the last mask, so the edge doesn't flicker.
          for (let i = 0; i < f.length; i++) {
            const v = f[i]! * 255;
            data[i] = prev ? (v * 0.65 + prev[i]! * 0.35) | 0 : v | 0;
          }
          this.mask = { data, w: conf.width, h: conf.height };
        }
        r.close();
      }
      if (bg.mode === 'keep') this.mask = null;
      // Auto-framing: look for people 5 times a second; move smoothly every frame.
      if (af.enabled && m.detector) {
        if (now - this.lastLook >= 200) {
          this.lastLook = now;
          const t0 = performance.now();
          const found = m.detector.detectForVideo(el, stamp()).detections;
          // Looked for 5 times a second, so it may take longer than a mask.
          noteCost((performance.now() - t0) / 3, now);
          const people: Box[] = [];
          for (const d of found) {
            const b = d.boundingBox;
            if (b) people.push({ x: b.originX / w, y: b.originY / h, w: b.width / w, h: b.height / h });
          }
          // Nobody for a moment (someone turned away): hold the shot 3 s, then go wide.
          this.people = people;
          this.lookedAt = now;
          if (people.length) this.seenAt = now;
          if (people.length || now - this.seenAt > 3000) {
            const next = frameFor(people, af, maxZoom(w, outW, af.keepSharp));
            if (worthMoving(this.target, next)) this.target = next;
          }
        }
        this.shot = stepShot(this.shot, this.target, af.speed, this.lastStep ? now - this.lastStep : 0);
        this.lastStep = now;
      } else {
        this.shot = WIDE;
        this.target = WIDE;
        this.lastStep = 0;
      }
    } catch (e) {
      console.warn('Lumora: picture smarts stopped for an input', e);
      this.broken = true;
      this.mask = null;
      this.shot = WIDE;
    }
  }
}

/** Does this input need the picture smarts at all? */
export const usesVision = (bg: Background | undefined, af: AutoFrame | undefined) => (bg?.mode ?? 'keep') !== 'keep' || !!af?.enabled;

/** The models can't run on this computer (shown to the operator). */
export const visionFailed = () => failed || (loaded !== null && !loaded.segmenter && !loaded.detector);
