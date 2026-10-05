// Remove silences and filler words: find the quiet stretches (by level, how
// long, and some room kept either side) and the "um"s and "uh"s in the
// transcript, then take the chosen ones out of every unlocked track at once
// and close up, so picture and sound stay in sync.
import { extractRange } from '../model/edit';
import type { Project } from '../model/types';
import { FLOOR_DB, percentile } from './envelope';

export interface SilenceOptions {
  /** Quieter than this (dB) is silence. */
  thresholdDb: number;
  /** Only silences at least this long (seconds). */
  minDuration: number;
  /** Room kept at each side of a silence (seconds), so words are not clipped. */
  padding: number;
}

export const SILENCE_DEFAULTS: SilenceOptions = { thresholdDb: -42, minDuration: 0.7, padding: 0.15 };

/** A sensible threshold for this sound: a little above its quiet background. */
export function suggestThreshold(levels: Float32Array): number {
  const heard = levels.filter((v) => v > FLOOR_DB);
  if (heard.length === 0) return SILENCE_DEFAULTS.thresholdDb;
  const quiet = percentile(heard, 0.1);
  const loud = percentile(heard, 0.9);
  // Between the background and speech, nearer the background.
  const t = quiet + Math.max(6, (loud - quiet) * 0.3);
  return Math.round(Math.min(-20, Math.max(-65, t)));
}

/** The silences (seconds): stretches quieter than the threshold, long enough, less the padding. */
export function findSilences(levels: Float32Array, hop: number, o: SilenceOptions): [number, number][] {
  const out: [number, number][] = [];
  let from = -1;
  for (let i = 0; i <= levels.length; i++) {
    const quiet = i < levels.length && (levels[i] as number) < o.thresholdDb;
    if (quiet && from < 0) from = i;
    if (!quiet && from >= 0) {
      const a = from * hop;
      const b = i * hop;
      if (b - a >= o.minDuration) {
        // The very start and end need no room on their outer side.
        const lo = from === 0 ? a : a + o.padding;
        const hi = i === levels.length ? b : b - o.padding;
        if (hi - lo > 0.04) out.push([lo, hi]);
      }
      from = -1;
    }
  }
  return out;
}

/** Fillers that are almost always just sounds (checked to remove at first). */
export const SOUND_FILLERS = ['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'ah', 'hmm', 'mm', 'mhm'];
/** Words that are fillers only sometimes (shown, but not checked at first). */
export const WORD_FILLERS = ['like', 'you know', 'i mean', 'sort of', 'kind of', 'basically', 'actually', 'literally', 'so yeah'];
export const DEFAULT_FILLERS = [...SOUND_FILLERS, ...WORD_FILLERS];

const clean = (w: string): string =>
  w
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, '')
    .trim();

export interface Filler {
  /** Frames (sequence). */
  from: number;
  to: number;
  text: string;
  /** Almost surely a filler (a sound, not a word). */
  sure: boolean;
}

/** The fillers in the words (frames), longest phrase first ("you know" before "you"). */
export function findFillers(words: { w: string; from: number; to: number }[], list: string[] = DEFAULT_FILLERS): Filler[] {
  const phrases = [...new Set(list.map(clean).filter(Boolean))].map((x) => x.split(/\s+/)).sort((a, b) => b.length - a.length);
  const sounds = new Set(SOUND_FILLERS);
  const plain = words.map((w) => clean(w.w));
  const out: Filler[] = [];
  for (let i = 0; i < words.length; ) {
    const hit = phrases.find((ph) => ph.every((p, k) => plain[i + k] === p));
    if (!hit) {
      i++;
      continue;
    }
    const first = words[i] as { from: number; to: number };
    const last = words[i + hit.length - 1] as { from: number; to: number };
    const text = hit.join(' ');
    out.push({ from: first.from, to: Math.max(first.from + 1, last.to), text, sure: sounds.has(text) || /^(u+h*m*|e+r+m*|a+h+|h*m+)$/.test(text) });
    i += hit.length;
  }
  return out;
}

export interface Removal {
  id: string;
  kind: 'silence' | 'filler';
  /** Frames (sequence). */
  from: number;
  to: number;
  label: string;
  on: boolean;
}

/** Ranges (frames) joined where they touch or overlap, in order. */
export function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = ranges.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Take the ranges (frames) out of every unlocked track, closing up (latest first, so earlier ones stay put). */
export function rippleRanges(p: Project, ranges: [number, number][]): Project {
  let out = p;
  for (const [from, to] of mergeRanges(ranges).reverse()) out = extractRange(out, from, to);
  return out;
}

/** Silences as removals, in sequence frames (whole frames, inside them). */
export function silenceRemovals(silences: [number, number][], fps: number): Removal[] {
  return silences
    .map(([a, b], i) => ({
      id: `s${i}`,
      kind: 'silence' as const,
      from: Math.ceil(a * fps),
      to: Math.floor(b * fps),
      label: `Silence, ${(b - a).toFixed(1)} s`,
      on: true,
    }))
    .filter((r) => r.to > r.from);
}

export function fillerRemovals(fillers: Filler[]): Removal[] {
  return fillers.map((f, i) => ({ id: `f${i}`, kind: 'filler' as const, from: f.from, to: f.to, label: `“${f.text}”`, on: f.sure }));
}

/** How much shorter the sequence gets (frames). */
export const savedFrames = (removals: Removal[]): number =>
  mergeRanges(removals.filter((r) => r.on).map((r) => [r.from, r.to] as [number, number])).reduce((a, [x, y]) => a + (y - x), 0);
