// OpenTimelineIO (.otio): the open, JSON timeline format from the Academy
// Software Foundation. DaVinci Resolve, Premiere (through its plug-in),
// Avid, Hiero / Nuke Studio and most pipeline tools read and write it.
import { fileNameOf, fileUrl, pathFromUrl, standardFps, type XClip, type XFile, type XMarker, type XTimeline, type XTrack } from './timeline';

type Json = Record<string, unknown>;

const exactOf = (fps: number) => (Math.abs(fps - Math.round(fps)) > 0.001 ? (Math.round(fps) * 1000) / 1001 : fps);
const rt = (value: number, rate: number): Json => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value });
const range = (start: number, duration: number, rate: number): Json => ({
  OTIO_SCHEMA: 'TimeRange.1',
  start_time: rt(start, rate),
  duration: rt(duration, rate),
});

const COLORS: [string, string][] = [
  ['RED', '#c0453a'],
  ['ORANGE', '#d9822b'],
  ['YELLOW', '#d9a441'],
  ['GREEN', '#3f8f5a'],
  ['CYAN', '#3d8f99'],
  ['BLUE', '#4a6fb5'],
  ['PURPLE', '#7a5bb0'],
  ['MAGENTA', '#a8507a'],
  ['WHITE', '#e6e6e6'],
  ['BLACK', '#202020'],
];
function colorName(hex: string | undefined): string {
  if (!hex) return 'RED';
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return 'RED';
  const c = [m[1], m[2], m[3]].map((x) => parseInt(x as string, 16));
  let best = 'RED';
  let d = Infinity;
  for (const [name, h] of COLORS) {
    const k = /^#(..)(..)(..)/.exec(h) as RegExpExecArray;
    const e = [k[1], k[2], k[3]].reduce((s, x, i) => s + (parseInt(x as string, 16) - (c[i] as number)) ** 2, 0);
    if (e < d) {
      d = e;
      best = name;
    }
  }
  return best;
}

/** Write a timeline as OpenTimelineIO JSON. */
export function writeOtio(t: XTimeline): string {
  const rate = exactOf(t.fps);
  const marker = (m: XMarker): Json => ({
    OTIO_SCHEMA: 'Marker.2',
    metadata: {},
    name: m.name,
    color: colorName(m.color),
    marked_range: range(m.at, m.length, rate),
    comment: '',
  });
  const track = (tr: XTrack): Json => {
    const children: Json[] = [];
    let at = 0;
    for (const c of [...tr.clips].sort((a, b) => a.start - b.start)) {
      if (c.start < at) continue;
      if (c.start > at)
        children.push({ OTIO_SCHEMA: 'Gap.1', metadata: {}, name: '', source_range: range(0, c.start - at, rate), effects: [], markers: [], enabled: true });
      if (c.dissolveIn && children.length && tr.kind === 'video') {
        const h = Math.floor(c.dissolveIn / 2);
        children.push({
          OTIO_SCHEMA: 'Transition.1',
          metadata: {},
          name: 'Cross Dissolve',
          transition_type: 'SMPTE_Dissolve',
          in_offset: rt(h, rate),
          out_offset: rt(c.dissolveIn - h, rate),
        });
      }
      const speed = Math.abs(c.speed || 1) * (c.reverse ? -1 : 1);
      const srcFrames = Math.round(c.srcIn * rate);
      const effects: Json[] =
        speed !== 1 ? [{ OTIO_SCHEMA: 'LinearTimeWarp.1', metadata: {}, name: '', effect_name: 'LinearTimeWarp', time_scalar: speed }] : [];
      if (c.file) {
        const f = c.file;
        children.push({
          OTIO_SCHEMA: 'Clip.2',
          metadata: c.gain !== undefined ? { lumora: { gain: c.gain } } : {},
          name: c.name,
          source_range: range(srcFrames, c.length, rate),
          effects,
          markers: [],
          enabled: c.enabled,
          media_references: {
            DEFAULT_MEDIA: {
              OTIO_SCHEMA: 'ExternalReference.1',
              metadata: { lumora: { width: f.width, height: f.height, hasVideo: f.hasVideo, hasAudio: f.hasAudio } },
              name: f.name,
              available_range: f.duration > 0 ? range(0, Math.round(f.duration * exactOf(f.fps || t.fps)), exactOf(f.fps || t.fps)) : null,
              available_image_bounds: null,
              target_url: fileUrl(f.path),
            },
          },
          active_media_reference_key: 'DEFAULT_MEDIA',
        });
      } else
        children.push({
          OTIO_SCHEMA: 'Clip.2',
          metadata: { lumora: { text: c.text ?? c.name } },
          name: c.name,
          source_range: range(0, c.length, rate),
          effects: [],
          markers: [],
          enabled: c.enabled,
          media_references: {
            DEFAULT_MEDIA: { OTIO_SCHEMA: 'GeneratorReference.1', metadata: {}, name: c.name, generator_kind: 'Title', parameters: {}, available_range: null },
          },
          active_media_reference_key: 'DEFAULT_MEDIA',
        });
      at = c.start + c.length;
    }
    return {
      OTIO_SCHEMA: 'Track.1',
      metadata: {},
      name: tr.name,
      source_range: null,
      effects: [],
      markers: [],
      enabled: true,
      children,
      kind: tr.kind === 'video' ? 'Video' : 'Audio',
    };
  };
  const out: Json = {
    OTIO_SCHEMA: 'Timeline.1',
    metadata: { lumora: { width: t.width, height: t.height, fps: t.fps } },
    name: t.name,
    global_start_time: rt(0, rate),
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      metadata: {},
      name: 'tracks',
      source_range: null,
      effects: [],
      markers: t.markers.map(marker),
      enabled: true,
      children: t.tracks.map(track),
    },
  };
  return `${JSON.stringify(out, null, 4)}\n`;
}

