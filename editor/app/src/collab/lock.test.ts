import { describe, expect, it } from 'vitest';
import { Doc } from '../doc';
import { emptyProject, newSequence, type Project, type Sequence } from '../model/types';
import { clockSkew, editGate, lockReason, lockView, type LockRow } from './lock';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const row = (over: Partial<LockRow> = {}): LockRow => ({
  seq_id: 's1',
  holder: 'dana',
  holder_name: 'Dana',
  expires_at: new Date(NOW + 30_000).toISOString(),
  requested_by: null,
  requested_name: '',
  ...over,
});

describe('sequence locks', () => {
  it('is free with no lock, or once it ran out', () => {
    expect(lockView(null, 'me', NOW)).toEqual({ kind: 'free' });
    expect(lockView(row({ expires_at: new Date(NOW - 1).toISOString() }), 'me', NOW)).toEqual({ kind: 'free' });
    // Exactly at the end time it has run out.
    expect(lockView(row({ expires_at: new Date(NOW).toISOString() }), 'me', NOW).kind).toBe('free');
  });

  it('shows who holds it, and whether I asked for it', () => {
    expect(lockView(row(), 'me', NOW)).toEqual({ kind: 'theirs', name: 'Dana', askedByMe: false, until: NOW + 30_000 });
    expect(lockView(row({ requested_by: 'me', requested_name: 'Me' }), 'me', NOW)).toMatchObject({ kind: 'theirs', askedByMe: true });
  });

  it('is mine, with who asks for it', () => {
    expect(lockView(row({ holder: 'me' }), 'me', NOW)).toEqual({ kind: 'mine', askedBy: null });
    expect(lockView(row({ holder: 'me', requested_by: 'sam', requested_name: 'Sam' }), 'me', NOW)).toEqual({ kind: 'mine', askedBy: 'Sam' });
  });

  it("goes by the server's clock", () => {
    const skew = clockSkew(new Date(NOW + 45_000).toISOString(), NOW);
    expect(skew).toBe(45_000);
    // My clock says 30 s left, but the server is 45 s ahead: it ran out.
    expect(lockView(row(), 'me', NOW + skew).kind).toBe('free');
    expect(clockSkew(undefined, NOW)).toBe(0);
  });

  it('explains in plain words why a sequence cannot be changed', () => {
    expect(lockReason({ kind: 'theirs', name: 'Dana', askedByMe: false, until: 0 }, 'Main', true, true)).toBe('Dana is editing “Main”.');
    expect(lockReason({ kind: 'free' }, 'Main', false, true)).toBe('Open “Main” to edit it.');
    expect(lockReason({ kind: 'free' }, 'Main', true, false)).toMatch(/cannot reach the internet/);
    expect(lockReason({ kind: 'mine', askedBy: null }, 'Main', true, true)).toBeNull();
  });
});

function project(): Project {
  const p = emptyProject('Film');
  return {
    ...p,
    sequences: [
      { ...(p.sequences[0] as Sequence), id: 's1' },
      { ...newSequence('Two'), id: 's2' },
    ],
    open: 's1',
  };
}
const touch = (p: Project, id: string): Project => ({ ...p, sequences: p.sequences.map((s) => (s.id === id ? { ...s, background: '#123456' } : s)) });

describe('who may change what', () => {
  const holdS1 = (id: string) => (id === 's1' ? null : 'Dana is editing “Two”.');

  it('lets an editor change the sequence they hold, not another', () => {
    const p = project();
    expect(editGate(p, touch(p, 's1'), 'editor', holdS1)).toBeNull();
    expect(editGate(p, touch(p, 's2'), 'editor', holdS1)).toBe('Dana is editing “Two”.');
  });

  it('stops viewers, but not for things that are never saved', () => {
    const p = project();
    expect(editGate(p, touch(p, 's1'), 'viewer', () => null)).toMatch(/view this project/);
    const moved = { ...p, open: 's2', sequences: p.sequences.map((s) => ({ ...s, playhead: 99 })) };
    expect(editGate(p, moved, 'viewer', () => 'no')).toBeNull();
  });

  it('lets editors add sequences and media without a lock', () => {
    const p = project();
    const more = { ...p, sequences: [...p.sequences, { ...newSequence('Three'), id: 's3' }] };
    expect(editGate(p, more, 'editor', () => 'locked')).toBeNull();
  });

  it('keeps the Doc from making a blocked change (and from undoing into one)', () => {
    const d = new Doc(project());
    const said: string[] = [];
    d.blocked = (why) => said.push(why);
    d.gate = (before, after) => editGate(before, after, 'editor', holdS1);
    d.edit((p) => touch(p, 's2'), 'Color');
    expect(d.state.canUndo).toBe(false);
    expect(said).toEqual(['Dana is editing “Two”.']);
    d.edit((p) => touch(p, 's1'), 'Color');
    expect(d.state.canUndo).toBe(true);
    // Lost the lock: Undo would change s1, so it is stopped too.
    d.gate = (before, after) => editGate(before, after, 'editor', () => 'Dana is editing “Sequence 1”.');
    d.undo();
    expect(d.state.canUndo).toBe(true);
    expect(said).toHaveLength(2);
  });

  it("brings someone else's change into every undo step", () => {
    const d = new Doc(project());
    d.edit((p) => touch(p, 's1'), 'Color');
    d.rebase((p) => ({ ...p, name: 'Renamed by Dana' }));
    expect(d.project.name).toBe('Renamed by Dana');
    d.undo();
    expect(d.project.name).toBe('Renamed by Dana');
    d.replace(project());
    expect(d.state.canUndo).toBe(false);
    expect(d.state.dirty).toBe(false);
  });
});
