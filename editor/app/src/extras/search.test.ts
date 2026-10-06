import { describe, expect, it } from 'vitest';
import { current } from '../model/seq';
import { emptyProject, newClip, type MediaItem, type Project } from '../model/types';
import { decodeLooks, encodeLooks, hitsToBin, labelMatches, lookTimes, parseQuery, search, selectsSequence, shotType, type LookIndex } from './search';
import { applyDuckPreset, DUCK_PRESETS, enhanceSpeech, ENHANCE_CHAIN } from './voice';

const media = (id: string, words: string[], duration = 60): MediaItem => ({
  id,
  name: id,
  path: `/${id}.mp4`,
  proxy: null,
  kind: 'video',
  duration,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  bin: null,
  transcript: { language: 'en', model: 'whisper-base', done: [[0, duration]], words: words.map((w, i) => ({ w, s: i, e: i + 0.8 })) },
});

const looks: LookIndex = {
  version: 1,
  every: 2,
  looks: [
    { t: 1, faces: 0, people: 0, face: 0, labels: [['seashore', 0.8]] },
    { t: 3, faces: 1, people: 1, face: 0.4, labels: [['person', 0.9]] },
    { t: 5, faces: 1, people: 1, face: 0.35, labels: [['person', 0.9]] },
    {
      t: 7,
      faces: 2,
      people: 2,
      face: 0.15,
      labels: [
        ['person', 0.9],
        ['dog', 0.7],
      ],
    },
    {
      t: 9,
      faces: 0,
      people: 3,
      face: 0,
      labels: [
        ['car', 0.6],
        ['person', 0.8],
      ],
    },
  ],
};

describe('search queries', () => {
  it('reads people, faces and shot filters out of the words', () => {
    expect(parseQuery('2 people').people).toEqual({ op: '=', n: 2 });
    expect(parseQuery('3+ faces').faces).toEqual({ op: '>=', n: 3 });
    expect(parseQuery('people:1 dog').people).toEqual({ op: '=', n: 1 });
    expect(parseQuery('people:1 dog').words).toEqual(['dog']);
    expect(parseQuery('close-up of Sarah').shot).toBe('close');
    expect(parseQuery('close-up of Sarah').words).toEqual(['of', 'sarah']);
    expect(parseQuery('wide shot beach').shot).toBe('wide');
    expect(parseQuery('nobody').people).toEqual({ op: '=', n: 0 });
    expect(parseQuery('"thank you"').exact).toBe(true);
  });

  it('shot type from face size', () => {
    expect(shotType({ t: 0, faces: 1, people: 1, face: 0.4, labels: [] })).toBe('close');
    expect(shotType({ t: 0, faces: 1, people: 1, face: 0.2, labels: [] })).toBe('medium');
    expect(shotType({ t: 0, faces: 0, people: 2, face: 0, labels: [] })).toBe('wide');
    expect(shotType({ t: 0, faces: 0, people: 0, face: 0, labels: [] })).toBeNull();
  });

  it('labels match words and aliases', () => {
    expect(labelMatches('seashore', 'beach')).toBe(true);
    expect(labelMatches('sports car', 'car')).toBe(true);
    expect(labelMatches('cell phone', 'phone')).toBe(true);
    expect(labelMatches('dog', 'cat')).toBe(false);
  });
});

