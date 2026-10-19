p = 'render/frame.ts'
s = open(p).read()


def rep(a, b):
    global s
    assert a in s, a
    s = s.replace(a, b, 1)


rep("""import type { BlendMode, Clip, MediaItem, Project, Sequence, TextData } from '../model/types';
""", """import { rateAt, remapSourceAt, sampleFrames } from '../model/remap';
import type { BlendMode, Clip, MediaItem, Project, Sequence, ShapeData, TextData } from '../model/types';
""")
rep("""  | { kind: 'video'; media: MediaItem; time: number }""", """  /** `next`: a second frame mixed in (time remapping between the file's frames: blended or by optical flow). */
  | { kind: 'video'; media: MediaItem; time: number; next?: { time: number; mix: number; mode: 'blend' | 'flow' } }
  | { kind: 'shape'; shape: ShapeData; local: number; length: number }""")
rep("""  motion: MotionNow;
  effects: EffectNow[];
}
""", """  motion: MotionNow;
  effects: EffectNow[];
  /** Motion blur: the movement across the shutter (each look drawn and averaged), relative to `base`. */
  motionBlur?: { base: MotionNow; samples: MotionNow[] };
}
""")
rep("""export function sourceAt(c: Clip, into: number, fps: number): number {
  const f""", """export function sourceAt(c: Clip, into: number, fps: number): number {
  if (c.remap) return remapSourceAt(c, c.remap, into, fps);
  const f""")
rep("""export function motionAt(c: Clip, local: number): MotionNow {""", """/** The looks across the shutter for motion blur (none when the clip doesn't move then). */
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

export function motionAt(c: Clip, local: number, between = false): MotionNow {""")
rep("""  const t = Math.max(0, Math.min(c.length - 1, local));
  return {
    x: valueAt(m.x, t),""", """  const t = Math.max(0, Math.min(c.length - 1, between ? local : Math.round(local)));
  return {
    x: valueAt(m.x, t),""")
rep("""    else if (m && m.hasVideo) source = { kind: 'video', media: m, time: clampTime(sourceAt(c, local, fps), m) };""", """    else if (m && m.hasVideo) source = remapped(c, m, clampTime(sourceAt(c, local, fps), m));""")
rep("""      if (t >= -0.5 / fps && t < m.duration) source = { kind: 'video', media: m, time: clampTime(t, m) };""", """      if (t >= -0.5 / fps && t < m.duration) source = remapped(c, m, clampTime(t, m));""")
rep("""  else if (src.kind === 'color') source = { kind: 'color', color: src.color };""", """  else if (src.kind === 'shape') source = { kind: 'shape', shape: src.shape, local, length: c.length };
  else if (src.kind === 'color') source = { kind: 'color', color: src.color };""")
rep("""  return { clip: c, key: `${prefix}${c.id}`, fps, source, local, motion, effects };
}
""", """  const samples = blurSamples(c, local, motion);
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
""")
rep("""    if (l?.source?.kind === 'video') out.push({ media: l.source.media, time: l.source.time, key: l.key, rate: l.clip.speed * (l.clip.reverse ? -1 : 1) });""",
    """    if (l?.source?.kind === 'video') out.push({ media: l.source.media, time: l.source.time, key: l.key, rate: rateAt(l.clip, l.local) });""")
open(p, 'w').write(s)
