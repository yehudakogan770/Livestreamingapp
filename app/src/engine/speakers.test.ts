import { describe, expect, it } from 'vitest';
import { SpeakerWatch } from './speakers';

const s = { holdS: 6, againMin: 3 };
const run = (w: SpeakerWatch, levels: Record<string, number>, from: number, to: number) => {
  let got: string | null = null;
  for (let t = from; t <= to; t += 100) got = w.feed(new Map(Object.entries(levels)), s, t) ?? got;
  return got;
};

describe('automatic speaker names', () => {
  it('a cough is not a speaker', () => {
    expect(run(new SpeakerWatch(), { mic1: 0.3 }, 0, 600)).toBeNull();
  });
  it('someone talking for a moment gets their name on', () => {
    expect(run(new SpeakerWatch(), { mic1: 0.3 }, 0, 2000)).toBe('mic1');
  });
  it('the same person isn’t named again for a few minutes', () => {
    const w = new SpeakerWatch();
    run(w, { mic1: 0.3 }, 0, 2000);
    expect(run(w, { mic1: 0.3 }, 10_000, 60_000)).toBeNull();
    expect(run(w, { mic1: 0.3 }, 200_000, 205_000)).toBe('mic1');
  });
  it('a new speaker waits until the name on air has had its time', () => {
    const w = new SpeakerWatch();
    run(w, { mic1: 0.3, mic2: 0 }, 0, 2000);
    expect(run(w, { mic1: 0, mic2: 0.3 }, 2100, 4000)).toBeNull();
    expect(run(w, { mic1: 0, mic2: 0.3 }, 4100, 9000)).toBe('mic2');
  });
});
