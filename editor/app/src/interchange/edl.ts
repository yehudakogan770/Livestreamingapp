// CMX3600 EDL (.edl): the oldest and plainest edit list, read by every
// editor and online / finishing system. One picture track (V) and up to four
// sound channels (A, A2, A3, A4); each event says which file (by clip name),
// which part of it and where it goes. Record times start at 01:00:00:00.
import { dropFrameRate, fileNameOf, framesToTc, standardFps, tcToFrames, type XClip, type XFile, type XTimeline, type XTrack } from './timeline';

/** EDL reel names are at most 8 letters; “AX” (auxiliary) with the clip name in a comment is what editors expect for files. */
const REEL = 'AX';

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|wma|aiff|aif|bwf)$/i;

interface Ev {
  clip: XClip;
  channel: string;
}

/** Write a timeline as a CMX3600 EDL (V1 and the first four sound tracks). */
export function writeEdl(t: XTimeline): string {
  const fps = t.fps;
  const drop = dropFrameRate(fps);
  const base = Math.round(fps);
  const exact = drop ? (base * 1000) / 1001 : fps;
  const rec0 = tcToFrames('01:00:00:00', fps, drop);
  const tc = (f: number) => framesToTc(f, fps, drop);
  const video = t.tracks.filter((x) => x.kind === 'video');
  const audio = t.tracks.filter((x) => x.kind === 'audio');
  const notes: string[] = [];
  if (video.length > 1 && video.slice(1).some((x) => x.clips.length)) notes.push('only V1 is in the EDL (an EDL has one picture track)');
  if (audio.length > 4 && audio.slice(4).some((x) => x.clips.length)) notes.push('only A1 to A4 are in the EDL');
  const events: Ev[] = [];
  const chan = (tr: XTrack, ch: string) => {
    for (const c of tr.clips) if (c.file && c.enabled) events.push({ clip: c, channel: ch });
  };
  if (video[0]) chan(video[0], 'V');
  audio.slice(0, 4).forEach((tr, i) => chan(tr, i === 0 ? 'A' : `A${i + 1}`));
  events.sort((a, b) => a.clip.start - b.clip.start || (a.channel === 'V' ? -1 : b.channel === 'V' ? 1 : a.channel.localeCompare(b.channel)));

  const lines = [`TITLE: ${t.name.slice(0, 70)}`, `FCM: ${drop ? 'DROP FRAME' : 'NON-DROP FRAME'}`, ''];
  let n = 0;
  const line = (num: number, ch: string, how: string, sIn: number, sOut: number, rIn: number, rOut: number) =>
    `${String(num).padStart(3, '0')}  ${REEL.padEnd(8)} ${ch.padEnd(6)}${how.padEnd(9)}${tc(sIn)} ${tc(sOut)} ${tc(rec0 + rIn)} ${tc(rec0 + rOut)}`;
  const srcFrames = (c: XClip) => Math.round(c.srcIn * exact);
  for (const e of events) {
    const c = e.clip;
    n += 1;
    const speed = Math.abs(c.speed || 1) * (c.reverse ? -1 : 1);
    const span = Math.round(c.length * Math.abs(speed));
    const sIn = srcFrames(c);
    const d = e.channel === 'V' && c.dissolveIn ? Math.round(c.dissolveIn) : 0;
    const prev = d ? events.find((x) => x !== e && x.channel === e.channel && x.clip.start + x.clip.length === c.start) : undefined;
    if (d && prev) {
      // A dissolve: the outgoing clip at the cut, then the incoming one dissolving in.
      const h = Math.floor(d / 2);
      const pc = prev.clip;
      const pOut = srcFrames(pc) + Math.round(pc.length * Math.abs(pc.speed || 1));
      lines.push(line(n, e.channel, 'C', pOut - h, pOut - h, c.start - h, c.start - h));
      lines.push(line(n, e.channel, `D    ${String(d).padStart(3, '0')}`.slice(0, 9), sIn - h, sIn + span, c.start - h, c.start + c.length));
    } else lines.push(line(n, e.channel, 'C', sIn, sIn + span, c.start, c.start + c.length));
    if (speed !== 1) lines.push(`M2   ${REEL.padEnd(8)} ${(speed * base).toFixed(1).padStart(5, '0')}                ${tc(sIn)}`);
    if (c.file) {
      lines.push(`* FROM CLIP NAME: ${c.file.name}`);
      lines.push(`* SOURCE FILE: ${c.file.path}`);
    }
    lines.push('');
  }
  for (const note of notes) lines.push(`* NOTE: ${note}`);
  return `${lines.join('\r\n')}\r\n`;
}

