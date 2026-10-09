// The film's sound is made by FFmpeg: every sound clip, with its volume
// line, fades, effects, speed and pan, placed and mixed. The picture is made
// separately (frame by frame on the GPU) and joined with the sound at the end.
import { isAnim, valueAt } from '../model/anim';
import { end, rate } from '../model/seq';
import { activeFx, mixOf, staged } from '../model/mix';
import type { Bus, Clip, Effect, Project, Sequence, Track } from '../model/types';
import { dbToGain, duckOf, heardTracks, audioAt, type Duck } from '../player/audio';
import { isAudioEffect, sourceAt } from '../render/frame';
import { soundPieces } from '../model/remap';
import { titlerCueParts } from '../titler/titlerClip';

/** A sound effect on a piece: its settings at the start, and (when keyframed) how they change, by seconds from the piece's start. */
export interface PartEffect {
  type: string;
  p: Record<string, number>;
  over?: [number, Record<string, number>][];
}

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
  effects: PartEffect[];
  /** Turned down under the speech tracks (FFmpeg's sidechain compressor). */
  duck: Duck | null;
  /** false: the pitch follows the speed (like tape); otherwise it is kept. */
  pitch?: boolean;
  /** Already mixed from pieces of its track (their pans and volume lines are in it; the track's fader and processing are not). */
  mixed?: boolean;
}

/**
 * The mix's stages for a graph: each track's processing and fader, its bus,
 * and the whole mix's processing and level. `partsOnly`: only the pieces are
 * mixed (a premix of one track's pieces; its track's stages come later).
 */
export interface MixStages {
  buses: Bus[];
  fx: Effect[];
  volume: number;
  partsOnly?: boolean;
}

/** A strip's switched-on effects as a piece's (strips have no keyframes). */
function stripEffects(fx: Effect[] | undefined): PartEffect[] {
  return activeFx(fx).map((e) => ({ type: e.type, p: Object.fromEntries(Object.entries(e.p).map(([k, v]) => [k, valueAt(v, 0)])) }));
}

const AMIX = 'normalize=0:duration=longest:dropout_transition=0';
const mixOfLabels = (labels: string[]): string =>
  labels.length > 1 ? `${labels.map((x) => `[${x}]`).join('')}amix=inputs=${labels.length}:${AMIX}` : `[${labels[0]}]anull`;

/** Every piece of sound in [from, to), joined up where clips simply follow on. */
export function audioParts(p: Project, s: Sequence, from: number, to: number, depth = 0, inside: string[] = [s.id]): Part[] {
  const fps = rate(s);
  const heard = heardTracks(s);
  const parts: (Part & { clip: Clip })[] = [];
  for (const t of s.tracks) {
    if (t.kind !== 'audio' || !heard.has(t.id)) continue;
    const clips = s.clips
      .filter((c) => c.track === t.id && c.enabled && (c.source.kind === 'media' || c.source.kind === 'sequence'))
      .sort((a, b) => a.start - b.start);
    for (const c of clips) {
      const src = c.source;
      if (src.kind === 'sequence') {
        parts.push(...nestParts(p, s, c, t, from, to, depth, inside).map((x) => ({ ...x, clip: c })));
        continue;
      }
      if (src.kind !== 'media') continue;
      const m = p.media.find((x) => x.id === src.media);
      if (!m?.hasAudio) continue;
      const prev = clips.find((o) => end(o) === c.start && o.id !== c.id);
      const next = clips.find((o) => o.start === end(c) && o.id !== c.id);
      let w0 = c.start - (c.tIn && prev ? Math.floor(c.tIn.length / 2) : 0);
      let w1 = end(c) + (next?.tIn ? next.tIn.length - Math.floor(next.tIn.length / 2) : 0);
      // Time remapping: the sound in pieces of one speed each (freezes are silent).
      if (c.remap) {
        const lo = Math.max(w0, from);
        const hi = Math.min(w1, to);
        for (const x of remapParts(p, s, c, t, m.missing && m.proxy ? m.proxy : m.path, m.duration, lo, hi, fps)) parts.push({ ...x, clip: c });
        continue;
      }
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
        // FFmpeg reads the original sound (the edit-friendly copy only when the original is gone).
        path: m.missing && m.proxy ? m.proxy : m.path,
        track: t,
        from: w0,
        to: w1,
        srcFrom: Math.max(0, c.reverse ? Math.min(startSrc, endSrc) - c.speed / fps : startSrc),
        speed: c.speed,
        reverse: c.reverse,
        envelope: thin(points),
        pan: Math.max(-1, Math.min(1, valueAt(c.pan, lc) / 100)),
        effects: partEffects(c, w0, w1, fps),
        duck: duckOf(c, t, lc),
      });
    }
  }
  return join(parts, fps);
}

