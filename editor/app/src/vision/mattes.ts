// AI masks for clips: each frame's matte is worked out once (in the
// background, while you edit) and kept: in memory, packed small, and on the
// disk so opening the project again doesn't redo it. The viewer and the
// export ask here for the same frame and get the same matte; the export waits
// for any frame that isn't done yet, so the film is exact.
import { poseAt } from '../track/paths';
import type { Clip, MediaItem, Project } from '../model/types';
import { inApp, native } from '../native';
import { layerFor, type EffectNow, type Layer } from '../render/frame';
import { decodedFile, FrameReader, lookSize } from './frames';
import { finish, pack, unpack, type Matte, type MatteLook } from './matte';
import { canvasOf, segmentObject, segmentPerson, type ObjectMethod } from './segment';
import { drawnMatte, drawnShape } from '../render/drawnmask';

/** What a matte is of: the people, or the object at a spot (0–1 of the picture). */
export type MatteSpec = { kind: 'person' } | { kind: 'object'; u: number; v: number; tol: number };

export const isAiMask = (type: string): boolean => type === 'personmask' || type === 'objectmask';

/** Looked at this many pixels on the long side (the person model works at 256; the object model at 512). */
const LONG = { person: 320, object: 512 };

/** The frame of the file showing at a time (whole frames, as the decoder gives them). */
export const fileFrame = (m: MediaItem, time: number): number => (m.kind === 'image' ? 0 : Math.floor(time * (m.fps || 30) + 1e-3));

/** What an AI mask effect is of at a frame of its clip (null: not set up yet, e.g. no click on the object). */
export function specFor(clip: Clip, e: { type: string; p: Record<string, unknown>; d?: Record<string, unknown> }, local: number): MatteSpec | null {
  if (e.type === 'personmask') return { kind: 'person' };
  if (e.type !== 'objectmask') return null;
  const tol = typeof e.p.tolerance === 'number' ? e.p.tolerance : 25;
  // The clicked spot, carried through the clip by its track.
  const pathId = typeof e.d?.track === 'string' ? e.d.track : '';
  const pose = pathId
    ? poseAt(
        clip.paths?.find((x) => x.id === pathId),
        local,
      )
    : null;
  if (pose) return { kind: 'object', u: pose.u, v: pose.v, tol };
  const seed = e.d?.seed as [number, number] | undefined;
  return Array.isArray(seed) ? { kind: 'object', u: seed[0], v: seed[1], tol } : null;
}

const bucketOf = (m: MediaItem, spec: MatteSpec) => `${decodedFile(m)}|${spec.kind}`;
const keyOf = (frame: number, spec: MatteSpec) =>
  spec.kind === 'person' ? `${frame}` : `${frame}:${spec.u.toFixed(3)}:${spec.v.toFixed(3)}:${Math.round(spec.tol)}`;

interface Packed {
  w: number;
  h: number;
  bytes: Uint8Array;
  how: ObjectMethod | 'ai';
}

interface Bucket {
  media: MediaItem;
  kind: MatteSpec['kind'];
  frames: Map<string, Packed>;
  /** Read from the disk (once). */
  loaded: Promise<void>;
  dirty: boolean;
}

export interface MatteStatus {
  done: number;
  total: number;
  running: boolean;
  /** How "Select object" is finding it. */
  how: ObjectMethod | null;
  /** Why it can't (the model won't run here). */
  problem: string;
}

const NO_STATUS: MatteStatus = { done: 0, total: 0, running: false, how: null, problem: '' };

interface Job {
  id: string;
  stop: boolean;
  status: MatteStatus;
  /** When it last finished (it isn't started again straight away by itself). */
  ended: number;
}

