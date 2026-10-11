// Who is speaking on one microphone: the transcript's phrases are told apart
// by the sound of each voice (speaker diarization), on this computer.
//
// Each phrase gets a voice print: the average shape of its spectrum (mel
// cepstrum, the same measure speech recognizers use), how much that shape
// moves, and the voice's pitch. Prints are compared with each other (cosine
// distance, after evening out each measure over the whole file) and grouped
// bottom-up; the number of voices is the grouping that separates them best
// (one voice when nothing separates clearly). Short phrases take the voice
// of the phrase next to them.
import { fft } from '../extras/beats';
import type { MediaItem, Project, Transcript } from '../model/types';

/** The sound's samples a second (the speech model's rate). */
export const VOICE_RATE = 16000;
const FRAME = 400;
const HOP = 160;
const NFFT = 512;
const MELS = 40;
const CEPS = 19;
/** A phrase ends at a pause this long (seconds), and is cut after this long. */
const PAUSE = 0.3;
const LONGEST = 6;
/** Shorter phrases (seconds) take a neighbor's voice. */
const SHORTEST = 0.7;

const hz2mel = (f: number): number => 2595 * Math.log10(1 + f / 700);
const mel2hz = (m: number): number => 700 * (10 ** (m / 2595) - 1);

let bank: { from: number; w: Float32Array }[] | null = null;
/** Triangular mel filters from 80 Hz to 7.6 kHz over the FFT's bins (each kept as its first bin and weights). */
function melBank(): { from: number; w: Float32Array }[] {
  if (bank) return bank;
  const lo = hz2mel(80);
  const hi = hz2mel(7600);
  const edges = Array.from({ length: MELS + 2 }, (_, i) => (mel2hz(lo + ((hi - lo) * i) / (MELS + 1)) * NFFT) / VOICE_RATE);
  bank = Array.from({ length: MELS }, (_, m) => {
    const f = new Float32Array(NFFT / 2 + 1);
    const [a, b, c] = [edges[m] as number, edges[m + 1] as number, edges[m + 2] as number];
    for (let k = 0; k < f.length; k++) {
      if (k > a && k <= b) f[k] = (k - a) / (b - a);
      else if (k > b && k < c) f[k] = (c - k) / (c - b);
    }
    const first = Math.max(
      0,
      f.findIndex((v) => v > 0),
    );
    let last = f.length - 1;
    while (last > first && !f[last]) last--;
    return { from: first, w: f.slice(first, last + 1) };
  });
  return bank;
}

const hamming = Float32Array.from({ length: FRAME }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));

/** The pitch of a frame (Hz) by autocorrelation, or 0 when it isn't voiced. */
function pitchOf(x: Float32Array, at: number): number {
  const minLag = Math.floor(VOICE_RATE / 400);
  const maxLag = Math.floor(VOICE_RATE / 70);
  const n = Math.min(FRAME, x.length - at - maxLag);
  if (n < 200) return 0;
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += (x[at + i] as number) ** 2;
  if (e0 <= 1e-8) return 0;
  let best = 0;
  let lag = 0;
  for (let l = minLag; l <= maxLag; l++) {
    let s = 0;
    let el = 0;
    for (let i = 0; i < n; i++) {
      const y = x[at + i + l] as number;
      s += (x[at + i] as number) * y;
      el += y * y;
    }
    const r = s / Math.sqrt(e0 * el + 1e-12);
    if (r > best) {
      best = r;
      lag = l;
    }
  }
  return best > 0.55 && lag ? VOICE_RATE / lag : 0;
}

/**
 * A voice print for [from, to) seconds of the sound: the mean and spread of
 * the mel cepstrum over the loud frames, and the median pitch. Null when
 * there is too little sound.
 */
