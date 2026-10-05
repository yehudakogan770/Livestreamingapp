// The film's sound is made by FFmpeg: every sound clip, with its volume
// line, fades, effects, speed and pan, placed and mixed. The picture is made
// separately (frame by frame on the GPU) and joined with the sound at the end.
import { valueAt } from '../model/anim';
import { end, rate } from '../model/seq';
import type { Clip, Project, Sequence, Track } from '../model/types';
import { dbToGain, heardTracks, audioAt } from '../player/audio';
import { sourceAt } from '../render/frame';

export interface Part {
  path: string;
  track: Track;
  /** Sequence frames the part covers. */
  from: number;
  to: number;
  /** Seconds into the file at `from` (the earliest second used, for a reversed clip). */
  srcFrom: number;
  speed: number;
  reverse: boolean;
  /** Seconds from the part's start, and how loud (1 = as recorded). */
  envelope: [number, number][];
  pan: number;
  effects: { type: string; p: Record<string, number> }[];
}

/** Every piece of sound in [from, to), joined up where clips simply follow on. */
export function audioParts(p: Project, s: Sequence, from: number, to: number): Part[] {
  const fps = rate(s);
  const heard = heardTracks(s);
  const parts: (Part & { clip: Clip })[] = [];
  for (const t of s.tracks) {
    if (t.kind !== 'audio' || !heard.has(t.id)) continue;
    const clips = s.clips.filter((c) => c.track === t.id && c.enabled && c.source.kind === 'media').sort((a, b) => a.start - b.start);
    for (const c of clips) {
      const src = c.source;
      if (src.kind !== 'media') continue;
      const m = p.media.find((x) => x.id === src.media);
      if (!m?.hasAudio) continue;
      const prev = clips.find((o) => end(o) === c.start && o.id !== c.id);
      const next = clips.find((o) => o.start === end(c) && o.id !== c.id);
      let w0 = c.start - (c.tIn && prev ? Math.floor(c.tIn.length / 2) : 0);
      let w1 = end(c) + (next?.tIn ? next.tIn.length - Math.floor(next.tIn.length / 2) : 0);
      // Only the part of the file that exists.
      const firstOk = Math.ceil(c.start + ((c.reverse ? 0 : -src.in) * fps) / c.speed);
      if (!c.reverse) w0 = Math.max(w0, firstOk);
      const lastOk = c.reverse ? w1 : Math.floor(c.start + ((m.duration - src.in) * fps) / c.speed);
      w1 = Math.min(w1, lastOk);
      w0 = Math.max(w0, from);
      w1 = Math.min(w1, to);
      if (w1 <= w0) continue;
      // The volume line: sampled where it changes (keyframes, fades).
      const marks = new Set<number>([w0, w1 - 1]);
      const keyTimes = typeof c.gain === 'object' ? c.gain.k.map((k) => c.start + k.t) : [];
      for (const k of keyTimes) if (k > w0 && k < w1) marks.add(k);
      const fades: [number, number][] = [];
      if (c.tIn) fades.push([c.start - Math.floor(c.tIn.length / 2), c.tIn.length]);
      if (next?.tIn) fades.push([next.start - Math.floor(next.tIn.length / 2), next.tIn.length]);
      if (c.tOut && !next) fades.push([end(c) - c.tOut.length, c.tOut.length]);
      for (const [f0, len] of fades) for (let i = 0; i <= 8; i++) marks.add(Math.round(f0 + (len * i) / 8));
      if (typeof c.gain === 'object') for (let f = w0; f < w1; f += Math.max(1, Math.round(fps / 4))) if (keyTimes.length) marks.add(f);
      const points = [...marks]
        .filter((f) => f >= w0 && f < w1)
        .sort((a, b) => a - b)
        .map((f) => [(f - w0) / fps, gainOf(p, s, c, f)] as [number, number]);
      const lc = Math.max(0, Math.min(c.length - 1, w0 - c.start));
      const startSrc = sourceAt(c, w0 - c.start, fps);
      const endSrc = sourceAt(c, w1 - 1 - c.start, fps) + c.speed / fps;
      parts.push({
        clip: c,
        path: m.proxy ?? m.path,
        track: t,
        from: w0,
        to: w1,
        srcFrom: Math.max(0, c.reverse ? Math.min(startSrc, endSrc) - c.speed / fps : startSrc),
        speed: c.speed,
        reverse: c.reverse,
        envelope: thin(points),
        pan: Math.max(-1, Math.min(1, valueAt(c.pan, lc) / 100)),
        effects: c.effects
          .filter((e) => e.on && ['eq', 'compressor', 'denoise', 'deess', 'limiter', 'voice'].includes(e.type))
          .map((e) => ({ type: e.type, p: Object.fromEntries(Object.entries(e.p).map(([k, v]) => [k, valueAt(v, lc)])) })),
      });
    }
  }
  return join(parts, fps);
}

/** How loud a clip is at a frame (its own volume and fades). */
function gainOf(p: Project, s: Sequence, c: Clip, frame: number): number {
  const h = audioAt(p, s, frame).find((x) => x.clip.id === c.id);
  if (h) return h.gain;
  return dbToGain(valueAt(c.gain, Math.max(0, Math.min(c.length - 1, frame - c.start))));
}

