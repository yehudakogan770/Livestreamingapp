// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EMPTY_QUEUE, nextToRun, overall, reduce, type QueueEvent, type QueueState } from './queue';

const run = (events: QueueEvent[], s: QueueState = EMPTY_QUEUE) => events.reduce(reduce, s);
const add = (id: string): QueueEvent => ({ type: 'add', job: { id, name: `Seq ${id}`, preset: 'YouTube', out: `/f/${id}.mp4` }, at: 1 });
const status = (s: QueueState) => s.jobs.map((j) => `${j.id}:${j.status}`).join(' ');

describe('the render queue', () => {
  it('runs one export at a time, in order', () => {
    let s = run([add('a'), add('b')]);
    expect(nextToRun(s)?.id).toBe('a');
    s = reduce(s, { type: 'start', id: 'a' });
    expect(nextToRun(s)).toBeNull();
    // A second one can't start while one runs.
    expect(reduce(s, { type: 'start', id: 'b' })).toBe(s);
    s = reduce(s, { type: 'progress', id: 'a', done: 0.5, message: 'Frame 10', left: 3 });
    expect(s.jobs[0]?.done).toBe(0.5);
    s = reduce(s, { type: 'finish', id: 'a', path: '/f/a.mp4', message: 'Ready', at: 5 });
    expect(status(s)).toBe('a:done b:queued');
    expect(nextToRun(s)?.id).toBe('b');
  });

  it('pauses, resumes and cancels', () => {
    let s = run([add('a'), { type: 'start', id: 'a' }, { type: 'pause', id: 'a' }]);
    expect(status(s)).toBe('a:paused');
    // Paused still counts as being made: nothing else starts.
    s = reduce(s, add('b'));
    expect(nextToRun(s)).toBeNull();
    s = run(
      [
        { type: 'resume', id: 'a' },
        { type: 'cancel', id: 'a' },
      ],
      s,
    );
    expect(status(s)).toBe('a:canceled b:queued');
    expect(nextToRun(s)?.id).toBe('b');
    // A waiting one can be canceled too.
    s = reduce(s, { type: 'cancel', id: 'b' });
    expect(nextToRun(s)).toBeNull();
  });

  it('ignores events that do not fit', () => {
    const s = run([add('a')]);
    expect(reduce(s, { type: 'finish', id: 'a', path: null, message: '', at: 1 })).toBe(s);
    expect(reduce(s, { type: 'pause', id: 'a' })).toBe(s);
    expect(reduce(s, { type: 'resume', id: 'a' })).toBe(s);
    expect(reduce(s, { type: 'retry', id: 'a' })).toBe(s);
    expect(reduce(s, add('a'))).toBe(s);
    expect(reduce(s, { type: 'start', id: 'nope' })).toBe(s);
  });

  it('a failed export can be tried again; a running one cannot be removed', () => {
    let s = run([add('a'), { type: 'start', id: 'a' }]);
    expect(reduce(s, { type: 'remove', id: 'a' })).toBe(s);
    s = reduce(s, { type: 'fail', id: 'a', message: 'Disk full', at: 2 });
    expect(s.jobs[0]?.message).toBe('Disk full');
    s = reduce(s, { type: 'retry', id: 'a' });
    expect(status(s)).toBe('a:queued');
    expect(s.jobs[0]?.done).toBe(0);
    s = run([{ type: 'start', id: 'a' }, { type: 'finish', id: 'a', path: '/x', message: '', at: 3 }, add('b'), { type: 'clear' }], s);
    expect(status(s)).toBe('b:queued');
    s = reduce(s, { type: 'remove', id: 'b' });
    expect(s.jobs).toEqual([]);
  });

  it('holding stops new exports; the order can change', () => {
    let s = run([add('a'), add('b'), add('c'), { type: 'hold' }]);
    expect(nextToRun(s)).toBeNull();
    s = run([{ type: 'move', id: 'c', by: -2 }, { type: 'release' }], s);
    expect(status(s)).toBe('c:queued a:queued b:queued');
    expect(nextToRun(s)?.id).toBe('c');
    expect(reduce(s, { type: 'move', id: 'c', by: -1 })).toBe(s);
  });

  it('adds up how far everything is along', () => {
    const s = run([add('a'), add('b'), { type: 'start', id: 'a' }, { type: 'progress', id: 'a', done: 0.5, message: '', left: null }]);
    const o = overall(s);
    expect(o.done).toBeCloseTo(0.25);
    expect(o.left).toBe(2);
    expect(o.active?.id).toBe('a');
    expect(overall(EMPTY_QUEUE)).toEqual({ done: 1, left: 0, active: null });
  });
});
