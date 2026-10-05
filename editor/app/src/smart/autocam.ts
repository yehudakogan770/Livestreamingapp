// Auto multicam edit: listen to each person's microphone, work out who is
// talking when, and cut to their camera. The rules a good director follows
// are built in: no shot shorter than a minimum (no flicker), a wide shot when
// people talk over each other or nobody talks for a while, and a cutaway to
// the wide shot now and then during a long monologue. The result is ordinary
// multicam clips, cut and switched, that can be changed (or undone) as usual.
import { withAngle } from '../model/edit';
import { current, cutClip, editSeq, end, rate, trackOf } from '../model/seq';
import { uid, type Clip, type MediaItem, type MulticamGroup, type Project, type Sequence } from '../model/types';
import { percentile } from './envelope';

/** Nobody is talking. */
export const SILENCE = -1;
/** Two or more people are talking at once. */
export const OVERLAP = -2;

export interface DetectOptions {
  /** Seconds per step of the envelopes. */
  hop: number;
  /** A microphone this far (dB) above its own background is someone talking. */
  marginDb: number;
  /** Below this level (dB) a microphone is never talking. */
  minDb: number;
  /** The loudest talking microphone must beat the next by this much (dB), or it is people talking at once. */
  overlapDb: number;
  /** Talking shorter than this (seconds) is a cough or a "mm-hm", not talking. */
  minTalk: number;
  /** Short pauses (seconds) inside someone's talking still count as talking. */
  hold: number;
}

export const DETECT_DEFAULTS: DetectOptions = { hop: 0.1, marginDb: 12, minDb: -55, overlapDb: 6, minTalk: 0.4, hold: 0.6 };

/** Each microphone's talking, step by step (true: someone is talking into it). */
export function talking(env: Float32Array, o: DetectOptions): Uint8Array {
  const floor = percentile(env, 0.15);
  const on = new Uint8Array(env.length);
  for (let i = 0; i < env.length; i++) on[i] = (env[i] as number) > Math.max(o.minDb, floor + o.marginDb) ? 1 : 0;
  // Blips are not talking.
  const minRun = Math.max(1, Math.round(o.minTalk / o.hop));
  runs(on, (from, to, v) => {
    if (v && to - from < minRun) on.fill(0, from, to);
  });
  // Pauses between words are.
  const hold = Math.round(o.hold / o.hop);
  runs(on, (from, to, v) => {
    if (!v && from > 0 && to < on.length && to - from <= hold) on.fill(1, from, to);
  });
  return on;
}

function runs(a: ArrayLike<number>, f: (from: number, to: number, v: number) => void): void {
  let from = 0;
  for (let i = 1; i <= a.length; i++) {
    if (i === a.length || a[i] !== a[from]) {
      f(from, i, a[from] as number);
      from = i;
    }
  }
}

/**
 * Who is talking at each step: the index of a microphone, SILENCE or OVERLAP.
 * Every microphone hears everyone a little (bleed), so when several are "on",
 * the loudest one (above its own background) is the speaker unless another is close.
 */
export function detectSpeakers(envs: Float32Array[], o: DetectOptions = DETECT_DEFAULTS): Int16Array {
  const n = envs.reduce((m, e) => Math.max(m, e.length), 0);
  const on = envs.map((e) => talking(e, o));
  const floors = envs.map((e) => percentile(e, 0.15));
  const who = new Int16Array(n).fill(SILENCE);
  for (let i = 0; i < n; i++) {
    let best = -1;
    let bestLevel = -Infinity;
    let second = -Infinity;
    envs.forEach((e, m) => {
      if (!on[m]?.[i]) return;
      const level = (e[i] as number) - (floors[m] as number);
      if (level > bestLevel) {
        second = bestLevel;
        bestLevel = level;
        best = m;
      } else if (level > second) second = level;
    });
    if (best < 0) continue;
    who[i] = second === -Infinity || bestLevel - second >= o.overlapDb ? best : OVERLAP;
  }
  return who;
}

