import type { EventFile } from './event';

/** Color settings for one camera, each from -100 to 100 (0 = as recorded). */
export interface Look {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
}
export const NEUTRAL: Look = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };

/** A camera angle (or the Live Screen recording). Times are ms after the event started. */
export interface Angle {
  id: string;
  name: string;
  path: string;
  startMs: number;
  durationMs: number;
  /** Nudge when the picture is a little early or late (ms). */
  offsetMs: number;
  /** The Live Screen recording (everything that went out, with graphics). */
  live: boolean;
  color: string;
  look: Look;
  width: number;
  height: number;
}

/** A sound track: a microphone, or the sound that went out live. */
export interface Track {
  id: string;
  name: string;
  path: string;
  startMs: number;
  durationMs: number;
  offsetMs: number;
  gainDb: number;
  muted: boolean;
  solo: boolean;
  live: boolean;
}

/**
 * A part of the event that stays in the film, and which camera shows it.
 * `in`/`out` are event times (ms); the film plays the clips one after another.
 */
export interface Clip {
  id: string;
  angle: string;
  in: number;
  out: number;
  /** A dissolve into this clip from the one before (ms; 0 = a straight cut). */
  fade: number;
}

export type TitleStyle = 'lower' | 'center' | 'corner';

/** Words on the picture. It stays with the moment it was put on (an event time). */
export interface Title {
  id: string;
  at: number;
  length: number;
  text: string;
  sub: string;
  style: TitleStyle;
}

export interface Project {
  kind: 'lumora-edit';
  version: 1;
  name: string;
  eventPath: string;
  startedAt: number;
  durationMs: number;
  angles: Angle[];
  tracks: Track[];
  clips: Clip[];
  titles: Title[];
  /** The part to export when only part is wanted (film times, ms). */
  range: { from: number; to: number } | null;
}

/** What Lumora Edit found out about each recorded file when it got it ready. */
export interface Prepared {
  path: string;
  durationMs: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
}

export const FPS = 30;
export const FRAME = 1000 / FPS;
/** The shortest clip (a few frames). */
export const MIN_CLIP = FRAME * 3;

/** Camera colors on the timeline (never yellow: that is the logo's). */
export const ANGLE_COLORS = ['#3d8f99', '#4a6fb5', '#7a5bb0', '#b5654a', '#3f8f5a', '#a8507a', '#5d7a8c', '#8c6d3f'];
export const LIVE_COLOR = '#a9443c';

