// Making a project: from a recorded event (every camera as one multicam
// clip, the live switching as the first edit), from older Lumora Edit
// projects, and adding media to a sequence.
import type { EventFile } from './event';
import { current, editSeq, rate } from './seq';
import { placeClips } from './edit';
import {
  DEFAULT_TEXT,
  LABELS,
  LIVE_COLOR,
  newClip,
  newSequence,
  uid,
  type Angle,
  type Clip,
  type MediaItem,
  type MulticamGroup,
  type Project,
  type Sequence,
  type Track,
} from './types';

/** What Lumora Edit found out about a file when it got it ready. */
export interface Prepared {
  path: string;
  /** What to play while editing, when it isn't the file itself. */
  proxy?: string | null;
  durationMs: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
  fps?: number;
}

const IMAGE = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|avif)$/i;

export function mediaFrom(prepared: Prepared, name: string, bin: string | null = null): MediaItem {
  const image = IMAGE.test(prepared.path);
  return {
    id: uid('m'),
    name,
    path: prepared.path,
    proxy: prepared.proxy ?? null,
    kind: image ? 'image' : prepared.hasVideo ? 'video' : 'audio',
    duration: image ? 0 : prepared.durationMs / 1000,
    width: prepared.width,
    height: prepared.height,
    fps: prepared.fps ?? 30,
    hasVideo: image || prepared.hasVideo,
    hasAudio: !image && prepared.hasAudio,
    bin,
  };
}

/** How long a still picture is when it goes on the timeline. */
export const STILL_SECONDS = 5;

