import { describe, expect, it } from 'vitest';
import { addMedia } from '../model/build';
import { current, end, onTrack } from '../model/seq';
import { emptyProject, type MediaItem, type Project } from '../model/types';
import { addClipLevels, FLOOR_DB, peakToDb } from './envelope';
import { fillerRemovals, findFillers, findSilences, mergeRanges, rippleRanges, savedFrames, silenceRemovals, suggestThreshold } from './silence';

const HOP = 0.05;
function levels(seconds: number, quiet: [number, number][]): Float32Array {
  const v = new Float32Array(Math.round(seconds / HOP)).fill(-20);
  for (const [a, b] of quiet) v.fill(-60, Math.round(a / HOP), Math.round(b / HOP));
  return v;
}

describe('silences', () => {
  const o = { thresholdDb: -40, minDuration: 0.5, padding: 0.1 };

  it('finds quiet stretches long enough, less the padding', () => {
    const found = findSilences(
      levels(10, [
        [2, 3],
        [5, 5.3],
        [7, 8.5],
      ]),
      HOP,
      o,
    );
    expect(found.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)])).toEqual([
      [2.1, 2.9],
      [7.1, 8.4],
    ]);
  });

  it('takes the whole quiet start and end (no padding outside)', () => {
    const found = findSilences(
      levels(10, [
        [0, 1],
        [9, 10],
      ]),
      HOP,
      o,
    );
    expect(found.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)])).toEqual([
      [0, 0.9],
      [9.1, 10],
    ]);
  });

  it('padding bigger than the silence leaves it', () => {
    expect(findSilences(levels(5, [[2, 2.6]]), HOP, { ...o, padding: 0.3 })).toEqual([]);
  });

  it('suggests a threshold between the background and the talking', () => {
    const t = suggestThreshold(levels(10, [[0, 3]]));
    expect(t).toBeGreaterThan(-60);
    expect(t).toBeLessThan(-20);
  });

  it('turns into whole frames inside the silence', () => {
    const r = silenceRemovals([[1.01, 2.01]], 30);
    expect([r[0]?.from, r[0]?.to]).toEqual([31, 60]);
  });

  it('reads waveform peaks as decibels', () => {
    expect(peakToDb(255)).toBeCloseTo(0);
    expect(peakToDb(0)).toBe(FLOOR_DB);
    expect(peakToDb(128)).toBeCloseTo(-12, 0);
  });
});

describe('filler words', () => {
  const words = ['So', 'um,', 'I', 'think', 'you', 'know', 'it', 'was', 'like', 'Uh...', 'great'].map((w, i) => ({ w, from: i * 10, to: i * 10 + 8 }));

  it('finds sounds and phrases, ignoring case and punctuation', () => {
    const f = findFillers(words, ['um', 'uh', 'you know', 'like']);
    expect(f.map((x) => [x.text, x.from, x.to, x.sure])).toEqual([
      ['um', 10, 18, true],
      ['you know', 40, 58, false],
      ['like', 80, 88, false],
      ['uh', 90, 98, true],
    ]);
  });

  it('only checks the sure ones at first', () => {
    const r = fillerRemovals(findFillers(words));
    expect(r.filter((x) => x.on).map((x) => x.label)).toEqual(['“um”', '“uh”']);
  });

  it('uses the list given', () => {
    expect(findFillers(words, ['great']).map((x) => x.text)).toEqual(['great']);
    expect(findFillers(words, [])).toEqual([]);
  });
});

function project(): Project {
  const p = emptyProject('Test');
  const m: MediaItem = {
    id: 'm1',
    name: 'Talk',
    path: '/t.mp4',
    proxy: null,
    kind: 'video',
    duration: 100,
    width: 1920,
    height: 1080,
    fps: 30,
    hasVideo: true,
    hasAudio: true,
    bin: null,
  };
  // A 10-second clip from 10 s into the file, with its sound.
  return addMedia({ ...p, media: [m] }, 'm1', 0, 'overwrite', undefined, undefined, { in: 10, out: 20 });
}

describe('taking them out', () => {
  it('joins touching and overlapping ranges', () => {
    expect(
      mergeRanges([
        [50, 60],
        [10, 20],
        [20, 30],
        [55, 70],
        [80, 80],
      ]),
    ).toEqual([
      [10, 30],
      [50, 70],
    ]);
  });

  it('ripples every track together: picture and sound stay in sync', () => {
    const p = project();
    const q = rippleRanges(p, [
      [90, 120],
      [30, 60],
    ]);
    const s = current(q);
    const v = onTrack(s, s.tracks[0]!.id);
    const a = onTrack(s, s.tracks.find((t) => t.kind === 'audio')!.id);
    const shape = (cs: typeof v) => cs.map((c) => [c.start, end(c), c.source.kind === 'media' ? +c.source.in.toFixed(3) : -1]);
    expect(shape(v)).toEqual([
      [0, 30, 10],
      [30, 60, 12],
      [60, 240, 14],
    ]);
    expect(shape(a)).toEqual(shape(v));
    expect(Math.max(...s.clips.map(end))).toBe(240);
    // Each picture part keeps its sound linked to it.
    for (const c of v) expect(a.some((x) => x.link === c.link && x.start === c.start)).toBe(true);
  });

  it('counts the time saved by the chosen ones only', () => {
    expect(
      savedFrames([
        { id: 'a', kind: 'silence', from: 0, to: 30, label: '', on: true },
        { id: 'b', kind: 'filler', from: 20, to: 40, label: '', on: true },
        { id: 'c', kind: 'filler', from: 100, to: 200, label: '', on: false },
      ]),
    ).toBe(40);
  });

  it('reads a sound clip onto the sequence time', () => {
    const p = project();
    const s = current(p);
    const clip = s.clips.find((c) => s.tracks.find((t) => t.id === c.track)?.kind === 'audio')!;
    // Loud only from 12 s into the file: 2 s into the clip.
    const peaks = new Uint8Array(100 * 100);
    peaks.fill(220, 1200, 1500);
    const out = new Float32Array(20).fill(FLOOR_DB);
    addClipLevels(out, peaks, clip, s, 1);
    expect(out[1]).toBe(FLOOR_DB);
    expect(out[2]).toBeGreaterThan(-10);
    expect(out[4]).toBeGreaterThan(-10);
    expect(out[5]).toBe(FLOOR_DB);
    expect(out[12]).toBe(FLOOR_DB);
  });
});