/** The disk file format: "LMT1", then per frame its key, size and packed bytes. */
export function encodeBucket(frames: Map<string, Packed>): Uint8Array {
  const parts: Uint8Array[] = [new TextEncoder().encode('LMT1')];
  const enc = new TextEncoder();
  for (const [k, f] of frames) {
    const key = enc.encode(`${k}|${f.how}`);
    const head = new DataView(new ArrayBuffer(2 + key.length + 8));
    head.setUint16(0, key.length, true);
    new Uint8Array(head.buffer).set(key, 2);
    head.setUint16(2 + key.length, f.w, true);
    head.setUint16(4 + key.length, f.h, true);
    head.setUint32(6 + key.length, f.bytes.length, true);
    parts.push(new Uint8Array(head.buffer), f.bytes);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function decodeBucket(bytes: Uint8Array): Map<string, Packed> {
  const out = new Map<string, Packed>();
  if (bytes.length < 4 || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'LMT1') return out;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  let o = 4;
  while (o + 2 <= bytes.length) {
    const kl = view.getUint16(o, true);
    if (o + 2 + kl + 8 > bytes.length) break;
    const [key, how] = dec.decode(bytes.subarray(o + 2, o + 2 + kl)).split('|');
    const w = view.getUint16(o + 2 + kl, true);
    const h = view.getUint16(o + 4 + kl, true);
    const n = view.getUint32(o + 6 + kl, true);
    o += 2 + kl + 8;
    if (o + n > bytes.length) break;
    out.set(key ?? '', { w, h, bytes: bytes.slice(o, o + n), how: how === 'color' ? 'color' : 'ai' });
    o += n;
  }
  return out;
}

export class MatteStore {
  private buckets = new Map<string, Bucket>();
  private jobs = new Map<string, Job>();
  private queue: (() => Promise<void>)[] = [];
  private working = false;
  private listeners = new Set<() => void>();
  /** Recently unpacked mattes (unpacking is quick, but not free). */
  private recent = new Map<string, Matte>();
  private done = new WeakMap<Matte, { key: string; out: Matte; stamp: string }>();
  private ids = new WeakMap<Matte, number>();
  private nextId = 1;
  private saveTimer = 0;
  /** A new matte is ready (the viewer draws again). */
  onReady: (() => void) | null = null;
  /** A track is still being followed (an object's mask waits for it, or it would be worked out at the wrong spots). */
  tracking: ((clip: string, path: string) => boolean) | null = null;

  subscribe = (f: () => void): (() => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  private emit() {
    for (const f of this.listeners) f();
  }

  private bucket(media: MediaItem, spec: MatteSpec): Bucket {
    const id = bucketOf(media, spec);
    let b = this.buckets.get(id);
    if (!b) {
      const frames = new Map<string, Packed>();
      const made: Bucket = { media, kind: spec.kind, frames, loaded: Promise.resolve(), dirty: false };
      made.loaded = inApp()
        ? native
            .matteRead(decodedFile(media), spec.kind)
            .then((bytes) => {
              for (const [k, f] of decodeBucket(bytes)) if (!frames.has(k)) frames.set(k, f);
              if (frames.size) this.onReady?.();
            })
            .catch(() => undefined)
        : Promise.resolve();
      this.buckets.set(id, made);
      b = made;
    }
    return b;
  }

  /** The matte for a frame, if it is done. */
  get(media: MediaItem, spec: MatteSpec, time: number): Matte | null {
    const b = this.bucket(media, spec);
    const key = keyOf(fileFrame(media, time), spec);
    const p = b.frames.get(key);
    if (!p) return null;
    const rk = `${bucketOf(media, spec)}#${key}`;
    let m = this.recent.get(rk);
    if (!m) {
      m = unpack(p.bytes, p.w, p.h) ?? undefined;
      if (!m) return null;
      this.ids.set(m, this.nextId++);
      this.recent.set(rk, m);
      if (this.recent.size > 24) this.recent.delete(this.recent.keys().next().value as string);
    }
    return m;
  }

  private put(media: MediaItem, spec: MatteSpec, time: number, m: Matte, how: ObjectMethod | 'ai') {
    const b = this.bucket(media, spec);
    b.frames.set(keyOf(fileFrame(media, time), spec), { w: m.w, h: m.h, bytes: pack(m), how });
    b.dirty = true;
    this.saveSoon();
  }

  /** Work out one frame's matte from its picture (null when the models can't run here). */
  private async make(media: MediaItem, spec: MatteSpec, pic: CanvasImageSource | ImageData): Promise<{ m: Matte; how: ObjectMethod | 'ai' } | null> {
    const [w, h] = lookSize(media.width, media.height, LONG[spec.kind]);
    const c = canvasOf(pic, w, h);
    if (spec.kind === 'person') {
      const m = await segmentPerson(c);
      return m ? { m, how: 'ai' } : null;
    }
    const r = await segmentObject(c, spec.u, spec.v, spec.tol);
    return { m: r.matte, how: r.how };
  }

  /** The export: make sure a frame's matte is done, from the exact frame it decoded (raw pixels when FFmpeg read the original). */
  async ensure(layer: Layer, e: EffectNow, pic: CanvasImageSource | ImageData | null): Promise<void> {
    const src = layer.source;
    if (!pic || (src?.kind !== 'video' && src?.kind !== 'image')) return;
    const spec = specFor(layer.clip, e, layer.local);
    if (!spec) return;
    const time = src.kind === 'video' ? src.time : 0;
    await this.bucket(src.media, spec).loaded;
    if (this.get(src.media, spec, time)) return;
    const made = await this.make(src.media, spec, pic).catch(() => null);
    if (made) this.put(src.media, spec, time, made.m, made.how);
  }

  /** How far a clip's AI mask is along. */
  status(clip: string, effect: string): MatteStatus {
    return this.jobs.get(`${clip}:${effect}`)?.status ?? NO_STATUS;
  }

  stop(clip: string, effect: string) {
    const j = this.jobs.get(`${clip}:${effect}`);
    if (j) j.stop = true;
  }

  /**
   * Work out every frame of a clip's AI mask in the background (frames already
   * done are skipped). `from` is the clip frame to start at (the playhead).
   */
  analyze(p: Project, clip: Clip, effectId: string, fps: number, from = 0, force = false) {
    const id = `${clip.id}:${effectId}`;
    const have = this.jobs.get(id);
    if (have && (have.status.running || have.stop)) return;
    // Asked for by drawing: not again and again when some frames can't be done.
    if (have && !force && (have.status.problem || performance.now() - have.ended < 5000)) return;
    const track = clip.effects.find((e) => e.id === effectId)?.d?.track;
    if (typeof track === 'string' && this.tracking?.(clip.id, track)) return;
    const job: Job = { id, stop: false, status: { done: 0, total: clip.length, running: true, how: null, problem: '' }, ended: 0 };
    this.jobs.set(id, job);
    this.emit();
    this.queue.push(() => this.run(job, p, clip, effectId, fps, from));
    void this.work();
  }

  private async work() {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length) await (this.queue.shift() as () => Promise<void>)();
    } finally {
      this.working = false;
    }
  }

  private async run(job: Job, p: Project, clip: Clip, effectId: string, fps: number, from: number) {
    const set = (change: Partial<MatteStatus>) => {
      job.status = { ...job.status, ...change };
      this.emit();
    };
    try {
      if (!clip.effects.some((x) => x.id === effectId)) return;
      // Each clip frame: the file and time it shows and what to find there (exactly as drawing works them out).
      const todo: { local: number; media: MediaItem; time: number; spec: MatteSpec }[] = [];
      const start = Math.max(0, Math.min(clip.length - 1, from));
      for (let k = 0; k < clip.length; k++) {
        const local = (start + k) % clip.length;
        const layer = layerFor(p, clip, clip.start + local, fps);
        const src = layer.source;
        const e = layer.effects.find((x) => x.id === effectId);
        const spec = e ? specFor(clip, e, local) : null;
        if (!spec || (src?.kind !== 'video' && src?.kind !== 'image')) continue;
        todo.push({ local, media: src.media, time: src.kind === 'video' ? src.time : 0, spec });
      }
      set({ total: todo.length });
      if (!todo.length) return;
      await Promise.all([...new Set(todo.map((t) => this.bucket(t.media, t.spec)))].map((b) => b.loaded));
      const missing = todo.filter((t) => !this.get(t.media, t.spec, t.time));
      set({ done: todo.length - missing.length });
      // One reader per file; in two runs (from the playhead to the end, then the start), each in time order.
      const byFile = new Map<MediaItem, typeof missing>();
      for (const t of missing) byFile.set(t.media, [...(byFile.get(t.media) ?? []), t]);
      let done = todo.length - missing.length;
      for (const [media, list] of byFile) {
        const reader = new FrameReader(media);
        const runs = [list.filter((t) => t.local >= start), list.filter((t) => t.local < start)];
        for (const run of runs) {
          run.sort((a, b) => a.time - b.time);
          await reader.each(
            run.map((t) => t.time),
            async (i, pic) => {
              if (job.stop) return false;
              const t = run[i] as (typeof run)[number];
              if (pic && !this.get(t.media, t.spec, t.time)) {
                const made = await this.make(t.media, t.spec, pic);
                if (!made) {
                  set({ problem: 'The AI model could not start on this computer.' });
                  return false;
                }
                this.put(t.media, t.spec, t.time, made.m, made.how);
                if (t.spec.kind === 'object') job.status.how = made.how;
                this.onReady?.();
              }
              done++;
              if (done % 3 === 0 || done === todo.length) set({ done });
              // Let the screen breathe between frames.
              await new Promise((r) => setTimeout(r, 0));
              return true;
            },
          );
          if (job.stop || job.status.problem) break;
        }
      }
    } catch (err) {
      set({ problem: err instanceof Error ? err.message : String(err) });
    } finally {
      job.ended = performance.now();
      set({ running: false });
      // A stopped job can be started again.
      if (job.stop) this.jobs.delete(job.id);
      this.save();
    }
  }

  private saveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 4000);
  }

  /** Keep what was worked out on the disk (in the app). */
  private save() {
    if (!inApp()) return;
    for (const b of this.buckets.values()) {
      if (!b.dirty) continue;
      b.dirty = false;
      void native.matteWrite(decodedFile(b.media), b.kind, encodeBucket(b.frames)).catch(() => (b.dirty = true));
    }
  }

  /** A raw matte with the effect's settings applied (worked out once per matte and settings). */
  finished(raw: Matte, look: MatteLook): { w: number; h: number; data: Uint8Array; stamp: string } {
    const key = `${look.feather}|${look.expand}|${look.invert}`;
    const have = this.done.get(raw);
    if (have && have.key === key) return { ...have.out, stamp: have.stamp };
    const out = finish(raw, look);
    const stamp = `${this.ids.get(raw) ?? 0}|${key}`;
    this.done.set(raw, { key, out, stamp });
    return { ...out, stamp };
  }
}

