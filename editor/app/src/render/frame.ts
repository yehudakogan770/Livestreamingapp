// What is in the picture at one frame: a list of layers (bottom first),
// transitions between them, and adjustment layers. The same list is drawn
// while editing and when the film is made.
import { valueAt } from '../model/anim';
import { end, onTrack, rate } from '../model/seq';
import type { BlendMode, Clip, MediaItem, Project, Sequence, TextData } from '../model/types';

export type LayerSource =
  | { kind: 'video'; media: MediaItem; time: number }
  | { kind: 'image'; media: MediaItem }
  | { kind: 'text'; text: TextData; local: number; length: number }
  | { kind: 'color'; color: string };

export interface MotionNow {
  x: number;
  y: number;
  scale: number;
  scaleX: number;
  rotation: number;
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
}

export interface Layer {
  clip: Clip;
  /** Nothing to show (e.g. that camera wasn't recording then). */
  source: LayerSource | null;
  /** Frames into the clip. */
  local: number;
  motion: MotionNow;
  effects: EffectNow[];
}

export type Op =
  | { kind: 'layer'; layer: Layer }
  | { kind: 'transition'; type: string; progress: number; from: Layer | null; to: Layer | null }
  | { kind: 'adjust'; layer: Layer };

/** Seconds into the clip's source at a frame of the clip (frames past either end reach into the source's spare footage). */
export function sourceAt(c: Clip, into: number, fps: number): number {
  const f = c.reverse ? c.length - 1 - into : into;
  return ('in' in c.source ? c.source.in : 0) + (f * c.speed) / fps;
}

export function motionAt(c: Clip, local: number): MotionNow {
  const m = c.motion;
  const t = Math.max(0, Math.min(c.length - 1, local));
  return {
    x: valueAt(m.x, t),
    y: valueAt(m.y, t),
    scale: valueAt(m.scale, t, 100),
    scaleX: valueAt(m.scaleX, t, 100),
    rotation: valueAt(m.rotation, t),
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
    .map((e) => ({ id: e.id, type: e.type, p: Object.fromEntries(Object.entries(e.p).map(([k, v]) => [k, valueAt(v, t)])), d: e.d ?? {} }));
}

const AUDIO_EFFECTS = new Set(['eq', 'compressor', 'denoise', 'deess', 'limiter', 'voice']);
export const isAudioEffect = (type: string): boolean => AUDIO_EFFECTS.has(type);

/** What a clip shows at a frame (frames before or after it reach into spare footage, for transitions). */
export function layerFor(p: Project, c: Clip, frame: number, fps: number): Layer {
  const local = frame - c.start;
  const motion = motionAt(c, local);
  const effects = effectsAt(c, local, 'video', isAudioEffect);
  const src = c.source;
  let source: LayerSource | null = null;
  if (src.kind === 'media') {
    const m = p.media.find((x) => x.id === src.media);
    if (m && m.kind === 'image') source = { kind: 'image', media: m };
    else if (m && m.hasVideo) source = { kind: 'video', media: m, time: clampTime(sourceAt(c, local, fps), m) };
  } else if (src.kind === 'multicam') {
    const g = p.groups.find((x) => x.id === src.group);
    const a = g?.angles.find((x) => x.id === src.angle);
    const m = a ? p.media.find((x) => x.id === a.media) : undefined;
    if (a && m) {
      const t = sourceAt(c, local, fps) - a.offset;
      // A camera that wasn't recording then shows nothing.
      if (t >= -0.5 / fps && t < m.duration) source = { kind: 'video', media: m, time: clampTime(t, m) };
    }
  } else if (src.kind === 'text') source = { kind: 'text', text: src.text, local, length: c.length };
  else if (src.kind === 'color') source = { kind: 'color', color: src.color };
  return { clip: c, source, local, motion, effects };
}

const clampTime = (t: number, m: MediaItem): number => Math.max(0, Math.min(Math.max(0, m.duration - 0.001), t));

/** The two halves of a transition centered on a clip's start: when it begins, and how long. */
export function transitionWindow(c: Clip): { from: number; to: number } | null {
  if (!c.tIn) return null;
  const half = Math.floor(c.tIn.length / 2);
  return { from: c.start - half, to: c.start - half + c.tIn.length };
}

/** Everything to draw at a frame, bottom first. */
export function frameOps(p: Project, s: Sequence, frame: number): Op[] {
  const fps = rate(s);
  const ops: Op[] = [];
  for (const t of s.tracks) {
    if (t.kind !== 'video' || t.off) continue;
    const clips = onTrack(s, t.id).filter((c) => c.enabled);
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
      ops.push({ kind: 'transition', type: into.tIn.type, progress, from: prev ? layerFor(p, prev, frame, fps) : null, to: layerFor(p, into, frame, fps) });
      continue;
    }
    const c = clips.find((x) => frame >= x.start && frame < end(x));
    if (!c) continue;
    const layer = layerFor(p, c, frame, fps);
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
export function videoNeeds(ops: Op[]): { media: MediaItem; time: number; key: string }[] {
  const out: { media: MediaItem; time: number; key: string }[] = [];
  // One video per clip, so a clip keeps the same one through its transitions.
  const add = (l: Layer | null) => {
    if (l?.source?.kind === 'video') out.push({ media: l.source.media, time: l.source.time, key: l.clip.id });
  };
  for (const op of ops) {
    if (op.kind === 'transition') {
      add(op.from);
      add(op.to);
    } else add(op.layer);
  }
  return out;
}
