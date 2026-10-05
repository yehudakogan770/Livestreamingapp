// Loudness envelopes for the smart tools: the waveform peaks Lumora Studio
// already makes for the timeline (100 a second, made once by FFmpeg and
// cached) turned into decibels on an even grid of steps.
import { rate } from '../model/seq';
import type { Clip, Sequence } from '../model/types';

/** How many peaks a waveform has per second of sound (see the Rust side, media::PEAKS_PER_SECOND). */
export const PEAKS_PER_SECOND = 100;
/** The quietest level the tools use (digital silence). */
export const FLOOR_DB = -100;

/** A waveform peak (0–255, square-root scaled) as decibels below full scale. */
export function peakToDb(p: number): number {
  const a = (p / 255) ** 2;
  return a <= 1e-5 ? FLOOR_DB : 20 * Math.log10(a);
}

/**
 * The loudness of a file on a grid: step `i` covers `start + i * hop` seconds of the
 * file for `hop` seconds (the average power of its peaks, in dB). Outside the file: silence.
 */
export function envelope(peaks: Uint8Array, start: number, hop: number, count: number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = levelAt(peaks, start + i * hop, hop);
  return out;
}

/** The loudness (dB) of `seconds` of a waveform from `from`: the average power of its peaks. */
export function levelAt(peaks: Uint8Array, from: number, seconds: number): number {
  if (from + seconds <= 0) return FLOOR_DB;
  const a = Math.max(0, Math.floor(from * PEAKS_PER_SECOND));
  const b = Math.min(peaks.length, Math.max(a + 1, Math.ceil((from + seconds) * PEAKS_PER_SECOND)));
  if (b <= a) return FLOOR_DB;
  let power = 0;
  for (let k = a; k < b; k++) {
    const amp = ((peaks[k] as number) / 255) ** 2;
    power += amp * amp;
  }
  const rms = Math.sqrt(power / (b - a));
  return rms <= 1e-5 ? FLOOR_DB : 20 * Math.log10(rms);
}

/**
 * A sound clip's loudness laid onto a sequence grid (step `i` is `i * hop` seconds
 * into the sequence): the louder of what is there and this clip wins.
 */
export function addClipLevels(out: Float32Array, peaks: Uint8Array, c: Clip, s: Sequence, hop: number, gainDb = 0): void {
  if (!('in' in c.source) || c.reverse || !c.enabled) return;
  const fps = rate(s);
  const src = c.source.in;
  const first = Math.max(0, Math.floor(c.start / fps / hop));
  const last = Math.min(out.length, Math.ceil((c.start + c.length) / fps / hop));
  for (let i = first; i < last; i++) {
    const seqT = i * hop;
    const into = seqT - c.start / fps;
    if (into < 0 || into >= c.length / fps) continue;
    const fileT = src + into * c.speed;
    const v = levelAt(peaks, fileT, hop * c.speed) + gainDb;
    if (v > (out[i] as number)) out[i] = v;
  }
}

/** The value below which `q` (0–1) of the levels fall. */
export function percentile(levels: ArrayLike<number>, q: number): number {
  if (levels.length === 0) return FLOOR_DB;
  const sorted = Float32Array.from(levels).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))] as number;
}