interface Parsed {
  num: string;
  channel: string;
  how: string;
  dur: number;
  sIn: number;
  sOut: number;
  rIn: number;
  rOut: number;
  reel: string;
  clipName: string;
  sourceFile: string;
  speedFps: number | null;
}

const TC = String.raw`\d{1,2}[:;.]\d{2}[:;.]\d{2}[:;.,]\d{2,3}`;
const EVENT = new RegExp(String.raw`^(\d{1,6})\s+(\S+)\s+(\S+)\s+(C|D|W\d{3}|KB?|K\s+O)\s*(\d{3})?\s+(${TC})\s+(${TC})\s+(${TC})\s+(${TC})`);

/** Read a CMX3600 EDL. `fps` is the frame rate the EDL counts in (EDLs don't say; 30 when not given). */
export function readEdl(text: string, fps = 30, name = ''): XTimeline {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/);
  let title = name;
  let drop = false;
  const evs: Parsed[] = [];
  for (const raw of rows) {
    const l = raw.trim();
    if (!l) continue;
    const titleM = /^TITLE:\s*(.*)$/i.exec(l);
    if (titleM) {
      title = titleM[1]?.trim() || title;
      continue;
    }
    const fcm = /^FCM:\s*(.*)$/i.exec(l);
    if (fcm) {
      drop = /^DROP/i.test(fcm[1]?.trim() ?? '');
      continue;
    }
    const m = EVENT.exec(l);
    if (m) {
      evs.push({
        num: m[1] as string,
        reel: m[2] as string,
        channel: (m[3] as string).toUpperCase(),
        how: (m[4] as string).replace(/\s+/g, ''),
        dur: m[5] ? Number(m[5]) : 0,
        sIn: tcToFrames(m[6] as string, fps, drop),
        sOut: tcToFrames(m[7] as string, fps, drop),
        rIn: tcToFrames(m[8] as string, fps, drop),
        rOut: tcToFrames(m[9] as string, fps, drop),
        clipName: '',
        sourceFile: '',
        speedFps: null,
      });
      continue;
    }
    const last = evs[evs.length - 1];
    if (!last) continue;
    const from = /^\*\s*FROM CLIP NAME:\s*(.+)$/i.exec(l);
    if (from) {
      // The comment belongs to every line of the event (a dissolve has two).
      for (const e of evs.filter((x) => x.num === last.num && !x.clipName)) e.clipName = from[1]?.trim() ?? '';
      if (last.how === 'D') last.clipName = from[1]?.trim() ?? '';
      continue;
    }
    const to = /^\*\s*TO CLIP NAME:\s*(.+)$/i.exec(l);
    if (to) {
      last.clipName = to[1]?.trim() ?? last.clipName;
      continue;
    }
    const src = /^\*\s*SOURCE FILE:\s*(.+)$/i.exec(l);
    if (src) {
      for (const e of evs.filter((x) => x.num === last.num && !x.sourceFile)) e.sourceFile = src[1]?.trim() ?? '';
      if (last.how === 'D') last.sourceFile = src[1]?.trim() ?? '';
      continue;
    }
    const m2 = /^M2\s+(\S+)\s+(-?\d+(?:\.\d+)?)\s+(\S+)/.exec(l);
    if (m2) {
      const speedFps = Number(m2[2]);
      for (const e of evs.filter((x) => x.reel === m2[1] && x.num === last.num)) e.speedFps = speedFps;
    }
  }
  if (!evs.length) throw new Error('No edit events were found in this EDL.');

  // Record times usually start at 01:00:00:00 (or another whole hour): the sequence starts there.
  const first = Math.min(...evs.map((e) => e.rIn));
  const perHour = tcToFrames('01:00:00:00', fps, drop);
  const offset = Math.floor(first / perHour) * perHour;
  const exact = dropFrameRate(fps) ? (Math.round(fps) * 1000) / 1001 : fps;
  const base = Math.round(fps);

  const lanes = new Map<string, XClip[]>();
  const put = (key: string, c: XClip) => lanes.set(key, [...(lanes.get(key) ?? []), c]);
  const isBlack = (reel: string) => /^(BL|BLK|BLACK)$/i.test(reel);
  const notes: string[] = [];
  for (const e of evs) {
    const length = e.rOut - e.rIn;
    if (length <= 0 || isBlack(e.reel)) continue;
    const speed = e.speedFps !== null ? e.speedFps / base : (e.sOut - e.sIn) / length || 1;
    const name = e.clipName || fileNameOf(e.sourceFile) || e.reel;
    const audioOnly = AUDIO_EXT.test(name) || (!/V/.test(e.channel) && /^A/.test(e.channel) && AUDIO_EXT.test(e.sourceFile));
    const file: XFile = {
      name,
      path: e.sourceFile || name,
      duration: 0,
      width: 0,
      height: 0,
      fps,
      hasVideo: !audioOnly,
      hasAudio: true,
    };
    let start = e.rIn - offset;
    let len = length;
    let sIn = e.sIn;
    let dissolveIn: number | undefined;
    if (e.how === 'D' && e.dur > 0) {
      // A dissolve: the cut is in its middle, and the clip before runs on to it.
      const h = Math.floor(e.dur / 2);
      start += h;
      len -= h;
      sIn += Math.round(h * Math.abs(speed));
      dissolveIn = e.dur;
      for (const key of channelKeys(e.channel)) {
        const before = (lanes.get(key) ?? []).find((c) => c.start + c.length === e.rIn - offset);
        if (before) before.length += h;
      }
    } else if (e.how !== 'C' && e.how !== 'D') notes.push(`event ${e.num}: a wipe or key (read as a cut)`);
    const clip: XClip = {
      name: name.replace(/\.[^.]+$/, ''),
      file,
      start,
      length: len,
      srcIn: Math.max(0, speed < 0 ? Math.min(sIn, e.sOut) : sIn) / exact,
      speed: Math.abs(speed) || 1,
      reverse: speed < 0,
      enabled: true,
      ...(dissolveIn ? { dissolveIn } : {}),
    };
    for (const key of channelKeys(e.channel)) put(key, key === 'v' ? clip : { ...clip, dissolveIn: undefined });
  }

  const tracks: XTrack[] = [];
  const sorted = (k: string) => [...(lanes.get(k) ?? [])].sort((a, b) => a.start - b.start);
  if (lanes.has('v')) tracks.push({ kind: 'video', name: 'V1', clips: sorted('v') });
  for (const k of ['a1', 'a2', 'a3', 'a4']) if (lanes.has(k)) tracks.push({ kind: 'audio', name: k.toUpperCase(), clips: sorted(k) });
  // Audio-only files on a picture-and-sound channel only make sound.
  for (const tr of tracks) if (tr.kind === 'video') tr.clips = tr.clips.filter((c) => c.file?.hasVideo !== false);
  return {
    name: title || 'Imported EDL',
    width: 1920,
    height: 1080,
    fps: standardFps(fps),
    tracks,
    markers: [],
    notes: [...new Set(notes)],
  };
}

/** Which tracks an EDL channel ("V", "A", "A2", "AA", "B", "AA/V") puts a clip on. */
function channelKeys(ch: string): string[] {
  const c = ch.toUpperCase();
  const out: string[] = [];
  if (c === 'B' || c.includes('V')) out.push('v');
  if (c === 'B' || c === 'A' || c === 'A1' || c.startsWith('A/') || c === 'AA' || c.startsWith('AA')) out.push('a1');
  if (c === 'AA' || c.startsWith('AA') || c === 'A2' || c.startsWith('A2')) out.push('a2');
  if (c === 'A3') out.push('a3');
  if (c === 'A4') out.push('a4');
  if (/^A\d\/?A\d$/.test(c)) for (const d of c.match(/\d/g) ?? []) out.push(`a${d}`);
  return [...new Set(out)];
}
