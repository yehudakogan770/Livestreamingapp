// Music tools: where the beats and bars of a song are (an onset envelope from
// the sound, its tempo by autocorrelation, and the beats by dynamic
// programming, as in Ellis's beat tracker), and what to do with them: beat
// markers, cuts snapped to the beat, a montage cut on the beat, and a song
// shortened or lengthened at bar lines so it ends exactly when the film does.
import { newClip, uid, type Clip, type Marker, type Project, type Sequence } from '../model/types';
import { current, editSeq, end, rate, trackOf } from '../model/seq';
import { trim } from '../model/edit';

// ---------------------------------------------------------------------------
// Analysis.

export interface Beats {
  /** Beats per minute. */
  bpm: number;
  /** Seconds into the file. */
  beats: number[];
  /** Which beats start a bar (indexes into `beats`), assuming four beats to the bar. */
  downbeats: number[];
  /** Beats in a bar. */
  meter: number;
}

/** The onset envelope's steps a second. */
export const ENV_RATE = 100;

/** In-place radix-2 FFT (re, im of length a power of two). */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = (re[b] as number) * cr - (im[b] as number) * ci;
        const xi = (re[b] as number) * ci + (im[b] as number) * cr;
        re[b] = (re[a] as number) - xr;
        im[b] = (im[a] as number) - xi;
        re[a] = (re[a] as number) + xr;
        im[a] = (im[a] as number) + xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/**
 * How much new sound starts at each moment (spectral flux of the
 * log-compressed spectrum, ENV_RATE steps a second), for all of it and for
 * the low end only (kick drums and bass: where bars start).
 */
export function onsetEnvelope(audio: Float32Array, sampleRate: number): { all: Float32Array; low: Float32Array } {
  const hop = Math.round(sampleRate / ENV_RATE);
  const size = 1 << Math.round(Math.log2(Math.max(64, sampleRate * 0.032)));
  // Frames are centered on their time (half a window of silence before the start).
  const pad = size / 2;
  const bins = size / 2;
  const lowBins = Math.max(2, Math.round((200 / sampleRate) * size));
  const count = Math.max(0, Math.floor(audio.length / hop));
  const all = new Float32Array(count);
  const low = new Float32Array(count);
  const win = new Float32Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  let prev = new Float32Array(bins);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  for (let f = 0; f < count; f++) {
    const o = f * hop - pad;
    for (let i = 0; i < size; i++) {
      re[i] = (audio[o + i] ?? 0) * (win[i] as number);
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(bins);
    let sum = 0;
    let sumLow = 0;
    for (let b = 1; b < bins; b++) {
      mag[b] = Math.log1p(100 * Math.hypot(re[b] as number, im[b] as number));
      const d = (mag[b] as number) - (prev[b] as number);
      if (d > 0) {
        sum += d;
        if (b < lowBins) sumLow += d;
      }
    }
    all[f] = f === 0 ? 0 : sum;
    low[f] = f === 0 ? 0 : sumLow;
    prev = mag;
  }
  return { all: normalizeOnsets(all), low: normalizeOnsets(low) };
}

/** Onsets from a waveform of peaks (ENV_RATE a second, 0–255): for when the sound itself can't be read. */
export function onsetsFromPeaks(peaks: Uint8Array): Float32Array {
  const out = new Float32Array(peaks.length);
  for (let i = 1; i < peaks.length; i++) {
    const a = Math.log1p(peaks[i - 1] as number);
    const b = Math.log1p(peaks[i] as number);
    out[i] = Math.max(0, b - a);
  }
  return normalizeOnsets(out);
}

/** Take away the slowly changing level (only sudden rises count) and scale to a spread of 1. */
function normalizeOnsets(x: Float32Array): Float32Array {
  const n = x.length;
  const half = Math.round(ENV_RATE * 0.25);
  const out = new Float32Array(n);
  let s = 0;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = (pre[i] as number) + (x[i] as number);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    const mean = ((pre[b] as number) - (pre[a] as number)) / (b - a);
    out[i] = Math.max(0, (x[i] as number) - mean);
    s += (out[i] as number) ** 2;
  }
  const sd = Math.sqrt(s / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i++) out[i] = (out[i] as number) / sd;
  return out;
}

