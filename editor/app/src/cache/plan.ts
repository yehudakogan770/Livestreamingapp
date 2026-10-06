// Which segments the render cache makes. Smart: the ones too heavy to play
// live, from an estimate of each frame's work (layers, source sizes, effects,
// color nodes, AI masks, optical flow, motion blur, nested sequences). User:
// the marked ranges, whatever they hold. Off: none.
import { rate } from '../model/seq';
import { allNodes, gradeOf } from '../model/grade';
import type { Clip, MediaItem, Project, Sequence } from '../model/types';
import { isAudioEffect } from '../render/frame';
import { mediaById, segmentKeys, segmentFrames, type CacheFormat } from './key';

export type CacheMode = 'off' | 'smart' | 'user';

export interface PlanOptions {
  mode: CacheMode;
  format: CacheFormat;
  /** Frames per segment (about two seconds by default). */
  segment?: number;
  /** User mode: the ranges to cache (frames, end not included). */
  ranges?: [number, number][];
  /** Heavy files play from their lighter proxies. */
  proxies?: boolean;
  /** Smart mode: a frame estimated at this share of the frame's time (or more) is cached. */
  threshold?: number;
}

export interface Segment {
  from: number;
  to: number;
  key: string;
  /** The estimated share of a frame's time the heaviest frame takes (1: just keeps up). */
  cost: number;
  /** The cache should make it. */
  needs: boolean;
}

/** Effects that cost much more than a plain color change (blurs and other many-sample filters). */
const HEAVY_EFFECTS: Record<string, number> = {
  blur: 0.2,
  glow: 0.2,
  sharpen: 0.1,
  zoomblur: 0.25,
  dirblur: 0.25,
  displace: 0.15,
  chromakey: 0.12,
  lumakey: 0.06,
  lut: 0.1,
  shadow: 0.12,
  grain: 0.08,
  edges: 0.1,
  // AI masks: a model runs on the picture.
  personmask: 1.2,
  objectmask: 1.2,
};

/** Costs kept for unchanged clips (valid while their media item and the proxy setting are the same). */
const costs = new WeakMap<Clip, { m: MediaItem | undefined; proxies: boolean; v: number }>();

/** A clip's estimated share of a frame's time while it shows (one layer). */
export function clipCost(p: Project, c: Clip, proxies = true, depth = 0): number {
  const src = c.source;
  const id =
    src.kind === 'media'
      ? src.media
      : src.kind === 'multicam'
        ? p.groups.find((g) => g.id === src.group)?.angles.find((a) => a.id === src.angle)?.media
        : undefined;
  const m = id === undefined ? undefined : mediaById(p).get(id);
  // Nested sequences are worked out again each time (what they hold may have changed).
  const memo = src.kind !== 'sequence';
  const had = costs.get(c);
  if (memo && had && had.m === m && had.proxies === proxies) return had.v;
  let v = 0;
  if (src.kind === 'media' || src.kind === 'multicam') {
    if (m?.kind === 'image') v += 0.04;
    else if (m) {
      // Decoding: by the picture's size (a 1080p frame ~0.15), lighter from a proxy.
      const usesProxy = proxies && !!m.playbackProxy;
      const px = usesProxy ? Math.min(m.width * m.height, 1920 * 1080) : m.width * m.height;
      v += 0.15 * Math.max(0.25, px / (1920 * 1080)) * (m.fps > 40 ? 1.6 : 1);
    }
  } else if (src.kind === 'sequence') {
    const inner = p.sequences.find((x) => x.id === src.seq);
    // A nest draws a whole sequence first.
    v += 0.3 + (inner && depth < 4 ? sequencePeak(p, inner, proxies, depth + 1) : 0);
  } else if (src.kind === 'generator') v += 0.15;
  else if (src.kind === 'adjustment') v += 0.05;
  else v += 0.05;
  for (const e of c.effects) {
    if (!e.on || isAudioEffect(e.type)) continue;
    if (e.type === 'grade') v += 0.07 * Math.max(1, allNodes(gradeOf(e)).length);
    else v += HEAVY_EFFECTS[e.type] ?? 0.04;
  }
  if (c.remap?.sampling === 'flow') v += 1.2;
  else if (c.remap?.sampling === 'blend') v += 0.15;
  if (c.motionBlur?.on) v += 0.06 * Math.max(2, Math.min(32, c.motionBlur.samples));
  if (c.stabilize || c.follow) v += 0.03;
  if (c.tIn) v += 0.08;
  if (memo) costs.set(c, { m, proxies, v });
  return v;
}