describe('search', () => {
  const a = media('a', 'hello and welcome to the show today we talk about the new camera lens'.split(' '));
  const b = media('b', 'thank you for watching the show see you next time'.split(' '));
  const index = new Map([['a', looks]]);

  it('finds spoken words, best match first, with the time they are said', () => {
    const hits = search([a, b], index, 'the show');
    expect(hits.length).toBe(2);
    expect(hits.every((h) => h.kind === 'speech')).toBe(true);
    expect(hits.find((h) => h.media === 'a')?.from).toBe(4);
    expect(hits.find((h) => h.media === 'b')?.from).toBe(4);
  });

  it('words apart, and an exact phrase', () => {
    expect(search([a], index, 'welcome camera').length).toBe(1);
    expect(search([a], index, '"welcome camera"').length).toBe(0);
    expect(search([b], index, '"thank you"')[0]?.from).toBe(0);
  });

  it('a word starts a longer word', () => {
    expect(search([b], index, 'watch')[0]?.from).toBe(3);
  });

  it('finds what is seen, joining frames next to each other', () => {
    const close = search([a], index, 'close-up');
    expect(close.length).toBe(1);
    expect(close[0]?.kind).toBe('picture');
    expect(close[0]?.from).toBe(2);
    expect(close[0]?.to).toBe(6);
    expect(search([a], index, '2 people')[0]?.from).toBe(6);
    expect(search([a], index, 'dog').map((h) => h.from)).toEqual([6]);
    expect(search([a], index, 'beach')[0]?.text).toContain('seashore');
    expect(search([a], index, 'crowd').length).toBe(0);
    expect(search([a], index, '3+ people')[0]?.from).toBe(8);
  });

  it('keeps the picture index', () => {
    expect(decodeLooks(encodeLooks(looks))).toEqual(looks);
    expect(decodeLooks(new Uint8Array())).toBeNull();
    expect(lookTimes(10, 2)).toEqual([1, 3, 5, 7, 9]);
  });
});

describe('enhance speech and ducking presets', () => {
  const setup = () => {
    let p: Project = emptyProject('t');
    const s = current(p);
    const [a1, a2] = s.tracks.filter((t) => t.kind === 'audio');
    const tracks = s.tracks.map((t) => (t.id === a1!.id ? { ...t, role: 'dialogue' as const } : t.id === a2!.id ? { ...t, role: 'music' as const } : t));
    const voice = newClip(a1!.id, 0, 100, { kind: 'media', media: 'm', in: 0 }, 'voice');
    const song = newClip(a2!.id, 0, 100, { kind: 'media', media: 'n', in: 0 }, 'song');
    p = { ...p, sequences: [{ ...s, tracks, clips: [voice, song] }] };
    return { p, voice, song };
  };

  it('puts the whole chain on, once', () => {
    const { p, voice } = setup();
    const once = enhanceSpeech(p, [voice.id]);
    expect(once.count).toBe(1);
    const twice = enhanceSpeech(once.project, [voice.id]).project;
    const fx = current(twice).clips.find((c) => c.id === voice.id)!.effects;
    expect(fx.map((e) => e.type)).toEqual(ENHANCE_CHAIN.map(([t]) => t));
    expect(fx.find((e) => e.type === 'loudnorm')?.p.target).toBe(-16);
  });

  it('a ducking preset goes on music clips, not speech', () => {
    const { p, song } = setup();
    const strong = DUCK_PRESETS.find((d) => d.id === 'strong')!;
    const { project, count } = applyDuckPreset(p, [], strong);
    expect(count).toBe(1);
    const duck = current(project)
      .clips.find((c) => c.id === song.id)!
      .effects.find((e) => e.type === 'duck');
    expect(duck?.p.ratio).toBe(20);
    // Again with another preset: the same effect changes.
    const gentle = applyDuckPreset(project, [song.id], DUCK_PRESETS[0]!).project;
    const list = current(gentle)
      .clips.find((c) => c.id === song.id)!
      .effects.filter((e) => e.type === 'duck');
    expect(list.length).toBe(1);
    expect(list[0]?.p.ratio).toBe(3);
  });
});

describe('search results into the project', () => {
  it('a selects sequence and a bin', () => {
    const p = { ...emptyProject('t'), media: [media('a', ['hi', 'there']), media('b', ['bye'])] };
    const hits = search(p.media, new Map(), 'hi');
    const made = selectsSequence(p, hits, 'Selects: hi');
    const s = current(made.project);
    expect(s.name).toBe('Selects: hi');
    expect(s.clips.length).toBe(2);
    expect(s.clips[0]?.link).toBe(s.clips[1]?.link);
    expect(s.clips[0]?.source).toEqual({ kind: 'media', media: 'a', in: 0 });
    const binned = hitsToBin(p, hits, 'Search: hi');
    expect(binned.count).toBe(1);
    expect(binned.project.media.find((m) => m.id === 'a')?.bin).toBe(binned.bin);
    expect(binned.project.media.find((m) => m.id === 'b')?.bin).toBeNull();
  });
});
