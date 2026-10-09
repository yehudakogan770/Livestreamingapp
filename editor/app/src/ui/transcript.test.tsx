import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Doc } from '../doc';
import { nameSpeaker, sequenceWords, speakerName, transcriptParagraphs } from '../model/captions';
import { current } from '../model/seq';
import { emptyProject, newClip, type MediaItem, type Project } from '../model/types';
import type { Engine } from '../player/engine';
import { TranscriptPanel } from './Speech';
import { Ui } from './state';

function interview(): Project {
  const mic = (id: string, words: [string, number][]): MediaItem => ({
    id,
    name: `${id}.wav`,
    path: `/${id}.wav`,
    proxy: null,
    kind: 'audio',
    duration: 60,
    width: 0,
    height: 0,
    fps: 30,
    hasVideo: false,
    hasAudio: true,
    bin: null,
    transcript: { language: 'en', model: 't', words: words.map(([w, s]) => ({ w, s, e: s + 0.4 })), done: [[0, 60]] },
  });
  const host = mic('Host', [
    ['So', 1],
    ['um', 1.5],
    ['tell', 2],
    ['us.', 2.5],
  ]);
  const guest = mic('Guest', [
    ['Well', 4],
    ['uh', 4.5],
    ['sure.', 5],
  ]);
  const p = { ...emptyProject('Talk'), media: [host, guest] };
  const s = current(p);
  const [a1, a2] = s.tracks.filter((t) => t.kind === 'audio');
  return {
    ...p,
    sequences: [
      {
        ...s,
        clips: [
          newClip(a1!.id, 0, 1800, { kind: 'media', media: 'Host', in: 0 }, 'Host'),
          newClip(a2!.id, 0, 1800, { kind: 'media', media: 'Guest', in: 0 }, 'Guest'),
        ],
      },
    ],
  };
}

describe('the transcript', () => {
  it('starts a new paragraph when someone else is heard, named after their file until named', () => {
    const p = interview();
    const words = sequenceWords(p, current(p));
    expect(transcriptParagraphs(words, 60).map((para) => para.map((i) => words[i]!.w).join(' '))).toEqual(['So um tell us.', 'Well uh sure.']);
    expect(speakerName(p, 'Guest')).toBe('Guest');
    const named = nameSpeaker(p, 'Guest', 'Dr. Levin');
    expect(speakerName(named, 'Guest')).toBe('Dr. Levin');
    expect(speakerName(nameSpeaker(named, 'Guest', ' '), 'Guest')).toBe('Guest');
  });

  it('names speakers in place and deletes every filler sound at once', () => {
    const doc = new Doc(interview());
    const engine = { pause: () => {}, seek: () => {}, isPlaying: false, frame: 0, subscribe: () => () => {} } as unknown as Engine;
    render(<TranscriptPanel doc={doc} engine={engine} ui={new Ui()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Guest' }));
    const input = screen.getByLabelText('Who is speaking');
    fireEvent.change(input, { target: { value: 'Dr. Levin' } });
    fireEvent.blur(input);
    expect(doc.project.speakers).toEqual({ Guest: 'Dr. Levin' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete fillers (2)' }));
    const left = sequenceWords(doc.project, current(doc.project)).map((w) => w.w);
    expect(left).toEqual(['So', 'tell', 'us.', 'Well', 'sure.']);
  });
});