/** The tempo (beats a minute) whose beat period best repeats in the onsets: autocorrelation, leaning toward about 120. */
export function estimateTempo(env: Float32Array, rateHz = ENV_RATE, min = 60, max = 200): number {
  const lo = Math.floor((60 / max) * rateHz);
  const hi = Math.ceil((60 / min) * rateHz);
  const n = env.length;
  const ac = new Float64Array(hi * 2 + 2);
  for (let lag = 1; lag < ac.length; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += (env[i] as number) * (env[i - lag] as number);
    ac[lag] = s / Math.max(1, n - lag);
  }
  let best = lo;
  let bestScore = -Infinity;
  const score = (lag: number) => {
    // A beat period is also helped by its double (the half-time feel); a mild preference for ~120 BPM.
    const bpm = (60 * rateHz) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.0) ** 2);
    return ((ac[lag] as number) + 0.5 * (ac[lag * 2] ?? 0)) * (0.6 + 0.4 * prior);
  };
  for (let lag = lo; lag <= hi; lag++) {
    const s = score(lag);
    if (s > bestScore) {
      bestScore = s;
      best = lag;
    }
  }
  // Between steps: a parabola through the peak.
  const a = ac[best - 1] ?? 0;
  const b = ac[best] ?? 0;
  const c = ac[best + 1] ?? 0;
  const den = a - 2 * b + c;
  const shift = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  return (60 * rateHz) / (best + shift);
}

/** Beats (seconds) that land on onsets and keep to the tempo: dynamic programming over the onset envelope. */
export function trackBeats(env: Float32Array, bpm: number, rateHz = ENV_RATE, tightness = 100): number[] {
  const n = env.length;
  if (n === 0 || !(bpm > 0)) return [];
  const period = (60 * rateHz) / bpm;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    let best = 0;
    let from = -1;
    const a = Math.max(0, Math.round(t - 2 * period));
    const b = Math.min(t - 1, Math.round(t - period / 2));
    for (let p = a; p <= b; p++) {
      const s = (score[p] as number) - tightness * Math.log((t - p) / period) ** 2;
      if (s > best || from < 0) {
        best = s;
        from = p;
      }
    }
    score[t] = (env[t] as number) + (from >= 0 ? Math.max(0, best) : 0);
    back[t] = from >= 0 && best > 0 ? from : -1;
  }
  // The last beat: the best score within the final beat.
  let last = n - 1;
  for (let t = Math.max(0, Math.floor(n - period)); t < n; t++) if ((score[t] as number) > (score[last] as number)) last = t;
  const beats: number[] = [];
  for (let t = last; t >= 0; t = back[t] as number) beats.push(t / rateHz);
  beats.reverse();
  // Leading silence: drop beats before the music starts (nothing heard near them).
  const strong = Math.max(...Array.from(env)) * 0.05;
  const near = (sec: number) => {
    const i = Math.round(sec * rateHz);
    let m = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(n - 1, i + 3); k++) m = Math.max(m, env[k] as number);
    return m;
  };
  while (beats.length > 1 && near(beats[0] as number) < strong) beats.shift();
  return beats;
}

/** Which beat of the bar is the first (the one with the most low-end and overall onsets), and the bars' first beats. */
export function findDownbeats(beats: number[], all: Float32Array, low: Float32Array, meter = 4, rateHz = ENV_RATE): number[] {
  if (beats.length === 0) return [];
  const at = (env: Float32Array, sec: number) => {
    const i = Math.round(sec * rateHz);
    let m = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(env.length - 1, i + 2); k++) m = Math.max(m, env[k] as number);
    return m;
  };
  const sums = new Array<number>(meter).fill(0);
  beats.forEach((b, i) => {
    sums[i % meter] = (sums[i % meter] as number) + at(low, b) + 0.5 * at(all, b);
  });
  let phase = 0;
  for (let k = 1; k < meter; k++) if ((sums[k] as number) > (sums[phase] as number)) phase = k;
  const out: number[] = [];
  for (let i = phase; i < beats.length; i += meter) out.push(i);
  return out;
}

/** The whole analysis of a song's sound. */
export function analyzeBeats(audio: Float32Array, sampleRate: number): Beats {
  const env = onsetEnvelope(audio, sampleRate);
  return beatsFromEnvelope(env.all, env.low);
}

