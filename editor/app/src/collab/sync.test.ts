import { describe, expect, it, vi } from 'vitest';
import { emptyProject, newClip, newSequence, type Project, type Sequence } from '../model/types';
import { pullFlow, saveFlow, type SaveApi, type Synced } from './sync';

function base(): Project {
  const p = emptyProject('Film');
  return {
    ...p,
    sequences: [
      { ...(p.sequences[0] as Sequence), id: 's1' },
      { ...newSequence('Sequence 2'), id: 's2' },
    ],
    open: 's1',
  };
}
const addClip = (p: Project, id: string, name: string): Project => ({
  ...p,
  sequences: p.sequences.map((s) => (s.id === id ? { ...s, clips: [...s.clips, newClip(s.tracks[0]!.id, 0, 30, { kind: 'color', color: '#fff' }, name)] } : s)),
});
const names = (p: Project, id: string) => p.sequences.find((s) => s.id === id)?.clips.map((c) => c.name);

/** A pretend server: saves only on the newest version. */
function server(start: Synced) {
  let now = start;
  const api: SaveApi = {
    save: vi.fn(async (b: number, doc: Project) => {
      if (b !== now.version) return null;
      now = { version: b + 1, base: doc };
      return now.version;
    }),
    load: vi.fn(async () => now),
  };
  return { api, someoneSaves: (doc: Project) => (now = { version: now.version + 1, base: doc }), now: () => now };
}

describe('saving a shared project', () => {
  it('saves straight away when nobody else saved', async () => {
    const b = base();
    const s = server({ version: 3, base: b });
    const r = await saveFlow(s.api, { version: 3, base: b }, addClip(b, 's1', 'mine'));
    expect(r.kind).toBe('saved');
    expect(s.now().version).toBe(4);
    expect(r.brought).toEqual([]);
    expect(s.api.load).not.toHaveBeenCalled();
  });

  it('brings in a save by someone else to another sequence, then saves', async () => {
    const b = base();
    const s = server({ version: 3, base: b });
    s.someoneSaves(addClip(b, 's2', 'theirs'));
    const r = await saveFlow(s.api, { version: 3, base: b }, addClip(b, 's1', 'mine'));
    expect(r.kind).toBe('saved');
    if (r.kind !== 'saved') return;
    expect(r.synced.version).toBe(5);
    expect(names(s.now().base, 's1')).toEqual(['mine']);
    expect(names(s.now().base, 's2')).toEqual(['theirs']);
    expect(r.brought).toHaveLength(1);
    expect(s.api.save).toHaveBeenCalledTimes(2);
  });

  it('stops with a conflict when both changed the same sequence', async () => {
    const b = base();
    const s = server({ version: 3, base: b });
    s.someoneSaves(addClip(b, 's1', 'theirs'));
    const r = await saveFlow(s.api, { version: 3, base: b }, addClip(b, 's1', 'mine'));
    expect(r.kind).toBe('conflict');
    if (r.kind !== 'conflict') return;
    expect(r.conflicts).toEqual(['Sequence “Sequence 1”']);
    expect(r.theirs.version).toBe(4);
    // Nothing of mine went up.
    expect(names(s.now().base, 's1')).toEqual(['theirs']);
  });

  it('gives up after a few tries when others keep saving', async () => {
    const b = base();
    const api: SaveApi = { save: async () => null, load: async () => ({ version: 9, base: b }) };
    await expect(saveFlow(api, { version: 1, base: b }, b)).rejects.toThrow(/keep saving/);
  });
});

describe('someone else saved', () => {
  it('brings their save in when it does not clash', () => {
    const b = base();
    const r = pullFlow({ version: 1, base: b }, addClip(b, 's1', 'mine'), { version: 2, base: addClip(b, 's2', 'theirs') });
    expect(r.kind).toBe('brought');
  });
  it('reports a clash with my unsaved changes', () => {
    const b = base();
    const r = pullFlow({ version: 1, base: b }, addClip(b, 's1', 'mine'), { version: 2, base: addClip(b, 's1', 'theirs') });
    expect(r.kind).toBe('conflict');
  });
  it('does nothing for a version I already have', () => {
    const b = base();
    expect(pullFlow({ version: 2, base: b }, b, { version: 2, base: b }).kind).toBe('same');
  });
});
