// Using tracks when a frame is drawn: where a tracked spot is in the frame,
// masks and clips that follow it, and steadying a shaky clip. The viewer and
// the exported film both draw through here, so they always agree.
import { valueAt } from '../model/anim';
import type { Clip, Effect, MediaItem, Project, Sequence, Stabilize, TrackPath, TrackPoint } from '../model/types';
import type { Layer, MotionNow } from '../render/frame';

/** Where a track is at a frame: 0–1 across and down the picture, its size (1: as at the start) and turn (degrees). */
export interface PoseNow {
  u: number;
  v: number;
  scale: number;
  angle: number;
}

/** The part of Motion that moves, sizes and turns the picture. */
export type Placement = Pick<MotionNow, 'x' | 'y' | 'scale' | 'scaleX' | 'rotation'>;

const scaleOf = (p: TrackPoint) => p[3] ?? 1;
const angleOf = (p: TrackPoint) => p[4] ?? 0;

/** The track at a frame of the clip (in between: a straight line; before or after it: held). */
export function poseAt(path: TrackPath | undefined, t: number): PoseNow | null {
  const pts = path?.points;
  if (!pts || pts.length === 0) return null;
  const first = pts[0] as TrackPoint;
  if (t <= first[0]) return { u: first[1], v: first[2], scale: scaleOf(first), angle: angleOf(first) };
  const last = pts[pts.length - 1] as TrackPoint;
  if (t >= last[0]) return { u: last[1], v: last[2], scale: scaleOf(last), angle: angleOf(last) };
  // Points are in frame order: find the two around t.
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((pts[mid] as TrackPoint)[0] <= t) lo = mid;
    else hi = mid;
  }
  const a = pts[lo] as TrackPoint;
  const b = pts[hi] as TrackPoint;
  const k = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
  return {
    u: a[1] + (b[1] - a[1]) * k,
    v: a[2] + (b[2] - a[2]) * k,
    scale: scaleOf(a) + (scaleOf(b) - scaleOf(a)) * k,
    angle: angleOf(a) + (angleOf(b) - angleOf(a)) * k,
  };
}

/** A track point set (or replaced) at a frame, kept in frame order. */
export function setPoint(path: TrackPath, p: TrackPoint, manual = false): TrackPath {
  const points = path.points.filter((x) => x[0] !== p[0]);
  let i = points.findIndex((x) => x[0] > p[0]);
  if (i < 0) i = points.length;
  points.splice(i, 0, p);
  const hand = new Set(path.manual ?? []);
  if (manual) hand.add(p[0]);
  return { ...path, points, ...(hand.size ? { manual: [...hand].sort((a, b) => a - b) } : {}) };
}

/** A clip's tracks (and what refers to their frames) moved in time: the clip's start was trimmed, or its speed changed. */
export function retimeTracks(c: Clip, f: (t: number) => number): Clip {
  const usesFrames = c.paths?.length || c.stabilize || c.effects.some((e) => typeof e.d?.trackAt === 'number');
  if (!usesFrames) return c;
  return {
    ...c,
    ...(c.paths
      ? {
          paths: c.paths.map((p) => ({
            ...p,
            points: p.points.map((x) => [f(x[0]), ...x.slice(1)] as TrackPoint),
            ...(p.manual ? { manual: p.manual.map(f) } : {}),
          })),
        }
      : {}),
    ...(c.stabilize ? { stabilize: { ...c.stabilize, at: f(c.stabilize.at) } } : {}),
    effects: c.effects.map((e) => (typeof e.d?.trackAt === 'number' ? { ...e, d: { ...e.d, trackAt: f(e.d.trackAt) } } : e)),
  };
}

/**
 * Clips copied with new ids (into a nest, a reframed copy, a paste): one that
 * follows a clip copied with it follows that clip's copy, at the same place
 * on it (`shift`: how far the copies moved along the timeline).
 */
export function carryFollows(clips: Clip[], ids: ReadonlyMap<string, string>, shift: number): Clip[] {
  return clips.map((c) => {
    const fl = c.follow;
    const to = fl ? ids.get(fl.clip) : undefined;
    return fl && to ? { ...c, follow: { ...fl, clip: to, at: fl.at + shift } } : c;
  });
}

/** How big the picture is in the frame before Motion (fit inside, or fill), in sequence pixels. */
export function placedSize(srcW: number, srcH: number, fill: boolean, W: number, H: number): [number, number] {
  if (!srcW || !srcH) return [W, H];
  const fit = fill ? Math.max(W / srcW, H / srcH) : Math.min(W / srcW, H / srcH);
  return [srcW * fit, srcH * fit];
}

