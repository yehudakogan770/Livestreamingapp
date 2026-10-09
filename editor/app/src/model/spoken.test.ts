// Captions that light up word by word as they are said (social-style).
import { describe, expect, it } from 'vitest';
import { drawText, spokenIndex, textStamp } from '../render/text';
import { CAPTION_LOOKS, captionBlocks, captionText, lookOf, mergeCaptions, placeCaptions, setCaptionText, splitCaption, wordTimes } from './captions';
import { current } from './seq';
import { trimLeft } from './seq';
import { DEFAULT_CAPTION_STYLE, emptyProject, newClip, type Clip, type Project } from './types';

const fps = 30;

function withCaption(words: [number, number][] | undefined, text = 'one two three four'): { p: Project; id: string } {
  const p = emptyProject('t');
  const s = current(p);
  const placed = placeCaptions(p, [{ from: 0, to: 40, text, ...(words ? { words } : {}) }]);
  const clip = current(placed.project).clips[0] as Clip;
  expect(s.id).toBe(current(placed.project).id);
  return { p: placed.project, id: clip.id };
}

describe('word timings', () => {
  it('blocks made from the transcript keep when each word is said', () => {
    const words = [
      { w: 'Hello', from: 10, to: 20 },
      { w: 'there', from: 22, to: 30 },
      { w: 'friends.', from: 31, to: 45 },
      { w: 'Next', from: 80, to: 90 },
    ];
    const b = captionBlocks(words, fps, { maxChars: 80, maxSeconds: 6, minSeconds: 0.8, gap: 0.7 });
    expect(b).toHaveLength(2);
    expect(b[0]?.words).toEqual([
      [10, 20],
      [22, 30],
      [31, 45],
    ]);
    const placed = placeCaptions(emptyProject('t'), b);
    const first = current(placed.project).clips.find((c) => c.start === 10) as Clip;
    expect(first.source).toMatchObject({
      kind: 'caption',
      words: [
        [0, 10],
        [12, 20],
        [21, 35],
      ],
    });
  });

  it('typed captions share the time out by word length', () => {
    const t = wordTimes('a bbbb', undefined, 70);
    expect(t).toEqual([
      [0, 20],
      [20, 70],
    ]);
    // Their own timings win when they match the words.
    expect(
      wordTimes(
        'a b',
        [
          [3, 5],
          [6, 9],
        ],
        70,
      ),
    ).toEqual([
      [3, 5],
      [6, 9],
    ]);
  });

  it('a fixed spelling keeps the timings; a changed word count works them out again', () => {
    const { p, id } = withCaption([
      [0, 10],
      [10, 20],
      [20, 30],
      [30, 40],
    ]);
    const c = current(p).clips.find((x) => x.id === id) as Clip;
    const fixed = setCaptionText(c, 'one two thre four');
    expect(fixed.source.kind === 'caption' && fixed.source.words).toHaveLength(4);
    const fewer = setCaptionText(c, 'one two');
    expect(fewer.source.kind === 'caption' && fewer.source.words).toBeFalsy();
  });

  it('splitting cuts between the words said before and after the playhead', () => {
    const { p, id } = withCaption([
      [0, 8],
      [8, 16],
      [16, 30],
      [30, 40],
    ]);
    const q = splitCaption(p, id, 17);
    const [a, b] = current(q).clips.sort((x, y) => x.start - y.start) as [Clip, Clip];
    expect(a.source).toMatchObject({
      text: 'one two',
      words: [
        [0, 8],
        [8, 16],
      ],
    });
    expect(b.start).toBe(17);
    expect(b.source).toMatchObject({
      text: 'three four',
      words: [
        [-1, 13],
        [13, 23],
      ],
    });
    // Joined again: one block with every timing, from the first one's start.
    const joined = mergeCaptions(q, [a.id, b.id]);
    const j = current(joined).clips[0] as Clip;
    expect(j.source).toMatchObject({
      text: 'one two three four',
      words: [
        [0, 8],
        [8, 16],
        [16, 30],
        [30, 40],
      ],
    });
  });

  it('trimming the start keeps the words where they are said', () => {
    const c = newClip(
      'cc',
      100,
      40,
      {
        kind: 'caption',
        text: 'a b',
        words: [
          [5, 10],
          [20, 30],
        ],
      },
      'a b',
    );
    const t = trimLeft(c, 5, fps);
    expect(t.source).toMatchObject({
      words: [
        [0, 5],
        [15, 25],
      ],
    });
  });
});