/** Lay out a recorded event, ready to edit. */
export function buildEventProject(event: EventFile, eventPath: string, media: Map<string, Prepared>): Project {
  const items: MediaItem[] = [];
  const camBin = { id: uid('b'), name: 'Cameras', parent: null };
  const soundBin = { id: uid('b'), name: 'Sound', parent: null };
  const bins = [camBin, soundBin];
  const angles: Angle[] = [];
  const mics: { item: MediaItem; offset: number; live: boolean }[] = [];
  const programPath = [event.program.mp4, event.program.path].find((x) => x && media.has(x)) ?? null;
  const program = programPath ? media.get(programPath) : undefined;
  if (program) {
    const item = mediaFrom(program, 'Live Screen', camBin.id);
    items.push(item);
    if (program.hasVideo) angles.push({ id: 'live', name: 'Live Screen', media: item.id, offset: 0, color: LIVE_COLOR, live: true });
    if (program.hasAudio) mics.push({ item, offset: 0, live: true });
  }
  const bySource = new Map<string, Angle[]>();
  for (const f of event.files) {
    const m = media.get(f.path);
    if (!m) continue;
    const camera = f.kind === 'camera' && m.hasVideo;
    const item = mediaFrom(m, camera ? f.name : f.name.replace(/\s*\(sound\)$/, ''), camera ? camBin.id : soundBin.id);
    items.push(item);
    if (camera) {
      const n = angles.filter((a) => !a.live).length;
      const a: Angle = { id: `cam${n + 1}`, name: f.name, media: item.id, offset: f.startMs / 1000, color: LABELS[n % LABELS.length] as string, live: false };
      angles.push(a);
      bySource.set(f.sourceId, [...(bySource.get(f.sourceId) ?? []), a]);
    } else if (m.hasAudio) mics.push({ item, offset: f.startMs / 1000, live: false });
  }
  if (angles.length === 0) throw new Error('No video was found for this event. Keep the event file in the same place as its recordings, then try again.');
  const ends = [...angles.map((a) => a.offset + (items.find((i) => i.id === a.media)?.duration ?? 0)), ...mics.map((m) => m.offset + m.item.duration)];
  const duration = Math.max((event.durationMs ?? 0) / 1000, ...ends);
  const group: MulticamGroup = { id: uid('g'), name: event.name || 'Event', duration, angles, startedAt: event.startedAt };

  const biggest = items.filter((i) => i.kind === 'video').sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const tall = biggest && biggest.height > biggest.width;
  const width = biggest?.width && biggest.width >= 640 ? (tall ? 1080 : 1920) : 1920;
  const height = tall ? 1920 : 1080;
  const seq = newSequence(event.name || 'Event', width, height, 30, 3, Math.max(1, mics.length));
  const audio = seq.tracks.filter((t) => t.kind === 'audio');
  mics.forEach((m, i) => {
    const t = audio[i] as Track;
    t.name = m.live ? 'Live sound' : m.item.name;
    // The live sound already has the microphones in it: theirs are there to fix things.
    t.off = !m.live && mics.some((x) => x.live);
  });
  const fps = rate(seq);
  const total = Math.round(duration * fps);
  // The live switching becomes the first edit.
  const fallback = angles[0]?.id ?? 'live';
  const angleFor = (id: string | null, at: number): string => {
    const options = id ? (bySource.get(id) ?? []) : [];
    const covering = options.find((a) => at >= a.offset && at < a.offset + (items.find((x) => x.id === a.media)?.duration ?? 0)) ?? options[0];
    return covering?.id ?? fallback;
  };
  const cuts = event.cuts.filter((c) => c.at / 1000 < duration);
  const spans: { from: number; to: number; angle: string }[] = [];
  const first = cuts[0];
  if (!first || first.at > 100) spans.push({ from: 0, to: Math.round(((first?.at ?? duration * 1000) / 1000) * fps), angle: fallback });
  cuts.forEach((c, i) => {
    const from = spans.length === 0 ? 0 : Math.round((c.at / 1000) * fps);
    const next = cuts[i + 1];
    const to = next ? Math.round((next.at / 1000) * fps) : total;
    if (to - from >= 1) spans.push({ from, to, angle: angleFor(c.id, c.at / 1000) });
  });
  // Make the spans touch, and join a camera to itself.
  const joined: typeof spans = [];
  for (const sp of spans) {
    const last = joined[joined.length - 1];
    if (last) sp.from = last.to;
    if (sp.to <= sp.from) continue;
    if (last && last.angle === sp.angle) last.to = sp.to;
    else joined.push({ ...sp });
  }
  const v1 = seq.tracks[0] as Track;
  const clips: Clip[] = [];
  for (const sp of joined) {
    const link = uid('l');
    const a = angles.find((x) => x.id === sp.angle);
    const clip = newClip(v1.id, sp.from, sp.to - sp.from, { kind: 'multicam', group: group.id, angle: sp.angle, in: sp.from / fps }, a?.name ?? 'Camera');
    clip.link = link;
    clips.push(clip);
    mics.forEach((m, i) => {
      const t = audio[i] as Track;
      const c = newClip(t.id, sp.from, sp.to - sp.from, { kind: 'media', media: m.item.id, in: sp.from / fps - m.offset }, m.item.name);
      c.link = link;
      clips.push(c);
    });
  }
  // Sound that starts after the event began: the part before it is silence.
  seq.clips = clips.map((c) => (c.source.kind === 'media' && c.source.in < 0 ? fixLead(c, fps) : c)).filter((c) => c.length > 0);
  return { kind: 'lumora-edit', version: 2, name: event.name || 'Event', eventPath, media: items, bins, groups: [group], sequences: [seq], open: seq.id };
}

/** A sound clip that starts before its file does: it begins where the file begins. */
function fixLead(c: Clip, fps: number): Clip {
  if (c.source.kind !== 'media') return c;
  const lead = Math.ceil(-c.source.in * fps);
  if (lead >= c.length) return { ...c, length: 0 };
  return { ...c, start: c.start + lead, length: c.length - lead, source: { ...c.source, in: c.source.in + lead / fps } };
}

/** Add media to the sequence at a frame (its sound comes too, linked). */
export function addMedia(
  p: Project,
  mediaId: string,
  at: number,
  mode: 'insert' | 'overwrite',
  video?: string,
  audio?: string,
  range?: { in: number; out: number },
): Project {
  const s = current(p);
  const m = p.media.find((x) => x.id === mediaId);
  if (!m) return p;
  const fps = rate(s);
  const from = range?.in ?? 0;
  const to = range?.out ?? (m.kind === 'image' ? STILL_SECONDS : m.duration);
  const length = Math.max(1, Math.round((to - from) * fps));
  const vTrack = video ?? s.tracks.find((t) => t.kind === 'video' && !t.locked)?.id;
  const aTrack = audio ?? s.tracks.find((t) => t.kind === 'audio' && !t.locked)?.id;
  const link = m.hasVideo && m.hasAudio ? uid('l') : null;
  const clips: Clip[] = [];
  if (m.hasVideo && vTrack) clips.push({ ...newClip(vTrack, at, length, { kind: 'media', media: m.id, in: m.kind === 'image' ? 0 : from }, m.name), link });
  if (m.hasAudio && aTrack) clips.push({ ...newClip(aTrack, at, length, { kind: 'media', media: m.id, in: from }, m.name), link });
  // A picture of another size fills the frame the way it would be shown.
  return placeClips(p, clips, mode);
}

