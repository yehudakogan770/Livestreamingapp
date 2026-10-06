import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Doc } from '../doc';
import { emptyProject, newClip, type Project } from '../model/types';
import { Ui } from '../ui/state';
import { ExportTimelineDialog, ImportTimelineDialog, type TimelineIO } from './InterchangeDialogs';
import premiere from './fixtures/premiere.xml?raw';
import resolveEdl from './fixtures/resolve.edl?raw';

function project(): Project {
  const p = emptyProject('Test');
  const s = p.sequences[0]!;
  const v1 = s.tracks[0]!;
  const clip = newClip(v1.id, 0, 60, { kind: 'media', media: 'm1', in: 0 }, 'C0012');
  return {
    ...p,
    media: [
      {
        id: 'm1',
        name: 'C0012',
        path: 'C:/Footage/C0012.MP4',
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
    sequences: [{ ...s, clips: [clip] }],
  };
}

const io = (over: Partial<TimelineIO> = {}): TimelineIO => ({
  saveAs: vi.fn(async (name: string) => `C:/Out/${name}`),
  pick: vi.fn(async () => null),
  write: vi.fn(async () => {}),
  exists: vi.fn(async () => false),
  folder: vi.fn(async () => null),
  findByName: vi.fn(async () => null),
  importFiles: vi.fn(async () => {}),
  ...over,
});

describe('Export timeline for other editors', () => {
  it('writes the chosen format to the chosen file', async () => {
    const doc = new Doc(project());
    const ui = new Ui();
    const onClose = vi.fn();
    const fake = io();
    render(<ExportTimelineDialog doc={doc} ui={ui} onClose={onClose} io={fake} />);
    expect(screen.getByText(/For Final Cut Pro, DaVinci Resolve/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Premiere XML/ }));
    expect(screen.getByText(/For Premiere Pro/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Export Premiere/ }));
    await waitFor(() => expect(fake.write).toHaveBeenCalled());
    const [path, text] = (fake.write as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(path).toBe('C:/Out/Sequence 1.xml');
    expect(text).toMatch(/<xmeml version="4">/);
    expect(text).toMatch(/C0012\.MP4/);
    expect(onClose).toHaveBeenCalled();
    expect(ui.state.note).toMatch(/Saved Sequence 1\.xml/);
  });
});

describe('Import a timeline', () => {
  it('shows what is in the file, finds files and makes the sequence', async () => {
    const doc = new Doc(project());
    const ui = new Ui();
    const onClose = vi.fn();
    const fake = io({
      pick: vi.fn(async () => ({ path: 'D:/Wedding.xml', text: premiere })),
      exists: vi.fn(async (p: string) => p.endsWith('C0019.MP4')),
      folder: vi.fn(async () => 'E:/Music'),
      findByName: vi.fn(async (_f: string, name: string) => (name === 'First Dance.mp3' ? 'E:/Music/First Dance.mp3' : null)),
    });
    render(<ImportTimelineDialog doc={doc} ui={ui} onClose={onClose} io={fake} />);
    fireEvent.click(screen.getByRole('button', { name: /Choose/ }));
    expect(await screen.findByText(/Wedding Highlights · 3840×2160 · 29.97 fps/)).toBeInTheDocument();
    expect(await screen.findByText('1 already in the project · 1 found · 2 not found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Look in a folder/ }));
    expect(await screen.findByText('1 already in the project · 2 found · 1 not found')).toBeInTheDocument();
    expect(screen.getByText('1 × generator (left as a gap)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Make the sequence' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fake.importFiles).toHaveBeenCalledWith(doc, ['D:/Weddings/Cohen/C0019.MP4', 'E:/Music/First Dance.mp3']);
    const s = doc.project.sequences.find((x) => x.id === doc.project.open)!;
    expect(s.name).toBe('Wedding Highlights');
    expect(doc.project.media.find((m) => m.name === 'Logo (white)')?.missing).toBe(true);
    expect(ui.state.note).toMatch(/1 file missing/);
  });

  it('asks an EDL’s frame rate', async () => {
    const doc = new Doc(project());
    const fake = io({ pick: vi.fn(async () => ({ path: 'Cut.edl', text: resolveEdl })) });
    render(<ImportTimelineDialog doc={doc} ui={new Ui()} onClose={() => {}} io={fake} />);
    fireEvent.click(screen.getByRole('button', { name: /Choose/ }));
    expect(await screen.findByText(/Timeline 1 · 1920×1080 · 30 fps/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '24' }));
    expect(await screen.findByText(/Timeline 1 · 1920×1080 · 24 fps/)).toBeInTheDocument();
  });

  it('says when a file is not a timeline', async () => {
    const fake = io({ pick: vi.fn(async () => ({ path: 'notes.txt', text: 'shopping list' })) });
    render(<ImportTimelineDialog doc={new Doc(project())} ui={new Ui()} onClose={() => {}} io={fake} />);
    fireEvent.click(screen.getByRole('button', { name: /Choose/ }));
    expect(await screen.findByText(/not a timeline Lumora Studio can read/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make the sequence' })).toBeDisabled();
  });
});
