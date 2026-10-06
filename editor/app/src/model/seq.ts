import { scaleKeys, shiftKeys } from './anim';
import { gradeOf, mapGradeParams } from './grade';
import { retimeTracks } from '../track/paths';
import { remapPosition, remapSourceAt } from './remap';
import { exactRate, type Clip, type MediaItem, type Motion, type Param, type Project, type Sequence, type ShapeData, type TextData, type Track } from './types';

export const end = (c: Clip): number => c.start + c.length;

export function current(p: Project): Sequence {
  return p.sequences.find((s) => s.id === p.open) ?? (p.sequences[0] as Sequence);
}

export function withSeq(p: Project, s: Sequence): Project {
  return { ...p, sequences: p.sequences.map((x) => (x.id === s.id ? s : x)) };
}

/** Change the open sequence. */
export function editSeq(p: Project, f: (s: Sequence) => Sequence): Project {
  const s = current(p);
  const after = f(s);
  return after === s ? p : withSeq(p, after);
}

export const videoTracks = (s: Sequence): Track[] => s.tracks.filter((t) => t.kind === 'video');
export const audioTracks = (s: Sequence): Track[] => s.tracks.filter((t) => t.kind === 'audio');
export const trackOf = (s: Sequence, id: string): Track | undefined => s.tracks.find((t) => t.id === id);

export const seqLength = (s: Sequence): number => s.clips.reduce((m, c) => Math.max(m, end(c)), 0);

export const onTrack = (s: Sequence, track: string): Clip[] => s.clips.filter((c) => c.track === track).sort((a, b) => a.start - b.start);

export const clipAt = (s: Sequence, track: string, frame: number): Clip | undefined =>
  s.clips.find((c) => c.track === track && frame >= c.start && frame < end(c));

export const rate = (s: Sequence): number => exactRate(s.fps);

export function mediaOf(p: Project, c: Clip): MediaItem | undefined {
  const src = c.source;
  if (src.kind === 'media') return p.media.find((m) => m.id === src.media);
  if (src.kind === 'multicam') {
    const g = p.groups.find((x) => x.id === src.group);
    const a = g?.angles.find((x) => x.id === src.angle);
    return a ? p.media.find((m) => m.id === a.media) : undefined;
  }
  return undefined;
}

/** Seconds into the clip's source at a frame of the clip. */
export function sourceTime(c: Clip, into: number, fps: number): number {
  if (c.remap) return remapSourceAt(c, c.remap, Math.max(0, into), fps);
  const f = c.reverse ? c.length - 1 - into : into;
  return ('in' in c.source ? c.source.in : 0) + (Math.max(0, f) * c.speed) / fps;
}

/** How many frames a clip could grow at each end before its source runs out. */
export function handles(p: Project, c: Clip, fps: number): { before: number; after: number } {
  const src = c.source;
  if (src.kind !== 'media' && src.kind !== 'multicam' && src.kind !== 'sequence') return { before: Infinity, after: Infinity };
  let duration = 0;
  if (src.kind === 'sequence') {
    const inner = p.sequences.find((x) => x.id === src.seq);
    duration = inner ? seqLength(inner) / rate(inner) : 0;
  } else if (src.kind === 'media') {
    const m = p.media.find((x) => x.id === src.media);
    if (!m || m.kind === 'image') return { before: Infinity, after: Infinity };
    duration = m.duration;
  } else duration = p.groups.find((g) => g.id === src.group)?.duration ?? 0;
  const span = (c.length * c.speed) / fps;
  const head = Math.floor((src.in * fps) / c.speed + 1e-6);
  const tail = Math.floor(((duration - src.in - span) * fps) / c.speed + 1e-6);
  return c.reverse ? { before: Math.max(0, tail), after: Math.max(0, head) } : { before: Math.max(0, head), after: Math.max(0, tail) };
}

