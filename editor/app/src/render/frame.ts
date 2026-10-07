// What is in the picture at one frame: a list of layers (bottom first),
// transitions between them, and adjustment layers. The same list is drawn
// while editing and when the film is made.
import { valueAt } from '../model/anim';
import { captionText } from '../model/captions';
import { effectDef } from '../model/effects';
import { end, onTrack, rate, seqLength } from '../model/seq';
import { gradeAt, gradeOf, type GradeNow } from '../model/grade';
import { rateAt, remapSourceAt, sampleFrames } from '../model/remap';
import type { BlendMode, Clip, MediaItem, Project, Sequence, ShapeData, TextData } from '../model/types';
import { withTracking } from '../track/paths';

export type LayerSource =
  /** `next`: a second frame mixed in (time remapping between the file's frames: blended or by optical flow). */
  | { kind: 'video'; media: MediaItem; time: number; next?: { time: number; mix: number; mode: 'blend' | 'flow' } }
  | { kind: 'shape'; shape: ShapeData; local: number; length: number }
  | { kind: 'image'; media: MediaItem }
  | { kind: 'text'; text: TextData; local: number; length: number }
  | { kind: 'color'; color: string }
  /** A sequence inside this one: its own layers, drawn first. */
  | { kind: 'nested'; ops: Op[]; background: string }
  | { kind: 'generator'; gen: string; settings: Record<string, number | string>; local: number; length: number; fps: number };

export interface MotionNow {
  x: number;
  y: number;
  scale: number;
  scaleX: number;
  rotation: number;
  rotX: number;
  rotY: number;
  z: number;
  cropL: number;
  cropR: number;
  cropT: number;
  cropB: number;
  opacity: number;
  blend: BlendMode;
  fill: boolean;
}

export interface EffectNow {
  id: string;
  type: string;
  p: Record<string, number>;
  d: Record<string, unknown>;
  /** A node grade's numbers at this frame. */
  grade?: GradeNow;
}

export interface Layer {
  clip: Clip;
  /** Unique while drawing (a clip inside a nest is keyed by the nest too). */
  key: string;
  /** The frame rate of the sequence it is in. */
  fps: number;
  /** Nothing to show (e.g. that camera wasn't recording then). */
  source: LayerSource | null;
  /** Frames into the clip. */
  local: number;
  motion: MotionNow;
  effects: EffectNow[];
  /** Motion blur: the movement across the shutter (each look drawn and averaged), relative to `base`. */
  motionBlur?: { base: MotionNow; samples: MotionNow[] };
}

export type Op =
  | { kind: 'layer'; layer: Layer }
  | { kind: 'transition'; type: string; progress: number; from: Layer | null; to: Layer | null }
  | { kind: 'adjust'; layer: Layer };

/** Seconds into the clip's source at a frame of the clip (frames past either end reach into the source's spare footage). */
export function sourceAt(c: Clip, into: number, fps: number): number {
  if (c.remap) return remapSourceAt(c, c.remap, into, fps);
  const f = c.reverse ? c.length - 1 - into : into;
  return ('in' in c.source ? c.source.in : 0) + (f * c.speed) / fps;
}

/** The looks across the shutter for motion blur (none when the clip doesn't move then). */
export function blurSamples(c: Clip, local: number, base: MotionNow): MotionNow[] | undefined {
  const mb = c.motionBlur;
  if (!mb?.on || mb.shutter <= 0) return undefined;
  const n = Math.max(2, Math.min(32, Math.round(mb.samples)));
  const open = Math.min(720, mb.shutter) / 360;
  const out: MotionNow[] = [];
  let moves = false;
  for (let i = 0; i < n; i++) {
    const m = motionAt(c, local + open * (i / (n - 1) - 0.5), true);
    if (!moves && NUMERIC.some((k) => Math.abs((m[k] as number) - (base[k] as number)) > 1e-3)) moves = true;
    out.push(m);
  }
  return moves ? out : undefined;
}

