import { describe, expect, it } from 'vitest';
import { addMedia, buildEventProject, type Prepared } from '../model/build';
import { parseEvent } from '../model/event';
import { current, end, onTrack } from '../model/seq';
import { emptyProject, type MediaItem } from '../model/types';
import { buildReel, pickMoments, scoreMoments, type HighlightInput } from './highlights';

const HOP = 0.5;
/** Ten minutes of someone talking steadily (two words a second). */
function talk(): HighlightInput {
  const levels = new Float32Array(1200).fill(-30);
  const words: HighlightInput['words'] = [];
  for (let t = 0; t < 600; t += 0.5) {
    // A pause every 6 seconds (a sentence ends).
    if (t % 6 >= 5.5) continue;
    words.push({ w: 'word', from: t, to: t + 0.4 });
  }
  return { hop: HOP, levels, words, markers: [], changes: [], keywords: [] };
}

describe('scoring moments', () => {
  it('a REPLAY marker makes the moment before it the best', () => {
    const inp = { ...talk(), markers: [{ at: 300, name: 'REPLAY' }] };
    const s = scoreMoments(inp);
    const best = s.total.indexOf(Math.max(...s.total)) * HOP;
    expect(best).toBeGreaterThanOrEqual(288);
    expect(best).toBeLessThanOrEqual(302);
  });

  it('the room reacting (loud, nobody talking) scores what came before it', () => {
    const inp = talk();
    inp.words = inp.words.filter((w) => w.from < 120 || w.from >= 126);
    inp.levels.fill(-10, 240, 252);
    const s = scoreMoments(inp);
    expect(s.reaction[245]).toBe(1);
    expect(s.reaction[100]).toBe(0);
    expect(s.total[236]!).toBeGreaterThan(s.total[600]! + 1);
  });

  it('key words count', () => {
    const inp = { ...talk(), keywords: ['Mazel tov'] };
    const i = inp.words.findIndex((w) => w.from >= 400);
    inp.words[i] = { ...inp.words[i]!, w: 'Mazel' };
    inp.words[i + 1] = { ...inp.words[i + 1]!, w: 'tov!' };
    const s = scoreMoments(inp);
    expect(s.total[800]!).toBeGreaterThan(s.total[200]! + 2);
  });
});

describe('choosing moments', () => {
  const inp = { ...talk(), markers: [{ at: 100, name: 'Highlight' }], keywords: ['amazing'] };
  inp.words[700] = { ...inp.words[700]!, w: 'amazing' };
  const scores = scoreMoments(inp);

  for (const target of [30, 60, 90]) {
    it(`fits ${target} seconds, in order, with no overlaps`, () => {
      const m = pickMoments(inp, scores, { target, length: 8, minLength: 3 }, 600);
      const total = m.reduce((a, x) => a + (x.to - x.from), 0);
      expect(total).toBeLessThanOrEqual(target + 1e-6);
      expect(total).toBeGreaterThan(target - 8);
      m.slice(1).forEach((x, i) => expect(x.from).toBeGreaterThanOrEqual(m[i]!.to));
      expect(m.every((x) => x.to - x.from >= 3 - 1e-9)).toBe(true);
    });
  }

  it('includes the marked moment and the key word, and says why', () => {
    const m = pickMoments(inp, scores, { target: 30, length: 8, minLength: 3 }, 600);
    expect(m.some((x) => x.from <= 100 && x.to >= 92 && x.why.includes('Highlight'))).toBe(true);
    const said = inp.words[700]!.from;
    expect(m.some((x) => x.from <= said && x.to > said && x.why.includes('key words'))).toBe(true);
  });

  it('starts and ends moments in pauses where it can', () => {
    const m = pickMoments(inp, scores, { target: 30, length: 8, minLength: 3 }, 600);
    const inWord = (t: number) => inp.words.some((w) => t > w.from && t < w.to);
    expect(m.filter((x) => !inWord(x.from)).length).toBeGreaterThanOrEqual(m.length - 1);
  });
});

describe('the reel', () => {
  const media: MediaItem = {
    id: 'm1',
    name: 'Talk',
    path: '/t.mp4',
    proxy: null,
    kind: 'video',
    duration: 600,
    width: 1920,
    height: 1080,
    fps: 30,
    hasVideo: true,
    hasAudio: true,
    bin: null,
  };
  const p = addMedia({ ...emptyProject('T'), media: [media] }, 'm1', 0, 'overwrite', undefined, undefined, { in: 0, out: 600 });
  const s = current(p);
  const moments = [
    { id: 'a', from: 100, to: 110, score: 1, why: '', text: '' },
    { id: 'b', from: 20, to: 25, score: 1, why: '', text: '' },
  ];

  it('lays the moments one after another, in the order given, with dissolves', () => {
    const reel = buildReel(s, moments, { fade: 12, title: null, name: 'Reel' });
    expect(reel.id).not.toBe(s.id);
    const v = onTrack(reel, reel.tracks[0]!.id);
    expect(v.map((c) => [c.start, end(c), c.source.kind === 'media' ? c.source.in : -1])).toEqual([
      [0, 300, 100],
      [300, 450, 20],
    ]);
    expect(v[0]?.tIn).toBeNull();
    expect(v[1]?.tIn).toEqual({ type: 'dissolve', length: 12 });
    const a = onTrack(reel, reel.tracks.find((t) => t.kind === 'audio')!.id);
    expect(a[1]?.tIn?.type).toBe('crossfade');
    // Picture and sound of each moment linked, each moment on its own.
    expect(a[0]?.link).toBe(v[0]?.link);
    expect(a[1]?.link).not.toBe(a[0]?.link);
  });

  it('puts the title over the start', () => {
    const reel = buildReel(s, moments, { fade: 0, title: 'Gala night', name: 'Reel' });
    const title = reel.clips.find((c) => c.source.kind === 'text');
    expect(title?.start).toBe(0);
    expect(title?.source.kind === 'text' && title.source.text.text).toBe('Gala night');
    expect(reel.clips.filter((c) => c.tIn).length).toBe(0);
  });
});

describe('markers from Lumora', () => {
  it('an event file brings its highlight markers and replays', () => {
    const event = parseEvent(
      JSON.stringify({
        app: 'Lumora',
        version: 1,
        name: 'Game',
        startedAt: 0,
        durationMs: 60000,
        program: {},
        files: [{ kind: 'camera', sourceId: 'c1', name: 'Wide', path: '/e/w.mp4', startMs: 0 }],
        cuts: [
          { at: 0, id: 'c1', name: 'Wide' },
          { at: 30000, id: null, name: 'Replay' },
        ],
        markers: [{ at: 12000, name: 'Highlight' }],
      }),
    );
    const prep: Prepared = { path: '/e/w.mp4', durationMs: 60000, hasVideo: true, hasAudio: true, width: 1920, height: 1080 };
    const p = buildEventProject(event, '/e/Game.lumora', new Map([['/e/w.mp4', prep]]));
    expect(current(p).markers.map((m) => [m.at, m.name])).toEqual([
      [360, 'Highlight'],
      [900, 'REPLAY'],
    ]);
  });
});
