import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Doc } from '../doc';
import { emptyProject, type MediaItem } from '../model/types';
import { Ui } from '../ui/state';
import { FinishDialog } from './FinishDialog';
import { buildMulticam } from './syncsound';

vi.mock('./analysis', async (orig) => ({
  ...(await orig<typeof import('./analysis')>()),
  micEnvelopes: (sources: unknown[], duration: number, hop: number) =>
    Promise.resolve(
      sources.map((_, k) => {
        const env = new Float32Array(Math.round(duration / hop)).fill(-60);
        for (let i = 0; i < env.length; i++) if (Math.floor((i * hop) / 20) % sources.length === k) env[i] = -20;
        return env;
      }),
    ),
  sequenceLevels: (_p: unknown, _s: unknown, hop: number) => Promise.resolve(new Float32Array(Math.round(300 / hop)).fill(-30)),
}));

function event() {
  const words: { w: string; s: number; e: number }[] = [];
  for (let t = 0; t < 300; t += 4) ['Thank', 'you', 'all', 'for', 'coming.'].forEach((w, i) => words.push({ w, s: t + i * 0.6, e: t + i * 0.6 + 0.5 }));
  const cam = (id: string, transcript: boolean): MediaItem => ({
    id,
    name: id,
    path: `/${id}.mp4`,
    proxy: null,
    kind: 'video',
    duration: 300,
    width: 1920,
    height: 1080,
    fps: 30,
    hasVideo: true,
    hasAudio: true,
    bin: null,
    ...(transcript ? { transcript: { language: 'en', model: 'test', words, done: [[0, 300]] as [number, number][] } } : {}),
  });
  const a = cam('Wide', true);
  const b = cam('Close', false);
  return buildMulticam(
    { ...emptyProject('Gala'), media: [a, b] },
    {
      name: 'Gala',
      files: [
        { media: a, offset: 0 },
        { media: b, offset: 0 },
      ],
      sound: ['Wide'],
    },
  ).project;
}

describe('Finish the event (dialog)', () => {
  it('runs the chosen steps and applies them as one change', async () => {
    const doc = new Doc(event());
    const before = doc.project.sequences.length;
    const onClose = vi.fn();
    render(<FinishDialog doc={doc} ui={new Ui()} onClose={onClose} />);
    expect(screen.getByText('Already written down')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '3' }));
    fireEvent.click(screen.getByLabelText(/Follow the people talking/));
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const p = doc.project;
    expect(p.sequences.length).toBeGreaterThan(before + 1);
    expect(doc.undoLabel).toBe('Finish the event');
    doc.undo();
    expect(doc.project.sequences).toHaveLength(before);
  });
});