export interface CutRules {
  /** No shot shorter than this (seconds). */
  minShot: number;
  /** A speaker's shot longer than this gets a cutaway to the wide shot (seconds). */
  maxShot: number;
  /** How long a cutaway lasts (seconds). */
  cutaway: number;
  /** Nobody talking this long goes to the wide shot (seconds). */
  silenceToWide: number;
  /** The wide camera (an angle id), or null when there is none. */
  wide: string | null;
}

/** Calm (0) to fast (1) pacing, as rules. */
export function rulesForPacing(pacing: number, wide: string | null): CutRules {
  const p = Math.min(1, Math.max(0, pacing));
  const lerp = (a: number, b: number) => a + (b - a) * p;
  return { minShot: lerp(4, 1.2), maxShot: lerp(22, 7), cutaway: lerp(4, 2), silenceToWide: lerp(4, 1.5), wide };
}

export interface Shot {
  /** Seconds (the group's time). */
  from: number;
  to: number;
  angle: string;
  why: 'speaker' | 'overlap' | 'silence' | 'cutaway';
}

/**
 * The cuts for who was talking when: `angles[m]` is the camera on microphone
 * `m`'s person (null: don't cut for them). `start` is the time of step 0.
 */
export function planCuts(who: Int16Array, hop: number, angles: (string | null)[], rules: CutRules, start = 0): Shot[] {
  // Stretches of the same thing happening.
  const segs: { from: number; to: number; who: number }[] = [];
  runs(who, (a, b, v) => segs.push({ from: start + a * hop, to: start + b * hop, who: v }));
  if (segs.length === 0) return [];
  // The camera each one wants (null: keep what is on).
  const wanted: { from: number; to: number; angle: string | null; why: Shot['why'] }[] = segs.map((s) => {
    if (s.who >= 0) return { ...s, angle: angles[s.who] ?? null, why: 'speaker' as const };
    if (s.who === OVERLAP) return { ...s, angle: rules.wide, why: 'overlap' as const };
    return { ...s, angle: s.to - s.from >= rules.silenceToWide ? rules.wide : null, why: 'silence' as const };
  });
  const firstAngle = wanted.find((w) => w.angle)?.angle ?? rules.wide ?? angles.find((a) => a) ?? null;
  if (!firstAngle) return [];
  let shots: Shot[] = [];
  let on = firstAngle;
  let why: Shot['why'] = 'speaker';
  for (const w of wanted) {
    if (w.angle) {
      on = w.angle;
      why = w.why;
    }
    shots.push({ from: w.from, to: w.to, angle: on, why });
  }
  shots = joinSame(shots);
  shots = enforceMin(shots, rules.minShot);
  shots = addCutaways(shots, rules);
  return joinSame(shots);
}

function joinSame(shots: Shot[]): Shot[] {
  const out: Shot[] = [];
  for (const s of shots) {
    const last = out[out.length - 1];
    if (last && last.angle === s.angle) last.to = s.to;
    else out.push({ ...s });
  }
  return out;
}

/** Shots shorter than the minimum go to what was on before them (or after, at the start). */
function enforceMin(shots: Shot[], min: number): Shot[] {
  let out = shots.map((s) => ({ ...s }));
  for (;;) {
    if (out.length < 2) return out;
    let shortest = -1;
    for (let i = 0; i < out.length; i++) {
      const s = out[i] as Shot;
      if (s.to - s.from < min - 1e-9 && (shortest < 0 || s.to - s.from < (out[shortest] as Shot).to - (out[shortest] as Shot).from)) shortest = i;
    }
    if (shortest < 0) return out;
    const s = out[shortest] as Shot;
    const prev = out[shortest - 1];
    const next = out[shortest + 1];
    if (prev) prev.to = s.to;
    else if (next) next.from = s.from;
    out.splice(shortest, 1);
    out = joinSame(out);
  }
}