let n = 0;
export function uid(prefix = 'c'): string {
  n += 1;
  return `${prefix}${Date.now().toString(36)}${n.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** To the nearest frame, in whole ms (so clips that touch match exactly). */
export const snap = (ms: number): number => Math.round(Math.round(ms / FRAME) * FRAME);

/** Lay out the whole event, ready to edit: every camera, every microphone, and the live cuts as the first edit. */
export function buildProject(event: EventFile, eventPath: string, media: Map<string, Prepared>): Project {
  const angles: Angle[] = [];
  const tracks: Track[] = [];
  const programPath = [event.program.mp4, event.program.path].find((p) => p && media.has(p)) ?? null;
  const program = programPath ? media.get(programPath) : undefined;
  if (program?.hasVideo) {
    angles.push({
      id: 'live',
      name: 'Live Screen',
      path: program.path,
      startMs: 0,
      durationMs: program.durationMs,
      offsetMs: 0,
      live: true,
      color: LIVE_COLOR,
      look: { ...NEUTRAL },
      width: program.width,
      height: program.height,
    });
  }
  if (program?.hasAudio) {
    tracks.push({
      id: 'live-sound',
      name: 'Live sound',
      path: program.path,
      startMs: 0,
      durationMs: program.durationMs,
      offsetMs: 0,
      gainDb: 0,
      muted: false,
      solo: false,
      live: true,
    });
  }
  // Which angle each input became (an input may have several files if it was restarted).
  const bySource = new Map<string, Angle[]>();
  let cams = 0;
  let mics = 0;
  for (const f of event.files) {
    const m = media.get(f.path);
    if (!m) continue;
    if (f.kind === 'camera' && m.hasVideo) {
      const a: Angle = {
        id: `cam${cams + 1}`,
        name: f.name,
        path: m.path,
        startMs: f.startMs,
        durationMs: m.durationMs,
        offsetMs: 0,
        live: false,
        color: ANGLE_COLORS[cams % ANGLE_COLORS.length] ?? '#3d8f99',
        look: { ...NEUTRAL },
        width: m.width,
        height: m.height,
      };
      cams += 1;
      angles.push(a);
      bySource.set(f.sourceId, [...(bySource.get(f.sourceId) ?? []), a]);
    } else if (m.hasAudio) {
      mics += 1;
      tracks.push({
        id: `mic${mics}`,
        name: f.name.replace(/\s*\(sound\)$/, ''),
        path: m.path,
        startMs: f.startMs,
        durationMs: m.durationMs,
        offsetMs: 0,
        gainDb: 0,
        // The live sound already has the microphones in it: theirs are there to fix things.
        muted: !!program?.hasAudio,
        solo: false,
        live: false,
      });
    }
  }
  if (angles.length === 0) {
    throw new Error('No video was found for this event. Keep the event file in the same place as its recordings, then try again.');
  }
  const ends = [...angles, ...tracks].map((x) => x.startMs + x.durationMs);
  const durationMs = snap(Math.max(event.durationMs ?? 0, ...ends));
  const fallback = angles[0]?.id ?? 'live';
  const angleFor = (id: string | null, at: number): string => {
    const options = id ? (bySource.get(id) ?? []) : [];
    const covering = options.find((a) => at >= a.startMs && at < a.startMs + a.durationMs) ?? options[0];
    return covering?.id ?? fallback;
  };
  const clips: Clip[] = [];
  const cuts = event.cuts.filter((c) => c.at < durationMs);
  if (cuts.length === 0 || (cuts[0]?.at ?? 0) > MIN_CLIP) clips.push({ id: uid(), angle: fallback, in: 0, out: snap(cuts[0]?.at ?? durationMs), fade: 0 });
  cuts.forEach((c, i) => {
    const from = clips.length === 0 ? 0 : snap(c.at);
    const to = snap(cuts[i + 1]?.at ?? durationMs);
    if (to - from >= FRAME) clips.push({ id: uid(), angle: angleFor(c.id, c.at), in: from, out: to, fade: 0 });
  });
  return {
    kind: 'lumora-edit',
    version: 1,
    name: event.name,
    eventPath,
    startedAt: event.startedAt,
    durationMs,
    angles,
    tracks,
    clips: normalize(fixEnds(clips)),
    titles: [],
    range: null,
  };
}

/** Clips touch end to end (no tiny gaps from rounding). */
function fixEnds(clips: Clip[]): Clip[] {
  return clips.map((c, i) => {
    const next = clips[i + 1];
    return next && Math.abs(next.in - c.out) < FRAME ? { ...c, out: next.in } : c;
  });
}

/** Two clips in a row of the same camera, one straight after the other, become one. */
export function normalize(clips: Clip[]): Clip[] {
  const out: Clip[] = [];
  for (const c of clips) {
    const last = out[out.length - 1];
    if (last && last.angle === c.angle && last.out === c.in && c.fade === 0) out[out.length - 1] = { ...last, out: c.out };
    else out.push(c);
  }
  return out;
}

export const clipLength = (c: Clip): number => c.out - c.in;

/** Where each clip starts in the film, and how long the film is. */
export function layout(clips: Clip[]): { starts: number[]; total: number } {
  const starts: number[] = [];
  let t = 0;
  for (const c of clips) {
    starts.push(t);
    t += clipLength(c);
  }
  return { starts, total: t };
}

export interface Spot {
  index: number;
  clip: Clip;
  /** When the clip starts in the film. */
  start: number;
  /** The event time at this film time. */
  event: number;
}

/** What is showing at a film time (the last frame for the very end). */
export function locate(clips: Clip[], t: number): Spot | null {
  let start = 0;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i] as Clip;
    const len = clipLength(clip);
    if (t < start + len || i === clips.length - 1) {
      const into = Math.max(0, Math.min(len, t - start));
      return { index: i, clip, start, event: clip.in + into };
    }
    start += len;
  }
  return null;
}

/** The film time of an event time (null: that moment was cut out). */
export function filmTime(clips: Clip[], event: number): number | null {
  let start = 0;
  for (const c of clips) {
    if (event >= c.in && event < c.out) return start + (event - c.in);
    start += clipLength(c);
  }
  return null;
}

// Edits keep every cut the editor made (even with the same camera on both sides).
const withClips = (p: Project, clips: Clip[]): Project => ({ ...p, clips });

/** Cut the clip at the playhead into two. */
export function split(p: Project, t: number): Project {
  const s = locate(p.clips, t);
  if (!s) return p;
  const at = snap(s.event);
  if (at - s.clip.in < MIN_CLIP || s.clip.out - at < MIN_CLIP) return p;
  const clips = [...p.clips];
  clips.splice(s.index, 1, { ...s.clip, out: at }, { ...s.clip, id: uid(), in: at, fade: 0 });
  return withClips(p, clips);
}

/** Take clips out; the rest closes up (the sound goes with the picture). */
export function remove(p: Project, ids: string[]): Project {
  const clips = p.clips.filter((c) => !ids.includes(c.id));
  if (clips.length === 0) return p;
  return withClips(p, clips);
}

export function setAngle(p: Project, id: string, angle: string): Project {
  return withClips(
    p,
    p.clips.map((c) => (c.id === id ? { ...c, angle } : c)),
  );
}

/** Switch to a camera from the playhead on (to the end of that clip), like switching live. */
export function switchFrom(p: Project, t: number, angle: string): Project {
  const s = locate(p.clips, t);
  if (!s) return p;
  if (s.event - s.clip.in < MIN_CLIP || s.clip.out - s.event < MIN_CLIP) return setAngle(p, s.clip.id, angle);
  const at = snap(s.event);
  const clips = [...p.clips];
  clips.splice(s.index, 1, { ...s.clip, out: at }, { ...s.clip, id: uid(), in: at, fade: 0, angle });
  return withClips(p, clips);
}

/**
 * Move a clip's edge. Between two clips that follow on in the event, the cut
 * point moves ("roll": nothing is lost). Otherwise, or with `ripple`, the
 * clip gets longer or shorter and the film after it moves along.
 */
export function trim(p: Project, id: string, edge: 'start' | 'end', delta: number, ripple = false): Project {
  const i = p.clips.findIndex((c) => c.id === id);
  const clip = p.clips[i];
  if (!clip) return p;
  const clips = [...p.clips];
  if (edge === 'end') {
    const next = clips[i + 1];
    const touching = !!next && next.in === clip.out;
    let out = snap(clip.out + delta);
    if (touching && !ripple && next) {
      out = Math.max(clip.in + MIN_CLIP, Math.min(next.out - MIN_CLIP, out));
      clips[i + 1] = { ...next, in: out };
    } else {
      const limit = next && !touching ? next.in : touching ? clip.out : p.durationMs;
      out = Math.max(clip.in + MIN_CLIP, Math.min(limit, out));
    }
    clips[i] = { ...clip, out };
  } else {
    const prev = clips[i - 1];
    const touching = !!prev && prev.out === clip.in;
    let start = snap(clip.in + delta);
    if (touching && !ripple && prev) {
      start = Math.max(prev.in + MIN_CLIP, Math.min(clip.out - MIN_CLIP, start));
      clips[i - 1] = { ...prev, out: start };
    } else {
      const limit = prev && !touching ? prev.out : touching ? clip.in : 0;
      start = Math.min(clip.out - MIN_CLIP, Math.max(limit, start));
    }
    clips[i] = { ...clip, in: start };
  }
  return withClips(p, clips);
}

/** The longest dissolve that fits between a clip and the one before it. */
export function maxFade(p: Project, id: string): number {
  const i = p.clips.findIndex((c) => c.id === id);
  const clip = p.clips[i];
  const prev = p.clips[i - 1];
  if (!clip || !prev) return 0;
  return snap(Math.min(clipLength(clip), clipLength(prev)) * 0.8);
}

export function setFade(p: Project, id: string, ms: number): Project {
  const most = maxFade(p, id);
  return { ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, fade: Math.max(0, Math.min(most, snap(ms))) } : c)) };
}

export function addTitle(p: Project, t: number, length = 5000): { project: Project; id: string } {
  const s = locate(p.clips, t);
  const id = uid('t');
  const title: Title = { id, at: s ? snap(s.event) : 0, length, text: 'Name', sub: '', style: 'lower' };
  return { project: { ...p, titles: [...p.titles, title] }, id };
}

export function updateTitle(p: Project, id: string, change: Partial<Omit<Title, 'id'>>): Project {
  return { ...p, titles: p.titles.map((x) => (x.id === id ? { ...x, ...change, length: Math.max(500, change.length ?? x.length) } : x)) };
}

/** Move a title to a film time. */
export function moveTitle(p: Project, id: string, t: number): Project {
  const s = locate(p.clips, t);
  return s ? updateTitle(p, id, { at: snap(s.event) }) : p;
}

export function removeTitle(p: Project, id: string): Project {
  return { ...p, titles: p.titles.filter((x) => x.id !== id) };
}

/** Each title's place in the film (titles whose moment was cut out are left out). */
export function placedTitles(p: Project): { title: Title; start: number }[] {
  return p.titles
    .map((title) => ({ title, start: filmTime(p.clips, title.at) }))
    .filter((x): x is { title: Title; start: number } => x.start !== null)
    .sort((a, b) => a.start - b.start);
}

export function updateAngle(p: Project, id: string, change: Partial<Omit<Angle, 'id'>>): Project {
  return { ...p, angles: p.angles.map((a) => (a.id === id ? { ...a, ...change } : a)) };
}

export function updateTrack(p: Project, id: string, change: Partial<Omit<Track, 'id'>>): Project {
  return { ...p, tracks: p.tracks.map((x) => (x.id === id ? { ...x, ...change } : x)) };
}

/** The tracks heard (solo wins). */
export function heardTracks(p: Project): Track[] {
  const solo = p.tracks.some((x) => x.solo);
  return p.tracks.filter((x) => (solo ? x.solo : !x.muted));
}

/** "1:02:03" or "2:03" (film or event time). */
export function timecode(ms: number, frames = false): string {
  const total = Math.max(0, ms);
  const s = Math.floor(total / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  const base = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  if (!frames) return base;
  const f = Math.round(total / FRAME) % FPS;
  return `${base}.${String(f).padStart(2, '0')}`;
}

/** The time of day something happened, e.g. "7:42 PM". */
export function clockTime(startedAt: number, event: number, seconds = false): string {
  if (!startedAt) return '';
  return new Date(startedAt + event).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hour12: true,
  });
}