/** A new text clip at a frame on the lowest free video track above V1. */
export function addText(p: Project, at: number, length: number, preset: Partial<typeof DEFAULT_TEXT> = {}): { project: Project; id: string } {
  const s = current(p);
  const video = s.tracks.filter((t) => t.kind === 'video');
  const freeTrack =
    video.slice(1).find((t) => !t.locked && !s.clips.some((c) => c.track === t.id && c.start < at + length && c.start + c.length > at)) ??
    video[video.length - 1];
  if (!freeTrack) return { project: p, id: '' };
  const clip = newClip(
    freeTrack.id,
    at,
    length,
    { kind: 'text', text: { ...DEFAULT_TEXT, ...preset } },
    (preset.text ?? DEFAULT_TEXT.text).split('\n')[0] ?? 'Text',
  );
  return { project: placeClips(p, [clip], 'overwrite'), id: clip.id };
}

export function addGenerated(p: Project, at: number, length: number, kind: 'color' | 'adjustment', color = '#000000'): { project: Project; id: string } {
  const s = current(p);
  const video = s.tracks.filter((t) => t.kind === 'video');
  const freeTrack =
    (kind === 'color' ? video : video.slice(1)).find(
      (t) => !t.locked && !s.clips.some((c) => c.track === t.id && c.start < at + length && c.start + c.length > at),
    ) ?? video[video.length - 1];
  if (!freeTrack) return { project: p, id: '' };
  const clip = newClip(
    freeTrack.id,
    at,
    length,
    kind === 'color' ? { kind: 'color', color } : { kind: 'adjustment' },
    kind === 'color' ? 'Color' : 'Adjustment layer',
  );
  return { project: placeClips(p, [clip], 'overwrite'), id: clip.id };
}

export const GENERATORS: { gen: string; name: string; settings: Record<string, number | string>; options?: string[] }[] = [
  { gen: 'gradient', name: 'Gradient', settings: { color1: '#1e3a5f', color2: '#d08a48', a: 25, b: 50, c: 50, kind: 0 }, options: ['Straight', 'Round'] },
  { gen: 'noise', name: 'Clouds (noise)', settings: { color1: '#0e1a2a', color2: '#4fb3bf', a: 30, b: 30, c: 50 } },
  {
    gen: 'particles',
    name: 'Particles',
    settings: { color1: '#ffffff', color2: '#ffd27a', a: 50, b: 30, c: 30, kind: 0 },
    options: ['Snow', 'Sparks', 'Bokeh', 'Confetti', 'Dust'],
  },
  { gen: 'lightleak', name: 'Light leak', settings: { color1: '#ff8a3d', color2: '#ffd27a', a: 60, b: 50, c: 40 } },
  { gen: 'bars', name: 'Color bars', settings: {} },
];

/** A made picture (gradient, noise, particles…) on the first free track above the pictures. */
export function addGenerator(
  p: Project,
  at: number,
  length: number,
  gen: string,
  settings: Record<string, number | string> = {},
): { project: Project; id: string } {
  const def = GENERATORS.find((g) => g.gen === gen);
  const s = current(p);
  const video = s.tracks.filter((t) => t.kind === 'video');
  const overlay = gen === 'particles' || gen === 'lightleak';
  const freeTrack =
    (overlay ? video.slice(1) : video).find((t) => !t.locked && !s.clips.some((c) => c.track === t.id && c.start < at + length && c.start + c.length > at)) ??
    video[video.length - 1];
  if (!freeTrack) return { project: p, id: '' };
  const clip = newClip(freeTrack.id, at, length, { kind: 'generator', gen, settings: { ...(def?.settings ?? {}), ...settings } }, def?.name ?? 'Generator');
  if (gen === 'lightleak') clip.motion.blend = 'screen';
  return { project: placeClips(p, [clip], 'overwrite'), id: clip.id };
}