export function beatsFromEnvelope(all: Float32Array, low: Float32Array = all): Beats {
  const bpm = estimateTempo(all);
  const beats = trackBeats(all, bpm);
  // The tempo as the beats actually came (more exact than the autocorrelation's step).
  const gaps = beats.slice(1).map((b, i) => b - (beats[i] as number));
  const median = gaps.length ? ([...gaps].sort((a, b) => a - b)[gaps.length >> 1] as number) : 60 / bpm;
  return { bpm: Math.round((60 / median) * 10) / 10, beats, downbeats: findDownbeats(beats, all, low), meter: 4 };
}

// ---------------------------------------------------------------------------
// On the timeline.

/** A file time (seconds) as a sequence frame, for a clip of that file (null when the clip doesn't show it). */
export function fileToFrame(c: Clip, t: number, fps: number): number | null {
  if (c.source.kind !== 'media' || c.reverse) return null;
  const f = c.start + ((t - c.source.in) / c.speed) * fps;
  return f >= c.start - 1e-6 && f <= end(c) + 1e-6 ? f : null;
}

/** A clip's beats as sequence frames (and which are bar starts). */
export function clipBeatFrames(c: Clip, b: Beats, fps: number): { frame: number; bar: number | null }[] {
  const bars = new Map(b.downbeats.map((i, k) => [i, k + 1]));
  const out: { frame: number; bar: number | null }[] = [];
  b.beats.forEach((t, i) => {
    const f = fileToFrame(c, t, fps);
    if (f !== null) out.push({ frame: Math.round(f), bar: bars.get(i) ?? null });
  });
  return out;
}

export const BEAT_COLOR = '#d9a441';
export const BAR_COLOR = '#e0703a';
export const isBeatMarker = (m: Marker): boolean => (m.color === BEAT_COLOR && m.name === 'Beat') || (m.color === BAR_COLOR && /^Bar \d+$/.test(m.name));

/** Beat markers for a music clip (bars only, or every beat); earlier beat markers in its time are replaced. */
export function addBeatMarkers(p: Project, clipId: string, b: Beats, barsOnly: boolean): { project: Project; count: number } {
  let count = 0;
  const project = editSeq(p, (s) => {
    const c = s.clips.find((x) => x.id === clipId);
    if (!c) return s;
    const fps = rate(s);
    const made: Marker[] = clipBeatFrames(c, b, fps)
      .filter((x) => !barsOnly || x.bar !== null)
      .map((x) => ({ id: uid('m'), at: x.frame, length: 0, name: x.bar !== null ? `Bar ${x.bar}` : 'Beat', color: x.bar !== null ? BAR_COLOR : BEAT_COLOR }));
    count = made.length;
    const kept = s.markers.filter((m) => !(isBeatMarker(m) && m.at >= c.start && m.at <= end(c)));
    return { ...s, markers: [...kept, ...made].sort((x, y) => x.at - y.at) };
  });
  return { project, count };
}

export function removeBeatMarkers(p: Project): Project {
  return editSeq(p, (s) => (s.markers.some(isBeatMarker) ? { ...s, markers: s.markers.filter((m) => !isBeatMarker(m)) } : s));
}

/** The nearest beat frame within `within` frames (null if none). */
export function nearestBeat(beats: number[], frame: number, within: number): number | null {
  let best: number | null = null;
  for (const b of beats) if (Math.abs(b - frame) <= within && (best === null || Math.abs(b - frame) < Math.abs(best - frame))) best = b;
  return best;
}

/**
 * Cut to the beat: each chosen clip's end (the cut into the clip after it,
 * rolled, so nothing else moves; a last clip's end is trimmed) moves to the
 * nearest beat within `within` frames.
 */
export function snapCutsToBeats(p: Project, ids: string[], beatFrames: number[], within: number): { project: Project; moved: number } {
  let q = p;
  let moved = 0;
  const s = current(p);
  const chosen = s.clips.filter((c) => ids.includes(c.id) && trackOf(s, c.track)?.kind === 'video').sort((a, b) => a.start - b.start);
  for (const c0 of chosen) {
    const c = current(q).clips.find((x) => x.id === c0.id);
    if (!c) continue;
    const e = end(c);
    const b = nearestBeat(beatFrames, e, within);
    if (b === null || b === e || b <= c.start) continue;
    const next = current(q).clips.find((x) => x.track === c.track && x.start === e && x.id !== c.id);
    const before = q;
    q = trim(q, c.id, 'end', b - e, next ? 'roll' : 'normal');
    if (q !== before) moved++;
  }
  return { project: q, moved };
}

