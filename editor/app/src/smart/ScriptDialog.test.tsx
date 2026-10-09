import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Doc } from '../doc';
import { current } from '../model/seq';
import { emptyProject, type MediaItem } from '../model/types';
import { Ui } from '../ui/state';
import { ScriptDialog } from './ScriptDialog';

const take = (id: string, said: string): MediaItem => ({
  id,
  name: id,
  path: `/${id}.mp4`,
  proxy: null,
  kind: 'video',
  duration: 30,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  bin: null,
  transcript: {
    language: 'en',
    model: 't',
    words: said.split(' ').map((w, i) => ({ w, s: i * 0.5, e: i * 0.5 + 0.4 })),
    done: [[0, 30]],
  },
});

describe('Rough cut from a script (dialog)', () => {
  it('shows each line with its take and makes the rough cut in one step', () => {
    const doc = new Doc({ ...emptyProject('t'), media: [take('Interview', 'so I grew up near the river and then we moved to the city')] });
    const onClose = vi.fn();
    render(<ScriptDialog doc={doc} ui={new Ui()} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText(/Paste the script/), {
      target: { value: 'We moved to the city.\nI grew up near the river.\nA line nobody said.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find 3 lines' }));
    expect(screen.getAllByText(/Interview 0:0/)).toHaveLength(2);
    expect(screen.getByText('Not found')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make the rough cut' }));
    expect(onClose).toHaveBeenCalled();
    const s = current(doc.project);
    expect(s.name).toBe('Rough cut from the script');
    const v = s.clips.filter((c) => c.source.kind === 'media' && s.tracks.find((t) => t.id === c.track)?.kind === 'video').sort((a, b) => a.start - b.start);
    // The script's order, not the recording's: "moved to the city" (later in the file) first.
    expect(v.map((c) => (c.source.kind === 'media' ? Math.round(c.source.in * 10) / 10 : -1))).toEqual([4.3, 0.3]);
    expect(doc.undoLabel).toBe('Rough cut from a script');
  });
});
