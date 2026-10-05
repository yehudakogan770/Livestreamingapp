// What the editor and the tracking worker say to each other (the same tracker
// also runs in the editor itself if a worker can't start).
import type { Gray } from './math';
import { PlanarTracker, PointTracker, type Pose } from './tracker';

/** Where to start, or start again (a point set by hand): pixels of the analyzed picture. */
export interface Place {
  x: number;
  y: number;
  scale: number;
  angle: number;
}

export type TrackerMessage =
  | { type: 'start'; kind: 'point' | 'region'; w: number; h: number; data: Float32Array; at: Place; box: [number, number] }
  | { type: 'frame'; w: number; h: number; data: Float32Array; reset: Place | null };

export type TrackerReply = { type: 'ready' } | { type: 'pose'; pose: Pose } | { type: 'error'; message: string };

export function createTracker(start: Extract<TrackerMessage, { type: 'start' }>, first: Gray) {
  const { at } = start;
  const t =
    start.kind === 'region'
      ? new PlanarTracker(first, { x: at.x, y: at.y, w: start.box[0], h: start.box[1] })
      : new PointTracker(first, at.x, at.y, Math.max(6, Math.round(Math.min(first.w, first.h) / 36)));
  if (t instanceof PlanarTracker && (at.scale !== 1 || at.angle !== 0)) t.reset(first, at.x, at.y, at.scale, at.angle);
  return {
    next(m: TrackerMessage, img: Gray): Pose {
      if (m.type === 'frame' && m.reset) {
        const r = m.reset;
        if (t instanceof PlanarTracker) t.reset(img, r.x, r.y, r.scale, r.angle);
        else t.reset(img, r.x, r.y);
        return { ...r, ok: true, score: 1 };
      }
      return t.step(img);
    },
  };
}