const NUMERIC = ['x', 'y', 'scale', 'scaleX', 'rotation', 'rotX', 'rotY', 'z', 'cropL', 'cropR', 'cropT', 'cropB', 'opacity'] as const;

/** A look across the shutter moved by what tracking (or anything after) changed in the frame's motion. */
export function shifted(m: MotionNow, base: MotionNow, now: MotionNow): MotionNow {
  const out = { ...now };
  for (const k of NUMERIC) out[k] = now[k] + (m[k] - base[k]);
  return out;
}

export function motionAt(c: Clip, local: number, between = false): MotionNow {
  const m = c.motion;
  const t = Math.max(0, Math.min(c.length - 1, between ? local : Math.round(local)));
  return {
    x: valueAt(m.x, t),
    y: valueAt(m.y, t),
    scale: valueAt(m.scale, t, 100),
    scaleX: valueAt(m.scaleX, t, 100),
    rotation: valueAt(m.rotation, t),
    rotX: valueAt(m.rotX, t),
    rotY: valueAt(m.rotY, t),
    z: valueAt(m.z, t),
    cropL: valueAt(m.cropL, t),
    cropR: valueAt(m.cropR, t),
    cropT: valueAt(m.cropT, t),
    cropB: valueAt(m.cropB, t),
    opacity: valueAt(m.opacity, t, 100),
    blend: m.blend,
    fill: m.fill,
  };
}

export function effectsAt(c: Clip, local: number, kind: 'video' | 'audio', isAudio: (type: string) => boolean): EffectNow[] {
  const t = Math.max(0, Math.min(c.length - 1, local));
  return c.effects
    .filter((e) => e.on && isAudio(e.type) === (kind === 'audio'))
    .map((e) => ({
      id: e.id,
      type: e.type,
      p: Object.fromEntries(Object.entries(e.p).map(([k, v]) => [k, valueAt(v, t)])),
      d: e.d ?? {},
      ...(e.type === 'grade' ? { grade: gradeAt(gradeOf(e), t) } : {}),
    }));
}

const BASIC_ZERO = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'vibrance'];

/**
 * A picture effect that changes nothing as it is set at this frame (a
 * correction left at its defaults, an amount of 0): it isn't drawn, saving a
 * full-frame pass per layer. Missing numbers count as the compositor reads them.
 */
export function idleEffect(e: Pick<EffectNow, 'type' | 'p'>): boolean {
  const n = (k: string, d: number) => (Number.isFinite(e.p[k]) ? (e.p[k] as number) : d);
  switch (e.type) {
    case 'basic':
      return BASIC_ZERO.every((k) => n(k, 0) === 0) && n('saturation', 100) === 100;
    case 'hsl':
      return n('shift', 0) === 0 && n('sat', 0) === 0 && n('light', 0) === 0;
    case 'vignette':
      return n('amount', 0) === 0;
    case 'bw':
    case 'invert':
      return n('mix', 100) === 0;
    case 'sharpen':
      return n('amount', 60) === 0;
    case 'grain':
      return n('amount', 20) === 0;
    case 'chromatic':
      return n('amount', 30) === 0;
    case 'blur':
      return n('radius', 0) <= 0.2;
    default:
      return false;
  }
}

/** A sound effect (the rest change the picture). */
export const isAudioEffect = (type: string): boolean => effectDef(type)?.kind === 'audio';

// Worked out once per sequence and media list (edits replace them, so these stay right): every frame
// otherwise filtered and sorted all of a sequence's clips for each track, and searched the media list for each layer.
const trackLists = new WeakMap<Sequence, Map<string, Clip[]>>();
const mediaLists = new WeakMap<MediaItem[], Map<string, MediaItem>>();