function mapMotion(m: Motion, f: (p: Motion['x']) => Motion['x']): Motion {
  return {
    ...m,
    x: f(m.x),
    y: f(m.y),
    scale: f(m.scale),
    scaleX: f(m.scaleX),
    rotation: f(m.rotation),
    ...(m.rotX !== undefined ? { rotX: f(m.rotX) } : {}),
    ...(m.rotY !== undefined ? { rotY: f(m.rotY) } : {}),
    ...(m.z !== undefined ? { z: f(m.z) } : {}),
    cropL: f(m.cropL),
    cropR: f(m.cropR),
    cropT: f(m.cropT),
    cropB: f(m.cropB),
    opacity: f(m.opacity),
  };
}

/** Every keyframed number of a clip, changed the same way. */
export function mapParams(c: Clip, f: (p: Motion['x']) => Motion['x']): Clip {
  return {
    ...c,
    motion: mapMotion(c.motion, f),
    gain: f(c.gain),
    pan: f(c.pan),
    effects: c.effects.map((e) => ({
      ...e,
      p: Object.fromEntries(Object.entries(e.p).map(([k, v]) => [k, f(v)])),
      // A node grade's keyframes move too.
      ...(e.type === 'grade' ? { d: mapGradeParams(gradeOf(e), f) as unknown as Record<string, unknown> } : {}),
    })),
    ...(c.remap ? { remap: { ...c.remap, speed: f(c.remap.speed) } } : {}),
    ...(c.source.kind === 'shape' ? { source: { ...c.source, shape: mapShape(c.source.shape, f) } } : {}),
    ...(c.source.kind === 'text' && c.source.text.animators?.length ? { source: { ...c.source, text: mapAnimators(c.source.text, f) } } : {}),
  };
}

const mapShape = (s: ShapeData, f: (p: Param) => Param): ShapeData => ({ ...s, trimStart: f(s.trimStart), trimEnd: f(s.trimEnd), trimOffset: f(s.trimOffset) });

const ANIMATOR_PARAMS = ['start', 'end', 'offset', 'amount', 'opacity', 'x', 'y', 'scale', 'rotation', 'blur', 'tracking'] as const;
const mapAnimators = (t: TextData, f: (p: Param) => Param): TextData => ({
  ...t,
  animators: t.animators?.map((a) => {
    const out = { ...a };
    for (const k of ANIMATOR_PARAMS) if (a[k] !== undefined) out[k] = f(a[k] as Param);
    return out;
  }),
});

const withIn = (c: Clip, delta: number): Clip => ('in' in c.source ? { ...c, source: { ...c.source, in: Math.max(0, c.source.in + delta) } } : c);

/** Take `d` frames off the start (a negative `d` adds frames back). */
export function trimLeft(c: Clip, d: number, fps: number): Clip {
  const moved = retimeTracks(
    mapParams({ ...c, start: c.start + d, length: c.length - d }, (x) => shiftKeys(x, -d)),
    (t) => t - d,
  );
  // A remapped clip starts where its speed had carried it by then.
  if (c.remap) return withIn(moved, (remapPosition(c.remap, c.length, d) * c.speed) / fps);
  return c.reverse ? moved : withIn(moved, (d * c.speed) / fps);
}

/** Take `d` frames off the end (a negative `d` adds frames back). */
export function trimRight(c: Clip, d: number, fps: number): Clip {
  const out = { ...c, length: c.length - d };
  return c.reverse ? withIn(out, (d * c.speed) / fps) : out;
}

/** Cut a clip in two at a sequence frame. */
export function cutClip(c: Clip, at: number, fps: number, id: string): [Clip, Clip] {
  const left = trimRight({ ...c, tOut: null }, end(c) - at, fps);
  const right = trimLeft({ ...c, id, tIn: null }, at - c.start, fps);
  return [left, right];
}

export function changeSpeed(c: Clip, speed: number): Clip {
  const length = Math.max(1, Math.round((c.length * c.speed) / speed));
  return retimeTracks(
    mapParams({ ...c, speed, length }, (x) => scaleKeys(x, length / c.length)),
    (t) => Math.round(t * (length / c.length)),
  );
}