/** A remapped clip's sound over [w0, w1): a part for each stretch of one speed and direction. */
function remapParts(p: Project, s: Sequence, c: Clip, t: Track, path: string, duration: number, w0: number, w1: number, fps: number): Part[] {
  const out: Part[] = [];
  if (w1 <= w0) return out;
  for (const piece of soundPieces(c, w0, w1, fps)) {
    if (Math.abs(piece.rate) < 1e-3) continue;
    const a = sourceAt(c, piece.from - c.start, fps);
    const b = sourceAt(c, piece.to - c.start, fps);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (hi <= 0 || lo >= duration) continue;
    const marks = new Set<number>([piece.from, piece.to - 1]);
    for (let f = piece.from; f < piece.to; f += Math.max(1, Math.round(fps / 4))) marks.add(f);
    const lc = Math.max(0, Math.min(c.length - 1, piece.from - c.start));
    out.push({
      path,
      track: t,
      from: piece.from,
      to: piece.to,
      srcFrom: Math.max(0, lo),
      speed: ((hi - lo) * fps) / (piece.to - piece.from),
      reverse: b < a,
      envelope: thin([...marks].sort((x, y) => x - y).map((f) => [(f - piece.from) / fps, gainOf(p, s, c, f)] as [number, number])),
      pan: Math.max(-1, Math.min(1, valueAt(c.pan, lc) / 100)),
      effects: partEffects(c, piece.from, piece.to, fps),
      duck: duckOf(c, t, lc),
      pitch: c.remap?.pitch !== false,
    });
  }
  return out;
}

/** A clip's sound effects for the piece [w0, w1): keyframed settings are followed every tenth of a second. */
function partEffects(c: Clip, w0: number, w1: number, fps: number): PartEffect[] {
  const at = (e: Clip['effects'][number], f: number) => {
    const lc = Math.max(0, Math.min(c.length - 1, f - c.start));
    return Object.fromEntries(Object.entries(e.p).map(([k, v]) => [k, valueAt(v, lc)]));
  };
  return c.effects
    .filter((e) => e.on && isAudioEffect(e.type) && e.type !== 'duck')
    .map((e) => {
      const fx: PartEffect = { type: e.type, p: at(e, w0) };
      if (!Object.values(e.p).some(isAnim)) return fx;
      const step = Math.max(1, Math.round(fps / 10));
      const over: [number, Record<string, number>][] = [];
      let last = JSON.stringify(fx.p);
      for (let f = w0 + step; f < w1; f += step) {
        const v = at(e, f);
        const key = JSON.stringify(v);
        if (key === last) continue;
        last = key;
        over.push([(f - w0) / fps, v]);
      }
      return over.length ? { ...fx, over } : fx;
    });
}

/**
 * The sound of a nested sequence, as pieces of this sequence: placed where
 * the nest clip is, at its speed, with its volume (and the nest's own track
 * volumes and pans) folded in.
 */
