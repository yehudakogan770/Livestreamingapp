// Render cache keys: the timeline is cut into short segments, and each
// segment's key is a hash of everything that makes its pictures: the sequence's
// size, rate and background, the order of the video tracks, the cache's format,
// and every clip that can show in it (its source, timing, motion, effects,
// keyframes, color nodes, transitions, time remapping, tracking) with the media
// it reads, any sequence nested in it, and any clip it follows. Names, labels
// and sound settings are left out, so they never throw cached pictures away.
// An edit changes only the keys of the segments the changed clip reaches.
import { end, rate, seqLength } from '../model/seq';
import type { Clip, MediaItem, Project, Sequence } from '../model/types';
import { isAudioEffect, transitionWindow } from '../render/frame';
import { hash64, hashOf, stable } from './hash';

/** Bumped when the way pictures are drawn changes (every old cache file is then unused). */
export const KEY_VERSION = 1;

/** How cache files are made: their height and quality. */
export interface CacheFormat {
  height: number;
  high: boolean;
}

/** One stretch of the timeline. */
export interface SegmentKey {
  /** Frames, `to` not included. */
  from: number;
  to: number;
  key: string;
  /** The clips that can show in it (bottom track first). */
  clips: Clip[];
}

/** Frames per segment: about two seconds (short enough that an edit throws little away). */
export const segmentFrames = (fps: number): number => Math.max(12, Math.round(fps * 2));

// Hashes kept for unchanged objects (edits replace only what they change).
const ownHashes = new WeakMap<Clip, string>();
const mediaHashes = new WeakMap<MediaItem, string>();
const seqHashes = new WeakMap<Sequence, { p: Project; h: string }>();
const mediaMaps = new WeakMap<MediaItem[], Map<string, MediaItem>>();

/** The project's media by id (kept while the media list is unchanged). */
export function mediaById(p: Project): Map<string, MediaItem> {
  let m = mediaMaps.get(p.media);
  if (!m) {
    m = new Map(p.media.map((x) => [x.id, x]));
    mediaMaps.set(p.media, m);
  }
  return m;
}

/** The part of a clip that changes its picture. */
function ownHash(c: Clip): string {
  let h = ownHashes.get(c);
  if (h === undefined) {
    const { name, label, link, gain, pan, effects, ...rest } = c;
    h = hash64(stable({ ...rest, effects: effects.filter((e) => !isAudioEffect(e.type)) }));
    ownHashes.set(c, h);
  }
  return h;
}

function mediaHash(m: MediaItem | undefined): string {
  if (!m) return 'none';
  let h = mediaHashes.get(m);
  if (h === undefined) {
    h = hashOf({
      path: m.path,
      // The edit-friendly copy is read only when the original is missing.
      proxy: m.missing ? m.proxy : null,
      missing: !!m.missing,
      kind: m.kind,
      video: m.hasVideo,
      duration: m.duration,
      w: m.width,
      h: m.height,
      fps: m.fps,
    });
    mediaHashes.set(m, h);
  }
  return h;
}

/** What a clip's picture depends on outside itself. */
function depsHash(p: Project, s: Sequence, c: Clip, depth: number): string {
  const src = c.source;
  const parts: string[] = [];
  if (src.kind === 'media') parts.push(mediaHash(mediaById(p).get(src.media)));
  else if (src.kind === 'multicam') {
    const g = p.groups.find((x) => x.id === src.group);
    const a = g?.angles.find((x) => x.id === src.angle);
    parts.push(String(a?.offset ?? 'none'), mediaHash(a ? mediaById(p).get(a.media) : undefined));
  } else if (src.kind === 'sequence') {
    const inner = p.sequences.find((x) => x.id === src.seq);
    parts.push(inner && depth < 4 ? sequenceHash(p, inner, depth + 1) : 'none');
  }
  const fl = c.follow;
  if (fl) {
    const t = s.clips.find((x) => x.id === fl.clip);
    parts.push(t ? hashOf({ start: t.start, length: t.length, paths: t.paths ?? null, motion: t.motion }) : 'none');
  }
  return parts.join('/');
}