/** A spot of the picture (0–1) as sequence pixels from the middle of the frame, before Motion. */
export const pictureToPlaced = (u: number, v: number, pw: number, ph: number): [number, number] => [(u - 0.5) * pw, (v - 0.5) * ph];
export const placedToPicture = (x: number, y: number, pw: number, ph: number): [number, number] => [x / pw + 0.5, y / ph + 0.5];

const rot = (deg: number, x: number, y: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
};

/** Where Motion puts a spot (pixels from the middle, before Motion) in the frame: sized, turned, moved — as the compositor does. */
export function placedToFrame(m: Placement, x: number, y: number): [number, number] {
  const [rx, ry] = rot(m.rotation, x * (m.scale / 100) * (m.scaleX / 100), y * (m.scale / 100));
  return [rx + m.x, ry + m.y];
}

/** The other way: a spot in the frame back to the picture before Motion. */
export function frameToPlaced(m: Placement, X: number, Y: number): [number, number] {
  const [x, y] = rot(-m.rotation, X - m.x, Y - m.y);
  const s = Math.max(1e-6, m.scale / 100);
  return [x / (s * Math.max(1e-6, m.scaleX / 100)), y / s];
}

/** The clip's picture size, for clips that show a file. */
export function mediaSize(p: Project, c: Clip): MediaItem | null {
  const src = c.source;
  if (src.kind === 'media') return p.media.find((m) => m.id === src.media) ?? null;
  if (src.kind === 'multicam') {
    const a = p.groups.find((g) => g.id === src.group)?.angles.find((x) => x.id === src.angle);
    return (a && p.media.find((m) => m.id === a.media)) ?? null;
  }
  return null;
}

const placement = (c: Clip, local: number): Placement => {
  const t = Math.max(0, Math.min(c.length - 1, local));
  const m = c.motion;
  return { x: valueAt(m.x, t), y: valueAt(m.y, t), scale: valueAt(m.scale, t, 100), scaleX: valueAt(m.scaleX, t, 100), rotation: valueAt(m.rotation, t) };
};

// ---------------------------------------------------------------------------
// Steadying a clip.

/** How each frame is corrected: the picture is moved, turned and sized around the tracked spot. */
export interface Steady {
  /** Per frame of the clip: where the spot is (P) and where it should be (Q), pixels before Motion; size and turn changes. */
  px: Float64Array;
  py: Float64Array;
  qx: Float64Array;
  qy: Float64Array;
  k: Float64Array;
  turn: Float64Array;
  /** The zoom (about the frame's middle) that keeps the edges out of sight. */
  zoom: number;
}

/** Smooth a list of numbers (a bell-shaped average over `sigma` frames each way; the ends are held). */
export function smoothList(v: ArrayLike<number>, sigma: number): Float64Array {
  const n = v.length;
  const out = new Float64Array(n);
  if (sigma <= 0.01) {
    for (let i = 0; i < n; i++) out[i] = v[i] as number;
    return out;
  }
  const r = Math.ceil(sigma * 3);
  const w = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  for (let i = 0; i < n; i++) {
    let s = 0;
    let ws = 0;
    for (let j = -r; j <= r; j++) {
      const x = v[Math.max(0, Math.min(n - 1, i + j))] as number;
      s += x * (w[j + r] as number);
      ws += w[j + r] as number;
    }
    out[i] = s / ws;
  }
  return out;
}

/**
 * The zoom (1 or more) that hides the edges: every corner of the frame, taken
 * back through each frame's correction, must land inside the picture.
 */
export function cropZoom(st: Omit<Steady, 'zoom'>, pw: number, ph: number, W: number, H: number, most = 3): number {
  const hx = Math.min(pw, W) / 2;
  const hy = Math.min(ph, H) / 2;
  let u = 1;
  for (let t = 0; t < st.px.length; t++) {
    const k = st.k[t] as number;
    const turn = st.turn[t] as number;
    // Undoing the correction: x = P + R(−turn)(y − Q)/k; for y = corner / zoom, that is A + B / zoom.
    const [qx, qy] = rot(-turn, st.qx[t] as number, st.qy[t] as number);
    const ax = (st.px[t] as number) - qx / k;
    const ay = (st.py[t] as number) - qy / k;
    for (const [cx, cy] of [
      [-hx, -hy],
      [hx, -hy],
      [-hx, hy],
      [hx, hy],
    ] as [number, number][]) {
      const [bx, by] = rot(-turn, cx / k, cy / k);
      for (const [a, b, lim] of [
        [ax, bx, pw / 2],
        [ay, by, ph / 2],
      ] as [number, number, number][]) {
        if (Math.abs(b) < 1e-9) continue;
        const bound = b > 0 ? (lim - a) / b : (-lim - a) / b;
        if (bound < u) u = bound;
      }
    }
  }
  return Math.min(most, 1 / Math.max(1 / most, u));
}