export function voicePrint(pcm: Float32Array, from: number, to: number): Float32Array | null {
  const a = Math.max(0, Math.floor(from * VOICE_RATE));
  const b = Math.min(pcm.length, Math.floor(to * VOICE_RATE));
  if (b - a < FRAME * 4) return null;
  const mels = melBank();
  const re = new Float32Array(NFFT);
  const im = new Float32Array(NFFT);
  const frames: { c: Float32Array; e: number; at: number }[] = [];
  for (let at = a; at + FRAME <= b; at += HOP) {
    re.fill(0);
    im.fill(0);
    let e = 0;
    // Pre-emphasis, then the window.
    for (let i = 0; i < FRAME; i++) {
      const v = (pcm[at + i] as number) - 0.97 * (i ? (pcm[at + i - 1] as number) : 0);
      re[i] = v * (hamming[i] as number);
      e += v * v;
    }
    fft(re, im);
    const logMel = new Float32Array(MELS);
    for (let m = 0; m < MELS; m++) {
      const { from, w } = mels[m] as { from: number; w: Float32Array };
      let s = 0;
      for (let k = 0; k < w.length; k++) s += (w[k] as number) * ((re[from + k] as number) ** 2 + (im[from + k] as number) ** 2);
      logMel[m] = Math.log(s + 1e-10);
    }
    // The cepstrum (DCT-II), without c0 (loudness).
    const c = new Float32Array(CEPS);
    for (let j = 1; j <= CEPS; j++) {
      let s = 0;
      for (let m = 0; m < MELS; m++) s += (logMel[m] as number) * Math.cos((Math.PI * j * (m + 0.5)) / MELS);
      c[j - 1] = s;
    }
    frames.push({ c, e: 10 * Math.log10(e / FRAME + 1e-12), at });
  }
  if (frames.length < 4) return null;
  // Only the loud frames (the voice, not the pauses between words).
  const loudest = Math.max(...frames.map((f) => f.e));
  const voiced = frames.filter((f) => f.e > loudest - 30 && f.e > -75);
  if (voiced.length < 4) return null;
  const out = new Float32Array(CEPS * 2 + 1);
  for (const f of voiced) for (let j = 0; j < CEPS; j++) out[j] = (out[j] as number) + (f.c[j] as number) / voiced.length;
  for (const f of voiced)
    for (let j = 0; j < CEPS; j++) out[CEPS + j] = (out[CEPS + j] as number) + ((f.c[j] as number) - (out[j] as number)) ** 2 / voiced.length;
  for (let j = 0; j < CEPS; j++) out[CEPS + j] = Math.sqrt(out[CEPS + j] as number);
  // The pitch, from every few loud frames.
  const pitches: number[] = [];
  for (let i = 0; i < voiced.length; i += Math.max(1, Math.floor(voiced.length / 24))) {
    const p = pitchOf(pcm, (voiced[i] as { at: number }).at);
    if (p) pitches.push(p);
  }
  pitches.sort((x, y) => x - y);
  out[CEPS * 2] = pitches.length ? Math.log2(pitches[Math.floor(pitches.length / 2)] as number) : 0;
  return out;
}

/** Each measure evened out over all the prints (mean 0, spread 1), the pitch counted more. */
function normalize(prints: Float32Array[]): Float32Array[] {
  if (!prints.length) return prints;
  const d = (prints[0] as Float32Array).length;
  const mean = new Float64Array(d);
  const sd = new Float64Array(d);
  for (const p of prints) for (let j = 0; j < d; j++) mean[j] = (mean[j] as number) + (p[j] as number) / prints.length;
  for (const p of prints) for (let j = 0; j < d; j++) sd[j] = (sd[j] as number) + ((p[j] as number) - (mean[j] as number)) ** 2 / prints.length;
  const weight = (j: number) => (j === d - 1 ? 3 : j >= CEPS ? 0.5 : 1);
  return prints.map((p) => Float32Array.from(p, (v, j) => (((v - (mean[j] as number)) / Math.sqrt((sd[j] as number) + 1e-9)) * weight(j)) as number));
}

const cosine = (a: Float32Array, b: Float32Array): number => {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i] as number) * (b[i] as number);
    aa += (a[i] as number) ** 2;
    bb += (b[i] as number) ** 2;
  }
  return 1 - ab / Math.sqrt(aa * bb + 1e-12);
};