/**
 * A montage cut on the beat: a new sequence with the song on its first sound
 * track and the chosen pictures, one after another, each held for `every`
 * beats (cycling through them; a picture used again goes on from where it
 * left off).
 */
export function buildMontage(
  p: Project,
  music: Clip,
  pictures: Clip[],
  b: Beats,
  every: number,
  name = 'Beat montage',
): { project: Project; seq: string } | null {
  const s = current(p);
  const fps = rate(s);
  const frames = clipBeatFrames(music, b, fps).map((x) => x.frame - music.start);
  // Cut points: every Nth beat (starting from a bar line when there is one).
  const firstBar = clipBeatFrames(music, b, fps).findIndex((x) => x.bar !== null);
  const start = firstBar > 0 ? firstBar % every : 0;
  const cuts = frames.filter((_, i) => i >= start && (i - start) % Math.max(1, every) === 0);
  const length = music.length;
  const points = [0, ...cuts.filter((f) => f > 0 && f < length), length];
  if (pictures.length === 0 || points.length < 2) return null;
  const v1 = s.tracks.find((t) => t.kind === 'video' && !t.captions);
  const a1 = s.tracks.find((t) => t.kind === 'audio');
  if (!v1 || !a1) return null;
  const seqId = uid('s');
  const tracks = s.tracks
    .filter((t) => !t.captions)
    .map((t) => ({ ...t, id: t.id === v1.id ? uid('v') : t.id === a1.id ? uid('a') : uid(t.kind === 'video' ? 'v' : 'a') }));
  const vId = tracks[s.tracks.filter((t) => !t.captions).indexOf(v1)]?.id as string;
  const aId = tracks[s.tracks.filter((t) => !t.captions).indexOf(a1)]?.id as string;
  const used = new Map<string, number>();
  const clips: Clip[] = [{ ...structuredClone(music), id: uid(), track: aId, start: 0, link: null }];
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i] as number;
    const len = (points[i + 1] as number) - from;
    if (len <= 0) continue;
    const pic = pictures[i % pictures.length] as Clip;
    // Go on from where this picture left off; start again when it runs out.
    let offset = used.get(pic.id) ?? 0;
    if (offset + len > pic.length) offset = 0;
    used.set(pic.id, offset + len);
    const src = pic.source;
    const source =
      src.kind === 'media' || src.kind === 'multicam' ? { ...src, in: src.in + ((pic.reverse ? -1 : 1) * offset * pic.speed) / fps } : structuredClone(src);
    clips.push({ ...structuredClone(pic), id: uid(), track: vId, start: from, length: Math.min(len, pic.length), source, link: null, tIn: null, tOut: null });
    // A picture shorter than its beats: the rest is a hold of nothing (rare: pictures are usually longer).
  }
  const seq: Sequence = { ...s, id: seqId, name, tracks, clips, markers: [], inPoint: null, outPoint: null, playhead: 0 };
  return { project: { ...p, sequences: [...p.sequences, seq], open: seqId }, seq: seqId };
}

// ---------------------------------------------------------------------------
// Fit music to length.

/** A part of the song to play (seconds into the file); parts play one after another, crossfaded. */
export interface Segment {
  from: number;
  to: number;
}

export interface FitPlan {
  segments: Segment[];
  /** What was done, in words. */
  summary: string;
}

/**
 * Parts of a song (bar starts `bars`, seconds; the song is `duration` long)
 * that together last exactly `target` seconds, cut only at bar lines: a
 * stretch of whole bars is taken out (a long song) or repeated (a short one),
 * in the middle of the song so its start and its ending are kept. What is
 * left over (less than a bar) comes off the very start.
 */