function nestParts(p: Project, s: Sequence, c: Clip, t: Track, from: number, to: number, depth: number, inside: string[]): Part[] {
  const src = c.source;
  if (src.kind !== 'sequence') return [];
  const inner = p.sequences.find((x) => x.id === src.seq);
  if (!inner || depth >= 4 || inside.includes(inner.id)) return [];
  const fps = rate(s);
  const ifps = rate(inner);
  const w0 = Math.max(from, c.start);
  const w1 = Math.min(to, end(c));
  if (w1 <= w0) return [];
  // Outer frame → inner frame, and back.
  const toInner = (f: number) => (src.in + ((f - c.start) * c.speed) / fps) * ifps;
  const toOuter = (g: number) => c.start + ((g / ifps - src.in) * fps) / c.speed;
  const innerParts = audioParts(p, inner, Math.floor(toInner(w0)), Math.ceil(toInner(w1)), depth + 1, [...inside, inner.id]);
  const lc = (f: number) => Math.max(0, Math.min(c.length - 1, f - c.start));
  const panOuter = valueAt(c.pan, lc(w0)) / 100;
  return innerParts.flatMap((x) => {
    const of0 = Math.max(w0, Math.round(toOuter(x.from)));
    const of1 = Math.min(w1, Math.round(toOuter(x.to)));
    if (of1 <= of0) return [];
    const skip = (toInner(of0) - x.from) / ifps; // seconds of the inner part skipped at the start
    const innerAt = (sec: number) => interp(x.envelope, sec);
    // The volume line: the inner one, times the nest clip's own (sampled where either changes).
    const marks = new Set<number>([0, (of1 - of0 - 1) / fps]);
    for (const [ts] of x.envelope) {
      const o = (ts - skip) / c.speed;
      if (o > 0 && o < (of1 - of0) / fps) marks.add(o);
    }
    for (let f = of0; f < of1; f += Math.max(1, Math.round(fps / 4))) marks.add((f - of0) / fps);
    const env = [...marks]
      .sort((a, b) => a - b)
      .map((o) => [o, innerAt(skip + o * c.speed) * gainOf(p, s, c, of0 + Math.round(o * fps)) * dbToGain(x.track.volume)] as [number, number]);
    return [
      {
        ...x,
        track: t,
        from: of0,
        to: of1,
        srcFrom: x.reverse ? x.srcFrom : x.srcFrom + skip * x.speed,
        speed: x.speed * c.speed,
        envelope: thin(env),
        pan: Math.max(-1, Math.min(1, x.pan + x.track.pan + panOuter)),
      },
    ];
  });
}