/** How well a grouping separates (the mean silhouette, −1 … 1). */
function silhouette(dist: Float64Array, n: number, labels: number[]): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const sums = new Map<number, [number, number]>();
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const l = labels[j] as number;
      const s = sums.get(l) ?? [0, 0];
      s[0] += dist[i * n + j] as number;
      s[1] += 1;
      sums.set(l, s);
    }
    const own = sums.get(labels[i] as number);
    if (!own || own[1] === 0) continue;
    const a = own[0] / own[1];
    let b = Infinity;
    for (const [l, [s, c]] of sums) if (l !== labels[i]) b = Math.min(b, s / c);
    if (b === Infinity) continue;
    total += (b - a) / Math.max(a, b, 1e-9);
  }
  return total / n;
}

/**
 * Group voice prints by speaker (average-linkage, bottom up). Gives each
 * print's voice (0, 1, … in order of first appearance); `weights` (how long
 * each phrase is) keep a voice heard only for a moment from counting as a
 * speaker of its own.
 */
export function groupVoices(given: Float32Array[], weights: number[] = given.map(() => 1), most = 6): number[] {
  const n = given.length;
  if (n < 3) return given.map(() => 0);
  const prints = normalize(given);
  const dist = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) dist[i * n + j] = dist[j * n + i] = cosine(prints[i] as Float32Array, prints[j] as Float32Array);
  // Merge the two closest groups until one is left, keeping each step's grouping.
  let groups: number[][] = Array.from({ length: n }, (_, i) => [i]);
  const steps = new Map<number, number[]>();
  const link = (a: number[], b: number[]) => {
    let s = 0;
    for (const i of a) for (const j of b) s += dist[i * n + j] as number;
    return s / (a.length * b.length);
  };
  while (groups.length > 1) {
    if (groups.length <= most) {
      const labels = new Array<number>(n);
      groups.forEach((g, k) => g.forEach((i) => (labels[i] = k)));
      steps.set(groups.length, labels);
    }
    let best = Infinity;
    let pair: [number, number] = [0, 1];
    for (let a = 0; a < groups.length; a++)
      for (let b = a + 1; b < groups.length; b++) {
        const d = link(groups[a] as number[], groups[b] as number[]);
        if (d < best) {
          best = d;
          pair = [a, b];
        }
      }
    const [a, b] = pair;
    groups = [...groups.filter((_, k) => k !== a && k !== b), [...(groups[a] as number[]), ...(groups[b] as number[])]];
  }
  const total = weights.reduce((x, y) => x + y, 0);
  let chosen: number[] = new Array<number>(n).fill(0);
  let score = 0.2;
  for (const [k, labels] of steps) {
    if (k < 2) continue;
    // Every voice must be heard for a fair part of the time.
    const share = new Map<number, number>();
    labels.forEach((l, i) => share.set(l, (share.get(l) ?? 0) + (weights[i] as number)));
    if ([...share.values()].some((w) => w < total * 0.04)) continue;
    const s = silhouette(dist, n, labels);
    if (s > score + 0.02 * (k - 2)) {
      score = s;
      chosen = labels;
    }
  }
  // Numbered in the order the voices are first heard.
  const order = new Map<number, number>();
  return chosen.map((l) => {
    if (!order.has(l)) order.set(l, order.size);
    return order.get(l) as number;
  });
}

/** The transcript's words in phrases: [first word, last word] (inclusive), split at pauses and cut when long. */
export function phrasesOf(t: Transcript): [number, number][] {
  const out: [number, number][] = [];
  const w = t.words;
  for (let i = 0; i < w.length; i++) {
    const last = out[out.length - 1];
    const prev = w[i - 1];
    const cur = w[i] as Transcript['words'][number];
    if (last && prev && cur.s - prev.e <= PAUSE && cur.e - (w[last[0]] as Transcript['words'][number]).s <= LONGEST) last[1] = i;
    else out.push([i, i]);
  }
  return out;
}

/**
 * Each word's voice, from the file's sound (16 kHz mono from 0 s). Gives
 * null when only one voice is heard.
 */
