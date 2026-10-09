import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Doc } from '../doc';
import { current } from '../model/seq';
import { emptyProject, type MediaItem } from '../model/types';
import type { Engine } from '../player/engine';
import { placeVoiceover, takeName, VOICEOVER_TRACK } from '../player/voiceover';
import { Ui } from './state';
import { VoiceoverDialog } from './Voiceover';

const take = {
  level: () => -12,
  start: (onStart: () => void) => onStart(),
  stop: () => Promise.resolve(new Blob(['opus'], { type: 'audio/webm' })),
  close: vi.fn(),
};
vi.mock('../player/voiceover', async (orig) => {
  const real = await orig<typeof import('../player/voiceover')>();
  return {
    ...real,
    Take: { open: () => Promise.resolve(take), microphones: () => Promise.resolve([]) },
    saveTake: vi.fn(() => Promise.resolve('/Documents/Lumora/Voiceovers/Sequence 1 00-00-02-00.webm')),
  };
});
const vo = (): MediaItem => ({
  id: 'vo1',
  name: 'Take',
  path: '/Documents/Lumora/Voiceovers/Take.webm',
  proxy: null,
  kind: 'audio',
  duration: 4,
  width: 0,
  height: 0,
  fps: 30,
  hasVideo: false,
  hasAudio: true,
  bin: null,
});
vi.mock('./importer', () => ({
  importFiles: (doc: Doc) => {
    doc.edit((p) => ({ ...p, media: [...p.media, vo()] }), 'Import');
    return Promise.resolve(['vo1']);
  },
}));

afterEach(() => vi.useRealTimers());

describe('voiceovers', () => {
  it('go on a Voiceover track (made once) at their frame', () => {
    const p0 = { ...emptyProject('t'), media: [vo()] };
    const p1 = placeVoiceover(p0, 'vo1', 60);
    const s1 = current(p1);
    const track = s1.tracks.find((t) => t.name === VOICEOVER_TRACK)!;
    expect(track.role).toBe('dialogue');
    expect(s1.clips.map((c) => [c.track, c.start, c.length])).toEqual([[track.id, 60, 120]]);
    const p2 = placeVoiceover(p1, 'vo1', 300);
    expect(current(p2).tracks.filter((t) => t.name === VOICEOVER_TRACK)).toHaveLength(1);
    expect(takeName('Spring Gala', '00:01:02:03')).toBe('Spring Gala 00-01-02-03');
  });

  it('count in, record from the playhead while the film plays, and place the take (one Undo)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const doc = new Doc(emptyProject('t'));
    const engine = { time: 60, play: vi.fn(), pause: vi.fn() } as unknown as Engine;
    const onClose = vi.fn();
    render(<VoiceoverDialog doc={doc} engine={engine} ui={new Ui()} onClose={onClose} />);
    const record = await screen.findByRole('button', { name: /Record/ });
    await waitFor(() => expect((record as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(record);
    expect(screen.getByText('3')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    expect(engine.play).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Stop and keep/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const s = current(doc.project);
    const clip = s.clips.find((c) => c.source.kind === 'media' && c.source.media === 'vo1');
    expect(clip?.start).toBe(60);
    expect(s.tracks.find((t) => t.id === clip?.track)?.name).toBe(VOICEOVER_TRACK);
    expect(doc.undoLabel).toBe('Record a voiceover');
  });
});
