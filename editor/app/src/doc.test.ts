import { describe, expect, it } from 'vitest';
import { Doc } from './doc';
import { emptyProject, type Project } from './model/types';

const p = (name: string): Project => ({ ...emptyProject(name), name });

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
