import { describe, expect, it } from 'vitest';
import { addMedia } from './build';
import {
  addCaptionTrack,
  captionBlocks,
  captionCues,
  captionText,
  captionTracks,
  deleteWords,
  mergeCaptions,
  placeCaptions,
  rulesFor,
  sequenceWords,
  splitCaption,
  toSrt,
  toVtt,
  withoutCaptions,
  wordRanges,
} from './captions';
import { addTrack, moveClips, updateTrack } from './edit';
import { current, end, onTrack } from './seq';
import { DEFAULT_CAPTION_STYLE, emptyProject, type MediaItem, type Project, type Word } from './types';
import { frameOps } from '../render/frame';
import { spansToTranscribe, withTranscripts } from '../speech/transcribe';

const words = (list: [string, number, number][]): Word[] => list.map(([w, s, e]) => ({ w, s, e }));

/** A 20-second talk; the clip uses seconds 2–12 of it, from frame 0 (30 fps). */
function talk(): Project {
  const m: MediaItem = {
    id: 'm',
    name: 'Talk',
    path: '/talk.mp4',
    proxy: null,
    kind: 'video',
    duration: 20,
    width: 1920,
    height: 1080,
    fps: 30,
    hasVideo: true,
    hasAudio: true,
    bin: null,
    transcript: {
      language: 'en',
      model: 'whisper-base',
      done: [[0, 20]],
      words: words([
        ['Before', 1, 1.5],
        ['Hello', 2.5, 3],
        ['everyone,', 3, 3.6],
        ['um', 4, 4.4],
        ['welcome.', 4.5, 5.2],
        ['Tonight', 7, 7.5],
        ['we', 7.5, 7.7],
        ['talk.', 7.7, 8.2],
        ['After', 13, 13.5],
      ]),
    },
  };
  return addMedia({ ...emptyProject('Talk'), media: [m] }, 'm', 0, 'overwrite', undefined, undefined, { in: 2, out: 12 });
}

describe('the transcript on the sequence', () => {
  it('places the words the clip uses, in frames', () => {
    const p = talk();
    const w = sequenceWords(p, current(p));
    expect(w.map((x) => x.w)).toEqual(['Hello', 'everyone,', 'um', 'welcome.', 'Tonight', 'we', 'talk.']);
    expect([w[0]?.from, w[0]?.to]).toEqual([15, 30]);
    expect(w[6]?.to).toBe(186);
  });

  it('a word heard on two microphones at once is kept once', () => {
    let p = talk();
    const a2 = current(p).tracks.filter((t) => t.kind === 'audio')[1]?.id ?? '';
    p = addMedia(p, 'm', 0, 'overwrite', undefined, a2, { in: 2, out: 12 });
    expect(sequenceWords(p, current(p))).toHaveLength(7);
  });

  it('chosen words become ranges: neighbors together, gaps apart', () => {
    const p = talk();
    const w = sequenceWords(p, current(p));
    expect(wordRanges(w, [2])).toEqual([[60, 72]]);
    expect(wordRanges(w, [3, 2])).toEqual([[60, 96]]);
    expect(wordRanges(w, [0, 5, 6])).toEqual([
      [15, 30],
      [165, 186],
    ]);
    expect(wordRanges(w, [99])).toEqual([]);
  });

  it('deleting words cuts them out of every track and closes up', () => {
    const p = talk();
    const w = sequenceWords(p, current(p));
    const q = deleteWords(p, w, [2]);
    const s = current(q);
    // Both picture and sound lose 12 frames, and stay in step.
    for (const t of s.tracks.filter((x) => s.clips.some((c) => c.track === x.id))) {
      const clips = onTrack(s, t.id);
      expect(clips.map((c) => [c.start, c.length])).toEqual([
        [0, 60],
        [60, 228],
      ]);
    }
    const after = sequenceWords(q, s).map((x) => x.w);
    expect(after).toEqual(['Hello', 'everyone,', 'welcome.', 'Tonight', 'we', 'talk.']);
    // Two separate runs: the later one goes first, so the earlier one stays put.
    const r = current(deleteWords(p, w, [0, 6]));
    expect(Math.max(...r.clips.map(end))).toBe(300 - 15 - 15);
  });
});

