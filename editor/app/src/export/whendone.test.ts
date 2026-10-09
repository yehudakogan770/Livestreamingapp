import { describe, expect, it, vi } from 'vitest';
import type { QueueEvent } from './queue';
import { RenderQueue } from './renderQueue';

describe('after an export', () => {
  it('runs what was asked once it finishes well, and not after a failure', () => {
    const q = new RenderQueue();
    const send = (e: QueueEvent) => (q as unknown as { send: (e: QueueEvent) => void }).send(e);
    // Held, so nothing starts on its own.
    q.hold(true);
    send({ type: 'add', job: { id: 'a', name: 'Gala', preset: 'YouTube', out: '/a.mp4' }, at: 1 });
    send({ type: 'add', job: { id: 'b', name: 'Reel', preset: 'YouTube', out: '/b.mp4' }, at: 1 });
    const done = vi.fn();
    const failed = vi.fn();
    q.whenDone('a', done);
    q.whenDone('b', failed);
    send({ type: 'start', id: 'a' });
    send({ type: 'finish', id: 'a', path: '/a.mp4', message: '', at: 2 });
    send({ type: 'start', id: 'b' });
    send({ type: 'fail', id: 'b', message: 'no', at: 3 });
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0]?.[0]).toMatchObject({ id: 'a', path: '/a.mp4' });
    expect(failed).not.toHaveBeenCalled();
  });
});
