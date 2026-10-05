import { describe, expect, it } from 'vitest';
import { applyChange, checkText, forSequence, fromRow, openCount, pins, type CommentRow, type ReviewComment } from './comments';

const row = (over: Partial<CommentRow> = {}): CommentRow => ({
  id: 'c1',
  project_id: 'p1',
  seq_id: 's1',
  frame: 30,
  author: 'dana',
  author_name: 'Dana',
  text: 'Cut earlier here',
  resolved: false,
  created_at: '2026-10-05T12:00:00Z',
  ...over,
});
const list = (rows: Partial<CommentRow>[]): ReviewComment[] => rows.map((r) => fromRow(row(r)));

describe('review comments', () => {
  it('reads a row from the server', () => {
    expect(fromRow(row({ frame: 12.6, author_name: '' }))).toEqual({
      id: 'c1',
      seq: 's1',
      frame: 13,
      author: 'dana',
      authorName: 'Someone',
      text: 'Cut earlier here',
      resolved: false,
      at: Date.parse('2026-10-05T12:00:00Z'),
    });
  });

  it('checks the words', () => {
    expect(checkText('   ')).toBe('Type a comment first.');
    expect(checkText('x'.repeat(2001))).toMatch(/up to 2000/);
    expect(checkText('Looks good')).toBeNull();
  });

  it('adds, changes and removes live (and ignores other projects)', () => {
    let l: ReviewComment[] = [];
    l = applyChange(l, { eventType: 'INSERT', new: row({ id: 'b', frame: 90 }), old: {} }, 'p1');
    l = applyChange(l, { eventType: 'INSERT', new: row({ id: 'a', frame: 10 }), old: {} }, 'p1');
    expect(l.map((c) => c.id)).toEqual(['a', 'b']);
    // The same insert twice (mine, then the live copy) is one comment.
    l = applyChange(l, { eventType: 'INSERT', new: row({ id: 'a', frame: 10 }), old: {} }, 'p1');
    expect(l).toHaveLength(2);
    l = applyChange(l, { eventType: 'UPDATE', new: row({ id: 'a', frame: 10, resolved: true }), old: { id: 'a' } }, 'p1');
    expect(l.find((c) => c.id === 'a')?.resolved).toBe(true);
    l = applyChange(l, { eventType: 'INSERT', new: row({ id: 'x', project_id: 'other' }), old: {} }, 'p1');
    expect(l).toHaveLength(2);
    l = applyChange(l, { eventType: 'DELETE', new: {}, old: { id: 'b' } }, 'p1');
    expect(l.map((c) => c.id)).toEqual(['a']);
    expect(applyChange(l, { eventType: 'DELETE', new: {}, old: { id: 'nope' } }, 'p1')).toBe(l);
  });

  it('shows one sequence, done ones only when asked', () => {
    const l = list([
      { id: 'a', frame: 50 },
      { id: 'b', frame: 5, resolved: true },
      { id: 'c', seq_id: 's2' },
    ]);
    expect(forSequence(l, 's1', false).map((c) => c.id)).toEqual(['a']);
    expect(forSequence(l, 's1', true).map((c) => c.id)).toEqual(['b', 'a']);
    expect(openCount(l, 's1')).toBe(1);
    expect(openCount(l)).toBe(2);
  });

  it('makes one timeline pin per frame', () => {
    const l = list([
      { id: 'a', frame: 30, text: 'Too dark' },
      { id: 'b', frame: 30, author_name: 'Sam', text: 'Agreed', resolved: true },
      { id: 'c', frame: 60, resolved: true },
      { id: 'd', frame: 60, seq_id: 's2' },
    ]);
    const p = pins(l, 's1');
    expect(p.map((x) => [x.frame, x.ids, x.resolved])).toEqual([
      [30, ['a', 'b'], false],
      [60, ['c'], true],
    ]);
    expect(p[0]?.title).toBe('Dana: Too dark\nSam: Agreed (done)');
  });
});
