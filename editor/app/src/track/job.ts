// Running a track: the clip's frames are read exactly (as the export reads
// them), made small and gray, and handed to the tracker in a worker, forward
// or backward from the playhead. Points set by hand are kept, and the tracker
// starts again from them. It can be stopped at any time; what was found stays.
import type { Clip, Project, TrackPath, TrackPoint } from '../model/types';
import { layerFor } from '../render/frame';
import { FrameReader, lookSize } from '../vision/frames';
import { canvasOf } from '../vision/segment';
import { grayFromRgba } from './math';
import { mediaSize, poseAt } from './paths';
import { createTracker, type Place, type TrackerMessage, type TrackerReply } from './protocol';
import type { Pose } from './tracker';

/** Frames are looked at this many pixels on the long side (plenty for following, and quick). */
const LONG = 640;
/** Frames read at a time (backward tracking reads a batch forward, then goes through it backward). */
const BATCH = 24;

export interface TrackState {
  clip: string;
  path: string;
  dir: 1 | -1;
  done: number;
  total: number;
  running: boolean;
  /** What happened (lost the spot, stopped, finished). */
  message: string;
}

/** The tracker, in a worker when it can be (and in the editor itself when it can't). */
class Tracker {
  private worker: Worker | null = null;
  private local: ReturnType<typeof createTracker> | null = null;
  private waiting: ((r: TrackerReply) => void) | null = null;

  constructor() {
    try {
      this.worker = new Worker(new URL('./track.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<TrackerReply>) => this.waiting?.(e.data);
      this.worker.onerror = () => this.waiting?.({ type: 'error', message: 'The tracker stopped.' });
    } catch {
      this.worker = null;
    }
  }

  send(m: TrackerMessage): Promise<TrackerReply> {
    if (!this.worker) {
      const img = { w: m.w, h: m.h, data: m.data };
      try {
        if (m.type === 'start') {
          this.local = createTracker(m, img);
          return Promise.resolve({ type: 'ready' });
        }
        return Promise.resolve(this.local ? { type: 'pose', pose: this.local.next(m, img) } : { type: 'error', message: 'Not started.' });
      } catch (e) {
        return Promise.resolve({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    }
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.worker?.postMessage(m, [m.data.buffer]);
    });
  }

  close() {
    this.worker?.terminate();
  }
}

export class TrackJob {
  state: TrackState;
  private stopped = false;

  constructor(
    private p: Project,
    private clip: Clip,
    private path: TrackPath,
    private fps: number,
    private from: number,
    dir: 1 | -1,
    /** New points found (a few at a time). */
    private onPoints: (points: TrackPoint[]) => void,
    private onState: (s: TrackState) => void,
  ) {
    const total = dir > 0 ? clip.length - 1 - from : from;
    this.state = { clip: clip.id, path: path.id, dir, done: 0, total: Math.max(0, total), running: true, message: '' };
  }

  stop() {
    this.stopped = true;
  }

  private set(change: Partial<TrackState>) {
    this.state = { ...this.state, ...change };
    this.onState(this.state);
  }

  async run(): Promise<void> {
    const tracker = new Tracker();
    try {
      await this.track(tracker);
    } catch (e) {
      this.set({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      tracker.close();
      this.set({ running: false });
    }
  }

  private async track(tracker: Tracker) {
    const { clip, path, from } = this;
    const dir = this.state.dir;
    const media = mediaSize(this.p, clip);
    if (!media) return this.set({ message: 'Tracking works on clips that show a video or a picture.' });
    const [aw, ah] = lookSize(media.width, media.height, LONG);
    const start = poseAt(path, from);
    if (!start) return this.set({ message: 'Place the tracker point first.' });
    // Every frame to go through, in tracking order: the clip frame and the time in the file it shows.
    const frames: { local: number; time: number }[] = [];
    for (let local = from; local >= 0 && local < clip.length; local += dir) {
      const src = layerFor(this.p, clip, clip.start + local, this.fps).source;
      if (src?.kind !== 'video' && src?.kind !== 'image') break;
      frames.push({ local, time: src.kind === 'video' ? src.time : 0 });
    }
    if (frames.length < 2) return this.set({ message: dir > 0 ? 'Nothing left to track after this frame.' : 'Nothing left to track before this frame.' });
    const reader = new FrameReader(media);
    const toPx = (u: number, v: number): [number, number] => [u * aw - 0.5, v * ah - 0.5];
    const manual = new Set(path.manual ?? []);
    const placeAt = (local: number): Place | null => {
      const p = poseAt(path, local);
      return p ? { x: toPx(p.u, p.v)[0], y: toPx(p.u, p.v)[1], scale: p.scale, angle: p.angle } : null;
    };
    const box: [number, number] = [(path.box?.[0] ?? 0.1) * aw, (path.box?.[1] ?? 0.1) * ah];
    let pending: TrackPoint[] = [];
    const flush = () => {
      if (pending.length) this.onPoints(pending);
      pending = [];
    };
    let started = false;
    for (let b = 0; b < frames.length && !this.stopped; b += BATCH) {
      const batch = frames.slice(b, b + BATCH);
      // Read the batch in time order (quickest for the decoder), then go through it in tracking order.
      const order = batch.map((f, i) => ({ ...f, i })).sort((x, y) => x.time - y.time);
      const grays: (Float32Array | null)[] = new Array(batch.length).fill(null);
      await reader.each(
        order.map((f) => f.time),
        (k, pic) => {
          if (this.stopped) return false;
          if (pic) {
            const c = canvasOf(pic, aw, ah);
            const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
            grays[(order[k] as (typeof order)[number]).i] = grayFromRgba(ctx.getImageData(0, 0, aw, ah).data, aw, ah).data;
          }
          return true;
        },
      );
      for (let i = 0; i < batch.length && !this.stopped; i++) {
        const f = batch[i] as (typeof batch)[number];
        const data = grays[i];
        if (!data) {
          flush();
          return this.set({ message: `Frame ${f.local + 1} of the clip couldn't be read: tracking stopped there.` });
        }
        if (!started) {
          const at = placeAt(f.local) as Place;
          const r = await tracker.send({ type: 'start', kind: path.kind === 'region' ? 'region' : 'point', w: aw, h: ah, data, at, box });
          if (r.type === 'error') return this.set({ message: r.message });
          started = true;
          continue;
        }
        // A point set by hand: kept, and the tracker starts again from it.
        const reset = manual.has(f.local) ? placeAt(f.local) : null;
        const r = await tracker.send({ type: 'frame', w: aw, h: ah, data, reset });
        if (r.type === 'error') {
          flush();
          return this.set({ message: r.message });
        }
        if (r.type !== 'pose') continue;
        const pose: Pose = r.pose;
        if (!pose.ok) {
          flush();
          return this.set({ message: `Lost the spot at frame ${f.local + 1} of the clip. Drag the point to where it is there, then track again.` });
        }
        if (!reset)
          pending.push([f.local, (pose.x + 0.5) / aw, (pose.y + 0.5) / ah, ...(path.kind === 'region' ? [pose.scale, pose.angle] : [])] as TrackPoint);
        if (pending.length >= 8) flush();
        this.set({ done: this.state.done + 1 });
      }
    }
    flush();
    this.set({ message: this.stopped ? 'Stopped.' : 'Done.' });
  }
}
