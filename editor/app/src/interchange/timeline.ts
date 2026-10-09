// A timeline in the form every interchange format shares (FCPXML, Premiere /
// FCP7 XML, CMX3600 EDL, OpenTimelineIO): tracks of clips that point at files,
// placed in whole frames. A Lumora sequence is turned into one of these to be
// written out, and one read from another editor is turned back into a
// sequence, with its files found again by name.
import { isAnim, valueAt } from '../model/anim';
import { mediaOf, rate } from '../model/seq';
import {
  DEFAULT_TEXT,
  exactRate,
  newClip,
  newSequence,
  newTrack,
  uid,
  type Clip,
  type MediaItem,
  type Project,
  type Sequence,
  type Track,
} from '../model/types';

/** A file a clip plays from. */
export interface XFile {
  /** The file's name with its ending ("Interview A.mov"): how it is found again. */
  name: string;
  /** Where it was on the computer that wrote the timeline. */
  path: string;
  /** Seconds (0: not known). */
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface XClip {
  name: string;
  /** null: made in the editor (a title or a color), not from a file. */
  file: XFile | null;
  /** Sequence frames. */
  start: number;
  length: number;
  /** Seconds into the file where the clip begins. */
  srcIn: number;
  /** 1 is normal speed. */
  speed: number;
  reverse: boolean;
  enabled: boolean;
  /** A dissolve into this clip (frames, centered on its start). */
  dissolveIn?: number;
  /** A title's words. */
  text?: string;
  /** Volume (dB) when it stays the same. */
  gain?: number;
}

export interface XTrack {
  kind: 'video' | 'audio';
  name: string;
  clips: XClip[];
}

export interface XMarker {
  /** Sequence frames. */
  at: number;
  length: number;
  name: string;
  color?: string;
}

export interface XTimeline {
  name: string;
  width: number;
  height: number;
  /** The frame rate as people say it (29.97, 24, 25…). */
  fps: number;
  /** Video tracks first (V1 lowest), then sound. */
  tracks: XTrack[];
  markers: XMarker[];
  /** What didn't carry over, in plain words. */
  notes: string[];
}

// ---------------------------------------------------------------- files and URLs

/** The last part of a path ("C:\Clips\A.mov" or "/Users/x/A.mov" → "A.mov"). */
export const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** A path as a file URL ("file:///C:/Clips/A%20B.mov"); `host` adds "localhost" as FCP7 XML expects. */
export function fileUrl(path: string, host = false): string {
  let p = path.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(p)) p = `/${p}`;
  else if (p.startsWith('//')) return `file:${p.split('/').map(encodeSegment).join('/')}`;
  const encoded = p
    .split('/')
    .map((s, i) => (i === 1 && /^[A-Za-z]:$/.test(s) ? s : encodeSegment(s)))
    .join('/');
  return `file://${host ? 'localhost' : ''}${encoded}`;
}

const encodeSegment = (s: string): string => encodeURIComponent(s).replace(/%2C/g, ',').replace(/%40/g, '@').replace(/%2B/g, '+');

/** A file URL (or a plain path) back to a path. */
export function pathFromUrl(url: string): string {
  const u = url.trim();
  if (!/^file:/i.test(u)) return u;
  let rest = u.replace(/^file:\/\/localhost/i, 'file://').replace(/^file:(\/\/)?/i, '');
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    decoded = rest;
  }
  rest = decoded;
  // "/C:/Clips/A.mov" → "C:/Clips/A.mov".
  if (/^\/[A-Za-z]:[\\/]/.test(rest)) return rest.slice(1);
  // A network share ("file://server/share/A.mov").
  if (!rest.startsWith('/')) return `//${rest}`;
  return rest;
}

// ---------------------------------------------------------------- frames and timecode

/** Frame rates read from files are often a hair off: the standard one they mean. */
export function standardFps(fps: number): number {
  const known = [23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 119.88, 120];
  const near = known.find((k) => Math.abs(k - fps) < 0.02);
  return near ?? Math.round(fps * 1000) / 1000;
}

/** 29.97 and 59.94 use drop-frame timecode in broadcast EDLs. */
export const dropFrameRate = (fps: number): boolean => Math.abs(fps - 29.97) < 0.01 || Math.abs(fps - 59.94) < 0.01;