/** A clip's whole key part. */
export function clipHash(p: Project, s: Sequence, c: Clip, depth = 0): string {
  const deps = depsHash(p, s, c, depth);
  return deps ? hash64(`${ownHash(c)}|${deps}`) : ownHash(c);
}

/** A whole sequence's picture (for one nested in another). */
function sequenceHash(p: Project, s: Sequence, depth: number): string {
  const had = seqHashes.get(s);
  if (had && had.p === p) return had.h;
  const vt = s.tracks.filter((t) => t.kind === 'video' && !t.off).map((t) => t.id);
  const clips = s.clips.filter((c) => vt.includes(c.track)).map((c) => clipHash(p, s, c, depth));
  const h = hash64(stable({ w: s.width, h: s.height, fps: s.fps, bg: s.background, tracks: vt }) + clips.join(','));
  seqHashes.set(s, { p, h });
  return h;
}

/** The frames each clip can show in: its own, and the transitions into and out of it. */
export function reach(s: Sequence): Map<Clip, [number, number]> {
  const out = new Map<Clip, [number, number]>();
  const byTrack = new Map<string, Clip[]>();
  for (const c of s.clips) {
    const list = byTrack.get(c.track);
    if (list) list.push(c);
    else byTrack.set(c.track, [c]);
  }
  for (const clips of byTrack.values()) {
    const ends = new Map<number, Clip[]>();
    for (const c of clips) {
      out.set(c, [c.start, end(c)]);
      const e = end(c);
      const list = ends.get(e);
      if (list) list.push(c);
      else ends.set(e, [c]);
    }
    for (const c of clips) {
      const w = transitionWindow(c);
      if (!w) continue;
      const r = out.get(c) as [number, number];
      r[0] = Math.min(r[0], w.from);
      r[1] = Math.max(r[1], w.to);
      // The clip before it shows in the transition too.
      for (const prev of ends.get(c.start) ?? []) {
        if (prev === c) continue;
        const pr = out.get(prev) as [number, number];
        pr[0] = Math.min(pr[0], w.from);
        pr[1] = Math.max(pr[1], w.to);
      }
    }
  }
  return out;
}

/** Every segment of a sequence that has something in it, with its key. */
export function segmentKeys(p: Project, s: Sequence, format: CacheFormat, segment = segmentFrames(rate(s))): SegmentKey[] {
  const vtracks = s.tracks.filter((t) => t.kind === 'video');
  const order = new Map(vtracks.map((t, i) => [t.id, i]));
  // Hidden tracks show nothing: their clips are left out (showing one again changes only its segments).
  const shown = new Set(vtracks.filter((t) => !t.off).map((t) => t.id));
  const global = hash64(
    stable({
      v: KEY_VERSION,
      w: s.width,
      h: s.height,
      fps: s.fps,
      bg: s.background,
      tracks: vtracks.map((t) => [t.id, t.captions ?? null]),
      format,
    }),
  );
  const len = seqLength(s);
  const ranges = reach(s);
  const buckets = new Map<number, { c: Clip; h: string }[]>();
  for (const c of s.clips) {
    if (!shown.has(c.track)) continue;
    const r = ranges.get(c);
    if (!r) continue;
    const lo = Math.max(0, r[0]);
    const hi = Math.min(len, r[1]);
    if (hi <= lo) continue;
    const h = clipHash(p, s, c);
    for (let i = Math.floor(lo / segment); i <= Math.floor((hi - 1) / segment); i++) {
      const b = buckets.get(i);
      if (b) b.push({ c, h });
      else buckets.set(i, [{ c, h }]);
    }
  }
  const out: SegmentKey[] = [];
  for (const i of [...buckets.keys()].sort((a, b) => a - b)) {
    const entries = buckets.get(i) as { c: Clip; h: string }[];
    entries.sort((a, b) => (order.get(a.c.track) ?? 0) - (order.get(b.c.track) ?? 0) || a.c.start - b.c.start || (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));
    const from = i * segment;
    const to = Math.min(len, from + segment);
    const key = hash64(`${global}|${from}-${to}|${entries.map((e) => e.h).join(',')}`);
    out.push({ from, to, key, clips: entries.map((e) => e.c) });
  }
  return out;
}
