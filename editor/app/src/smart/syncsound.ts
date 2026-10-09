// Multicam from separate files: cameras and sound recorders that filmed the
// same thing, lined up by their sound (like PluralEyes, or "Synchronize by
// audio" in other editors) or by their starts, made into one multicam group
// and a sequence that plays it.
//
// Sound is compared by where it gets suddenly louder (claps, words, steps):
// that shape is the same in every microphone in the room, whatever its level,
// distance or tone. The files' waveforms (100 peaks a second, already made for
// the timeline) are compared at 25 steps a second over every possible offset
// at once (FFT), then the best offset is refined at 100 steps a second.
import { fft } from '../extras/beats';
import {
  newClip,
  newSequence,
  newTrack,
  uid,
  LABELS,
  type Angle,
  type Clip,
  type MediaItem,
  type MulticamGroup,
  type Project,
  type Track,
} from '../model/types';
import { FRAME_RATES } from '../model/types';
import { PEAKS_PER_SECOND, peakToDb } from './envelope';

/** How sudden rises in loudness are spread over time (step `i`: `i / rate` seconds into the file). */
export function onsets(peaks: Uint8Array, rate = PEAKS_PER_SECOND): Float32Array {
  const step = Math.max(1, Math.round(PEAKS_PER_SECOND / rate));
  const n = Math.floor(peaks.length / step);
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = 0; k < step; k++) m = Math.max(m, peaks[i * step + k] as number);
    db[i] = Math.max(-60, peakToDb(m));
  }
  const out = new Float32Array(n);
  for (let i = 1; i < n; i++) out[i] = Math.max(0, (db[i] as number) - (db[i - 1] as number));
  // Zero mean and unit spread, so a loud file and a quiet one count the same.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += out[i] as number;
  mean /= Math.max(1, n);
  let sq = 0;
  for (let i = 0; i < n; i++) {
    out[i] = (out[i] as number) - mean;
    sq += (out[i] as number) ** 2;
  }
  const sd = Math.sqrt(sq / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i++) out[i] = (out[i] as number) / sd;
  return out;
}

/**
 * How well `other` matches `ref` at every offset: `lag` steps means `other`
 * starts `lag` steps after `ref` starts (negative: before).
 */
export function correlate(ref: Float32Array, other: Float32Array): { lags: Int32Array; scores: Float32Array } {
  let n = 1;
  while (n < ref.length + other.length) n <<= 1;
  const ar = new Float32Array(n);
  const ai = new Float32Array(n);
  const br = new Float32Array(n);
  const bi = new Float32Array(n);
  ar.set(ref);
  br.set(other);
  fft(ar, ai);
  fft(br, bi);
  // ref × conj(other), then the inverse transform (by conjugating around the forward one).
  for (let i = 0; i < n; i++) {
    const r = (ar[i] as number) * (br[i] as number) + (ai[i] as number) * (bi[i] as number);
    const im = (ai[i] as number) * (br[i] as number) - (ar[i] as number) * (bi[i] as number);
    ar[i] = r;
    ai[i] = -im;
  }
  fft(ar, ai);
  // Index k holds lag k; index n - k holds lag -k. Only offsets where they overlap.
  const lo = -(other.length - 1);
  const hi = ref.length - 1;
  const lags = new Int32Array(hi - lo + 1);
  const scores = new Float32Array(hi - lo + 1);
  for (let lag = lo; lag <= hi; lag++) {
    const i = lag - lo;
    lags[i] = lag;
    scores[i] = (ar[(lag + n) % n] as number) / n;
  }
  return { lags, scores };
}

/** The match at one offset, computed directly (for refining). */
function scoreAt(ref: Float32Array, other: Float32Array, lag: number): number {
  let s = 0;
  const from = Math.max(0, -lag);
  const to = Math.min(other.length, ref.length - lag);
  for (let i = from; i < to; i++) s += (ref[i + lag] as number) * (other[i] as number);
  return s;
}

export interface Offset {
  /** Seconds after the reference starts that this file starts (negative: before). */
  seconds: number;
  /** How clearly the sound matched (the best match against the typical one): above 6 is sure. */
  confidence: number;
}