/** A track's enabled clips, in time order. */
function enabledOn(s: Sequence, track: string): Clip[] {
  let by = trackLists.get(s);
  if (!by) {
    by = new Map(s.tracks.map((t) => [t.id, onTrack(s, t.id).filter((c) => c.enabled)]));
    trackLists.set(s, by);
  }
  return by.get(track) ?? [];
}

/** A media item by its id. */
function mediaOf(p: Project, id: string): MediaItem | undefined {
  let by = mediaLists.get(p.media);
  if (!by) {
    by = new Map(p.media.map((m) => [m.id, m]));
    mediaLists.set(p.media, by);
  }
  return by.get(id);
}

/** Nests inside nests stop here (and a sequence never shows itself). */
const MAX_DEPTH = 4;

/** What a clip shows at a frame (frames before or after it reach into spare footage, for transitions). */
export function layerFor(p: Project, c: Clip, frame: number, fps: number, prefix = '', depth = 0, inside: string[] = []): Layer {
  const local = frame - c.start;
  const motion = motionAt(c, local);
  const effects = effectsAt(c, local, 'video', isAudioEffect).filter((e) => !idleEffect(e));
  const src = c.source;
  let source: LayerSource | null = null;
  if (src.kind === 'media') {
    const m = mediaOf(p, src.media);
    if (m && m.kind === 'image') source = { kind: 'image', media: m };
    else if (m && m.hasVideo) source = remapped(c, m, clampTime(sourceAt(c, local, fps), m));
  } else if (src.kind === 'multicam') {
    const g = p.groups.find((x) => x.id === src.group);
    const a = g?.angles.find((x) => x.id === src.angle);
    const m = a ? mediaOf(p, a.media) : undefined;
    if (a && m) {
      const t = sourceAt(c, local, fps) - a.offset;
      // A camera that wasn't recording then shows nothing.
      if (t >= -0.5 / fps && t < m.duration) source = remapped(c, m, clampTime(t, m));
    }
  } else if (src.kind === 'text') source = { kind: 'text', text: src.text, local, length: c.length };
  else if (src.kind === 'shape') source = { kind: 'shape', shape: src.shape, local, length: c.length };
  else if (src.kind === 'color') source = { kind: 'color', color: src.color };
  else if (src.kind === 'generator') source = { kind: 'generator', gen: src.gen, settings: src.settings, local, length: c.length, fps };
  else if (src.kind === 'sequence') {
    const inner = p.sequences.find((x) => x.id === src.seq);
    if (inner && depth < MAX_DEPTH && !inside.includes(inner.id)) {
      const innerFrame = Math.round(sourceAt(c, local, fps) * rate(inner));
      if (innerFrame >= 0 && innerFrame < Math.max(1, seqLength(inner)))
        source = { kind: 'nested', ops: frameOps(p, inner, innerFrame, `${prefix}${c.id}/`, depth + 1, [...inside, inner.id]), background: inner.background };
    }
  }
  const samples = blurSamples(c, local, motion);
  return { clip: c, key: `${prefix}${c.id}`, fps, source, local, motion, effects, ...(samples ? { motionBlur: { base: motion, samples } } : {}) };
}

/** A remapped clip's picture on the file's frame grid: the nearest frame, or the two either side to blend or interpolate. */
function remapped(c: Clip, m: MediaItem, time: number): LayerSource {
  if (!c.remap) return { kind: 'video', media: m, time };
  const s = sampleFrames(time, m.fps || 30, c.remap.sampling);
  const last = Math.max(0, m.duration - 0.001);
  if (s.next === null || s.next > last) return { kind: 'video', media: m, time: Math.min(last, s.time) };
  return { kind: 'video', media: m, time: s.time, next: { time: s.next, mix: s.mix, mode: c.remap.sampling === 'flow' ? 'flow' : 'blend' } };
}

const clampTime = (t: number, m: MediaItem): number => Math.max(0, Math.min(Math.max(0, m.duration - 0.001), t));

