// Reading what the smart tools listen to: each file's waveform (made once by
// FFmpeg on the computer and cached, the same one the timeline draws), laid
// out on the sequence's or the multicam group's time.
import { sequenceWords } from '../model/captions';
import { rate } from '../model/seq';
import type { MediaItem, Project, Sequence } from '../model/types';
import { inApp, native } from '../native';
import { addClipLevels, envelope, FLOOR_DB } from './envelope';

/** Raised when the person stops a job. */
export class Stopped extends Error {
  constructor() {
    super('Stopped.');
  }
}

export interface Job {
  signal: AbortSignal;
  /** 0–1, and what is happening. */
  progress: (done: number, message: string) => void;
}

export const check = (job: Job): void => {
  if (job.signal.aborted) throw new Stopped();
};

const cache = new Map<string, Promise<Uint8Array>>();

/** A made-up waveform (the browser demo has no files to read). */
function demoPeaks(seconds: number, seed: number): Uint8Array {
  const n = Math.max(1, Math.round(seconds * 100));
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const turn = Math.floor(i / 700 + seed * 0.37) % 3 === seed % 3;
    a[i] = turn ? Math.round(90 + 90 * Math.abs(Math.sin(i / 9) * Math.sin(i / 3.1))) : Math.round(14 + 8 * Math.abs(Math.sin(i / 5)));
  }
  return a;
}

/** A file's waveform (100 peaks a second). */
export function peaksOf(m: MediaItem, seed = 0): Promise<Uint8Array> {
  const path = m.proxy ?? m.path;
  let p = cache.get(path);
  if (!p) {
    p = inApp() ? native.peaks(path) : Promise.resolve(demoPeaks(m.duration, seed));
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

/** Each sound file's loudness on the group's time (step `i`: `i * hop` seconds into the group). */
export async function micEnvelopes(sources: { media: MediaItem; offset: number }[], duration: number, hop: number, job: Job): Promise<Float32Array[]> {
  const count = Math.ceil(duration / hop);
  const out: Float32Array[] = [];
  for (const [i, s] of sources.entries()) {
    check(job);
    job.progress(i / sources.length, `Listening to ${s.media.name}…`);
    const peaks = await peaksOf(s.media, i);
    out.push(envelope(peaks, -s.offset, hop, count));
  }
  check(job);
  return out;
}

/**
 * The loudness of a sequence (step `i`: `i * hop` seconds in): the loudest
 * heard sound clip at each moment. `speechOnly` leaves out music tracks.
 */
export async function sequenceLevels(p: Project, s: Sequence, hop: number, speechOnly: boolean, job: Job): Promise<Float32Array> {
  const fps = rate(s);
  const length = s.clips.reduce((m, c) => Math.max(m, c.start + c.length), 0);
  const out = new Float32Array(Math.ceil(length / fps / hop)).fill(FLOOR_DB);
  const anySolo = s.tracks.some((t) => t.kind === 'audio' && t.solo);
  const tracks = s.tracks.filter((t) => t.kind === 'audio' && !t.off && (!anySolo || t.solo) && !(speechOnly && t.role === 'music'));
  const clips = s.clips.filter((c) => tracks.some((t) => t.id === c.track) && c.enabled && c.source.kind === 'media');
  for (const [i, c] of clips.entries()) {
    check(job);
    job.progress(i / Math.max(1, clips.length), `Listening to ${c.name}…`);
    const src = c.source as { media: string };
    const m = p.media.find((x) => x.id === src.media);
    if (!m?.hasAudio) continue;
    const peaks = await peaksOf(m, i);
    const gain = (typeof c.gain === 'number' ? c.gain : 0) + (tracks.find((t) => t.id === c.track)?.volume ?? 0);
    addClipLevels(out, peaks, c, s, hop, gain);
  }
  check(job);
  return out;
}

/** What is said in the sequence, in seconds. */
export function wordsInSeconds(p: Project, s: Sequence): { w: string; from: number; to: number }[] {
  const fps = rate(s);
  return sequenceWords(p, s).map((w) => ({ w: w.w, from: w.from / fps, to: w.to / fps }));
}
