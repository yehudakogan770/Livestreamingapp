import { describe, expect, it, vi } from 'vitest';
import { Doc } from '../doc';
import { addMedia } from '../model/build';
import { current } from '../model/seq';
import { emptyProject, type MediaItem } from '../model/types';
import { gatedLoudness, matchChanges, matchLoudness, middle, shiftGain } from './loudmatch';

/** A waveform at a steady level (amplitude 0–1) with silent gaps. */
function speech(seconds: number, amp: number): Uint8Array {
  const out = new Uint8Array(seconds * 100);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(i / 150) % 3 === 2 ? 0 : Math.round(Math.sqrt(amp) * 255);
  return out;
}

vi.mock('./analysis', () => ({
  peaksOf: (m: MediaItem) => Promise.resolve(speech(20, m.id === 'loud' ? 0.5 : 0.05)),
}));

describe('matching loudness', () => {
  it('silent gaps do not make a clip measure quieter', () => {
    const steady = new Uint8Array(2000).fill(Math.round(Math.sqrt(0.5) * 255));
    const gappy = gatedLoudness(speech(20, 0.5), 0, 20) as number;
    expect(gappy).toBeCloseTo(gatedLoudness(steady, 0, 20) as number, 0);
    expect(gatedLoudness(new Uint8Array(2000), 0, 20)).toBeNull();
  });

  it('matches to the middle one, leaves silent ones alone, keeps within 24 dB', () => {
    expect(middle([-30, null, -10, -20])).toBe(-20);
    expect(middle([-30, -10])).toBe(-20);
    expect(matchChanges([-30, null, -10, -60], -20)).toEqual([10, 0, -10, 24]);
  });

  it('moves a volume line as a whole', () => {
    expect(shiftGain(-3, 4.25)).toBe(1.3);
    expect(
      shiftGain(
        {
          k: [
            { t: 0, v: -6, e: 'linear' },
            { t: 9, v: 0, e: 'linear' },
          ],
        },
        2,
      ),
    ).toEqual({
      k: [
        { t: 0, v: -4, e: 'linear' },
        { t: 9, v: 2, e: 'linear' },
      ],
    });
  });

  it('a loud and a quiet clip end up the same', async () => {
    const m = (id: string): MediaItem => ({
      id,
      name: id,
      path: `/${id}.wav`,
      proxy: null,
      kind: 'audio',
      duration: 20,
      width: 0,
      height: 0,
      fps: 30,
      hasVideo: false,
      hasAudio: true,
      bin: null,
    });
    let p = { ...emptyProject('t'), media: [m('loud'), m('quiet')] };
    p = addMedia(p, 'loud', 0, 'overwrite', undefined, undefined, { in: 0, out: 10 });
    p = addMedia(p, 'quiet', 300, 'overwrite', undefined, undefined, { in: 0, out: 10 });
    const doc = new Doc(p);
    doc.select({ kind: 'clips', ids: current(p).clips.map((c) => c.id) });
    const said = await matchLoudness(doc);
    expect(said).toMatch(/Matched 2 clips/);
    const gains = current(doc.project).clips.map((c) => c.gain as number);
    // 20 dB apart (amplitudes 0.5 and 0.05): each moves 10 dB toward the middle.
    expect(gains[0]).toBeCloseTo(-10, 0);
    expect(gains[1]).toBeCloseTo(10, 0);
    // Only once: matched clips stay as they are.
    expect(await matchLoudness(doc)).toBe('The selected clips are already equally loud.');
  });
});