export async function wordVoices(t: Transcript, pcm: Float32Array, progress: (done: number) => void = () => {}): Promise<number[] | null> {
  const phrases = phrasesOf(t);
  const span = (ph: [number, number]): [number, number] => [(t.words[ph[0]] as { s: number }).s, (t.words[ph[1]] as { e: number }).e];
  const printed: { i: number; print: Float32Array; len: number }[] = [];
  for (let i = 0; i < phrases.length; i++) {
    const [a, b] = span(phrases[i] as [number, number]);
    if (b - a >= SHORTEST) {
      const print = voicePrint(pcm, a, b);
      if (print) printed.push({ i, print, len: b - a });
    }
    // Let the screens draw now and then.
    if (i % 20 === 19) {
      progress(i / phrases.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  if (printed.length < 3) return null;
  const labels = groupVoices(
    printed.map((x) => x.print),
    printed.map((x) => x.len),
  );
  if (!labels.some((l) => l > 0)) return null;
  // Every phrase's voice: its own, or the nearest printed phrase's.
  const voiceOf = new Array<number>(phrases.length).fill(-1);
  printed.forEach((x, k) => (voiceOf[x.i] = labels[k] as number));
  for (let i = 0; i < phrases.length; i++) {
    if (voiceOf[i] !== -1) continue;
    const [a, b] = span(phrases[i] as [number, number]);
    let best = 0;
    let gap = Infinity;
    for (const x of printed) {
      const [c, d] = span(phrases[x.i] as [number, number]);
      const g = c >= b ? c - b : a >= d ? a - d : 0;
      if (g < gap) {
        gap = g;
        best = voiceOf[x.i] as number;
      }
    }
    voiceOf[i] = best;
  }
  const out = new Array<number>(t.words.length).fill(0);
  phrases.forEach(([a, b], i) => {
    for (let k = a; k <= b; k++) out[k] = voiceOf[i] as number;
  });
  return out;
}

/** The voices found put on a file's transcript (null: one voice, so none are marked). */
export function withVoices(p: Project, media: string, voices: number[] | null): Project {
  return {
    ...p,
    media: p.media.map((m) => {
      if (m.id !== media || !m.transcript) return m;
      const words = m.transcript.words.map((w, i) => {
        const { v: _old, ...rest } = w;
        return voices ? { ...rest, v: voices[i] ?? 0 } : rest;
      });
      const count = voices ? Math.max(...voices) + 1 : 0;
      const names = (m.voices ?? []).slice(0, count);
      const next: MediaItem = { ...m, transcript: { ...m.transcript, words } };
      if (count) next.voices = names;
      else delete next.voices;
      return next;
    }),
  };
}

/** Read a file's whole sound (16 kHz mono) a minute at a time. */
export async function readSound(
  m: MediaItem,
  read: (path: string, from: number, seconds: number) => Promise<Float32Array>,
  progress: (done: number) => void,
  stopped: () => boolean,
): Promise<Float32Array | null> {
  const seconds = Math.max(0, m.duration);
  const out = new Float32Array(Math.ceil(seconds * VOICE_RATE) + VOICE_RATE);
  let filled = 0;
  for (let t = 0; t < seconds; t += 60) {
    if (stopped()) return null;
    const part = await read(m.path, t, Math.min(60, seconds - t));
    out.set(part.subarray(0, Math.max(0, out.length - Math.floor(t * VOICE_RATE))), Math.floor(t * VOICE_RATE));
    filled = Math.floor(t * VOICE_RATE) + part.length;
    progress(Math.min(1, (t + 60) / Math.max(1, seconds)));
  }
  return out.subarray(0, Math.max(0, Math.min(out.length, filled)));
}

/**
 * Tell the voices apart in each of some files' transcripts (their sound read
 * through `read`). Gives each file's word voices (null: one voice heard).
 */
export async function findSpeakers(
  media: MediaItem[],
  read: (path: string, from: number, seconds: number) => Promise<Float32Array>,
  progress: (done: number, name: string) => void,
  stopped: () => boolean = () => false,
): Promise<Map<string, number[] | null>> {
  const out = new Map<string, number[] | null>();
  const list = media.filter((m) => m.transcript?.words.length && m.hasAudio);
  for (let k = 0; k < list.length; k++) {
    const m = list[k] as MediaItem;
    const part = (x: number) => progress((k + x) / list.length, m.name);
    const pcm = await readSound(m, read, (x) => part(x * 0.5), stopped);
    if (!pcm || stopped()) break;
    out.set(m.id, await wordVoices(m.transcript as Transcript, pcm, (x) => part(0.5 + x * 0.5)));
  }
  return out;
}
