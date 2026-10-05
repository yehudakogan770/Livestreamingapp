// Finding where people talk in a recording (16 kHz): the stretches the
// speech model is given (a pause ends one; none is longer than it can take),
// and when each word was probably said within a stretch.
import type { Word } from '../model/types';

export const RATE = 16000;
/** 30 ms. */
const FRAME = 480;
const FRAME_S = FRAME / RATE;

/** How loud each 30 ms is (dB). */
export function levels(audio: Float32Array): Float32Array {
  const n = Math.floor(audio.length / FRAME);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let i = f * FRAME; i < (f + 1) * FRAME; i++) sum += (audio[i] as number) ** 2;
    const ms = sum / FRAME;
    out[f] = ms > 1e-12 ? 10 * Math.log10(ms) : -120;
  }
  return out;
}

/** Which 30 ms have someone talking: well above the quiet between words. */
export function voiced(db: Float32Array): boolean[] {
  if (db.length === 0) return [];
  const sorted = [...db].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.15)] as number;
  const loudest = sorted[sorted.length - 1] as number;
  // Above the quiet, but never so high that steady talking (no pauses) is missed.
  const threshold = Math.max(-48, Math.min(floor + 9.5, loudest - 20));
  return [...db].map((v) => v > threshold);
}

export interface PhraseRules {
  /** A pause at least this long ends a stretch (seconds). */
  pause: number;
  /** The longest stretch (the model hears 30 seconds at most). */
  longest: number;
  /** Pauses shorter than this inside speech are ignored. */
  bridge: number;
}

const RULES: PhraseRules = { pause: 1.2, longest: 24, bridge: 0.35 };

/** The stretches with speech, as [from, to] seconds from the start of `audio`. */
export function findPhrases(audio: Float32Array, rules: PhraseRules = RULES): [number, number][] {
  const db = levels(audio);
  const on = voiced(db);
  // Runs of talking, small gaps bridged.
  const runs: [number, number][] = [];
  let start = -1;
  let quiet = 0;
  const bridge = Math.round(rules.bridge / FRAME_S);
  on.forEach((v, f) => {
    if (v) {
      if (start < 0) start = f;
      quiet = 0;
    } else if (start >= 0 && ++quiet > bridge) {
      runs.push([start, f - quiet + 1]);
      start = -1;
      quiet = 0;
    }
  });
  if (start >= 0) runs.push([start, on.length - quiet]);
  // Very short blips are not speech.
  const real = runs.filter(([a, b]) => b - a >= Math.round(0.15 / FRAME_S));
  // Neighbors join until a real pause or the longest the model takes.
  const longest = Math.round(rules.longest / FRAME_S);
  const pause = Math.round(rules.pause / FRAME_S);
  const joined: [number, number][] = [];
  for (const r of real) {
    const last = joined[joined.length - 1];
    if (last && r[0] - last[1] < pause && r[1] - last[0] <= longest) last[1] = r[1];
    else joined.push([...r]);
  }
  // A run still too long is cut at its quietest moment.
  const cut: [number, number][] = [];
  for (const r of joined) {
    let [a, b] = r;
    while (b - a > longest) {
      const lo = a + Math.round(longest / 2);
      const hi = a + longest;
      let at = lo;
      for (let f = lo; f < hi; f++) if ((db[f] as number) < (db[at] as number)) at = f;
      cut.push([a, at]);
      a = at;
    }
    cut.push([a, b]);
  }
  // A little room either side, so first and last sounds aren't clipped.
  const pad = Math.round(0.2 / FRAME_S);
  const total = audio.length / RATE;
  return cut.map(([a, b], i) => {
    const prev = cut[i - 1];
    const next = cut[i + 1];
    const from = Math.max(prev ? prev[1] : 0, a - pad) * FRAME_S;
    const to = Math.min(next ? next[0] : Infinity, b + pad) * FRAME_S;
    return [Math.max(0, from), Math.min(total, to)];
  });
}

/** Words the model writes for sounds, not speech ("[Music]", "(applause)"). */
const NOT_SPEECH = /^[[(*♪].*[\])*♪]$/;

/**
 * The words of a stretch, each given a time: the stretch's talking time
 * (pauses left out) shared out by the length of each word. `db` is the
 * stretch's levels (30 ms each).
 */
export function spreadWords(text: string, from: number, to: number, db?: Float32Array): Word[] {
  const words = text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w && !NOT_SPEECH.test(w) && /[\p{L}\p{N}]/u.test(w));
  if (!words.length || to <= from) return [];
  // The talking moments (or the whole stretch when there's no telling).
  let times: number[] = [];
  if (db && db.length) {
    const on = voiced(db);
    times = on.flatMap((v, f) => (v ? [from + f * FRAME_S] : []));
  }
  if (times.length < words.length) times = Array.from({ length: Math.max(1, Math.round((to - from) / FRAME_S)) }, (_, f) => from + f * FRAME_S);
  const weight = words.map((w) => w.length + 1);
  const total = weight.reduce((a, b) => a + b, 0);
  const at = (k: number) => times[Math.min(times.length - 1, Math.max(0, k))] as number;
  let acc = 0;
  return words.map((w, i) => {
    const first = Math.floor((acc / total) * times.length);
    acc += weight[i] as number;
    // Ends with its last talking moment (a pause after it is not part of it).
    const lastOf = Math.max(first, Math.ceil((acc / total) * times.length) - 1);
    const s = at(first);
    const nextFirst = Math.floor((acc / total) * times.length);
    const e = Math.min(to, at(lastOf) + FRAME_S, i < words.length - 1 ? at(nextFirst) : Infinity);
    return { w, s: round(s), e: round(Math.max(e, s + 0.05)) };
  });
}

const round = (x: number): number => Math.round(x * 1000) / 1000;

/** Spans joined where they touch or overlap. */
export function unite(spans: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** New words for some spans of a file replace what was written there before. */
export function mergeWords(old: Word[], fresh: Word[], spans: [number, number][]): Word[] {
  const inside = (w: Word) => spans.some(([a, b]) => (w.s + w.e) / 2 >= a && (w.s + w.e) / 2 < b);
  return [...old.filter((w) => !inside(w)), ...fresh].sort((a, b) => a.s - b.s);
}