// ---------------------------------------------------------------- reading

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const schema = (v: Json): string => String(v.OTIO_SCHEMA ?? '').replace(/\.\d+$/, '');
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** A RationalTime in seconds. */
const seconds = (v: unknown): number => (isObj(v) && num(v.rate) > 0 ? num(v.value) / num(v.rate) : 0);
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** Read an OpenTimelineIO file. */
export function readOtio(text: string): XTimeline {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('This OpenTimelineIO file is not readable.');
  }
  if (!isObj(data)) throw new Error('This is not an OpenTimelineIO file.');
  // A file can hold one timeline, or a collection of them (the first is read).
  let tl: Json | undefined = data;
  if (schema(data) === 'SerializableCollection') tl = list(data.children).find((c) => schema(c) === 'Timeline');
  if (!tl || schema(tl) !== 'Timeline') throw new Error('There is no timeline in this OpenTimelineIO file.');
  const stack = isObj(tl.tracks) ? tl.tracks : null;
  if (!stack) throw new Error('This timeline has no tracks.');
  const meta = isObj(tl.metadata) && isObj(tl.metadata.lumora) ? tl.metadata.lumora : {};

  // The frame rate: ours, or the rate the first clip counts in.
  let rate = num(meta.fps);
  if (!rate) {
    const findRate = (items: Json[]): number => {
      for (const it of items) {
        const r = isObj(it.source_range) && isObj(it.source_range.duration) ? num(it.source_range.duration.rate) : 0;
        if (r) return r;
        const inner = findRate(list(it.children));
        if (inner) return inner;
      }
      return 0;
    };
    rate = findRate(list(stack.children)) || num(isObj(tl.global_start_time) ? tl.global_start_time.rate : 0) || 24;
  }
  const fps = standardFps(rate);
  const exact = exactOf(fps);
  const fr = (s: number) => Math.round(s * exact);
  const notes = new Map<string, number>();
  const note = (what: string) => notes.set(what, (notes.get(what) ?? 0) + 1);
  // Clip times are in the timeline's own time (Resolve starts at 01:00:00:00).
  const startTime = seconds(tl.global_start_time);

  const tracks: XTrack[] = [];
  let vN = 0;
  let aN = 0;
  for (const tr of list(stack.children)) {
    if (schema(tr) !== 'Track') {
      note('nested stack (left out)');
      continue;
    }
    const kind = String(tr.kind).toLowerCase() === 'audio' ? 'audio' : 'video';
    const clips: XClip[] = [];
    let at = 0;
    let pending: number | undefined;
    const items = list(tr.children);
    items.forEach((it) => {
      const sc = schema(it);
      if (sc === 'Transition') {
        // A transition overlaps the clips on each side without taking time.
        const total = seconds(it.in_offset) + seconds(it.out_offset);
        pending = fr(total);
        return;
      }
      const sr = isObj(it.source_range) ? it.source_range : null;
      const durS = sr ? seconds(sr.duration) : 0;
      const startS = sr ? seconds(sr.start_time) : 0;
      if (sc === 'Gap') {
        at += durS;
        return;
      }
      if (sc !== 'Clip') {
        note(sc === 'Stack' || sc === 'Track' ? 'nested clip (left as a gap)' : `${sc} (left as a gap)`);
        at += durS;
        return;
      }
      const refs = isObj(it.media_references) ? it.media_references : null;
      const key = typeof it.active_media_reference_key === 'string' ? it.active_media_reference_key : 'DEFAULT_MEDIA';
      const ref = refs && isObj(refs[key]) ? (refs[key] as Json) : isObj(it.media_reference) ? it.media_reference : null;
      const rs = ref ? schema(ref) : '';
      let speed = 1;
      for (const e of list(it.effects)) {
        if (schema(e) === 'LinearTimeWarp') speed = num(e.time_scalar, 1);
        else if (schema(e) === 'FreezeFrame') speed = 0;
      }
      const start = fr(at);
      const length = fr(at + durS) - start;
      const lumora = isObj(it.metadata) && isObj(it.metadata.lumora) ? it.metadata.lumora : {};
      const base = {
        name: typeof it.name === 'string' ? it.name : '',
        start,
        length,
        speed: Math.abs(speed) || 1,
        reverse: speed < 0,
        enabled: it.enabled !== false,
        ...(pending && kind === 'video' ? { dissolveIn: pending } : {}),
        ...(typeof lumora.gain === 'number' ? { gain: lumora.gain } : {}),
      };
      pending = undefined;
      if (rs === 'ExternalReference' && ref) {
        const path = pathFromUrl(String(ref.target_url ?? ''));
        const avail = isObj(ref.available_range) ? ref.available_range : null;
        const rm = isObj(ref.metadata) && isObj(ref.metadata.lumora) ? ref.metadata.lumora : {};
        const availStart = avail ? seconds(avail.start_time) : 0;
        const fileRate = avail && isObj(avail.duration) ? num(avail.duration.rate) : 0;
        const file: XFile = {
          name: fileNameOf(path) || String(ref.name ?? base.name),
          path,
          duration: avail ? seconds(avail.duration) : 0,
          width: num(rm.width),
          height: num(rm.height),
          fps: fileRate ? standardFps(fileRate) : 0,
          hasVideo: typeof rm.hasVideo === 'boolean' ? rm.hasVideo : kind === 'video',
          hasAudio: typeof rm.hasAudio === 'boolean' ? rm.hasAudio : true,
        };
        // Source times count from the file's own start timecode.
        clips.push({ ...base, name: base.name || file.name.replace(/\.[^.]+$/, ''), file, srcIn: Math.max(0, startS - availStart) });
      } else if (rs === 'GeneratorReference' || typeof lumora.text === 'string') {
        if (kind === 'video') clips.push({ ...base, file: null, srcIn: 0, text: typeof lumora.text === 'string' ? lumora.text : base.name });
      } else note('clip with no file (left as a gap)');
      at += durS;
    });
    if (kind === 'video') vN += 1;
    else aN += 1;
    tracks.push({ kind, name: typeof tr.name === 'string' && tr.name ? tr.name : kind === 'video' ? `V${vN}` : `A${aN}`, clips });
  }
  // Video tracks first.
  tracks.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'video' ? -1 : 1));

  const markers: XMarker[] = [];
  const addMarkers = (ms: unknown) => {
    for (const m of list(ms)) {
      const r = isObj(m.marked_range) ? m.marked_range : null;
      if (!r) continue;
      const hex = COLORS.find(([n]) => n === String(m.color).toUpperCase())?.[1];
      markers.push({
        at: Math.max(0, fr(seconds(r.start_time) - (seconds(r.start_time) >= startTime ? startTime : 0))),
        length: fr(seconds(r.duration)),
        name: String(m.name ?? ''),
        ...(hex ? { color: hex } : {}),
      });
    }
  };
  addMarkers(stack.markers);
  addMarkers(tl.markers);

  return {
    name: typeof tl.name === 'string' && tl.name ? tl.name : 'Imported timeline',
    width: num(meta.width) || 1920,
    height: num(meta.height) || 1080,
    fps,
    tracks,
    markers,
    notes: [...notes].map(([what, n]) => `${n} × ${what}`),
  };
}