describe('animated caption looks', () => {
  const style = { ...DEFAULT_CAPTION_STYLE, anim: 'highlight' as const, accent: '#ff0000' };

  it('a plain look draws no word timings; an animated one does', () => {
    expect(captionText('a b', DEFAULT_CAPTION_STYLE, undefined, 30).spoken).toBeUndefined();
    const t = captionText(
      'a b',
      style,
      [
        [0, 10],
        [10, 20],
      ],
      30,
    );
    expect(t.spoken).toEqual({
      anim: 'highlight',
      accent: '#ff0000',
      times: [
        [0, 10],
        [10, 20],
      ],
    });
    expect(captionText('a b', { ...style, caps: true }, undefined, 30).caps).toBe(true);
  });

  it('the word being said is the last one to have started', () => {
    const times: [number, number][] = [
      [5, 10],
      [12, 20],
      [25, 30],
    ];
    expect(spokenIndex(times, 0)).toBe(-1);
    expect(spokenIndex(times, 5)).toBe(0);
    expect(spokenIndex(times, 11)).toBe(0);
    expect(spokenIndex(times, 12)).toBe(1);
    expect(spokenIndex(times, 99)).toBe(2);
  });

  it('the picture is drawn again only when another word is said', () => {
    const t = captionText(
      'a b c',
      style,
      [
        [0, 10],
        [10, 20],
        [20, 30],
      ],
      30,
    );
    expect(textStamp(t, 12, 30)).toBe(textStamp(t, 12, 30));
    expect(textStamp(t, 8, 30)).toBe(textStamp(t, 9, 30));
    expect(textStamp(t, 9, 30)).not.toBe(textStamp(t, 10, 30));
  });

  /** The words filled and in which color, drawn by a canvas that only records. */
  function filled(anim: 'highlight' | 'karaoke' | 'reveal' | 'wordbox' | 'pop', local: number): [string, string][] {
    const calls: [string, string][] = [];
    const ctx = {
      save() {},
      restore() {},
      translate() {},
      scale() {},
      beginPath() {},
      rect() {},
      clip() {},
      fill() {},
      roundRect() {},
      fillRect() {},
      strokeText() {},
      measureText: (s: string) => ({ width: s.length * 10 }),
      fillText(s: string) {
        calls.push([s, String(ctx.fillStyle)]);
      },
      fillStyle: '' as string,
      globalAlpha: 1,
      filter: 'none',
      font: '',
      textBaseline: '',
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetY: 0,
      lineJoin: '',
      lineWidth: 0,
      strokeStyle: '',
    };
    const t = captionText(
      'one two three',
      { ...style, anim, box: false, shadow: 0 },
      [
        [0, 10],
        [10, 20],
        [20, 30],
      ],
      30,
    );
    drawText(ctx as unknown as CanvasRenderingContext2D, t, 1920, 1080, local, 30);
    return calls;
  }

  it('highlight lights only the word being said', () => {
    expect(filled('highlight', 12)).toEqual([
      ['one', '#ffffff'],
      ['two', '#ff0000'],
      ['three', '#ffffff'],
    ]);
  });

  it('karaoke lights every word said so far', () => {
    expect(filled('karaoke', 12)).toEqual([
      ['one', '#ff0000'],
      ['two', '#ff0000'],
      ['three', '#ffffff'],
    ]);
  });

  it('reveal shows only the words said so far', () => {
    expect(filled('reveal', 12).map(([w]) => w)).toEqual(['one', 'two']);
  });

  it('word box puts readable words on the accent box', () => {
    const calls = filled('wordbox', 12);
    expect(calls[1]).toEqual(['two', '#ffffff']);
    const yellow = (() => {
      const t = captionText(
        'one two',
        { ...style, anim: 'wordbox', accent: '#ffd23f', box: false, shadow: 0 },
        [
          [0, 10],
          [10, 20],
        ],
        30,
      );
      const out: string[] = [];
      const ctx = {
        save() {},
        restore() {},
        translate() {},
        scale() {},
        fill() {},
        roundRect() {},
        beginPath() {},
        fillRect() {},
        measureText: (s: string) => ({ width: s.length * 10 }),
        fillText() {
          out.push(String(ctx.fillStyle));
        },
        fillStyle: '' as string,
        globalAlpha: 1,
        filter: 'none',
      };
      drawText(ctx as unknown as CanvasRenderingContext2D, t, 1920, 1080, 12, 30);
      return out;
    })();
    expect(yellow[1]).toBe('#111111');
  });

  it('pop lights the word being said', () => {
    expect(filled('pop', 25)[2]).toEqual(['three', '#ff0000']);
  });
});

describe('ready-made caption looks', () => {
  it('each look is recognized once applied, and the default track is Broadcast', () => {
    expect(lookOf(DEFAULT_CAPTION_STYLE)).toBe('Broadcast');
    for (const l of CAPTION_LOOKS) expect(lookOf({ ...DEFAULT_CAPTION_STYLE, ...l.style })).toBe(l.name);
  });
  it('going back to Broadcast stops the words lighting up', () => {
    const social = { ...DEFAULT_CAPTION_STYLE, ...(CAPTION_LOOKS.find((l) => l.name === 'Highlight')?.style ?? {}) };
    const back = { ...social, ...(CAPTION_LOOKS[0]?.style ?? {}) };
    expect(back.anim).toBe('none');
    expect(back.caps).toBe(false);
  });
});
