import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GuideDialog } from './GuideDialog';
import { GUIDE, searchGuide } from './guide';

describe('help topics', () => {
  it('cover each finishing tool', () => {
    const all = GUIDE.map((t) => [t.title, ...t.paragraphs].join(' ')).join(' ');
    for (const word of [
      'FCPXML',
      'EDL',
      'OpenTimelineIO',
      '.cube',
      'False color',
      'Zebra',
      '−23 LUFS',
      'true peak',
      'stems',
      'ProRes 422 HQ',
      'DNxHR HQX',
      '.srt',
      'chapters',
      'thumbnail',
      'render queue',
      'Blackmagic RAW',
      'image sequence',
    ])
      expect(all.toLowerCase()).toContain(word.toLowerCase());
  });

  it('are written plainly: no shouting, no emoji', () => {
    for (const t of GUIDE)
      for (const p of [t.title, t.where, ...t.paragraphs]) {
        expect(p).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(p).not.toMatch(/\b[A-Z]{2,} [A-Z]{2,} [A-Z]{2,}\b/);
      }
    expect(new Set(GUIDE.map((t) => t.id)).size).toBe(GUIDE.length);
  });

  it('search needs every word', () => {
    expect(searchGuide('').length).toBe(GUIDE.length);
    expect(searchGuide('BRAW').map((t) => t.id)).toEqual(['formats']);
    expect(searchGuide('braw lufs')).toEqual([]);
    expect(searchGuide('r3d convert').map((t) => t.id)).toEqual(['formats']);
    expect(searchGuide('zebra level').map((t) => t.id)).toEqual(['exposure']);
  });

  it('shows the chosen topic and filters as you type', () => {
    const onClose = vi.fn();
    render(<GuideDialog onClose={onClose} />);
    expect(screen.getByRole('article', { name: 'Working with other editors' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Loudness and sound-only exports' }));
    expect(screen.getByRole('article', { name: 'Loudness and sound-only exports' }).textContent).toMatch(/EBU R128/);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search help' }), { target: { value: 'R3D' } });
    expect(screen.getAllByRole('button', { name: /./ }).filter((b) => b.closest('nav'))).toHaveLength(1);
    expect(screen.getByRole('article', { name: 'Camera formats' })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search help' }), { target: { value: 'nothing like this' } });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