/** No more points than FFmpeg handles well. */
function thin(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const pt of points) {
    const last = out[out.length - 1];
    const before = out[out.length - 2];
    // Drop a point in the middle of a flat stretch.
    if (last && before && Math.abs(last[1] - pt[1]) < 1e-4 && Math.abs(before[1] - last[1]) < 1e-4) out[out.length - 1] = pt;
    else out.push(pt);
  }
  if (out.length <= 120) return out;
  const step = out.length / 120;
  return Array.from({ length: 120 }, (_, i) => out[Math.min(out.length - 1, Math.round(i * step))] as [number, number]);
}

const flat = (e: [number, number][]): number | null => (e.every((x) => Math.abs(x[1] - (e[0]?.[1] ?? 0)) < 1e-4) ? (e[0]?.[1] ?? 1) : null);

/** Clips that simply follow on in the same file (an event cut into pieces) become one. */
function join(parts: (Part & { clip: Clip })[], fps: number): Part[] {
  const out: Part[] = [];
  for (const x of parts) {
    const last = out[out.length - 1];
    if (
      last &&
      last.track.id === x.track.id &&
      last.path === x.path &&
      last.to === x.from &&
      last.speed === 1 &&
      x.speed === 1 &&
      !last.reverse &&
      !x.reverse &&
      Math.abs(last.srcFrom + (last.to - last.from) / fps - x.srcFrom) < 0.5 / fps &&
      flat(last.envelope) !== null &&
      flat(last.envelope) === flat(x.envelope) &&
      last.pan === x.pan &&
      JSON.stringify(last.effects) === JSON.stringify(x.effects)
    ) {
      last.to = x.to;
      const g = flat(last.envelope) ?? 1;
      last.envelope = [
        [0, g],
        [(last.to - last.from - 1) / fps, g],
      ];
      continue;
    }
    const { clip: _clip, ...part } = x;
    out.push(part);
  }
  return out;
}

const num = (n: number): string => (Math.abs(n) < 1e-6 ? '0' : Number(n.toFixed(5)).toString());

/** The volume line as an FFmpeg expression of t (seconds). */
export function envelopeExpr(e: [number, number][]): string {
  const f = flat(e);
  if (f !== null) return num(f);
  let expr = num((e[e.length - 1] as [number, number])[1]);
  for (let i = e.length - 2; i >= 0; i--) {
    const [t0, v0] = e[i] as [number, number];
    const [t1, v1] = e[i + 1] as [number, number];
    const slope = (v1 - v0) / Math.max(1e-6, t1 - t0);
    expr = `if(lt(t,${num(t1)}),${num(v0)}+${num(slope)}*(t-${num(t0)}),${expr})`;
  }
  const [t0, v0] = e[0] as [number, number];
  return `if(lt(t,${num(t0)}),${num(v0)},${expr})`;
}

function tempo(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s > 2) {
    out.push('atempo=2');
    s /= 2;
  }
  while (s < 0.5) {
    out.push('atempo=0.5');
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 1e-4) out.push(`atempo=${num(s)}`);
  return out;
}

function effectFilters(e: Part['effects'][number]): string[] {
  const p = e.p;
  const n = (k: string, d = 0) => (Number.isFinite(p[k]) ? (p[k] as number) : d);
  switch (e.type) {
    case 'eq':
      return [
        ...(n('lowCut') > 10 ? [`highpass=f=${num(n('lowCut'))}`] : []),
        ...(n('low') ? [`bass=g=${num(n('low'))}:f=100:w=0.9`] : []),
        ...(n('lowMid') ? [`equalizer=f=400:t=q:w=0.9:g=${num(n('lowMid'))}`] : []),
        ...(n('highMid') ? [`equalizer=f=2500:t=q:w=0.9:g=${num(n('highMid'))}`] : []),
        ...(n('high') ? [`treble=g=${num(n('high'))}:f=8000:w=0.9`] : []),
      ];
    case 'compressor':
      return [
        `acompressor=threshold=${num(dbToGain(n('threshold', -20)))}:ratio=${num(Math.max(1, n('ratio', 4)))}:attack=${num(n('attack', 10))}:release=${num(n('release', 150))}:makeup=${num(Math.max(1, dbToGain(n('makeup', 3))))}`,
      ];
    case 'denoise':
      return [`afftdn=nr=${num(Math.max(1, n('amount', 50) * 0.4))}:nf=-50`];
    case 'deess':
      return [`deesser=i=${num(n('amount', 50) / 100)}`];
    case 'limiter':
      return [`alimiter=limit=${num(dbToGain(n('ceiling', -1)))}:level=false`];
    case 'voice': {
      const k = n('amount', 50) / 100;
      return [
        'highpass=f=80',
        `bass=g=${num(-4 * k)}:f=100:w=0.9`,
        `equalizer=f=2500:t=q:w=0.9:g=${num(4 * k)}`,
        `acompressor=threshold=${num(dbToGain(-12 - 18 * k))}:ratio=${num(1 + 3 * k)}:makeup=${num(dbToGain(6 * k))}`,
      ];
    }
    default:
      return [];
  }
}