/** The two halves of a transition centered on a clip's start: when it begins, and how long. */
export function transitionWindow(c: Clip): { from: number; to: number } | null {
  if (!c.tIn) return null;
  const half = Math.floor(c.tIn.length / 2);
  return { from: c.start - half, to: c.start - half + c.tIn.length };
}

/** Everything to draw at a frame, bottom first. */
export function frameOps(p: Project, s: Sequence, frame: number, prefix = '', depth = 0, inside: string[] = [s.id]): Op[] {
  const fps = rate(s);
  // Tracking (steadying, following, masks on a track) is applied the same way for the viewer and the film.
  const lay = (c: Clip) => withTracking(p, s, layerFor(p, c, frame, fps, prefix, depth, inside));
  const ops: Op[] = [];
  for (const t of s.tracks) {
    if (t.kind !== 'video' || t.off) continue;
    const clips = enabledOn(s, t.id);
    // A captions track: the block showing now, drawn in the track's look (no transitions).
    if (t.captions) {
      const c = clips.find((x) => frame >= x.start && frame < end(x));
      if (c?.source.kind === 'caption' && c.source.text.trim())
        ops.push({
          kind: 'layer',
          layer: { ...lay(c), source: { kind: 'text', text: captionText(c.source.text, t.captions), local: frame - c.start, length: c.length } },
        });
      continue;
    }
    // A transition into a clip (from the one touching it, or from nothing).
    const into = clips.find((c) => {
      const w = transitionWindow(c);
      return w && frame >= w.from && frame < w.to;
    });
    if (into?.tIn) {
      const w = transitionWindow(into) as { from: number; to: number };
      const prev = clips.find((o) => end(o) === into.start && o.id !== into.id);
      const progress = (frame - w.from + 0.5) / into.tIn.length;
      if (into.source.kind === 'adjustment') continue;
      ops.push({ kind: 'transition', type: into.tIn.type, progress, from: prev ? lay(prev) : null, to: lay(into) });
      continue;
    }
    const c = clips.find((x) => frame >= x.start && frame < end(x));
    if (!c) continue;
    const layer = lay(c);
    if (c.source.kind === 'adjustment') {
      ops.push({ kind: 'adjust', layer });
      continue;
    }
    // A transition out of the last clip (to nothing).
    const followed = clips.some((o) => o.start === end(c) && o.id !== c.id);
    if (c.tOut && !followed && frame >= end(c) - c.tOut.length) {
      ops.push({ kind: 'transition', type: c.tOut.type, progress: (frame - (end(c) - c.tOut.length) + 0.5) / c.tOut.length, from: layer, to: null });
      continue;
    }
    ops.push({ kind: 'layer', layer });
  }
  return ops;
}

/** The media files that are shown at a frame, with where in each (for getting them ready ahead of time). */
export function videoNeeds(ops: Op[]): { media: MediaItem; time: number; key: string; rate: number }[] {
  const out: { media: MediaItem; time: number; key: string; rate: number }[] = [];
  // One video per clip, so a clip keeps the same one through its transitions.
  const add = (l: Layer | null) => {
    if (l?.source?.kind === 'video') out.push({ media: l.source.media, time: l.source.time, key: l.key, rate: rateAt(l.clip, l.local) });
    if (l?.source?.kind === 'nested') out.push(...videoNeeds(l.source.ops));
  };
  for (const op of ops) {
    if (op.kind === 'transition') {
      add(op.from);
      add(op.to);
    } else add(op.layer);
  }
  return out;
}

/** Every layer of a frame, nests opened up (for getting pictures ready). */
export function allLayers(ops: Op[]): Layer[] {
  const out: Layer[] = [];
  const add = (l: Layer | null) => {
    if (!l) return;
    out.push(l);
    if (l.source?.kind === 'nested') out.push(...allLayers(l.source.ops));
  };
  for (const op of ops) {
    if (op.kind === 'transition') {
      add(op.from);
      add(op.to);
    } else add(op.layer);
  }
  return out;
}