/** Long shots of one speaker get cutaways to the wide shot, each part still long enough. */
function addCutaways(shots: Shot[], r: CutRules): Shot[] {
  const wide = r.wide;
  if (!wide) return shots;
  const len = Math.max(r.cutaway, r.minShot);
  const out: Shot[] = [];
  for (const s of shots) {
    const total = s.to - s.from;
    if (s.angle === wide || s.why !== 'speaker' || total <= r.maxShot) {
      out.push(s);
      continue;
    }
    let n = Math.ceil(total / r.maxShot) - 1;
    while (n > 0 && (total - n * len) / (n + 1) < r.minShot) n--;
    if (n === 0) {
      out.push(s);
      continue;
    }
    const part = (total - n * len) / (n + 1);
    let t = s.from;
    for (let k = 0; k <= n; k++) {
      out.push({ from: t, to: t + part, angle: s.angle, why: 'speaker' });
      t += part;
      if (k < n) {
        out.push({ from: t, to: t + len, angle: wide, why: 'cutaway' });
        t += len;
      }
    }
    (out[out.length - 1] as Shot).to = s.to;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The microphones and cameras of a multicam clip.

export interface MicSource {
  key: string;
  name: string;
  media: MediaItem;
  /** Where the file starts in the group's time (seconds). */
  offset: number;
  /** The camera on this person (null: not used to cut). */
  angle: string | null;
}

const plain = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\(sound\)|microphone|mic\b|camera|cam\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The multicam groups used in a sequence, the most used first. */
export function groupsIn(p: Project, s: Sequence): MulticamGroup[] {
  const count = new Map<string, number>();
  for (const c of s.clips) if (c.source.kind === 'multicam') count.set(c.source.group, (count.get(c.source.group) ?? 0) + c.length);
  return p.groups.filter((g) => count.has(g.id)).sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0));
}

/**
 * The sound sources that can tell who is talking: separate microphones in the
 * sequence (linked to the group's clips, as an event recording lays them out)
 * and the cameras' own sound. Each gets a camera guessed by name, then by order.
 */
export function micSources(p: Project, s: Sequence, g: MulticamGroup): MicSource[] {
  const fps = rate(s);
  const out: MicSource[] = [];
  const seen = new Set<string>();
  const cams = g.angles.filter((a) => !a.live);
  for (const v of s.clips) {
    if (v.source.kind !== 'multicam' || v.source.group !== g.id || !v.link || v.speed !== 1) continue;
    const vin = v.source.in;
    for (const a of s.clips) {
      if (a.link !== v.link || a.source.kind !== 'media' || trackOf(s, a.track)?.kind !== 'audio') continue;
      const m = p.media.find((x) => x.id === (a.source as { media: string }).media);
      if (!m?.hasAudio || seen.has(m.id) || a.speed !== 1) continue;
      seen.add(m.id);
      // The same moment: the group time at the clip's start is `vin + (a.start - v.start) / fps`.
      const offset = vin + (a.start - v.start) / fps - a.source.in;
      out.push({ key: m.id, name: m.name, media: m, offset, angle: null });
    }
  }
  const separate = out.length > 0;
  for (const a of g.angles) {
    const m = p.media.find((x) => x.id === a.media);
    if (!m?.hasAudio || seen.has(m.id) || a.live) continue;
    seen.add(m.id);
    out.push({ key: m.id, name: `${a.name} (camera sound)`, media: m, offset: a.offset, angle: separate ? null : a.id });
  }
  // Guess each microphone's camera by name, then by order.
  const used = new Set(out.map((m) => m.angle).filter(Boolean));
  for (const mic of out) {
    if (mic.angle || /live/i.test(mic.name)) continue;
    const n = plain(mic.name);
    const byName = cams.find((a) => !used.has(a.id) && n && (plain(a.name) === n || plain(a.name).includes(n) || n.includes(plain(a.name))));
    if (byName) {
      mic.angle = byName.id;
      used.add(byName.id);
    }
  }
  for (const mic of out) {
    if (mic.angle || /live/i.test(mic.name) || mic.name.endsWith('(camera sound)')) continue;
    const free = cams.find((a) => !used.has(a.id) && !/wide|master|stage|all\b/i.test(a.name));
    if (free) {
      mic.angle = free.id;
      used.add(free.id);
    }
  }
  return out;
}

/** The camera that looks like the wide shot (by name), or null. */
export function guessWide(g: MulticamGroup): string | null {
  return g.angles.find((a) => !a.live && /wide|master|stage|room|all\b|establish/i.test(a.name))?.id ?? null;
}

// ---------------------------------------------------------------------------
// Putting the cuts into the sequence.