export interface SoundGraph {
  /** `-ss … -t … -i file` for each part. */
  inputs: string[];
  /** The filter graph; its result is `[aout]`. */
  graph: string;
}

/**
 * The FFmpeg graph that makes the sound of [from, to). `firstInput` is the
 * input number of the first part (0, or 1 when the picture is input 0).
 */
export function soundGraph(parts: Part[], seconds: number, fps: number, from: number, firstInput: number, loudness: boolean): SoundGraph {
  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  parts.forEach((x, i) => {
    const dur = (x.to - x.from) / fps;
    const srcDur = dur * x.speed + 0.2;
    inputs.push('-ss', num(x.srcFrom), '-t', num(srcDur), '-i', x.path);
    const k = firstInput + i;
    const l = Math.min(1, 1 - x.pan) * Math.min(1, 1 - x.track.pan);
    const r = Math.min(1, 1 + x.pan) * Math.min(1, 1 + x.track.pan);
    const chain = [
      'aresample=48000',
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      ...(x.reverse ? ['atrim=duration=' + num(srcDur), 'areverse'] : []),
      ...tempo(x.speed),
      `atrim=duration=${num(dur)}`,
      'asetpts=PTS-STARTPTS',
      ...x.effects.flatMap(effectFilters),
      `volume='${envelopeExpr(x.envelope)}*${num(dbToGain(x.track.volume))}':eval=frame`,
      ...(Math.abs(l - 1) > 1e-3 || Math.abs(r - 1) > 1e-3 ? [`pan=stereo|c0=${num(l)}*c0|c1=${num(r)}*c1`] : []),
      `adelay=${Math.round(((x.from - from) / fps) * 1000)}:all=1`,
    ];
    const out = `p${i}`;
    filters.push(`[${k}:a]${chain.join(',')}[${out}]`);
    labels.push(out);
  });
  const total = num(seconds);
  const tail = [
    'aformat=sample_fmts=fltp:channel_layouts=stereo',
    `apad=whole_dur=${total}`,
    `atrim=duration=${total}`,
    ...(loudness ? ['loudnorm=I=-16:TP=-1.5:LRA=11'] : []),
  ];
  if (labels.length === 0) filters.push(`anullsrc=r=48000:cl=stereo,${tail.join(',')}[aout]`);
  else if (labels.length === 1) filters.push(`[${labels[0]}]${tail.join(',')}[aout]`);
  else
    filters.push(
      `${labels.map((x) => `[${x}]`).join('')}amix=inputs=${labels.length}:normalize=0:duration=longest:dropout_transition=0,${tail.join(',')}[aout]`,
    );
  return { inputs, graph: filters.join(';') };
}

/** A run of FFmpeg (args may use {tmp} and {out}). */
export interface Job {
  args: string[];
  seconds: number;
}

export type SoundFormat = 'aac' | 'mp3' | 'wav';

/**
 * The runs that make the sound and join it to the picture. Many pieces of
 * sound are first mixed in groups (FFmpeg works best with fewer files open at once).
 */
export function finishJobs(
  p: Project,
  s: Sequence,
  range: { from: number; to: number },
  video: { file: string; copy: boolean; crf: number } | null,
  sound: SoundFormat,
  loudness: boolean,
): Job[] {
  const fps = rate(s);
  const seconds = (range.to - range.from) / fps;
  let parts = audioParts(p, s, range.from, range.to);
  const jobs: Job[] = [];
  const GROUP = 80;
  if (parts.length > GROUP) {
    const groups: Part[][] = [];
    for (let i = 0; i < parts.length; i += GROUP) groups.push(parts.slice(i, i + GROUP));
    parts = groups.map((g, i) => {
      const file = `{tmp}/mix-${i}.wav`;
      const graph = soundGraph(g, seconds, fps, range.from, 0, false);
      jobs.push({ args: [...graph.inputs, '-filter_complex', graph.graph, '-map', '[aout]', '-c:a', 'pcm_f32le', file], seconds: seconds * 0.3 });
      const track: Track = { ...g[0]!.track, volume: 0, pan: 0 };
      return { path: file, track, from: range.from, to: range.to, srcFrom: 0, speed: 1, reverse: false, envelope: [[0, 1]], pan: 0, effects: [] };
    });
  }
  const graph = soundGraph(parts, seconds, fps, range.from, video ? 1 : 0, loudness);
  const audioCodec = sound === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '2'] : sound === 'wav' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '256k'];
  const videoArgs = video
    ? [
        '-map',
        '0:v',
        ...(video.copy ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(video.crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high']),
      ]
    : [];
  jobs.push({
    args: [
      ...(video ? ['-i', video.file] : []),
      ...graph.inputs,
      '-filter_complex',
      graph.graph,
      ...videoArgs,
      '-map',
      '[aout]',
      ...audioCodec,
      '-ar',
      '48000',
      ...(video ? ['-movflags', '+faststart', '-t', num(seconds)] : []),
      '{out}',
    ],
    seconds: video && !video.copy ? seconds : seconds * 0.4,
  });
  return jobs;
}
