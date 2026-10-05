import { describe, expect, it } from 'vitest';
import { duckGain, gateGain, loudnessGain } from '../player/voice';
import { findPhrases, levels, mergeWords, RATE, spreadWords, unite } from './phrases';

/** Talking (a loud tone) and quiet (faint noise), in seconds. */
function sound(parts: [number, boolean][]): Float32Array {
  const total = parts.reduce((a, [s]) => a + s, 0);
  const out = new Float32Array(Math.round(total * RATE));
  let i = 0;
  let seed = 1;
  for (const [s, talk] of parts) {
    const n = Math.round(s * RATE);
    for (let k = 0; k < n; k++, i++) {
      seed = (seed * 16807) % 2147483647;
      const noise = (seed / 2147483647 - 0.5) * 0.002;
      out[i] = (talk ? 0.3 * Math.sin(i / 5) : 0) + noise;
    }
  }
  return out;
}

describe('finding speech', () => {
  it('a long pause ends a stretch; short ones inside speech do not', () => {
    const a = sound([
      [1, false],
      [2, true],
      [0.2, false],
      [1, true],
      [3, false],
      [2, true],
      [1, false],
    ]);
    const p = findPhrases(a);
    expect(p).toHaveLength(2);
    expect(p[0]?.[0]).toBeCloseTo(0.8, 1);
    expect(p[0]?.[1]).toBeCloseTo(4.4, 1);
    expect(p[1]?.[0]).toBeCloseTo(7, 1);
  });

  it('no stretch is longer than the model can hear at once', () => {
    const p = findPhrases(sound([[70, true]]));
    expect(p.length).toBeGreaterThanOrEqual(3);
    for (const [a, b] of p) expect(b - a).toBeLessThanOrEqual(24.5);
    expect(p[p.length - 1]?.[1]).toBeCloseTo(70, 0);
  });

  it('silence has no speech', () => {
    expect(findPhrases(sound([[5, false]]))).toEqual([]);
  });
});

describe('word times', () => {
  it('shared out over the talking, not the pauses', () => {
    const a = sound([
      [1, true],
      [1, false],
      [1, true],
    ]);
    const w = spreadWords('aaaa bbbb', 10, 13, levels(a));
    expect(w.map((x) => x.w)).toEqual(['aaaa', 'bbbb']);
    expect(w[0]?.s).toBeCloseTo(10, 1);
    expect(w[0]?.e).toBeLessThanOrEqual(11.05);
    expect(w[1]?.s).toBeGreaterThanOrEqual(11.95);
    expect(w[1]?.e).toBeCloseTo(13, 1);
  });

  it('sounds the model writes down are not words', () => {
    expect(spreadWords('[Music] (applause) Hello ♪ there', 0, 2).map((w) => w.w)).toEqual(['Hello', 'there']);
    expect(spreadWords('', 0, 2)).toEqual([]);
  });

  it('new words replace the old ones in the spans listened to', () => {
    const old = [
      { w: 'a', s: 0, e: 1 },
      { w: 'b', s: 5, e: 6 },
    ];
    expect(mergeWords(old, [{ w: 'c', s: 5.2, e: 5.5 }], [[4, 8]]).map((w) => w.w)).toEqual(['a', 'c']);
    expect(
      unite([
        [5, 8],
        [0, 2],
        [1, 3],
      ]),
    ).toEqual([
      [0, 3],
      [5, 8],
    ]);
  });
});

describe('cleanup while editing', () => {
  it('ducking turns down by the ratio above the threshold', () => {
    const d = { threshold: -30, ratio: 4, attack: 20, release: 300 };
    expect(duckGain(-40, d)).toBe(1);
    // 12 dB over with 4:1 is 9 dB down.
    expect(20 * Math.log10(duckGain(-18, d))).toBeCloseTo(-9);
  });

  it('loudness is brought to the target once enough is heard', () => {
    expect(loudnessGain(undefined, -16)).toBe(0);
    expect(loudnessGain({ sum: 1, n: 2 }, -16)).toBe(0);
    // A mean square of 0.001 is about −30.7 LUFS: up by 14.7 dB.
    expect(loudnessGain({ sum: 0.01, n: 10 }, -16)).toBeCloseTo(14.691, 2);
    expect(loudnessGain({ sum: 1e-9, n: 10 }, -16)).toBe(20);
  });

  it('the gate closes under the noise level', () => {
    expect(gateGain(-60, -44, 20)).toBeCloseTo(0.1);
    expect(gateGain(-30, -44, 20)).toBe(1);
  });
});