export function addSequence(p: Project, name: string, width: number, height: number, fps: number): Project {
  const seq = newSequence(name, width, height, fps);
  return { ...p, sequences: [...p.sequences, seq], open: seq.id };
}

export function updateSequence(
  p: Project,
  change: Partial<Pick<Sequence, 'name' | 'width' | 'height' | 'fps' | 'background' | 'inPoint' | 'outPoint' | 'playhead'>>,
): Project {
  return editSeq(p, (s) => {
    if (change.fps && change.fps !== s.fps) {
      // Clips keep their time in seconds at the new frame rate.
      const k = change.fps / s.fps;
      const conv = (f: number) => Math.round(f * k);
      return {
        ...s,
        ...change,
        clips: s.clips.map((c) => ({ ...c, start: conv(c.start), length: Math.max(1, conv(c.length)) })),
        markers: s.markers.map((m) => ({ ...m, at: conv(m.at) })),
        inPoint: s.inPoint === null ? null : conv(s.inPoint),
        outPoint: s.outPoint === null ? null : conv(s.outPoint),
        playhead: conv(s.playhead),
      };
    }
    return { ...s, ...change };
  });
}

// ---- Older projects (Lumora Edit's first version) ----

interface V1 {
  kind: 'lumora-edit';
  version?: 1;
  name: string;
  eventPath: string;
  startedAt: number;
  durationMs: number;
  angles: {
    id: string;
    name: string;
    path: string;
    startMs: number;
    durationMs: number;
    offsetMs: number;
    live: boolean;
    color: string;
    width: number;
    height: number;
  }[];
  tracks: {
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
  }[];
  clips: { id: string; angle: string; in: number; out: number; fade: number }[];
  titles?: { id: string; at: number; length: number; text: string; sub: string; style: 'lower' | 'center' | 'corner' }[];
}

/** Open a project from any version of Lumora Edit. */
export function readProject(text: string): Project {
  const raw = JSON.parse(text) as Project | V1;
  if (raw?.kind !== 'lumora-edit') throw new Error('This is not a Lumora Edit project.');
  if (raw.version === 2) {
    const p = raw as Project;
    if (!Array.isArray(p.sequences) || p.sequences.length === 0) throw new Error('This Lumora Edit project is damaged.');
    return p;
  }
  return fromV1(raw as V1);
}