/** "HH:MM:SS:FF" (or "HH:MM:SS;FF" with drop frame) for a frame count. */
export function framesToTc(frames: number, fps: number, drop = false): string {
  const base = Math.round(fps);
  let f = Math.max(0, Math.round(frames));
  if (drop && dropFrameRate(fps)) {
    const dropN = base === 60 ? 4 : 2;
    const per10 = base * 600 - dropN * 9;
    const tens = Math.floor(f / per10);
    const rem = f % per10;
    f += dropN * 9 * tens + (rem > dropN ? dropN * Math.floor((rem - dropN) / (base * 60 - dropN)) : 0);
  }
  const two = (n: number) => String(n).padStart(2, '0');
  const ff = f % base;
  const s = Math.floor(f / base);
  return `${two(Math.floor(s / 3600) % 24)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}${drop && dropFrameRate(fps) ? ';' : ':'}${two(ff)}`;
}

/** A timecode back to a frame count (drop frame when it has a ";" or `drop` says so). */
export function tcToFrames(tc: string, fps: number, drop = false): number {
  const m = /^(\d{1,2})[:;.](\d{2})[:;.](\d{2})([:;.,])(\d{2,3})$/.exec(tc.trim());
  if (!m) throw new Error(`“${tc}” is not a timecode.`);
  const [h, mi, s, f] = [m[1], m[2], m[3], m[5]].map(Number) as [number, number, number, number];
  const base = Math.round(fps);
  const isDrop = (drop || m[4] === ';' || m[4] === ',') && dropFrameRate(fps);
  const total = ((h * 60 + mi) * 60 + s) * base + f;
  if (!isDrop) return total;
  const dropN = base === 60 ? 4 : 2;
  const minutes = h * 60 + mi;
  return total - dropN * (minutes - Math.floor(minutes / 10));
}

// ---------------------------------------------------------------- from a sequence

const gainOf = (c: Clip): number | undefined => {
  if (isAnim(c.gain)) return undefined;
  return c.gain === 0 ? undefined : c.gain;
};

/** A Lumora sequence in the shared form, with notes on what other editors won't get. */
export function fromSequence(p: Project, s: Sequence): XTimeline {
  const fps = rate(s);
  const notes = new Map<string, number>();
  const note = (what: string) => notes.set(what, (notes.get(what) ?? 0) + 1);
  const tracks: XTrack[] = [];
  const ordered = [...s.tracks.filter((t) => t.kind === 'video' && !t.captions), ...s.tracks.filter((t) => t.kind === 'audio')];
  if (s.tracks.some((t) => t.captions)) note('captions track (save captions as .srt from the Captions menu)');
  // The mix's stages stay in Studio: the clips' own volume lines travel, the tracks' processing doesn't.
  for (const t of s.tracks)
    if (t.kind === 'audio' && (t.fx?.some((e) => e.on) || t.volumeLine?.length))
      note('sound track with EQ, dynamics or recorded fader moves (they stay in Lumora Studio)');
  if (s.mix?.buses.length) note('bus (tracks go straight into the mix)');
  for (const t of ordered) {
    const clips: XClip[] = [];
    for (const c of s.clips.filter((x) => x.track === t.id).sort((a, b) => a.start - b.start)) {
      const base = { name: c.name, start: c.start, length: c.length, enabled: c.enabled, speed: c.speed, reverse: c.reverse };
      const tIn = c.tIn ? { dissolveIn: c.tIn.length } : {};
      const gain = t.kind === 'audio' ? gainOf(c) : undefined;
      if (c.source.kind === 'text' && t.kind === 'video') {
        clips.push({ ...base, file: null, srcIn: 0, text: c.source.text.text, ...tIn });
        note('title (its words carry over, not its look)');
        continue;
      }
      const m = mediaOf(p, c);
      if (!m || !('in' in c.source)) {
        note(c.source.kind === 'sequence' ? 'nested sequence (left as a gap)' : `${c.source.kind} clip (left as a gap)`);
        continue;
      }
      if (c.remap) note('speed ramp (the clip keeps its overall speed)');
      if (c.effects.some((e) => e.on)) note('clip with effects or a grade (effects stay in Lumora Studio)');
      clips.push({
        ...base,
        file: {
          name: fileNameOf(m.path),
          path: m.path,
          duration: m.duration,
          width: m.width,
          height: m.height,
          fps: m.fps,
          hasVideo: m.hasVideo,
          hasAudio: m.hasAudio,
        },
        srcIn: c.source.in,
        ...tIn,
        ...(gain !== undefined ? { gain } : {}),
      });
    }
    tracks.push({ kind: t.kind, name: t.name, clips });
  }
  return {
    name: s.name,
    width: s.width,
    height: s.height,
    fps: s.fps,
    tracks,
    markers: s.markers.map((m) => ({ at: m.at, length: m.length, name: m.name, color: m.color })),
    notes: [...notes].map(([what, n]) => `${n} × ${what}`),
  };
}