/** Below this the match is a guess, and the person is told to check it. */
export const SURE = 6;

/** Where `other` sits against `ref`, from their waveforms (100 peaks a second). */
export function findOffset(refPeaks: Uint8Array, otherPeaks: Uint8Array): Offset {
  const coarse = 25;
  const k = PEAKS_PER_SECOND / coarse;
  const a = onsets(refPeaks, coarse);
  const b = onsets(otherPeaks, coarse);
  if (a.length < 8 || b.length < 8) return { seconds: 0, confidence: 0 };
  const { lags, scores } = correlate(a, b);
  let best = 0;
  for (let i = 1; i < scores.length; i++) if ((scores[i] as number) > (scores[best] as number)) best = i;
  // Confidence: how far the best stands out from the spread of all offsets.
  let mean = 0;
  for (let i = 0; i < scores.length; i++) mean += scores[i] as number;
  mean /= scores.length;
  let sq = 0;
  for (let i = 0; i < scores.length; i++) sq += ((scores[i] as number) - mean) ** 2;
  const sd = Math.sqrt(sq / scores.length) || 1;
  const confidence = ((scores[best] as number) - mean) / sd;
  // Refine at the full rate, around the coarse answer.
  const fa = onsets(refPeaks);
  const fb = onsets(otherPeaks);
  const center = (lags[best] as number) * k;
  let bestLag = center;
  let bestScore = -Infinity;
  const scored = new Map<number, number>();
  for (let lag = center - 2 * k; lag <= center + 2 * k; lag++) {
    const s = scoreAt(fa, fb, lag);
    scored.set(lag, s);
    if (s > bestScore) {
      bestScore = s;
      bestLag = lag;
    }
  }
  // Between steps: the top of a parabola through the best and its neighbors.
  const l = scored.get(bestLag - 1);
  const r = scored.get(bestLag + 1);
  let frac = 0;
  if (l !== undefined && r !== undefined) {
    const d = l - 2 * bestScore + r;
    if (d < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / d));
  }
  return { seconds: (bestLag + frac) / PEAKS_PER_SECOND, confidence };
}

/**
 * A timecode as seconds ("01:00:10:12" at 25 fps is 3610.48). Drop-frame
 * ("01:00:10;12", 29.97 and 59.94) counts the frame numbers that are skipped
 * each minute except every tenth, as cameras do. Null when it isn't one.
 */
export function timecodeSeconds(tc: string, fps: number): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})([:;.])(\d{2,3})$/.exec(tc.trim());
  if (!m || fps <= 0) return null;
  const [h, mi, s, f] = [m[1], m[2], m[3], m[5]].map(Number) as [number, number, number, number];
  const nominal = Math.round(fps);
  if (f >= nominal || mi > 59 || s > 59) return null;
  let frames = ((h * 60 + mi) * 60 + s) * nominal + f;
  if (m[4] === ';' && (nominal === 30 || nominal === 60)) {
    const drop = nominal === 30 ? 2 : 4;
    const minutes = h * 60 + mi;
    frames -= drop * (minutes - Math.floor(minutes / 10));
  }
  // Frames of the real rate (29.97 runs a little slower than its numbers).
  return frames / (Math.abs(fps - nominal) > 0.001 ? (nominal * 1000) / 1001 : nominal);
}

/** When a file started recording (seconds since 1970), from the time its camera wrote in it. */
export function recordedAt(created: string | undefined): number | null {
  if (!created) return null;
  const t = Date.parse(created);
  return Number.isFinite(t) && t > Date.UTC(1990, 0, 1) ? t / 1000 : null;
}

/** Offsets (seconds after the earliest) from a time each file gives, or null when one doesn't give it. */
export function offsetsFrom(files: MediaItem[], time: (m: MediaItem) => number | null): Map<string, number> | null {
  const times = files.map((m) => [m.id, time(m)] as const);
  if (times.some(([, t]) => t === null)) return null;
  const first = Math.min(...times.map(([, t]) => t as number));
  return new Map(times.map(([id, t]) => [id, (t as number) - first]));
}

