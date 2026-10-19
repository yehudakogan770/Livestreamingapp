import { describe, expect, it } from 'vitest';
import { addMedia } from '../model/build';
import { current } from '../model/seq';
import { emptyProject, type MediaItem, type Project, type Word } from '../model/types';
import { phrases, pictureWords, placeBroll, planBroll, shotsShowing } from './broll';
import type { LookIndex } from './search';
import { sequenceWords } from '../model/captions';

const media = (id: string, over: Partial<MediaItem> = {}): MediaItem => ({
  id,
  name: id,
  path: `/m/${id}.mp4`,
  proxy: null,
  kind: 'video',
  duration: 60,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  bin: null,
  ...over,
});

const words = (text: string, at: number, gap = 0.3): Word[] => text.split(' ').map((w, i) => ({ w, s: at + i * gap, e: at + i * gap + 0.25 }));

/** An interview on V1 (with its sound) talking about a dog and the beach; two other shots in the project. */
function project(): { p: Project; looks: Map<string, LookIndex> } {
  const talk = media('talk', {
    transcript: {
      language: 'en',
      model: 'test',
      words: [...words('We took our dog everywhere that summer.', 0), ...words('Mostly we walked along the beach at sunset.', 7)],
      done: [[0, 20]],
    },
  });
  const dog = media('dogs');
  const shore = media('shore');
  const p = addMedia({ ...emptyProject('B-roll'), media: [talk, dog, shore] }, 'talk', 0, 'overwrite', undefined, undefined, { in: 0, out: 20 });
  const looks = new Map<string, LookIndex>([
    [
      'dogs',
      {
        version: 1,
        every: 2,
        looks: [
          { t: 1, faces: 0, people: 0, face: 0, labels: [] },
          { t: 3, faces: 0, people: 0, face: 0, labels: [['dog', 0.9]] },
          { t: 5, faces: 0, people: 0, face: 0, labels: [['dog', 0.8]] },
          { t: 7, faces: 0, people: 0, face: 0, labels: [['dog', 0.85]] },
        ],
      },
    ],
    [
      'shore',
      {
        version: 1,
        every: 2,
        looks: [
          { t: 11, faces: 0, people: 1, face: 0, labels: [['seashore', 0.7]] },
          { t: 13, faces: 0, people: 1, face: 0, labels: [['seashore', 0.75]] },
          { t: 15, faces: 0, people: 1, face: 0, labels: [['seashore', 0.6]] },
        ],
      },
    ],
    // The interview itself shows a person: never B-roll over itself.
    ['talk', { version: 1, every: 2, looks: [{ t: 1, faces: 1, people: 1, face: 0.3, labels: [['dog', 0.9]] }] }],
  ]);
  return { p, looks };
}

describe('B-roll from your media', () => {
  it('picks the words that can be pictured', () => {
    expect(pictureWords(['We', 'took', 'our', 'dogs', 'to', 'the', 'beach', 'today.'])).toEqual(['took', 'dog', 'beach']);
  });

  it('splits the transcript into phrases at sentence ends', () => {
    const { p } = project();
    const s = current(p);
    const ph = phrases(sequenceWords(p, s), 30);
    expect(ph).toHaveLength(2);
  });

  it('finds stretches of a file showing a thing (aliases too: beach → seashore)', () => {
    const { looks } = project();
    const dog = shotsShowing(looks.get('dogs') as LookIndex, 'dog', 0.35);
    expect(dog).toEqual([{ from: 2, to: 8, label: 'dog', score: 0.9 }]);
    expect(shotsShowing(looks.get('shore') as LookIndex, 'beach', 0.35)[0]?.label).toBe('seashore');
    expect(shotsShowing(looks.get('shore') as LookIndex, 'beach', 0.8)).toEqual([]);
  });

  it('puts a dog shot over the dog sentence and the beach over the beach, never the interview over itself', () => {
    const { p, looks } = project();
    const s = current(p);
    const picks = planBroll(p, s, looks);
    expect(picks.map((k) => [k.media, k.word])).toEqual([
      ['dogs', 'dog'],
      ['shore', 'beach'],
    ]);
    const [a, b] = picks;
    expect(a?.from).toBe(0);
    expect(b?.from).toBe(210);
    // At most five seconds, from inside the stretch that shows it.
    expect((a?.to ?? 0) - (a?.from ?? 0)).toBeLessThanOrEqual(150);
    expect(a?.in).toBeGreaterThanOrEqual(2);
    const r = placeBroll(p, picks);
    const q = current(r.project);
    const track = q.tracks.find((t) => t.id === r.track);
    expect(track?.name).toBe('B-roll');
    expect(track?.kind).toBe('video');
    // Above the other picture tracks.
    const order = q.tracks.filter((t) => t.kind === 'video').map((t) => t.id);
    expect(order[order.length - 1]).toBe(r.track);
    expect(q.clips.filter((c) => c.track === r.track)).toHaveLength(2);
  });

  it('keeps shots apart', () => {
    const { p, looks } = project();
    const picks = planBroll(p, current(p), looks, { longest: 5, shortest: 2, gap: 10, sure: 0.35 });
    expect(picks).toHaveLength(1);
  });
});