/** Every file the timeline uses, once each (by name). */
export function filesOf(t: XTimeline): XFile[] {
  const seen = new Map<string, XFile>();
  for (const tr of t.tracks) for (const c of tr.clips) if (c.file && !seen.has(c.file.name.toLowerCase())) seen.set(c.file.name.toLowerCase(), c.file);
  return [...seen.values()];
}

/** How many frames a timeline runs. */
export const timelineLength = (t: XTimeline): number => t.tracks.reduce((m, tr) => tr.clips.reduce((n, c) => Math.max(n, c.start + c.length), m), 0);

// ---------------------------------------------------------------- into a sequence

export interface ImportReport {
  clips: number;
  /** Files already in the project (or found on disk) and linked. */
  linked: string[];
  /** Files not found: they are in the project as missing (Find missing files links them). */
  missing: string[];
  notes: string[];
}

const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|wmv|mpg|mpeg|mts|m2ts|ts|mxf|flv|3gp|r3d|braw|ari|dng)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|wma|aiff|aif|bwf)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif|psd|exr|dpx)$/i;

/**
 * Find the project's media item for a file: the same path, or failing that the
 * same file name (case doesn't matter), or a path found on this computer.
 */
export function relink(media: readonly MediaItem[], f: XFile, found: ReadonlyMap<string, string> = new Map()): MediaItem | string | null {
  const samePath = media.find((m) => m.path.replace(/\\/g, '/').toLowerCase() === f.path.replace(/\\/g, '/').toLowerCase());
  if (samePath) return samePath;
  const name = f.name.toLowerCase();
  const sameName = media.find((m) => fileNameOf(m.path).toLowerCase() === name);
  if (sameName) return sameName;
  return found.get(name) ?? null;
}

/**
 * Make a timeline into a new sequence of the project (opened). Its files are
 * linked to the project's media by path or file name; `found` maps file names
 * (lowercase) to paths found on this computer and already imported. Files not
 * found are added as missing media.
 */
