import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Doc } from '../doc';
import { renderQueue } from '../export/renderQueue';
import { emptyProject, newClip, type Project } from '../model/types';
import { DeliverDialog } from './Deliver';
import { Ui } from './state';

/** A wide sequence with speech and music tracks and a marker. */
function project(): Project {
  const p = emptyProject('Gala');
  const s = p.sequences[0]!;
  const [v1] = s.tracks;
  const audio = s.tracks.filter((t) => t.kind === 'audio');
  const tracks = s.tracks.map((t) =>
    t.id === audio[0]!.id ? { ...t, role: 'dialogue' as const } : t.id === audio[1]!.id ? { ...t, role: 'music' as const } : t,
  );
  return {
    ...p,
    media: [
      {
        id: 'm',
        name: 'Cam',
        path: '/media/cam.mp4',
        proxy: null,
        kind: 'video',
        duration: 60,
        width: 1920,
        height: 1080,
        fps: 30,
        hasVideo: true,
        hasAudio: true,
        bin: null,
      },
    ],
    sequences: [
      {
        ...s,
        tracks,
        clips: [
          newClip(v1!.id, 0, 300, { kind: 'media', media: 'm', in: 0 }, 'Cam'),
          newClip(audio[0]!.id, 0, 300, { kind: 'media', media: 'm', in: 0 }, 'Cam'),
          newClip(audio[1]!.id, 0, 300, { kind: 'media', media: 'm', in: 0 }, 'Song'),
        ],
        markers: [{ id: 'k', at: 90, length: 0, name: 'Best smile', color: '#fff' }],
      },
    ],
  };
}

describe('Export window', () => {
  it('offers stems, a thumbnail from a marker, and queues them all', () => {
    const add = vi.spyOn(renderQueue, 'add').mockReturnValue('q1');
    const doc = new Doc(project());
    const ui = new Ui();
    ui.set({ dialog: 'export' });
    render(<DeliverDialog doc={doc} ui={ui} />);
    const stems = screen.getByRole('checkbox', { name: /Also save stems: Dialogue, Music/ });
    fireEvent.click(stems);
    const thumb = screen.getByRole('combobox', { name: 'Thumbnail from a marker' });
    expect(screen.getByRole('option', { name: /At marker “Best smile”/ })).toBeInTheDocument();
    fireEvent.change(thumb, { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to queue/ }));
    expect(add).toHaveBeenCalledTimes(3);
    const [film] = add.mock.calls[0]!;
    expect(film.thumbnail?.seconds).toBe(3);
    expect(add.mock.calls.map((c) => c[2])).toEqual(['Same as the sequence', 'Dialogue stem', 'Music stem']);
    add.mockRestore();
  });

  it('points a vertical preset at Auto reframe', () => {
    const doc = new Doc(project());
    const ui = new Ui();
    render(<DeliverDialog doc={doc} ui={ui} />);
    fireEvent.click(screen.getByRole('option', { name: 'YouTube Shorts' }));
    expect(screen.getByText(/crops the wide picture to the middle/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auto reframe to 9:16…' })).toBeInTheDocument();
  });

  it('has the social and master presets', () => {
    render(<DeliverDialog doc={new Doc(project())} ui={new Ui()} />);
    for (const name of ['X (Twitter)', 'LinkedIn', 'Master: DNxHR HQX (10-bit)', 'Master: H.265 10-bit', 'Sound: podcast (MP3)', 'Sound: broadcast WAV'])
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
  });
});
