import { describe, expect, it } from 'vitest';
import { emptyProject, type MediaItem, type Transcript, type Word } from '../model/types';
import { groupVoices, phrasesOf, VOICE_RATE, voicePrint, withVoices, wordVoices } from './voices';

/** A made-up voice: a pitch with its harmonics shaped by three formants, a little vibrato and breath. */
function voice(f0: number, formants: [number, number, number], seconds: number, seed: number): Float32Array {
  const n = Math.floor(seconds * VOICE_RATE);
  const out = new Float32Array(n);
  let phase = 0;
  let r = seed;
  const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  const shape = (f: number) => formants.reduce((a, F, i) => a + Math.exp(-(((f - F) / (80 + 40 * i)) ** 2)) / (1 + i * 0.6), 0.02);
  for (let i = 0; i < n; i++) {
    const t = i / VOICE_RATE;
    const pitch = f0 * (1 + 0.03 * Math.sin(2 * Math.PI * 4.5 * t) + 0.05 * Math.sin(2 * Math.PI * 0.7 * t + seed));
    phase += (2 * Math.PI * pitch) / VOICE_RATE;
    let v = 0;
    for (let h = 1; h * pitch < 7500; h++) v += shape(h * pitch) * Math.sin(h * phase);
    // Syllables: the loudness comes and goes four times a second.
    const env = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t + seed);
    out[i] = 0.2 * env * v + 0.003 * rand();
  }
  return out;
}

const A = { f0: 110, formants: [650, 1100, 2500] as [number, number, number] };
const B = { f0: 215, formants: [420, 2300, 3100] as [number, number, number] };

/** Turns of speech (who, seconds), with a 0.5 s pause after each; words every 0.25 s. */
function conversation(turns: [typeof A, number][]): { pcm: Float32Array; t: Transcript; who: number[] } {
  const total = turns.reduce((a, [, d]) => a + d + 0.5, 0);
  const pcm = new Float32Array(Math.ceil(total * VOICE_RATE));
  const words: Word[] = [];
  const who: number[] = [];
  let at = 0;
  turns.forEach(([v, d], k) => {
    pcm.set(voice(v.f0, v.formants, d, k + 1), Math.floor(at * VOICE_RATE));
    for (let s = at; s + 0.25 <= at + d + 1e-9; s += 0.25) {
      words.push({ w: 'word', s, e: s + 0.22 });
      who.push(v === A ? 0 : 1);
    }
    at += d + 0.5;
  });
  return { pcm, t: { language: 'en', model: 'test', words, done: [[0, total]] }, who };
}

describe('telling voices apart on one microphone', () => {
  it('phrases split at pauses and are cut when long', () => {
    const { t } = conversation([
      [A, 2],
      [B, 9],
    ]);
    const ph = phrasesOf(t);
    expect(ph[0]).toEqual([0, 7]);
    // The 9-second turn is cut into pieces no longer than 6 seconds.
    expect(ph.length).toBe(3);
  });

  it('a voice print is steady for the same voice and differs between voices', () => {
    const a1 = voicePrint(voice(A.f0, A.formants, 2, 1), 0, 2) as Float32Array;
    const a2 = voicePrint(voice(A.f0, A.formants, 2, 7), 0, 2) as Float32Array;
    const b = voicePrint(voice(B.f0, B.formants, 2, 3), 0, 2) as Float32Array;
    const d = (x: Float32Array, y: Float32Array) => Math.hypot(...Array.from(x, (v, i) => v - (y[i] as number)));
    expect(d(a1, a2)).toBeLessThan(d(a1, b));
    // The last measure is the pitch (log2 Hz).
    expect(2 ** (a1[a1.length - 1] as number)).toBeGreaterThan(95);
    expect(2 ** (a1[a1.length - 1] as number)).toBeLessThan(130);
    expect(2 ** (b[b.length - 1] as number)).toBeGreaterThan(190);
  });

  it('finds two people taking turns, and which words each says', async () => {
    const { pcm, t, who } = conversation([
      [A, 3],
      [B, 2.5],
      [A, 2],
      [B, 3],
      [A, 2.5],
      [B, 2],
    ]);
    const v = await wordVoices(t, pcm);
    expect(v).not.toBeNull();
    const agree = (v as number[]).filter((x, i) => x === who[i]).length / who.length;
    expect(agree).toBeGreaterThan(0.95);
  });

  it('one person talking is one voice (nothing is marked)', async () => {
    const { pcm, t } = conversation([
      [A, 3],
      [A, 2.5],
      [A, 2],
      [A, 3],
    ]);
    expect(await wordVoices(t, pcm)).toBeNull();
  });

  it('groups clearly separate prints; keeps similar ones together', () => {
    const near = (x: number) => Float32Array.from({ length: 6 }, (_, i) => x + Math.sin(i * 3 + x) * 0.05);
    const prints = [near(0), near(5), near(0.1), near(5.1), near(0.05), near(4.9)];
    const labels = groupVoices(prints.map((p, i) => Float32Array.from(p, (v, j) => (j === i % 6 ? v : v) + (i % 2 ? 2 * Math.cos(j) : 2 * Math.sin(j)))));
    expect(labels).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('voices are kept on the transcript and can be cleared', () => {
    const m: MediaItem = {
      id: 'm',
      name: 'Interview',
      path: '/i.wav',
      proxy: null,
      kind: 'audio',
      duration: 10,
      width: 0,
      height: 0,
      fps: 0,
      hasVideo: false,
      hasAudio: true,
      bin: null,
      voices: ['Dana', 'Sam', 'Old'],
      transcript: {
        language: 'en',
        model: 'x',
        words: [
          { w: 'hi', s: 0, e: 0.2 },
          { w: 'there', s: 1, e: 1.2 },
        ],
        done: [],
      },
    };
    const p = { ...emptyProject('T'), media: [m] };
    const q = withVoices(p, 'm', [0, 1]);
    expect(q.media[0]?.transcript?.words.map((w) => w.v)).toEqual([0, 1]);
    expect(q.media[0]?.voices).toEqual(['Dana', 'Sam']);
    const r = withVoices(q, 'm', null);
    expect(r.media[0]?.transcript?.words.some((w) => 'v' in w)).toBe(false);
    expect(r.media[0]?.voices).toBeUndefined();
  });
});