// ---------------------------------------------------------------------------
// Making the group and its sequence.

export interface SyncFile {
  media: MediaItem;
  /** Seconds after the first file starts (made 0 or more by `buildMulticam`). */
  offset: number;
}

export interface MulticamPlan {
  name: string;
  files: SyncFile[];
  /** Files whose sound goes on the timeline (dedicated recorders, or the reference camera). */
  sound: string[];
}

/** The sound to put on the timeline unless chosen: sound-only files (recorders), otherwise the first camera's. */
export function defaultSound(files: MediaItem[]): string[] {
  const recorders = files.filter((m) => m.kind === 'audio' && m.hasAudio);
  if (recorders.length) return recorders.map((m) => m.id);
  const cam = files.find((m) => m.hasVideo && m.hasAudio);
  return cam ? [cam.id] : [];
}

const nearestRate = (fps: number): number => FRAME_RATES.reduce((a, b) => (Math.abs(b - fps) < Math.abs(a - fps) ? b : a), 30);
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/**
 * A multicam group of the cameras (each at its offset, the earliest at 0) and a
 * new sequence holding it: the group on V1 from start to end, and the chosen
 * sound on its own tracks, linked to it, so the camera wall, angle switching
 * and Auto multicam edit work on it as on a recorded event.
 */
export function buildMulticam(p: Project, plan: MulticamPlan): { project: Project; group: string; sequence: string } {
  const first = Math.min(...plan.files.map((f) => f.offset));
  const files = plan.files.map((f) => ({ ...f, offset: f.offset - first }));
  const cams = files.filter((f) => f.media.hasVideo);
  if (!cams.length) throw new Error('Choose at least one camera (a file with a picture).');
  const duration = Math.max(...files.map((f) => f.offset + f.media.duration));
  const angles: Angle[] = cams.map((f, i) => ({
    id: uid('a'),
    name: f.media.name.replace(/\.[^.]+$/, ''),
    media: f.media.id,
    offset: f.offset,
    color: LABELS[i % LABELS.length] as string,
    live: false,
  }));
  const group: MulticamGroup = { id: uid('g'), name: plan.name, duration, angles, startedAt: 0 };
  const main = cams.reduce((a, b) => (b.media.width * b.media.height > a.media.width * a.media.height ? b : a));
  const fps = nearestRate(main.media.fps || 30);
  const sound = files.filter((f) => plan.sound.includes(f.media.id) && f.media.hasAudio);
  const seq = newSequence(plan.name, even(main.media.width) || 1920, even(main.media.height) || 1080, fps, 3, Math.max(1, sound.length));
  const audio = seq.tracks.filter((t) => t.kind === 'audio');
  while (audio.length < sound.length) {
    const t: Track = newTrack('audio', audio.length + 1);
    audio.push(t);
    seq.tracks.push(t);
  }
  const length = Math.max(1, Math.round(duration * fps));
  const link = uid('l');
  const video = seq.tracks.find((t) => t.kind === 'video') as Track;
  // The first camera that is there from the start shows first.
  const opening = angles.find((a) => a.offset <= 0.001) ?? (angles[0] as Angle);
  const clips: Clip[] = [{ ...newClip(video.id, 0, length, { kind: 'multicam', group: group.id, angle: opening.id, in: 0 }, opening.name), link }];
  sound.forEach((f, i) => {
    const track = audio[i] as Track;
    track.name = f.media.name.replace(/\.[^.]+$/, '');
    track.role = 'dialogue';
    const start = Math.round(f.offset * fps);
    const len = Math.min(length - start, Math.round(f.media.duration * fps));
    if (len > 0) clips.push({ ...newClip(track.id, start, len, { kind: 'media', media: f.media.id, in: 0 }, f.media.name), link });
  });
  seq.clips = clips;
  return {
    project: { ...p, groups: [...p.groups, group], sequences: [...p.sequences, seq], open: seq.id },
    group: group.id,
    sequence: seq.id,
  };
}