export function toSequence(p: Project, t: XTimeline, found: ReadonlyMap<string, string> = new Map()): { project: Project; seq: string; report: ImportReport } {
  const media = [...p.media];
  const linked = new Set<string>();
  const missing = new Set<string>();
  const byName = new Map<string, MediaItem>();
  const itemFor = (f: XFile, kind: 'video' | 'audio'): MediaItem => {
    const key = f.name.toLowerCase();
    const have = byName.get(key);
    if (have) return have;
    const r = relink(media, f, found);
    let item: MediaItem;
    if (r && typeof r !== 'string') {
      item = r;
      linked.add(f.name);
    } else {
      const path = typeof r === 'string' ? r : f.path;
      const image = IMAGE_EXT.test(f.name);
      const audioOnly = AUDIO_EXT.test(f.name) || (!VIDEO_EXT.test(f.name) && !image && kind === 'audio' && !f.hasVideo);
      item = {
        id: uid('m'),
        name: f.name.replace(/\.[^.]+$/, ''),
        path,
        proxy: null,
        kind: image ? 'image' : audioOnly ? 'audio' : 'video',
        duration: image ? 0 : f.duration,
        width: f.width || t.width,
        height: f.height || t.height,
        fps: f.fps || t.fps,
        hasVideo: !audioOnly,
        hasAudio: !image && (f.hasAudio || audioOnly),
        bin: null,
        addedAt: Date.now(),
        ...(typeof r === 'string' ? {} : { missing: true }),
      };
      media.push(item);
      if (typeof r === 'string') linked.add(f.name);
      else missing.add(f.name);
    }
    byName.set(key, item);
    return item;
  };

  const fps = standardFps(t.fps) || 30;
  const videoTracks = t.tracks.filter((x) => x.kind === 'video');
  const audioTracks = t.tracks.filter((x) => x.kind === 'audio');
  const seq = newSequence(t.name || 'Imported timeline', t.width || 1920, t.height || 1080, fps, 0, 0);
  const tracks: Track[] = [];
  const clips: Clip[] = [];
  const notes = [...t.notes];
  let count = 0;
  const longest = new Map<string, number>();
  const place = (xt: XTrack, index: number) => {
    const track = newTrack(xt.kind, index);
    if (xt.name && !/^(V|A)\d+$/i.test(xt.name)) track.name = xt.name;
    tracks.push(track);
    for (const c of xt.clips) {
      if (c.length <= 0) continue;
      let clip: Clip;
      if (!c.file) {
        if (xt.kind !== 'video') continue;
        clip = newClip(track.id, c.start, c.length, { kind: 'text', text: { ...DEFAULT_TEXT, text: c.text || c.name || 'Title' } }, c.name || 'Title');
      } else {
        const m = itemFor(c.file, xt.kind);
        clip = newClip(track.id, c.start, c.length, { kind: 'media', media: m.id, in: Math.max(0, c.srcIn) }, c.name || m.name);
        const used = c.srcIn + (c.length * Math.abs(c.speed || 1)) / exactRate(fps);
        if (m.missing || m.duration === 0) longest.set(m.id, Math.max(longest.get(m.id) ?? 0, used));
      }
      clip.speed = Math.abs(c.speed) > 0 ? Math.abs(c.speed) : 1;
      clip.reverse = c.reverse || c.speed < 0;
      clip.enabled = c.enabled;
      if (c.dissolveIn && c.dissolveIn > 0) clip.tIn = { type: xt.kind === 'video' ? 'dissolve' : 'crossfade', length: Math.round(c.dissolveIn) };
      if (c.gain !== undefined && xt.kind === 'audio') clip.gain = c.gain;
      clips.push(clip);
      count += 1;
    }
  };
  videoTracks.forEach((x, i) => place(x, i + 1));
  if (!videoTracks.length) tracks.push(newTrack('video', 1));
  audioTracks.forEach((x, i) => place(x, i + 1));
  if (!audioTracks.length) tracks.push(newTrack('audio', 1));

  // Picture and its sound from the same file, at the same place, move together.
  for (const v of clips) {
    if (v.source.kind !== 'media' || v.link) continue;
    const src = v.source;
    const vt = tracks.find((x) => x.id === v.track);
    if (vt?.kind !== 'video') continue;
    const partners = clips.filter(
      (a) =>
        !a.link &&
        a.source.kind === 'media' &&
        a.source.media === src.media &&
        a.start === v.start &&
        a.length === v.length &&
        tracks.find((x) => x.id === a.track)?.kind === 'audio',
    );
    if (!partners.length) continue;
    const link = uid('l');
    v.link = link;
    for (const a of partners) a.link = link;
  }

  // Missing files are as long as the longest use of them (so the clips can be trimmed until they're found).
  for (let i = 0; i < media.length; i++) {
    const m = media[i] as MediaItem;
    const need = longest.get(m.id);
    if (need && m.duration < need) media[i] = { ...m, duration: need };
  }

  const markers = t.markers.map((m) => ({
    id: uid('k'),
    at: Math.max(0, Math.round(m.at)),
    length: Math.max(0, Math.round(m.length)),
    name: m.name,
    color: m.color ?? '#d9a441',
  }));
  const s: Sequence = { ...seq, tracks, clips, markers };
  const project: Project = { ...p, media, sequences: [...p.sequences, s], open: s.id };
  return { project, seq: s.id, report: { clips: count, linked: [...linked], missing: [...missing], notes } };
}

/** The volume a gain line has at the clip's start (for formats that only take one number). */
export const gainAtStart = (c: Clip): number => valueAt(c.gain, 0);

// ---------------------------------------------------------------- XML helpers

/** Text made safe inside XML. */
export const xmlEscape = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;'));

export function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text.replace(/^\uFEFF/, ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('This file is not readable XML.');
  return doc;
}

/** The element's own child elements (optionally only those with these names). */
export const kids = (el: Element, ...names: string[]): Element[] => Array.from(el.children).filter((c) => !names.length || names.includes(c.tagName));
export const kid = (el: Element | null | undefined, name: string): Element | null =>
  el ? (Array.from(el.children).find((c) => c.tagName === name) ?? null) : null;
export const kidText = (el: Element | null | undefined, name: string): string => kid(el, name)?.textContent?.trim() ?? '';
