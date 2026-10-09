import { describe, expect, it } from 'vitest';
import { current } from '../model/seq';
import { emptyProject, newClip, type MediaItem, type Project } from '../model/types';
import { findClips, hookScore, makeClipSequence, sentences } from './clips';
import { scoreMoments, type HighlightInput } from './highlights';

/** Ten minutes of talk: a sentence every 6 seconds, quiet level, with one story the room laughs at. */
function talk(): HighlightInput {
  const hop = 0.25;
  const n = 600 / hop;
  const levels = new Float32Array(n).fill(-30);
  const words: { w: string; from: number; to: number }[] = [];
  for (let t = 0; t < 600; t += 6) {
    const line = t === 300 ? ['Why', 'does', 'nobody', 'talk', 'about', 'this?'] : ['and', 'then', 'we', 'went', 'on', 'there.'];
    line.forEach((w, i) => words.push({ w, from: t + i * 0.6, to: t + i * 0.6 + 0.5 }));
  }
  // The room laughs after the story (loud, nobody talking): 330–334 s.
  const quiet = words.filter((w) => !(w.from >= 329.5 && w.from < 335));
  for (let i = Math.floor(330 / hop); i < Math.floor(334 / hop); i++) levels[i] = -8;
  return { hop, levels, words: quiet, markers: [], changes: [], keywords: ['amazing'] };
}

describe('clips for social', () => {
  it('breaks the transcript into sentences at end marks and pauses', () => {
    const s = sentences([
      { w: 'Hello', from: 0, to: 0.4 },
      { w: 'there.', from: 0.5, to: 0.9 },
      { w: 'Then', from: 1, to: 1.3 },
      { w: 'a', from: 3, to: 3.2 },
      { w: 'pause', from: 3.3, to: 3.6 },
    ]);
    expect(s.map((x) => x.text)).toEqual(['Hello there.', 'Then', 'a pause']);
  });

  it('a question or a strong opener scores as a hook', () => {
    expect(hookScore('Why does nobody talk about this?', [])).toBeGreaterThan(hookScore('and then we went on there.', []));
    expect(hookScore('That was amazing.', ['amazing'])).toBeGreaterThan(0.5);
  });

  it('the best clip is the story the room reacts to, on whole sentences, within the lengths', () => {
    const inp = talk();
    const clips = findClips(inp, scoreMoments(inp), { count: 3, min: 20, max: 45 }, 600);
    expect(clips.length).toBe(3);
    const best = clips[0]!;
    expect(best.from).toBeLessThanOrEqual(330);
    expect(best.to).toBeGreaterThanOrEqual(334);
    expect(best.title).toBe('Why does nobody talk about this?');
    expect(best.why).toMatch(/the room reacts/);
    for (const c of clips) {
      expect(c.to - c.from).toBeGreaterThanOrEqual(19.5);
      expect(c.to - c.from).toBeLessThanOrEqual(48.5);
      // Starts just before a sentence starts.
      expect(inp.words.some((w) => w.from - c.from >= 0 && w.from - c.from < 0.16)).toBe(true);
    }
    // Strongest first, and none overlap.
    expect(clips.map((c) => c.strength)).toEqual([...clips.map((c) => c.strength)].sort((a, b) => b - a));
    for (const a of clips) for (const b of clips) if (a !== b) expect(a.to <= b.from || b.to <= a.from).toBe(true);
  });

  it('makes a vertical sequence of the clip with lit-up captions and its title', () => {
    const m: MediaItem = {
      id: 'm',
      name: 'Talk',
      path: '/talk.mp4',
      proxy: null,
      kind: 'video',
      duration: 600,
      width: 1920,
      height: 1080,
      fps: 30,
      hasVideo: true,
      hasAudio: true,
      bin: null,
      transcript: {
        language: 'en',
        model: 'test',
        words: [
          { w: 'Why', s: 300, e: 300.5 },
          { w: 'this?', s: 301, e: 301.5 },
        ],
        done: [[0, 600]],
      },
    };
    let p: Project = { ...emptyProject('t'), media: [m] };
    const s0 = current(p);
    const v = s0.tracks.find((t) => t.kind === 'video')!;
    const a = s0.tracks.find((t) => t.kind === 'audio')!;
    p = {
      ...p,
      sequences: [
        {
          ...s0,
          clips: [
            { ...newClip(v.id, 0, 18000, { kind: 'media', media: 'm', in: 0 }, 'Talk'), link: 'l' },
            { ...newClip(a.id, 0, 18000, { kind: 'media', media: 'm', in: 0 }, 'Talk'), link: 'l' },
          ],
        },
      ],
    };
    const out = makeClipSequence(p, current(p), { id: 'x', from: 299.85, to: 330, strength: 80, title: 'Why this?', why: '' }, 0, {
      aspect: '9:16',
      captions: 'Highlight',
      title: true,
    });
    const s = current(out.project);
    expect(s.id).toBe(out.sequence);
    expect(s.height).toBeGreaterThan(s.width);
    const cap = s.tracks.find((t) => t.captions);
    expect(cap?.captions?.anim).toBe('highlight');
    const block = s.clips.find((c) => c.source.kind === 'caption');
    expect(block?.source).toMatchObject({ kind: 'caption', text: 'Why this?' });
    expect(s.clips.some((c) => c.source.kind === 'text' && c.name === 'Why this?')).toBe(true);
    // The picture fills the tall frame.
    expect(s.clips.find((c) => c.source.kind === 'media' && s.tracks.find((t) => t.id === c.track)?.kind === 'video')?.motion.fill).toBe(true);
  });
});
