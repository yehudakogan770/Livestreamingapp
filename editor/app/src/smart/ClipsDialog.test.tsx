import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Doc } from '../doc';
import { current } from '../model/seq';
import { emptyProject, newClip, type MediaItem, type Project } from '../model/types';
import type { Engine } from '../player/engine';
import { Ui } from '../ui/state';
import { ClipsDialog } from './ClipsDialog';

vi.mock('./analysis', async (orig) => ({
  ...(await orig<typeof import('./analysis')>()),
  // Five minutes at an even level, a burst at 2:00.
  sequenceLevels: () => {
    const a = new Float32Array(1200).fill(-30);
    a.fill(-6, 480, 500);
    return Promise.resolve(a);
  },
}));

function talk(): Project {
  const words: { w: string; s: number; e: number }[] = [];
  for (let t = 0; t < 300; t += 5) ['So', 'here', 'is', 'the', 'thing.'].forEach((w, i) => words.push({ w, s: t + i * 0.5, e: t + i * 0.5 + 0.4 }));
  const m: MediaItem = {
    id: 'm',
    name: 'Talk',
    path: '/talk.mp4',
    proxy: null,
    kind: 'video',
    duration: 300,
    width: 1920,
    height: 1080,
    fps: 30,
    hasVideo: true,
    hasAudio: true,
    bin: null,
    transcript: { language: 'en', model: 'test', words, done: [[0, 300]] },
  };
  const p = { ...emptyProject('t'), media: [m] };
  const s = current(p);
  const v = s.tracks.find((t) => t.kind === 'video')!;
  const a = s.tracks.find((t) => t.kind === 'audio')!;
  return {
    ...p,
    sequences: [
      {
        ...s,
        clips: [
          { ...newClip(v.id, 0, 9000, { kind: 'media', media: 'm', in: 0 }, 'Talk'), link: 'l' },
          { ...newClip(a.id, 0, 9000, { kind: 'media', media: 'm', in: 0 }, 'Talk'), link: 'l' },
        ],
      },
    ],
  };
}

describe('Clips for social', () => {
  it('finds moments, and makes each chosen one a vertical captioned sequence in one step', async () => {
    const doc = new Doc(talk());
    const engine = { pause: () => {}, seek: () => {} } as unknown as Engine;
    const onClose = vi.fn();
    render(<ClipsDialog doc={doc} engine={engine} ui={new Ui()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('radio', { name: '3' }));
    fireEvent.click(screen.getByLabelText(/Follow the people/));
    fireEvent.click(screen.getByRole('button', { name: 'Find moments' }));
    await waitFor(() => expect(screen.getAllByLabelText('Make this clip')).toHaveLength(3));
    fireEvent.click(screen.getAllByLabelText('Make this clip')[2]!);
    fireEvent.click(screen.getByRole('button', { name: 'Make 2 clips' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const p = doc.project;
    expect(p.sequences).toHaveLength(3);
    const made = p.sequences.slice(1);
    for (const s of made) {
      expect(s.height).toBeGreaterThan(s.width);
      expect(s.tracks.find((t) => t.captions)?.captions?.anim).toBe('highlight');
      expect(s.clips.some((c) => c.source.kind === 'caption')).toBe(true);
    }
    // The first one made is open; one Undo takes them all back.
    expect(p.open).toBe(made[0]!.id);
    doc.undo();
    expect(doc.project.sequences).toHaveLength(1);
  });
});