const steadyCache = new WeakMap<TrackPath, Map<string, Steady>>();

/** The correction for every frame of a clip (worked out once for each track and settings). */
export function steadyFor(path: TrackPath, st: Stabilize, length: number, pw: number, ph: number, W: number, H: number): Steady {
  const key = JSON.stringify([st.smooth, st.lock, st.at, st.crop, st.rotate, st.scale, length, pw, ph, W, H]);
  let byKey = steadyCache.get(path);
  if (!byKey) {
    byKey = new Map();
    steadyCache.set(path, byKey);
  }
  const have = byKey.get(key);
  if (have) return have;
  const n = Math.max(1, length);
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const ps = new Float64Array(n);
  const pa = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    const pose = poseAt(path, t) ?? { u: 0.5, v: 0.5, scale: 1, angle: 0 };
    [px[t], py[t]] = pictureToPlaced(pose.u, pose.v, pw, ph);
    ps[t] = pose.scale;
    pa[t] = pose.angle;
  }
  let qx: Float64Array;
  let qy: Float64Array;
  let qs: Float64Array;
  let qa: Float64Array;
  if (st.lock) {
    const at = Math.max(0, Math.min(n - 1, Math.round(st.at)));
    qx = new Float64Array(n).fill(px[at] as number);
    qy = new Float64Array(n).fill(py[at] as number);
    qs = new Float64Array(n).fill(ps[at] as number);
    qa = new Float64Array(n).fill(pa[at] as number);
  } else {
    // 100: up to a second and a half each way (at 30 frames a second).
    const sigma = Math.max(0, Math.min(100, st.smooth)) * 0.15;
    qx = smoothList(px, sigma);
    qy = smoothList(py, sigma);
    qs = smoothList(ps, sigma);
    qa = smoothList(pa, sigma);
  }
  const k = new Float64Array(n);
  const turn = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    k[t] = st.scale && path.kind === 'region' ? (qs[t] as number) / Math.max(1e-6, ps[t] as number) : 1;
    turn[t] = st.rotate && path.kind === 'region' ? (qa[t] as number) - (pa[t] as number) : 0;
  }
  const base = { px, py, qx, qy, k, turn };
  const out: Steady = { ...base, zoom: st.crop ? cropZoom(base, pw, ph, W, H) : 1 };
  byKey.set(key, out);
  return out;
}

/**
 * Motion with a frame's correction added: the picture is moved so the
 * tracked spot sits where the smooth path says, turned and sized around it,
 * then zoomed about the frame's middle so no edge shows.
 */
export function steadied<M extends Placement>(m: M, st: Steady, t: number): M {
  const i = Math.max(0, Math.min(st.px.length - 1, Math.round(t)));
  const k = st.k[i] as number;
  const turn = st.turn[i] as number;
  const z = st.zoom;
  // Q − k·R(turn)·P: where the picture's middle goes, before Motion.
  const [rpx, rpy] = rot(turn, st.px[i] as number, st.py[i] as number);
  const ox = (st.qx[i] as number) - k * rpx;
  const oy = (st.qy[i] as number) - k * rpy;
  const [mx, my] = placedToFrame({ ...m, x: 0, y: 0 }, ox, oy);
  return { ...m, x: z * (m.x + mx), y: z * (m.y + my), scale: m.scale * k * z, rotation: m.rotation + turn };
}

// ---------------------------------------------------------------------------
// Where a track is in the frame.

/** Sequence size, as the frame is drawn. */
interface Frame {
  W: number;
  H: number;
}

/** A clip's Motion at a frame, steadied if it is. */
export function finalPlacement(p: Project, f: Frame, c: Clip, local: number): Placement {
  const m = placement(c, local);
  const st = c.stabilize;
  const path = st ? c.paths?.find((x) => x.id === st.path) : undefined;
  const media = mediaSize(p, c);
  if (!st || !path || !media) return m;
  const [pw, ph] = placedSize(media.width, media.height, c.motion.fill, f.W, f.H);
  return steadied(m, steadyFor(path, st, c.length, pw, ph, f.W, f.H), Math.max(0, Math.min(c.length - 1, local)));
}

