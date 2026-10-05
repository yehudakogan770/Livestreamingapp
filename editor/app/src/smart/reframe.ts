// Auto reframe: a vertical (9:16) or square (1:1) copy of a sequence whose
// pictures follow the people in them. Faces found in frames sampled through
// each clip give a target; the target is held still while it barely moves (a
// dead zone), then smoothed both ways in time (no lag, no overshoot), kept
// inside the picture, and written as Motion position keyframes: a starting
// point the editor can tweak by hand.
import { rate, sourceTime } from '../model/seq';
import { uid, type Clip, type Key, type MediaItem, type Param, type Project, type Sequence } from '../model/types';

export type Aspect = '9:16' | '1:1' | '4:5';
export const ASPECTS: [Aspect, string][] = [
  ['9:16', 'Vertical 9:16'],
  ['1:1', 'Square 1:1'],
  ['4:5', 'Portrait 4:5'],
];

/** The size of the new sequence: as sharp as the old one's short side. */
export function aspectSize(s: Sequence, aspect: Aspect): { width: number; height: number } {
  const base = Math.min(s.width, s.height);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (aspect === '1:1') return { width: even(base), height: even(base) };
  if (aspect === '4:5') return { width: even(base), height: even((base * 5) / 4) };
  return { width: even(base), height: even((base * 16) / 9) };
}

/** Something found in a frame: a box in 0–1 of the picture. */
export interface Found {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

/** What was found at a frame of a clip. */
export interface Sample {
  /** Frames from the clip's start. */
  t: number;
  found: Found[];
}

/**
 * The person to follow in each sample: the most prominent (size × sureness),
 * but the one already followed is kept unless another is clearly more
 * prominent (1.6×) for a while, so the frame doesn't jump between people.
 * Gives the center (0–1 of the picture) to follow, or null where nobody is seen.
 */
export function followTargets(samples: Sample[], switchAfter = 3): ({ x: number; y: number } | null)[] {
  let cur: Found | null = null;
  let challenger = 0;
  const weight = (f: Found) => f.w * f.h * (0.5 + f.score);
  const near = (a: Found, b: Found) => Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2)) < Math.max(a.w, b.w) * 1.2;
  return samples.map((s) => {
    if (s.found.length === 0) return null;
    const best = s.found.reduce((a, b) => (weight(b) > weight(a) ? b : a));
    const same = cur ? s.found.filter((f) => near(f, cur as Found)).sort((a, b) => weight(b) - weight(a))[0] : undefined;
    if (!cur || !same) {
      cur = best;
      challenger = 0;
    } else if (best !== same && weight(best) > weight(same) * 1.6) {
      challenger++;
      cur = challenger >= switchAfter ? best : same;
      if (challenger >= switchAfter) challenger = 0;
    } else {
      cur = same;
      challenger = 0;
    }
    // Faces: a little above the middle of the frame looks right (room above the head is less than below).
    return { x: cur.x + cur.w / 2, y: cur.y + cur.h * 0.55 };
  });
}

export interface SmoothOptions {
  /** Moves smaller than this (0–1 of the picture) are ignored: the frame stays still. */
  deadZone: number;
  /** How slowly the frame moves (in samples): the time constant of the smoothing. */
  lag: number;
}

export const SMOOTH_DEFAULTS: SmoothOptions = { deadZone: 0.05, lag: 4 };

/** Gaps (nobody seen) filled: held from before, or from after at the start, or the middle when nobody is ever seen. */
export function fillGaps(v: (number | null)[], fallback = 0.5): number[] {
  const firstSeen = v.find((x) => x !== null) ?? fallback;
  let last = firstSeen;
  return v.map((x) => (x === null ? last : (last = x)));
}

/** Hold still until the target moves more than the dead zone away, then follow it there. */
export function deadZone(v: number[], zone: number): number[] {
  if (v.length === 0) return [];
  let held = v[0] as number;
  return v.map((x) => {
    if (Math.abs(x - held) > zone) held = x;
    return held;
  });
}