describe('caption blocks', () => {
  const fps = 30;
  const rules = rulesFor(DEFAULT_CAPTION_STYLE);
  it('a new block after a sentence, a pause, or when it gets too long', () => {
    const p = talk();
    const b = captionBlocks(sequenceWords(p, current(p)), fps, rules);
    expect(b.map((x) => x.text)).toEqual(['Hello everyone, um welcome.', 'Tonight we talk.']);
    expect(b[0]?.from).toBe(15);
    const many = Array.from({ length: 40 }, (_, i) => ({ w: 'word', from: i * 10, to: i * 10 + 9 }));
    const blocks = captionBlocks(many, fps, rules);
    expect(blocks.length).toBeGreaterThan(2);
    for (const x of blocks) expect(x.text.length).toBeLessThanOrEqual(rules.maxChars);
    for (const x of blocks) expect((x.to - x.from) / fps).toBeLessThanOrEqual(rules.maxSeconds + 0.5);
  });

  it('short blocks stay up a little, never into the next', () => {
    const b = captionBlocks(
      [
        { w: 'Hi.', from: 0, to: 5 },
        { w: 'Yes.', from: 10, to: 14 },
      ],
      fps,
      rules,
    );
    expect(b.map((x) => [x.from, x.to])).toEqual([
      [0, 10],
      [10, 34],
    ]);
  });

  it('go on a captions track above the pictures', () => {
    const { project, track } = placeCaptions(talk(), [
      { from: 0, to: 30, text: 'One' },
      { from: 30, to: 60, text: 'Two' },
    ]);
    const s = current(project);
    const video = s.tracks.filter((t) => t.kind === 'video');
    expect(video[video.length - 1]?.id).toBe(track);
    expect(captionTracks(s)).toHaveLength(1);
    expect(onTrack(s, track).map((c) => c.name)).toEqual(['One', 'Two']);
    // Made again: the old blocks in that time are replaced, the track is reused.
    const again = placeCaptions(project, [{ from: 0, to: 60, text: 'Both' }]);
    expect(again.track).toBe(track);
    expect(onTrack(current(again.project), track).map((c) => c.name)).toEqual(['Both']);
  });

  it('split shares the words by time; join puts them back', () => {
    const { project, track } = placeCaptions(talk(), [{ from: 0, to: 100, text: 'one two three four' }]);
    const id = onTrack(current(project), track)[0]?.id ?? '';
    const split = splitCaption(project, id, 50);
    const parts = onTrack(current(split), track);
    expect(parts.map((c) => [c.start, c.length, c.source.kind === 'caption' && c.source.text])).toEqual([
      [0, 50, 'one two'],
      [50, 50, 'three four'],
    ]);
    const joined = mergeCaptions(
      split,
      parts.map((c) => c.id),
    );
    const one = onTrack(current(joined), track);
    expect(one.map((c) => [c.start, c.length, c.name])).toEqual([[0, 100, 'one two three four']]);
  });

  it('stay above the pictures when a video track is added, and other clips stay off them', () => {
    const { project, track } = placeCaptions(talk(), [{ from: 0, to: 30, text: 'One' }]);
    const more = current(addTrack(project, 'video'));
    const video = more.tracks.filter((t) => t.kind === 'video');
    expect(video[video.length - 1]?.id).toBe(track);
    expect(video).toHaveLength(5);
    const onCaptions = addMedia(project, 'm', 400, 'overwrite', track, undefined, { in: 0, out: 2 });
    expect(current(onCaptions).clips.filter((c) => c.track === track)).toHaveLength(1);
  });

  it('stay on their own track when moved', () => {
    const { project, track } = placeCaptions(talk(), [{ from: 0, to: 30, text: 'One' }]);
    const id = onTrack(current(project), track)[0]?.id ?? '';
    expect(moveClips(project, [id], { frames: 0, video: -1, audio: 0 })).toBe(project);
    expect(onTrack(current(moveClips(project, [id], { frames: 15, video: 0, audio: 0 })), track)[0]?.start).toBe(15);
  });

  it('are drawn over the picture (and not when the track is hidden)', () => {
    const { project, track } = placeCaptions(talk(), [{ from: 0, to: 30, text: 'Hello there' }]);
    const ops = frameOps(project, current(project), 10);
    const top = ops[ops.length - 1];
    expect(top?.kind === 'layer' && top.layer.source?.kind === 'text' && top.layer.source.text.text).toBe('Hello there');
    expect(frameOps(project, current(project), 40)).toHaveLength(1);
    expect(frameOps(updateTrack(project, track, { off: true }), current(updateTrack(project, track, { off: true })), 10)).toHaveLength(1);
    expect(frameOps(withoutCaptions(project), current(withoutCaptions(project)), 10)).toHaveLength(1);
  });

  it('look: wrapped lines, same size, placed from the bottom', () => {
    const t = captionText('one two three four five six', { ...DEFAULT_CAPTION_STYLE, lineChars: 13 });
    expect(t.text).toBe('one two three\nfour five six');
    expect(t.even).toBe(true);
    expect(t.py).toBeCloseTo(1 - 0.07 - (54 * 1.2 * 2) / 2 / 1080);
    expect(captionText('x', { ...DEFAULT_CAPTION_STYLE, position: 'top', margin: 10 }).py).toBeCloseTo(0.1 + (54 * 1.2) / 2 / 1080);
  });
});