/** Where a clip's track is in the frame at a frame of the clip: sequence pixels from the middle, size and turn included. */
export function trackInFrame(p: Project, f: Frame, c: Clip, pathId: string, local: number): { x: number; y: number; scale: number; angle: number } | null {
  const path = c.paths?.find((x) => x.id === pathId);
  const pose = poseAt(path, local);
  const media = mediaSize(p, c);
  if (!pose || !media) return null;
  const [pw, ph] = placedSize(media.width, media.height, c.motion.fill, f.W, f.H);
  const m = finalPlacement(p, f, c, local);
  const [x, y] = placedToFrame(m, ...pictureToPlaced(pose.u, pose.v, pw, ph));
  return { x, y, scale: pose.scale * (m.scale / 100), angle: pose.angle + m.rotation };
}

/**
 * How something attached to a track moves between the frame it was attached
 * at and now: it keeps its place relative to the tracked spot, and (for a
 * region) grows and turns with it.
 */
export function carried(
  now: { x: number; y: number; scale: number; angle: number },
  then: { x: number; y: number; scale: number; angle: number },
  x: number,
  y: number,
  withScale: boolean,
  withTurn: boolean,
): { x: number; y: number; k: number; turn: number } {
  const k = withScale ? now.scale / Math.max(1e-6, then.scale) : 1;
  const turn = withTurn ? now.angle - then.angle : 0;
  const [rx, ry] = rot(turn, x - then.x, y - then.y);
  return { x: now.x + k * rx, y: now.y + k * ry, k, turn };
}

/** A shape mask's numbers moved with its track (the mask's place, size and turn at the frame it was attached are kept relative to it). */
function maskFollowing(p: Project, f: Frame, c: Clip, e: Layer['effects'][number], local: number): Layer['effects'][number] {
  const pathId = typeof e.d.track === 'string' ? e.d.track : '';
  if (!pathId) return e;
  const path = c.paths?.find((x) => x.id === pathId);
  const at = typeof e.d.trackAt === 'number' ? e.d.trackAt : 0;
  const now = trackInFrame(p, f, c, pathId, local);
  const then = trackInFrame(p, f, c, pathId, at);
  if (!now || !then) return e;
  const region = path?.kind === 'region';
  const cx = ((e.p.cx ?? 0) / 100) * (f.W / 2);
  const cy = ((e.p.cy ?? 0) / 100) * (f.H / 2);
  const moved = carried(now, then, cx, cy, region, region);
  return {
    ...e,
    p: {
      ...e.p,
      cx: (moved.x / (f.W / 2)) * 100,
      cy: (moved.y / (f.H / 2)) * 100,
      w: (e.p.w ?? 40) * moved.k,
      h: (e.p.h ?? 50) * moved.k,
      angle: (e.p.angle ?? 0) + moved.turn,
    },
  };
}

/** Does a clip use tracking at all (so drawing can skip the work)? */
export const usesTracking = (c: Clip): boolean =>
  !!c.stabilize || !!c.follow || c.effects.some((e: Effect) => e.type === 'mask' && typeof e.d?.track === 'string');

/** A layer with its tracking applied: steadied, following another clip, masks following their tracks. */
export function withTracking(p: Project, s: Sequence, layer: Layer): Layer {
  const c = layer.clip;
  if (!usesTracking(c)) return layer;
  const f = { W: s.width, H: s.height };
  const local = Math.max(0, Math.min(c.length - 1, layer.local));
  let motion = layer.motion;
  // Steadied: its own track taken away.
  const st = c.stabilize;
  const stPath = st ? c.paths?.find((x) => x.id === st.path) : undefined;
  const media = layer.source?.kind === 'video' || layer.source?.kind === 'image' ? layer.source.media : null;
  if (st && stPath && media) {
    const [pw, ph] = placedSize(media.width, media.height, c.motion.fill, f.W, f.H);
    motion = steadied(motion, steadyFor(stPath, st, c.length, pw, ph, f.W, f.H), local);
  }
  // Attached to another clip's track.
  const fl = c.follow;
  const target = fl ? s.clips.find((x) => x.id === fl.clip) : undefined;
  if (fl && target && target.id !== c.id) {
    const frame = c.start + layer.local;
    const tLocal = Math.max(0, Math.min(target.length - 1, frame - target.start));
    const now = trackInFrame(p, f, target, fl.path, tLocal);
    const then = trackInFrame(p, f, target, fl.path, Math.max(0, Math.min(target.length - 1, fl.at - target.start)));
    if (now && then) {
      const moved = carried(now, then, motion.x, motion.y, fl.scale, fl.rotate);
      motion = { ...motion, x: moved.x, y: moved.y, scale: motion.scale * moved.k, rotation: motion.rotation + moved.turn };
    }
  }
  const effects = layer.effects.map((e) => (e.type === 'mask' && typeof e.d.track === 'string' ? maskFollowing(p, f, c, e, local) : e));
  return { ...layer, motion, effects };
}