function fromV1(v: V1): Project {
  const media: MediaItem[] = [];
  const mediaFor = (path: string, name: string, ms: number, video: boolean, w = 1920, h = 1080): MediaItem => {
    const have = media.find((m) => m.path === path);
    if (have) {
      if (video) have.hasVideo = true;
      else have.hasAudio = true;
      return have;
    }
    const m: MediaItem = {
      id: uid('m'),
      name,
      path,
      proxy: null,
      kind: video ? 'video' : 'audio',
      duration: ms / 1000,
      width: w,
      height: h,
      fps: 30,
      hasVideo: video,
      hasAudio: !video,
      bin: null,
    };
    media.push(m);
    return m;
  };
  const angles: Angle[] = v.angles.map((a) => ({
    id: a.id,
    name: a.name,
    media: mediaFor(a.path, a.name, a.durationMs, true, a.width, a.height).id,
    offset: (a.startMs + a.offsetMs) / 1000,
    color: a.color,
    live: a.live,
  }));
  const group: MulticamGroup = { id: uid('g'), name: v.name, duration: v.durationMs / 1000, angles, startedAt: v.startedAt };
  const seq = newSequence(v.name, 1920, 1080, 30, 3, Math.max(1, v.tracks.length));
  const fps = 30;
  const audio = seq.tracks.filter((t) => t.kind === 'audio');
  const mics = v.tracks.map((t, i) => {
    const track = audio[i] as Track;
    track.name = t.name;
    track.off = t.muted;
    track.solo = t.solo;
    track.volume = t.gainDb;
    return { track, item: mediaFor(t.path, t.name, t.durationMs, false), offset: (t.startMs + t.offsetMs) / 1000 };
  });
  let at = 0;
  const clips: Clip[] = [];
  const filmStart = new Map<string, number>();
  for (const c of v.clips) {
    const length = Math.max(1, Math.round(((c.out - c.in) / 1000) * fps));
    const link = uid('l');
    const clip = newClip(
      seq.tracks[0]?.id ?? '',
      at,
      length,
      { kind: 'multicam', group: group.id, angle: c.angle, in: c.in / 1000 },
      angles.find((a) => a.id === c.angle)?.name ?? 'Camera',
    );
    clip.link = link;
    if (c.fade > 0) clip.tIn = { type: 'dissolve', length: Math.round((c.fade / 1000) * fps) };
    clips.push(clip);
    filmStart.set(c.id, at);
    for (const m of mics)
      clips.push({ ...newClip(m.track.id, at, length, { kind: 'media', media: m.item.id, in: c.in / 1000 - m.offset }, m.item.name), link });
    at += length;
  }
  // Titles were kept at their moment of the event: they go where that moment is now.
  for (const t of v.titles ?? []) {
    let start: number | null = null;
    let pos = 0;
    for (const c of v.clips) {
      if (t.at >= c.in && t.at < c.out) {
        start = pos + Math.round(((t.at - c.in) / 1000) * fps);
        break;
      }
      pos += Math.max(1, Math.round(((c.out - c.in) / 1000) * fps));
    }
    if (start === null) continue;
    const text = t.sub ? `${t.text}\n${t.sub}` : t.text;
    const preset =
      t.style === 'lower'
        ? { align: 'left' as const, px: 0.08, py: 0.8, size: 64, box: true }
        : t.style === 'corner'
          ? { align: 'right' as const, px: 0.94, py: 0.1, size: 44 }
          : {};
    clips.push(
      newClip(seq.tracks[1]?.id ?? '', start, Math.round((t.length / 1000) * fps), { kind: 'text', text: { ...DEFAULT_TEXT, ...preset, text } }, t.text),
    );
  }
  seq.clips = clips.map((c) => (c.source.kind === 'media' && c.source.in < 0 ? fixLead(c, fps) : c)).filter((c) => c.length > 0);
  return { kind: 'lumora-edit', version: 2, name: v.name, eventPath: v.eventPath, media, bins: [], groups: [group], sequences: [seq], open: seq.id };
}

/** The time of day a frame of an event was filmed, e.g. "7:42 PM". */
export function clockAt(p: Project, c: Clip | undefined, frame: number, fps: number, seconds = false): string {
  if (!c || c.source.kind !== 'multicam') return '';
  const src = c.source;
  const g = p.groups.find((x) => x.id === src.group);
  if (!g?.startedAt) return '';
  const t = g.startedAt + (src.in + ((frame - c.start) * c.speed) / fps) * 1000;
  return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: true });
}

/** "01:02:03:04" (hours, minutes, seconds, frames). */
export function timecode(frame: number, fps: number): string {
  const f = Math.max(0, Math.round(frame));
  const base = Math.round(fps);
  const ff = f % base;
  const total = Math.floor(f / base);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(Math.floor(total / 3600))}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}:${two(ff)}`;
}

/** "1:02:03" or "2:03", for lengths. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Read a typed timecode ("1:02:03:04", "2:03", "90" seconds, "+10" frames) as a frame. */
export function parseTimecode(text: string, fps: number, from: number): number | null {
  const t = text.trim();
  if (/^[+-]\d+$/.test(t)) return Math.max(0, from + Number(t));
  const parts = t.split(/[:;.]/).map((x) => Number(x));
  if (parts.some((x) => !Number.isFinite(x))) return null;
  const base = Math.round(fps);
  if (parts.length === 4) {
    const [h, m, s, f] = parts as [number, number, number, number];
    return ((h * 60 + m) * 60 + s) * base + f;
  }
  if (parts.length === 3) {
    const [h, m, s] = parts as [number, number, number];
    return Math.round(((h * 60 + m) * 60 + s) * fps);
  }
  if (parts.length === 2) {
    const [m, s] = parts as [number, number];
    return Math.round((m * 60 + s) * fps);
  }
  return Math.round((parts[0] ?? 0) * fps);
}