export function planFit(bars: number[], duration: number, target: number, minKeep = 0.15): FitPlan | null {
  if (!(target > 0) || !(duration > 0)) return null;
  const diff = duration - target;
  if (Math.abs(diff) < 1e-3) return { segments: [{ from: 0, to: duration }], summary: 'Already the right length.' };
  const inside = bars.filter((b) => b > 0 && b < duration);
  if (inside.length < 2) {
    // No bars to cut at: just shorten it from the start (or play it as it is).
    return diff > 0 ? { segments: [{ from: diff, to: duration }], summary: 'No bars were found: the start is trimmed.' } : null;
  }
  const lo = duration * minKeep;
  const hi = duration * (1 - minKeep);
  const mid = duration / 2;
  let best: { a: number; b: number; left: number; score: number } | null = null;
  for (let i = 0; i < inside.length; i++)
    for (let j = i + 1; j < inside.length; j++) {
      const a = inside[i] as number;
      const b = inside[j] as number;
      const len = b - a;
      if (diff > 0) {
        // Take out [a, b): what is left must still be at least the target.
        const left = diff - len;
        if (left < -1e-6) break;
        const middle = a >= lo && b <= hi ? 0 : 1;
        const score = left * 10 + middle * 50 + Math.abs((a + b) / 2 - mid) / duration;
        if (!best || score < best.score) best = { a, b, left, score };
      } else {
        // Repeat [a, b) k times: the song plus the repeats must reach the target.
        const k = Math.ceil(-diff / len - 1e-9);
        const left = duration + k * len - target;
        const middle = a >= lo && b <= hi ? 0 : 1;
        const score = left * 10 + middle * 50 + k * 0.5 + Math.abs((a + b) / 2 - mid) / duration;
        if (!best || score < best.score) best = { a, b, left, score };
      }
    }
  if (!best) return diff > 0 ? { segments: [{ from: diff, to: duration }], summary: 'The start is trimmed.' } : null;
  const head = Math.max(0, best.left);
  if (diff > 0) {
    const segments = [
      { from: head, to: best.a },
      { from: best.b, to: duration },
    ].filter((x) => x.to - x.from > 1e-3);
    return { segments, summary: `${fmt(best.b - best.a)} of whole bars taken out at ${fmt(best.a)}${head > 0.01 ? `, ${fmt(head)} off the start` : ''}.` };
  }
  const k = Math.ceil(-diff / (best.b - best.a) - 1e-9);
  const segments: Segment[] = [{ from: head, to: best.b }];
  for (let r = 0; r < k; r++) segments.push({ from: best.a, to: r === k - 1 ? duration : best.b });
  if (k === 0) segments[0] = { from: head, to: duration };
  return {
    segments: segments.filter((x) => x.to - x.from > 1e-3),
    summary: `The bars from ${fmt(best.a)} to ${fmt(best.b)} play ${k + 1} times${head > 0.01 ? `, ${fmt(head)} off the start` : ''}.`,
  };
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}${t % 1 >= 0.05 ? `.${Math.floor((t % 1) * 10)}` : ''}`;

/** Seconds a fit plan plays for. */
export const planLength = (plan: FitPlan): number => plan.segments.reduce((a, x) => a + x.to - x.from, 0);

/**
 * The music clip replaced by the plan's parts, one after another from where
 * it starts, crossfaded at each joint; together they last exactly `frames`.
 */
export function applyFit(p: Project, clipId: string, plan: FitPlan, frames: number, crossfade = 0.25): Project {
  return editSeq(p, (s) => {
    const c = s.clips.find((x) => x.id === clipId);
    if (!c || c.source.kind !== 'media') return s;
    const fps = rate(s);
    const total = planLength(plan);
    let acc = 0;
    let at = c.start;
    const made: Clip[] = plan.segments.map((seg, i) => {
      acc += seg.to - seg.from;
      const stop = c.start + Math.round((acc / total) * frames);
      const clip: Clip = {
        ...structuredClone(c),
        ...newClip(c.track, at, Math.max(1, stop - at), { kind: 'media', media: (c.source as { media: string }).media, in: seg.from }, c.name),
        speed: 1,
        gain: structuredClone(c.gain),
        pan: structuredClone(c.pan),
        effects: structuredClone(c.effects),
        label: c.label,
        tIn: i > 0 ? { type: 'crossfade', length: Math.max(2, Math.round(crossfade * fps)) } : c.tIn,
        tOut: i === plan.segments.length - 1 ? c.tOut : null,
      };
      at = stop;
      return clip;
    });
    return { ...s, clips: [...s.clips.filter((x) => x.id !== clipId), ...made] };
  });
}
