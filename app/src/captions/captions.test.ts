import { describe, expect, it } from 'vitest';
import { CaptionLines, CLEAR_AFTER_MS, wrap } from './lines';
import { Segmenter } from './segmenter';
import { evenLevel, to16k, Words } from './moonshine';

const tone = (s: number, amp: number) => Float32Array.from({ length: Math.round(s * 16000) }, (_, i) => amp * Math.sin(i / 3));

describe('caption lines', () => {
  it('wraps words into short lines and keeps the newest', () => {
    expect(wrap('one two three four five', 9)).toEqual(['one two', 'three', 'four five']);
    const c = new CaptionLines();
    c.addFinal('Welcome everyone to the event tonight', 0);
    c.setPartial('we are so glad', 100);
    expect(c.shown(2, 20, 200)).toEqual(['the event tonight we', 'are so glad']);
  });
  it('clears after a quiet while', () => {
    const c = new CaptionLines();
    c.addFinal('Hello', 0);
    expect(c.shown(2, 40, CLEAR_AFTER_MS + 1)).toEqual([]);
  });
});

describe('phrases', () => {
  it('hands over a phrase when the speaker pauses', () => {
    const s = new Segmenter();
    const out = [...s.push(tone(0.5, 0)), ...s.push(tone(1.5, 0.3)), ...s.push(tone(1, 0))];
    const finals = out.filter((p) => p.kind === 'final');
    expect(finals).toHaveLength(1);
    expect(finals[0]!.audio.length / 16000).toBeGreaterThan(1.5);
    expect(out.some((p) => p.kind === 'partial')).toBe(true);
  });
  it('ignores quiet background', () => {
    const s = new Segmenter();
    expect(s.push(tone(3, 0.001))).toEqual([]);
  });
});

describe('model helpers', () => {
  it('reads word pieces back into text', () => {
    const w = new Words({ model: { vocab: { '<s>': 1, '▁Hello': 5, ',': 6, '▁world': 7, '<0xC3>': 8, '<0xA9>': 9 } } });
    expect(w.text([1, 5, 6, 7])).toBe('Hello, world');
    expect(w.text([5, 8, 9])).toBe('Helloé');
  });
  it('turns 48 kHz into 16 kHz', () => {
    expect(to16k(new Float32Array(4800), 48000).length).toBe(1600);
  });
  it('brings quiet speech up, but not past 20×', () => {
    expect(Math.max(...evenLevel(Float32Array.from([0.1, -0.05])))).toBeCloseTo(0.9);
    expect(Math.max(...evenLevel(Float32Array.from([0.001])))).toBeCloseTo(0.02);
  });
});
