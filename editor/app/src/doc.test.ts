import { describe, expect, it } from 'vitest';
import { Doc } from './doc';
import type { Project } from './model/project';

const p = (name: string) => ({ name, clips: [], titles: [] }) as unknown as Project;

describe('undo', () => {
  it('undoes and redoes, and one slider drag is one step', () => {
    const d = new Doc(p('a'));
    d.edit(() => p('b'));
    d.edit(() => p('c'), 'slider');
    d.edit(() => p('d'), 'slider');
    expect(d.project.name).toBe('d');
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
