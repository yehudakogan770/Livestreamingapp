import { describe, expect, it } from 'vitest';
import { current } from '../model/seq';
import { emptyProject } from '../model/types';
import { chapterStamp, findChapters, isChapterMarker, placeChapterMarkers, youtubeChapters, youtubeProblems, type TimedWord } from './chapters';

/** Talk about one topic after another: each sentence mixes the topic's words with everyday ones. */
function talk(topics: string[][], sentencesEach: number): { words: TimedWord[]; starts: number[] } {
  const filler = ['so', 'we', 'have', 'the', 'and', 'then', 'this', 'is', 'really', 'about', 'a', 'very', 'good'];
  const words: TimedWord[] = [];
  const starts: number[] = [];
  let t = 0;
  let k = 0;
  for (const topic of topics) {
    starts.push(t);
    for (let s = 0; s < sentencesEach; s++) {
      for (let i = 0; i < 12; i++) {
        const w = i % 3 === 1 ? (topic[(s + i) % topic.length] as string) : (filler[k++ % filler.length] as string);
        words.push({ w: i === 11 ? `${w}.` : w, from: t, to: t + 0.3 });
        t += 0.4;
      }
      t += 0.5;
    }
  }
  return { words, starts };
}

const TOPICS = [
  ['camera', 'lens', 'sensor', 'aperture', 'focus', 'camera'],
  ['recipe', 'flour', 'butter', 'oven', 'dough', 'recipe'],
  ['guitar', 'chord', 'strings', 'melody', 'guitar', 'tuning'],
];

describe('chapters from the talk', () => {
  it('starts a chapter where the topic changes, and names it after the topic', () => {
    const { words, starts } = talk(TOPICS, 12);
    const ch = findChapters(words, { minLength: 20, blockWords: 20, window: 2, sensitivity: 0.5, most: 10 });
    expect(ch.length).toBe(3);
    expect(ch[0]?.at).toBe(0);
    for (let i = 1; i < 3; i++) expect(Math.abs((ch[i]?.at ?? 0) - (starts[i] as number))).toBeLessThan(12);
    expect(ch[0]?.title.toLowerCase()).toMatch(/camera|lens|sensor|aperture|focus/);
    expect(ch[1]?.title.toLowerCase()).toMatch(/recipe|flour|butter|oven|dough/);
    expect(ch[2]?.title.toLowerCase()).toMatch(/guitar|chord|string|melody|tuning/);
  });

  it('keeps chapters at least the shortest length apart', () => {
    const { words } = talk(TOPICS, 12);
    const ch = findChapters(words, { minLength: 120, blockWords: 20, window: 2, sensitivity: 0.5, most: 10 });
    for (let i = 1; i < ch.length; i++) expect((ch[i]?.at ?? 0) - (ch[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(120);
  });

  it('no words, no chapters', () => {
    expect(findChapters([])).toEqual([]);
  });
});

describe('YouTube chapters', () => {
  it('writes one line a chapter, starting at 0:00', () => {
    const text = youtubeChapters([
      { at: 3, title: 'Welcome' },
      { at: 75, title: 'The  lens' },
      { at: 3725, title: 'Wrap up' },
    ]);
    expect(text).toBe('0:00 Welcome\n1:15 The lens\n1:02:05 Wrap up');
    expect(chapterStamp(59.9)).toBe('0:59');
  });

  it('says what YouTube would not accept', () => {
    expect(youtubeProblems([{ at: 0, title: 'a' }])).toMatch(/three/);
    expect(
      youtubeProblems([
        { at: 0, title: 'a' },
        { at: 5, title: 'b' },
        { at: 30, title: 'c' },
      ]),
    ).toMatch(/10 seconds/);
    expect(
      youtubeProblems([
        { at: 0, title: 'a' },
        { at: 15, title: 'b' },
        { at: 30, title: 'c' },
      ]),
    ).toBeNull();
  });

  it('chapters become markers (replacing earlier ones)', () => {
    const p = emptyProject('t');
    const once = placeChapterMarkers(
      p,
      [
        { at: 0, title: 'One' },
        { at: 10, title: 'Two' },
      ],
      30,
    );
    expect(current(once).markers.map((m) => [m.at, m.name])).toEqual([
      [0, 'Chapter: One'],
      [300, 'Chapter: Two'],
    ]);
    const again = placeChapterMarkers(once, [{ at: 2, title: 'Only' }], 30);
    expect(current(again).markers.filter(isChapterMarker).length).toBe(1);
  });
});