/** The heaviest moment of a sequence, roughly (each track's heaviest clip, added up). */
function sequencePeak(p: Project, s: Sequence, proxies: boolean, depth: number): number {
  const perTrack = new Map<string, number>();
  for (const c of s.clips) {
    const t = s.tracks.find((x) => x.id === c.track);
    if (!t || t.kind !== 'video' || t.off || !c.enabled) continue;
    perTrack.set(c.track, Math.max(perTrack.get(c.track) ?? 0, clipCost(p, c, proxies, depth)));
  }
  let sum = 0;
  for (const v of perTrack.values()) sum += v;
  return sum;
}

/** A segment's heaviest frame, roughly: each track's heaviest clip in it, added up (layers drawn over each other). */
export function segmentCost(p: Project, clips: Clip[], proxies = true): number {
  const perTrack = new Map<string, number>();
  for (const c of clips) {
    if (!c.enabled) continue;
    perTrack.set(c.track, Math.max(perTrack.get(c.track) ?? 0, clipCost(p, c, proxies)));
  }
  let sum = 0;
  for (const v of perTrack.values()) sum += v;
  // Each layer drawn over the others costs a little more.
  return sum + Math.max(0, perTrack.size - 1) * 0.04;
}

const overlaps = (a: number, b: number, r: [number, number]): boolean => a < r[1] && b > r[0];

/** Every segment with something in it, and whether the cache should make it. */
export function planSegments(p: Project, s: Sequence, o: PlanOptions): Segment[] {
  const seg = o.segment ?? segmentFrames(rate(s));
  const threshold = o.threshold ?? 1;
  return segmentKeys(p, s, o.format, seg).map((k) => {
    const cost = segmentCost(p, k.clips, o.proxies ?? true);
    const needs = o.mode === 'smart' ? cost >= threshold : o.mode === 'user' ? (o.ranges ?? []).some((r) => overlaps(k.from, k.to, r)) : false;
    return { from: k.from, to: k.to, key: k.key, cost, needs };
  });
}

/** The segment holding a frame (segments are in order). */
export function segmentAt<T extends { from: number; to: number }>(segs: T[], frame: number): T | undefined {
  let lo = 0;
  let hi = segs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segs[mid] as T;
    if (frame < s.from) hi = mid - 1;
    else if (frame >= s.to) lo = mid + 1;
    else return s;
  }
  return undefined;
}

/** The order to make segments in: nearest the playhead first, ahead of it before behind. */
export function renderOrder<T extends { from: number; to: number }>(segs: T[], playhead: number): T[] {
  const dist = (s: T) => (playhead >= s.from && playhead < s.to ? 0 : s.from >= playhead ? s.from - playhead : (playhead - s.to + 1) * 2);
  return [...segs].sort((a, b) => dist(a) - dist(b) || a.from - b.from);
}

/** Ranges of the timeline for the line over the ruler: cached, or wanted but not made yet. */
export function coverage(segs: Segment[], cached: (key: string) => boolean): { from: number; to: number; state: 'cached' | 'uncached' }[] {
  const out: { from: number; to: number; state: 'cached' | 'uncached' }[] = [];
  for (const s of segs) {
    const state = cached(s.key) ? 'cached' : s.needs ? 'uncached' : null;
    if (!state) continue;
    const last = out[out.length - 1];
    if (last && last.state === state && last.to === s.from) last.to = s.to;
    else out.push({ from: s.from, to: s.to, state });
  }
  return out;
}