/** The multicam clips of a group that the cuts go into (inside the in and out marks, when set). */
export function targetClips(s: Sequence, group: string): Clip[] {
  const from = s.inPoint ?? -Infinity;
  const to = s.outPoint ?? Infinity;
  return s.clips.filter(
    (c) =>
      c.source.kind === 'multicam' &&
      c.source.group === group &&
      !c.reverse &&
      !trackOf(s, c.track)?.locked &&
      trackOf(s, c.track)?.kind === 'video' &&
      end(c) > from &&
      c.start < to,
  );
}

/**
 * Cut the group's clips (and the sound linked to them) where the shots
 * change, and switch each part to its shot's camera. Each part gets its own
 * link, as if it had been cut by hand.
 */
export function applyShots(p: Project, group: string, shots: Shot[]): Project {
  if (shots.length === 0) return p;
  return editSeq(p, (s) => {
    const fps = rate(s);
    const targets = targetClips(s, group);
    if (targets.length === 0) return s;
    const lo = s.inPoint ?? -Infinity;
    const hi = s.outPoint ?? Infinity;
    let clips = s.clips;
    for (const t of targets) {
      const v = clips.find((c) => c.id === t.id);
      if (!v || v.source.kind !== 'multicam') continue;
      const vin = v.source.in;
      const frameOf = (g: number) => v.start + Math.round(((g - vin) * fps) / v.speed);
      const from = Math.max(v.start, lo);
      const to = Math.min(end(v), hi);
      // The parts of this clip, in sequence frames.
      const parts: { from: number; to: number; angle: string }[] = [];
      for (const sh of shots) {
        const a = Math.max(from, frameOf(sh.from));
        const b = Math.min(to, frameOf(sh.to));
        if (b <= a) continue;
        const last = parts[parts.length - 1];
        if (last && last.angle === sh.angle && last.to === a) last.to = b;
        else parts.push({ from: a, to: b, angle: sh.angle });
      }
      if (parts.length === 0) continue;
      const cuts = [...new Set(parts.flatMap((x) => [x.from, x.to]))].filter((f) => f > v.start && f < end(v)).sort((a, b) => a - b);
      const family = new Set(v.link ? clips.filter((c) => c.link === v.link && !trackOf(s, c.track)?.locked).map((c) => c.id) : [v.id]);
      family.add(v.id);
      // Cut the clip and its linked sound at every change.
      let pieces: Clip[] = clips.filter((c) => family.has(c.id));
      for (const f of cuts) {
        pieces = pieces.flatMap((c) => (f > c.start && f < end(c) ? cutClip(c, f, fps, uid()) : [c]));
      }
      // One link for each stretch between cuts.
      const bounds = [v.start, ...cuts, end(v)];
      const links = bounds.slice(0, -1).map(() => (v.link ? uid('l') : null));
      pieces = pieces.map((c) => {
        const i = Math.max(
          0,
          bounds.findIndex((b, k) => k < bounds.length - 1 && c.start >= b && c.start < (bounds[k + 1] as number)),
        );
        let out: Clip = { ...c, link: links[i] ?? c.link };
        if (c.track === v.track && c.source.kind === 'multicam') {
          const part = parts.find((x) => c.start >= x.from && c.start < x.to);
          if (part) out = withAngle(p, out, part.angle);
        }
        return out;
      });
      clips = [...clips.filter((c) => !family.has(c.id)), ...pieces];
    }
    return { ...s, clips };
  });
}

/** How many cuts, and how much each camera is on (seconds), for the preview. */
export function summarize(shots: Shot[]): { cuts: number; byAngle: Map<string, number>; shortest: number; average: number } {
  const byAngle = new Map<string, number>();
  for (const s of shots) byAngle.set(s.angle, (byAngle.get(s.angle) ?? 0) + (s.to - s.from));
  const lengths = shots.map((s) => s.to - s.from);
  return {
    cuts: Math.max(0, shots.length - 1),
    byAngle,
    shortest: lengths.length ? Math.min(...lengths) : 0,
    average: lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0,
  };
}

/** The group a sequence's multicam clips mostly use (the open sequence). */
export const mainGroup = (p: Project): MulticamGroup | undefined => groupsIn(p, current(p))[0];
