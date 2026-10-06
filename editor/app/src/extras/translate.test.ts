import { describe, expect, it } from 'vitest';
import { placeCaptions } from '../model/captions';
import { current } from '../model/seq';
import { emptyProject } from '../model/types';
import { MT_LANGUAGES, Unigram } from './marian';
import { addTranslatedTrack, trackBlocks } from './translate';

const vocab: [string, number][] = [
  ['</s>', 0],
  ['<unk>', 0],
  ['▁hello', -2],
  ['▁he', -3],
  ['llo', -3],
  ['▁world', -2],
  ['▁wor', -4],
  ['ld', -4],
  [',', -2],
  ['▁', -3],
  ['h', -5],
  ['e', -5],
  ['l', -5],
  ['o', -5],
  ['<pad>', 0],
];
const tok = new Unigram({
  model: { type: 'Unigram', vocab },
  added_tokens: [
    { id: 0, content: '</s>' },
    { id: 1, content: '<unk>' },
    { id: 14, content: '<pad>' },
  ],
});

describe('the unigram tokenizer', () => {
  it('splits words into their most likely pieces', () => {
    expect(tok.encode('hello world')).toEqual([2, 5]);
    expect(tok.encode('hello, world')).toEqual([2, 8, 5]);
  });
  it('letters it does not know are one unknown piece', () => {
    expect(tok.encode('hello zz')).toEqual([2, 9, 1]);
  });
  it('turns pieces back into words', () => {
    expect(tok.decode([3, 4, 8, 5, 0])).toBe('hello, world');
  });
});

describe('translated captions tracks', () => {
  it('a new track named for its language, with the same timings', () => {
    let p = emptyProject('t');
    p = placeCaptions(p, [
      { from: 0, to: 30, text: 'Hello' },
      { from: 40, to: 80, text: 'World' },
    ]).project;
    const src = current(p).tracks.find((t) => t.captions)!.id;
    const blocks = trackBlocks(current(p), src).map((b) => ({ ...b, text: b.text === 'Hello' ? 'Hallo' : 'Welt' }));
    const { project, track } = addTranslatedTrack(p, blocks, 'German', src);
    const s = current(project);
    expect(s.tracks.find((t) => t.id === track)?.name).toBe('Captions (German)');
    expect(trackBlocks(s, track)).toEqual([
      { from: 0, to: 30, text: 'Hallo' },
      { from: 40, to: 80, text: 'Welt' },
    ]);
    // The original stays.
    expect(trackBlocks(s, src).map((b) => b.text)).toEqual(['Hello', 'World']);
  });
  it('lists the languages it can translate into', () => {
    expect(MT_LANGUAGES.some((l) => l.code === 'de' && l.model === 'mt-en-de')).toBe(true);
  });
});
