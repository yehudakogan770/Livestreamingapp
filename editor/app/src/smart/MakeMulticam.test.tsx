import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Doc } from '../doc';
import { current } from '../model/seq';
import { emptyProject, type MediaItem } from '../model/types';
import { Ui } from '../ui/state';
import { MakeMulticamDialog } from './MakeMulticam';

const item = (id: string, video: boolean): MediaItem => ({
  id,
  name: id,
  path: `/x/${id}`,
  proxy: null,
  kind: video ? 'video' : 'audio',
  duration: 120,
  width: 1920,
  height: 1080,
  fps: 25,
  hasVideo: video,
  hasAudio: true,
  bin: null,
});

describe('New multicam clip from files', () => {
  it('lines the chosen files up by their starts and makes the group and its sequence', () => {
    const doc = new Doc({ ...emptyProject('t'), media: [item('Cam A', true), item('Cam B', true), item('Recorder', false)] });
    const onClose = vi.fn();
    render(<MakeMulticamDialog doc={doc} ui={new Ui()} onClose={onClose} />);
    const make = screen.getByRole('button', { name: 'Make the multicam clip' }) as HTMLButtonElement;
    expect(make.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Use Cam A'));
    fireEvent.click(screen.getByLabelText('Use Cam B'));
    fireEvent.click(screen.getByLabelText('Use Recorder'));
    fireEvent.click(screen.getByRole('radio', { name: /Every file starts/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Line up' }));
    expect(make.disabled).toBe(false);
    fireEvent.click(make);
    expect(onClose).toHaveBeenCalled();
    const p = doc.project;
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0]?.angles.map((a) => a.name)).toEqual(['Cam A', 'Cam B']);
    const s = current(p);
    expect(s.name).toBe('Multicam 1');
    expect(s.fps).toBe(25);
    // The recorder is the sound on the timeline.
    expect(s.clips.filter((c) => c.source.kind === 'media').map((c) => (c.source.kind === 'media' ? c.source.media : ''))).toEqual(['Recorder']);
    // One step for Undo.
    doc.undo();
    expect(doc.project.groups).toHaveLength(0);
  });
});