function interp(e: [number, number][], t: number): number {
  if (e.length === 0) return 1;
  if (t <= (e[0] as [number, number])[0]) return (e[0] as [number, number])[1];
  for (let i = 0; i < e.length - 1; i++) {
    const [t0, v0] = e[i] as [number, number];
    const [t1, v1] = e[i + 1] as [number, number];
    if (t < t1) return v0 + ((v1 - v0) * (t - t0)) / Math.max(1e-6, t1 - t0);
  }
  return (e[e.length - 1] as [number, number])[1];
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
      JSON.stringify(last.effects) === JSON.stringify(x.effects) &&
      JSON.stringify(last.duck) === JSON.stringify(x.duck)
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

/** Faster or slower with the pitch following (like tape): the sound's rate changed, then made 48 kHz again. */
export function varispeed(speed: number): string[] {
  if (Math.abs(speed - 1) < 1e-4) return [];
  return [`asetrate=${num(48000 * Math.max(0.05, speed))}`, 'aresample=48000'];
}

/** Faster or slower keeping the pitch (FFmpeg's atempo, chained for big changes). */
export function tempo(speed: number): string[] {
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

/** An effect as FFmpeg filters, and (for settings that change over the clip) the commands that change them as it plays. */
interface Filters {
  filters: string[];
  /** `target option value` for the settings at a moment. */
  cmds?: (p: Record<string, number>) => string[];
}

/** The hum and its harmonics (50 or 60 Hz, up to 8 of them). */
export function humFrequencies(p: Record<string, number>): number[] {
  const base = (p.mains ?? 1) >= 0.5 ? 60 : 50;
  const n = Math.max(1, Math.min(8, Math.round(p.harmonics ?? 4)));
  return Array.from({ length: n }, (_, i) => base * (i + 1));
}

/** The noise reduction asked for, as afftdn's numbers. */
export const denoiseNumbers = (p: Record<string, number>): { nr: number; nf: number } => ({
  nr: Math.max(1, Math.min(97, (p.amount ?? 50) * 0.4)),
  nf: Math.max(-80, Math.min(-20, p.floor ?? -50)),
});

export function effectFilters(e: PartEffect, name: string): Filters {
  const p = e.p;
  const n = (k: string, d = 0) => (Number.isFinite(p[k]) ? (p[k] as number) : d);
  switch (e.type) {
    case 'eq':
      return {
        filters: [
          ...(n('lowCut') > 10 ? [`highpass=f=${num(n('lowCut'))}`] : []),
          ...(n('low') ? [`bass=g=${num(n('low'))}:f=100:w=0.9`] : []),
          ...(n('lowMid') ? [`equalizer=f=400:t=q:w=0.9:g=${num(n('lowMid'))}`] : []),
          ...(n('highMid') ? [`equalizer=f=2500:t=q:w=0.9:g=${num(n('highMid'))}`] : []),
          ...(n('high') ? [`treble=g=${num(n('high'))}:f=8000:w=0.9`] : []),
        ],
      };
    case 'compressor':
      return {
        filters: [
          `acompressor=threshold=${num(dbToGain(n('threshold', -20)))}:ratio=${num(Math.max(1, n('ratio', 4)))}:attack=${num(n('attack', 10))}:release=${num(n('release', 150))}:makeup=${num(Math.max(1, dbToGain(n('makeup', 3))))}`,
        ],
      };
    case 'denoise': {
      const d = denoiseNumbers(p);
      return {
        filters: ['highpass=f=80', `afftdn@${name}=nr=${num(d.nr)}:nf=${num(d.nf)}`],
        cmds: (q) => {
          const x = denoiseNumbers(q);
          return [`afftdn@${name} nr ${num(x.nr)}`, `afftdn@${name} nf ${num(x.nf)}`];
        },
      };
    }
    case 'voiceiso': {
      // No speech model is bundled for FFmpeg's arnndn: noise reduction that follows the noise, the voice's band, presence and a compressor.
      const k = voiceIsoAmount(p);
      return {
        filters: [
          'highpass=f=100',
          'lowpass=f=9000',
          `afftdn=nr=${num(10 + 20 * k)}:nf=-40:tn=1`,
          `equalizer=f=3000:t=q:w=1:g=${num(4 * k)}`,
          `acompressor=threshold=${num(dbToGain(-24))}:ratio=${num(1 + 3 * k)}:attack=10:release=150:makeup=${num(dbToGain(4 * k))}`,
        ],
      };
    }
    case 'dehum': {
      const q = Math.max(2, Math.min(60, n('q', 18)));
      const fs = humFrequencies(p);
      const g = (v: Record<string, number>) => num(-Math.max(0, v.depth ?? 24));
      return {
        filters: fs.map((f, i) => `equalizer@${name}h${i}=f=${f}:t=q:w=${num(q)}:g=${g(p)}`),
        cmds: (v) => fs.map((_, i) => `equalizer@${name}h${i} g ${g(v)}`),
      };
    }
    case 'deess':
      return { filters: [`deesser=i=${num(n('amount', 50) / 100)}:f=${num(Math.max(0.05, Math.min(0.95, n('freq', 5500) / 24000)))}`] };
    case 'limiter':
      return { filters: [`alimiter=limit=${num(dbToGain(n('ceiling', -1)))}:level=false`] };
    case 'loudnorm':
      // loudnorm works at a high sample rate inside: back to 48 kHz after.
      return {
        filters: [
          `loudnorm=I=${num(Math.max(-70, Math.min(-5, n('target', -16))))}:TP=${num(Math.max(-9, Math.min(0, n('peak', -1.5))))}:LRA=11`,
          'aresample=48000',
        ],
      };
    case 'voice': {
      const k = n('amount', 50) / 100;
      return {
        filters: [
          'highpass=f=80',
          `bass=g=${num(-4 * k)}:f=100:w=0.9`,
          `equalizer=f=2500:t=q:w=0.9:g=${num(4 * k)}`,
          `acompressor=threshold=${num(dbToGain(-12 - 18 * k))}:ratio=${num(1 + 3 * k)}:makeup=${num(dbToGain(6 * k))}`,
        ],
      };
    }
    default:
      return { filters: [] };
  }
}

/** Voice isolation's amount, 0–1. */
export const voiceIsoAmount = (p: Record<string, number>): number => Math.max(0, Math.min(1, (p.amount ?? 70) / 100));

/** A piece's effects, with commands that follow keyframed settings while it plays. */
export function effectChain(effects: PartEffect[], part: number): string[] {
  const out: string[] = [];
  effects.forEach((e, j) => {
    const f = effectFilters(e, `p${part}e${j}`);
    if (e.over?.length && f.cmds) {
      const cmds = f.cmds;
      out.push(`asendcmd=c='${e.over.map(([t, v]) => `${num(t)} ${cmds(v).join(',')}`).join(';')}'`);
    }
    out.push(...f.filters);
  });
  return out;
}

/** FFmpeg's sidechain compressor for ducking (the speech is its second input). */
export function duckFilter(d: Duck): string {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return `sidechaincompress=threshold=${num(clamp(dbToGain(d.threshold), 0.000976563, 1))}:ratio=${num(clamp(d.ratio, 1, 20))}:attack=${num(clamp(d.attack, 0.01, 2000))}:release=${num(clamp(d.release, 0.01, 9000))}`;
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
 * `speech` is a file with the speech tracks' sound over the same time: pieces
 * that duck are turned down under it.
 */
export function soundGraph(
  parts: Part[],
  seconds: number,
  fps: number,
  from: number,
  firstInput: number,
  loudness: boolean | string,
  speech: string | null = null,
  stages: MixStages | null = null,
): SoundGraph {
  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  const ducked = speech ? parts.filter((x) => x.duck).length : 0;
  let key = 0;
  parts.forEach((x, i) => {
    const dur = (x.to - x.from) / fps;
    const srcDur = dur * x.speed + 0.2;
    inputs.push('-ss', num(x.srcFrom), '-t', num(srcDur), '-i', x.path);
    const k = firstInput + i;
    // A premix already has its track's pan; with stages, the track's fader comes after its processing.
    const tp = x.mixed ? 0 : x.track.pan;
    const l = Math.min(1, 1 - x.pan) * Math.min(1, 1 - tp);
    const r = Math.min(1, 1 + x.pan) * Math.min(1, 1 + tp);
    const fader = stages ? 1 : dbToGain(x.track.volume);
    const chain = [
      'aresample=48000',
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      ...(x.reverse ? ['atrim=duration=' + num(srcDur), 'areverse'] : []),
      ...(x.pitch === false ? varispeed(x.speed) : tempo(x.speed)),
      `atrim=duration=${num(dur)}`,
      'asetpts=PTS-STARTPTS',
      ...effectChain(x.effects, i),
      `volume='${envelopeExpr(x.envelope)}*${num(fader)}':eval=frame`,
      ...(Math.abs(l - 1) > 1e-3 || Math.abs(r - 1) > 1e-3 ? [`pan=stereo|c0=${num(l)}*c0|c1=${num(r)}*c1`] : []),
      `adelay=${Math.round(((x.from - from) / fps) * 1000)}:all=1`,
    ];
    const out = `p${i}`;
    if (speech && x.duck) {
      // Turned down while the speech (in the same place in time) is loud.
      filters.push(`[${k}:a]${chain.join(',')}[d${i}]`);
      filters.push(`[d${i}][k${key++}]${duckFilter(x.duck)}[${out}]`);
    } else filters.push(`[${k}:a]${chain.join(',')}[${out}]`);
    labels.push(out);
  });
  if (speech && ducked) {
    inputs.push('-i', speech);
    const keys = Array.from({ length: ducked }, (_, j) => `[k${j}]`).join('');
    const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
    filters.push(`[${firstInput + parts.length}:a]${fmt}${ducked > 1 ? `,asplit=${ducked}` : ''}${keys}`);
  }
  const total = num(seconds);
  const tail = [
    'aformat=sample_fmts=fltp:channel_layouts=stereo',
    `apad=whole_dur=${total}`,
    `atrim=duration=${total}`,
    ...(loudness === true ? ['loudnorm=I=-16:TP=-1.5:LRA=11'] : loudness ? [loudness] : []),
  ];
  if (labels.length && stages && !stages.partsOnly) {
    // Pieces into their tracks (processing, then fader), tracks into their buses, buses and tracks into the mix.
    const byTrack = new Map<string, { track: Track; labels: string[] }>();
    parts.forEach((x, i) => {
      const t = byTrack.get(x.track.id) ?? { track: x.track, labels: [] };
      t.labels.push(labels[i] as string);
      byTrack.set(x.track.id, t);
    });
    const byBus = new Map<string, string[]>();
    const direct: string[] = [];
    let j = 0;
    for (const { track, labels: ls } of byTrack.values()) {
      const out = `tr${j}`;
      const chain = [...effectChain(stripEffects(track.fx), 1000 + j), `volume=${num(dbToGain(track.volume))}`];
      filters.push(`${mixOfLabels(ls)},${chain.join(',')}[${out}]`);
      j++;
      const bus = track.bus ? stages.buses.find((b) => b.id === track.bus) : undefined;
      if (bus) byBus.set(bus.id, [...(byBus.get(bus.id) ?? []), out]);
      else direct.push(out);
    }
    stages.buses.forEach((b, k) => {
      const ls = byBus.get(b.id);
      if (!ls) return;
      const out = `bu${k}`;
      const l = Math.min(1, 1 - b.pan);
      const r = Math.min(1, 1 + b.pan);
      const chain = [
        ...effectChain(stripEffects(b.fx), 2000 + k),
        `volume=${num(b.off ? 0 : dbToGain(b.volume))}`,
        ...(Math.abs(l - 1) > 1e-3 || Math.abs(r - 1) > 1e-3 ? [`pan=stereo|c0=${num(l)}*c0|c1=${num(r)}*c1`] : []),
      ];
      filters.push(`${mixOfLabels(ls)},${chain.join(',')}[${out}]`);
      direct.push(out);
    });
    const master = [...effectChain(stripEffects(stages.fx), 3000), `volume=${num(dbToGain(stages.volume))}`];
    filters.push(`${mixOfLabels(direct)},${master.join(',')},${tail.join(',')}[aout]`);
    return { inputs, graph: filters.join(';') };
  }
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

/** Delivery's own choices for the last run (a preset's sound codec, chapters, embedded captions). */
export interface FinishOptions {
  /** The sound encoder's arguments (otherwise those of `sound`). */
  audio?: string[];
  /** Where a piece's file really is (the audio cues' sounds written into the work folder). */
  paths?: (path: string) => string;
  /** More inputs and what to do with them; `first` is the number the first of them gets. */
  extra?: (first: number) => { inputs: string[]; args: string[] };
}

/**
 * The runs that make the sound and join it to the picture. When something
 * ducks under speech, the speech tracks are mixed first (the key the
 * ducking listens to). Many pieces of sound are first mixed in groups
 * (FFmpeg works best with fewer files open at once).
 */
export function finishJobs(
  p: Project,
  s: Sequence,
  range: { from: number; to: number },
  video: { file: string; copy: boolean; crf: number } | null,
  sound: SoundFormat,
  loudness: boolean | string,
  opts: FinishOptions = {},
): Job[] {
  const fps = rate(s);
  const seconds = (range.to - range.from) / fps;
  // The film's sound, and the title clips' audio cues at their frames.
  let parts = [...audioParts(p, s, range.from, range.to), ...titlerCueParts(s, range.from, range.to, fps)];
  if (opts.paths) parts = parts.map((x) => ({ ...x, path: opts.paths!(x.path) }));
  const jobs: Job[] = [];
  const GROUP = 80;
  let speech: string | null = null;
  const talk = parts.filter((x) => x.track.role === 'dialogue');
  if (talk.length && parts.some((x) => x.duck)) {
    speech = '{tmp}/speech.wav';
    jobs.push(
      ...mixJobs(
        talk.map((x) => ({ ...x, duck: null })),
        seconds,
        fps,
        range,
        speech,
        GROUP,
      ),
    );
  }
  const stages: MixStages | null = staged(s) ? { ...mixOf(s) } : null;
  if (parts.length > GROUP) {
    const groups: Part[][] = [];
    if (stages) {
      // With stages, each premix holds one track's pieces, so its processing still applies to the track as a whole.
      const byTrack = new Map<string, Part[]>();
      for (const x of parts) byTrack.set(x.track.id, [...(byTrack.get(x.track.id) ?? []), x]);
      for (const list of byTrack.values()) for (let i = 0; i < list.length; i += GROUP) groups.push(list.slice(i, i + GROUP));
    } else for (let i = 0; i < parts.length; i += GROUP) groups.push(parts.slice(i, i + GROUP));
    parts = groups.map((g, i) => {
      const file = `{tmp}/mix-${i}.wav`;
      const graph = soundGraph(g, seconds, fps, range.from, 0, false, speech, stages ? { ...stages, partsOnly: true } : null);
      jobs.push({ args: [...graph.inputs, '-filter_complex', graph.graph, '-map', '[aout]', '-c:a', 'pcm_f32le', file], seconds: seconds * 0.3 });
      return stages ? { ...premixed(file, g[0]!.track, range), track: g[0]!.track, mixed: true } : premixed(file, g[0]!.track, range);
    });
  }
  const graph = soundGraph(parts, seconds, fps, range.from, video ? 1 : 0, loudness, speech, stages);
  const extra = opts.extra?.((video ? 1 : 0) + graph.inputs.filter((x) => x === '-i').length) ?? { inputs: [], args: [] };
  const audioCodec = opts.audio
    ? opts.audio
    : sound === 'mp3'
      ? ['-c:a', 'libmp3lame', '-q:a', '2']
      : sound === 'wav'
        ? ['-c:a', 'pcm_s16le']
        : ['-c:a', 'aac', '-b:a', '256k'];
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
      ...extra.inputs,
      '-filter_complex',
      graph.graph,
      ...videoArgs,
      '-map',
      '[aout]',
      ...audioCodec,
      ...extra.args,
      '-ar',
      '48000',
      ...(video ? ['-movflags', '+faststart', '-t', num(seconds)] : []),
      '{out}',
    ],
    seconds: video && !video.copy ? seconds : seconds * 0.4,
  });
  return jobs;
}

/** A mix already made, as one piece covering the whole range. */
function premixed(file: string, track: Track, range: { from: number; to: number }): Part {
  return {
    path: file,
    track: { ...track, volume: 0, pan: 0 },
    from: range.from,
    to: range.to,
    srcFrom: 0,
    speed: 1,
    reverse: false,
    envelope: [[0, 1]],
    pan: 0,
    effects: [],
    duck: null,
  };
}

/** The runs that mix some pieces into one file (in groups when there are many). */
function mixJobs(parts: Part[], seconds: number, fps: number, range: { from: number; to: number }, file: string, group: number): Job[] {
  const jobs: Job[] = [];
  let list = parts;
  if (list.length > group) {
    const groups: Part[][] = [];
    for (let i = 0; i < list.length; i += group) groups.push(list.slice(i, i + group));
    list = groups.map((g, i) => {
      const f = `${file.replace(/\.wav$/, '')}-${i}.wav`;
      const graph = soundGraph(g, seconds, fps, range.from, 0, false);
      jobs.push({ args: [...graph.inputs, '-filter_complex', graph.graph, '-map', '[aout]', '-c:a', 'pcm_f32le', f], seconds: seconds * 0.3 });
      return premixed(f, g[0]!.track, range);
    });
  }
  const graph = soundGraph(list, seconds, fps, range.from, 0, false);
  jobs.push({ args: [...graph.inputs, '-filter_complex', graph.graph, '-map', '[aout]', '-c:a', 'pcm_f32le', file], seconds: seconds * 0.3 });
  return jobs;
}