/** Smoothed forward then backward (an exponential each way): no lag, no overshoot, ends kept. */
export function smoothBothWays(v: number[], lag: number): number[] {
  if (lag <= 0 || v.length < 2) return [...v];
  const k = 1 - Math.exp(-1 / lag);
  const fwd = [...v];
  for (let i = 1; i < fwd.length; i++) fwd[i] = (fwd[i - 1] as number) + ((fwd[i] as number) - (fwd[i - 1] as number)) * k;
  const back = [...fwd];
  for (let i = back.length - 2; i >= 0; i--) back[i] = (back[i + 1] as number) + ((back[i] as number) - (back[i + 1] as number)) * k;
  return back;
}

/** The full path: gaps filled, dead zone, smoothed, kept within [lo, hi]. */
export function smoothPath(v: (number | null)[], o: SmoothOptions, lo = 0, hi = 1): number[] {
  const clamp = (x: number) => Math.min(hi, Math.max(lo, x));
  return smoothBothWays(deadZone(fillGaps(v).map(clamp), o.deadZone), o.lag).map(clamp);
}

/** The fewest points that keep a path within `tolerance` (Ramer–Douglas–Peucker). Gives the indexes kept. */
export function simplify(t: number[], v: number[], tolerance: number): number[] {
  const n = Math.min(t.length, v.length);
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    let worst = -1;
    let dist = tolerance;
    for (let i = a + 1; i < b; i++) {
      const ta = t[a] as number;
      const tb = t[b] as number;
      const f = tb === ta ? 0 : ((t[i] as number) - ta) / (tb - ta);
      const line = (v[a] as number) + ((v[b] as number) - (v[a] as number)) * f;
      const d = Math.abs((v[i] as number) - line);
      if (d > dist) {
        dist = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return Array.from(keep.keys()).filter((i) => keep[i]);
}

/**
 * Where a picture goes to show (cx, cy) of it (0–1) in the middle of a W × H
 * frame, filling it at `zoom` (1: just fills): Motion x and y, in pixels,
 * kept so the picture always covers the frame.
 */
export function positionFor(cx: number, cy: number, src: { w: number; h: number }, frame: { w: number; h: number }, zoom = 1): { x: number; y: number } {
  const fit = Math.max(frame.w / src.w, frame.h / src.h);
  const dw = src.w * fit * zoom;
  const dh = src.h * fit * zoom;
  const roomX = Math.max(0, (dw - frame.w) / 2);
  const roomY = Math.max(0, (dh - frame.h) / 2);
  const clamp = (v: number, r: number) => Math.min(r, Math.max(-r, v));
  // `+ 0` turns -0 into 0.
  return { x: Math.round(clamp((0.5 - cx) * dw, roomX)) + 0, y: Math.round(clamp((0.5 - cy) * dh, roomY)) + 0 };
}

/** The range of centers (0–1) the window can show without leaving the picture, across and down. */
export function centerRange(src: { w: number; h: number }, frame: { w: number; h: number }, zoom = 1): { x: [number, number]; y: [number, number] } {
  const fit = Math.max(frame.w / src.w, frame.h / src.h);
  const halfW = Math.min(0.5, frame.w / (src.w * fit * zoom) / 2);
  const halfH = Math.min(0.5, frame.h / (src.h * fit * zoom) / 2);
  return { x: [halfW, 1 - halfW], y: [halfH, 1 - halfH] };
}

/** A keyframed value from points (frames, values), simplified; a plain number when it never moves. */
export function keyed(t: number[], v: number[], tolerance: number): Param {
  if (v.length === 0) return 0;
  const first = v[0] as number;
  if (v.every((x) => Math.abs(x - first) <= tolerance)) return Math.round(first) + 0;
  const keep = simplify(t, v, tolerance);
  const k: Key[] = keep.map((i) => ({ t: t[i] as number, v: Math.round(v[i] as number), e: 'ease' }));
  return { k };
}

export interface ReframeOptions extends SmoothOptions {
  aspect: Aspect;
  /** 1: just fills the new frame; more: closer. */
  zoom: number;
  /** Look every this many frames. */
  every: number;
}

export const REFRAME_DEFAULTS: ReframeOptions = { ...SMOOTH_DEFAULTS, aspect: '9:16', zoom: 1, every: 10 };

/** The clips of a sequence whose pictures get followed (video, from a file or a camera). */
export function framedClips(p: Project, s: Sequence): { clip: Clip; media: MediaItem }[] {
  const out: { clip: Clip; media: MediaItem }[] = [];
  for (const c of s.clips) {
    const t = s.tracks.find((x) => x.id === c.track);
    if (t?.kind !== 'video' || t.captions || !c.enabled) continue;
    const src = c.source;
    let mediaId: string | undefined;
    if (src.kind === 'media') mediaId = src.media;
    else if (src.kind === 'multicam') mediaId = p.groups.find((g) => g.id === src.group)?.angles.find((a) => a.id === src.angle)?.media;
    const m = p.media.find((x) => x.id === mediaId);
    if (m?.kind === 'video' && m.width > 0 && m.height > 0) out.push({ clip: c, media: m });
  }
  return out;
}

/** The frames of a clip to look at (from its start), and the times in its file. */
export function sampleTimes(p: Project, c: Clip, s: Sequence, every: number): { t: number[]; seconds: number[] } {
  const fps = rate(s);
  const step = Math.max(1, Math.round(every));
  const t: number[] = [];
  for (let f = 0; f < c.length; f += step) t.push(f);
  if (c.length > 1 && t[t.length - 1] !== c.length - 1) t.push(c.length - 1);
  // A camera's file starts at its offset in the group's time.
  const src = c.source;
  const offset = src.kind === 'multicam' ? (p.groups.find((g) => g.id === src.group)?.angles.find((a) => a.id === src.angle)?.offset ?? 0) : 0;
  return { t, seconds: t.map((f) => Math.max(0, sourceTime(c, f, fps) - offset)) };
}

/** The Motion for a clip in the new frame, from what was found in it. */
export function reframeMotion(c: Clip, m: MediaItem, frame: { w: number; h: number }, samples: Sample[], o: ReframeOptions): Clip['motion'] {
  const src = { w: m.width, h: m.height };
  const range = centerRange(src, frame, o.zoom);
  const targets = followTargets(samples);
  const xs = smoothPath(
    targets.map((p) => (p ? p.x : null)),
    o,
    range.x[0],
    range.x[1],
  );
  const ys = smoothPath(
    targets.map((p) => (p ? p.y : null)),
    o,
    range.y[0],
    range.y[1],
  );
  const pos = xs.map((x, i) => positionFor(x, ys[i] as number, src, frame, o.zoom));
  const t = samples.map((s) => s.t);
  return {
    ...c.motion,
    fill: true,
    scale: Math.round(o.zoom * 100),
    x: keyed(
      t,
      pos.map((q) => q.x),
      Math.max(2, frame.w * 0.006),
    ),
    y: keyed(
      t,
      pos.map((q) => q.y),
      Math.max(2, frame.h * 0.006),
    ),
  };
}

/**
 * A copy of a sequence in another shape: the same tracks and clips (new ids),
 * picture clips filling the frame. `motions` gives the followed Motion of the
 * clips that were looked at (by the old clip id).
 */
export function reframedSequence(s: Sequence, aspect: Aspect, motions: Map<string, Clip['motion']>, name?: string): Sequence {
  const size = aspectSize(s, aspect);
  const trackIds = new Map(s.tracks.map((t) => [t.id, uid(t.kind === 'video' ? 'v' : 'a')]));
  const linkIds = new Map<string, string>();
  const clips = s.clips.map((c) => {
    const link = c.link ? (linkIds.get(c.link) ?? linkIds.set(c.link, uid('l')).get(c.link) ?? null) : null;
    const motion = motions.get(c.id);
    const track = s.tracks.find((t) => t.id === c.track);
    const picture = track?.kind === 'video' && (c.source.kind === 'media' || c.source.kind === 'multicam' || c.source.kind === 'sequence');
    return {
      ...c,
      id: uid(),
      track: trackIds.get(c.track) ?? c.track,
      link,
      motion: motion ?? (picture ? { ...c.motion, fill: true } : c.motion),
    };
  });
  return {
    ...s,
    id: uid('s'),
    name: name ?? `${s.name} (${aspect})`,
    width: size.width,
    height: size.height,
    tracks: s.tracks.map((t) => ({ ...t, id: trackIds.get(t.id) as string })),
    clips,
    markers: s.markers.map((m) => ({ ...m, id: uid('k') })),
  };
}

/** The project with the new sequence added and opened. */
export function addReframed(p: Project, seq: Sequence): Project {
  return { ...p, sequences: [...p.sequences, seq], open: seq.id };
}
