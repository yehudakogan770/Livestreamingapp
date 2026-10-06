import { describe, expect, it } from 'vitest';
import { Doc } from './doc';
import { emptyProject, type Project } from './model/types';

const p = (name: string): Project => ({ ...emptyProject(name), name });

describe('saving', () => {
  it('stays unsaved when something changed while the file was being written', () => {
    const d = new Doc(p('a'));
    d.edit(() => p('b'));
    const written = d.project;
    // Another change lands before the write finishes.
    d.edit(() => p('c'));
    d.saved(written);
    expect(d.state.dirty).toBe(true);
    d.saved(d.project);
    expect(d.state.dirty).toBe(false);
  });
});

describe('dragging', () => {
  it('keeps a change brought in while the drag goes on, and is one step to undo', () => {
    const d = new Doc(p('a'));
    // A drag: each step is worked out from where it started (here: the name gets a suffix).
    d.drag((start) => ({ ...start, name: `${start.name}-1` }), 'Trim', 'k1');
    // An import finishes meanwhile (brought in under the drag).
    d.rebase((x) => ({ ...x, bins: [...x.bins, { id: 'b1', name: 'Imported', parent: null }] }));
    d.drag((start) => ({ ...start, name: `${start.name}-2` }), 'Trim', 'k1');
    expect(d.project.name).toBe('a-2');
    expect(d.project.bins.map((b) => b.id)).toEqual(['b1']);
    d.undo();
    expect(d.project.name).toBe('a');
    expect(d.project.bins.map((b) => b.id)).toEqual(['b1']);
  });
});

describe('undo', () => {
  it('undoes and redoes, and one slider drag is one step', () => {
    const d = new Doc(p('a'));
    d.edit(() => p('b'), 'B');
    d.edit(() => p('c'), 'Slide', 'slider');
    d.edit(() => p('d'), 'Slide', 'slider');
    expect(d.project.name).toBe('d');
    expect(d.undoLabel).toBe('Slide');
    d.undo();
    expect(d.project.name).toBe('b');
    d.redo();
    expect(d.project.name).toBe('d');
    d.undo();
    d.undo();
    expect(d.project.name).toBe('a');
    expect(d.state.canUndo).toBe(false);
    d.edit(() => p('e'));
    expect(d.state.canRedo).toBe(false);
    expect(d.state.dirty).toBe(true);
  });
});
