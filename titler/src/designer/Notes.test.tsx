// Notes pinned on the canvas: written, listed, marked done, removed; an
// empty one goes away when closed; never drawn by the renderer.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { newProject } from '../core/build';
import { renderFrame } from '../core/render';
import { Store } from './store';
import { NotesPanel, NotesPopover } from './Notes';
import { canvas, env, pixels } from '../test/nodeCanvas';

function withNote(text = '') {
  const p = newProject();
  const s = new Store({ ...p, notes: [{ id: 'n1', comp: p.main, x: 100, y: 80, text, at: 0 }] });
  s.set({ editingNote: 'n1' });
  return s;
}

describe('canvas notes', () => {
  it('are written in the card and listed; done and removed', () => {
    const s = withNote();
    render(
      <>
        <NotesPopover store={s} />
        <NotesPanel store={s} />
      </>,
    );
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Make the name bigger' } });
    expect(s.get().project.notes![0]!.text).toBe('Make the name bigger');
    expect(screen.getByText('Notes (1 open)')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Note 1 done'));
    expect(s.get().project.notes![0]!.done).toBe(true);
    expect(screen.getByText('Notes (0 open)')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Remove note'));
    expect(s.get().project.notes).toEqual([]);
  });

  it('an empty note goes away when closed', () => {
    const s = withNote('');
    render(<NotesPopover store={s} />);
    fireEvent.click(screen.getByLabelText('Close note'));
    expect(s.get().project.notes).toEqual([]);
    expect(s.get().editingNote).toBeNull();
  });

  it('are never drawn on air', () => {
    const a = withNote('Visible only while designing').get().project;
    const draw = (p: typeof a) => {
      const c = canvas(192, 108);
      renderFrame(c.getContext('2d') as unknown as CanvasRenderingContext2D, p, { time: 1, env, width: 192, height: 108 });
      return Buffer.from(pixels(c));
    };
    expect(draw(a).equals(draw({ ...a, notes: [] }))).toBe(true);
  });
});
