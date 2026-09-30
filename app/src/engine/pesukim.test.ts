import { describe, expect, it } from 'vitest';
import { backWord, barChunks, barRange, defaultPesukim, glossesOf, goTo, nextWord, wordsOf } from './pesukim';
import { TWELVE_PESUKIM } from './pesukimText';

describe('the 12 Pesukim', () => {
  it('come filled in, the three lines word for word', () => {
    expect(TWELVE_PESUKIM).toHaveLength(12);
    TWELVE_PESUKIM.forEach((p) => {
      const n = wordsOf(p.text).length;
      expect(wordsOf(p.translit).length, p.translit).toBe(n);
      expect(glossesOf(p.english).length, p.english).toBe(n);
    });
    expect(defaultPesukim().pesukim[1]!.text).toContain('שְׁמַע');
    expect(defaultPesukim().look.mode).toBe('bar');
  });

  it('show a long pasuk in stretches that hold every word once', () => {
    for (const p of TWELVE_PESUKIM) {
      const chunks = barChunks({ child: '', ...p });
      expect(chunks[0]![0]).toBe(0);
      expect(chunks.at(-1)![1]).toBe(wordsOf(p.text).length);
      chunks.slice(1).forEach(([a], i) => expect(a).toBe(chunks[i]![1]));
    }
    expect(barChunks({ child: '', ...TWELVE_PESUKIM[11]! }).length).toBeGreaterThan(1);
  });

  it("put the child's name before their pasuk only", () => {
    const p = defaultPesukim();
    p.pesukim[0]!.text = 'a b';
    p.pesukim[1]!.child = 'Chaya';
    p.pesukim[1]!.text = 'c d';
    nextWord(p, 1);
    nextWord(p, 2);
    expect(p.place).toMatchObject({ pasuk: 1, word: 0, intro: true });
    nextWord(p, 3);
    expect(p.place).toMatchObject({ pasuk: 1, word: 0, intro: false });
    backWord(p, 4);
    expect(p.place.intro).toBe(true);
    backWord(p, 5);
    expect(p.place).toMatchObject({ pasuk: 0, word: 1, intro: false });
    goTo(p, 1, 0, 6);
    expect(p.place.intro).toBe(true);
    goTo(p, 1, 0, 7);
    expect(p.place.intro).toBe(false);
  });
});

describe('the bar', () => {
  it('shows one word at a time, or the line when chosen for the event', () => {
    const p = defaultPesukim();
    p.place.word = 2;
    expect(barRange(p)).toEqual([2, 3]);
    p.look.barWords = 'line';
    const [a, b] = barRange(p);
    expect(a).toBeLessThanOrEqual(2);
    expect(b).toBeGreaterThan(3);
    p.look.barWords = 'one';
    p.place.whole = true;
    expect(barRange(p)[0]).toBe(0);
  });
});