/** One store for the window: the viewer and the export share it. */
export const mattes = new MatteStore();

/** The settings of an AI mask effect, for its matte. */
export const lookOf = (e: EffectNow): MatteLook => ({ feather: e.p.feather ?? 0, expand: e.p.expand ?? 0, invert: (e.p.invert ?? 0) >= 0.5 });

/**
 * The matte an AI mask effect gives a layer at its frame, finished with the
 * effect's settings (null: not done yet; `missing` is called then).
 */
export function matteFor(layer: Layer, e: EffectNow, missing?: () => void): { w: number; h: number; data: Uint8Array; stamp: string } | null {
  if (e.type === 'drawnmask') {
    // Drawn on the frame: the same for every source.
    const shape = drawnShape(e.d);
    return shape ? drawnMatte(shape, typeof e.p.feather === 'number' ? e.p.feather : 12, (e.p.invert ?? 0) >= 0.5) : null;
  }
  const src = layer.source;
  if (src?.kind !== 'video' && src?.kind !== 'image') return null;
  const spec = specFor(layer.clip, e, layer.local);
  if (!spec) return null;
  const raw = mattes.get(src.media, spec, src.kind === 'video' ? src.time : 0);
  if (!raw) {
    missing?.();
    return null;
  }
  return mattes.finished(raw, lookOf(e));
}