describe('caption files', () => {
  const p = placeCaptions(talk(), [
    { from: 15, to: 45, text: 'Hello everyone, welcome.' },
    { from: 3600, to: 3690, text: 'Tonight we talk --> <b>here</b> & now' },
  ]).project;
  const s = current(p);

  it('SubRip (.srt)', () => {
    expect(toSrt(captionCues(s))).toBe(
      '1\n00:00:00,500 --> 00:00:01,500\nHello everyone, welcome.\n\n2\n00:02:00,000 --> 00:02:03,000\nTonight we talk -> <b>here</b> & now\n',
    );
  });

  it('WebVTT (.vtt)', () => {
    expect(toVtt(captionCues(s))).toBe(
      'WEBVTT\n\n00:00:00.500 --> 00:00:01.500\nHello everyone, welcome.\n\n00:02:00.000 --> 00:02:03.000\nTonight we talk -> &lt;b>here&lt;/b> &amp; now\n',
    );
  });

  it('timed from the start of what is exported', () => {
    const cues = captionCues(s, undefined, { from: 30, to: 3630 });
    expect(cues.map((c) => [c.from, c.to])).toEqual([
      [0, 0.5],
      [119, 120],
    ]);
  });

  it('long times have hours', () => {
    const q = placeCaptions(talk(), [{ from: 30 * 3725, to: 30 * 3726, text: 'Late' }]).project;
    expect(toSrt(captionCues(current(q)))).toContain('01:02:05,000 --> 01:02:06,000');
  });

  it('nothing without a captions track', () => {
    expect(captionCues(current(talk()))).toEqual([]);
    expect(captionTracks(current(addCaptionTrack(talk()).project))).toHaveLength(1);
  });
});

describe('what to transcribe', () => {
  it('the used part of each file, with a second either side', () => {
    const p = talk();
    expect([...spansToTranscribe(p, current(p), null)]).toEqual([['m', [[1, 13]]]]);
    const a = current(p).clips.find((c) => c.source.kind === 'media' && current(p).tracks.find((t) => t.id === c.track)?.kind === 'video');
    // A picture clip chosen: its sound is what is heard.
    expect([...spansToTranscribe(p, current(p), [a?.id ?? ''])]).toEqual([['m', [[1, 13]]]]);
    expect(spansToTranscribe(p, current(p), ['nothing']).size).toBe(0);
  });

  it('new transcripts go on their files', () => {
    const p = talk();
    const q = withTranscripts(p, new Map([['m', { language: 'he', model: 'whisper-small', words: [], done: [] }]]));
    expect(q.media[0]?.transcript?.language).toBe('he');
  });
});
