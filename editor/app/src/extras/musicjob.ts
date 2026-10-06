// Reading a song for the music tools: its sound (16 kHz, a minute at a time,
// through FFmpeg) and its beats, worked out once and kept with the file's
// other analysis (so opening the project again is instant).
import type { MediaItem } from '../model/types';
import { inApp, native } from '../native';
import { check, peaksOf, type Job } from '../smart/analysis';
import { analyzeBeats, beatsFromEnvelope, onsetsFromPeaks, type Beats } from './beats';

const RATE = 16000;
const STEP = 60;
/** Longest stretch of a file that is listened to (seconds). */
const MOST = 20 * 60;

const known = new Map<string, Beats>();
const fileOf = (m: MediaItem) => m.proxy ?? m.path;

function decode(bytes: Uint8Array): Beats | null {
  if (!bytes.length) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes)) as Beats;
    return Array.isArray(v.beats) && typeof v.bpm === 'number' ? v : null;
  } catch {
    return null;
  }
}

/** Beats already worked out for a file (null if not yet). */
export async function savedBeats(m: MediaItem): Promise<Beats | null> {
  const k = fileOf(m);
  const mem = known.get(k);
  if (mem) return mem;
  if (!inApp()) return null;
  const b = decode(await native.matteRead(k, 'beats').catch(() => new Uint8Array()));
  if (b) known.set(k, b);
  return b;
}

/** A file's beats (worked out and kept the first time). */
export async function beatsOf(m: MediaItem, job: Job): Promise<Beats> {
  const saved = await savedBeats(m);
  if (saved) return saved;
  let b: Beats;
  if (inApp()) {
    const length = Math.min(MOST, m.duration || MOST);
    const parts: Float32Array[] = [];
    for (let t = 0; t < length; t += STEP) {
      check(job);
      job.progress((t / length) * 0.8, `Listening to ${m.name}…`);
      const got = await native.speechAudio(m.path, t, Math.min(STEP, length - t));
      parts.push(got);
      if (got.length < STEP * RATE * 0.5 && t + STEP < length) break;
    }
    const audio = new Float32Array(parts.reduce((a, x) => a + x.length, 0));
    let o = 0;
    for (const x of parts) {
      audio.set(x, o);
      o += x.length;
    }
    check(job);
    job.progress(0.85, 'Finding the beats…');
    await new Promise((r) => setTimeout(r, 0));
    b = analyzeBeats(audio, RATE);
    void native.matteWrite(fileOf(m), 'beats', new TextEncoder().encode(JSON.stringify(b))).catch(() => undefined);
  } else {
    // The browser demo: the waveform is all there is.
    const env = onsetsFromPeaks(await peaksOf(m));
    b = beatsFromEnvelope(env);
  }
  known.set(fileOf(m), b);
  check(job);
  return b;
}
