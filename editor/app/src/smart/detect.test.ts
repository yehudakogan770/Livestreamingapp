import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FaceFinder } from './detect';

/** A worker stand-in: answers the start as told, and can fall over. */
class FakeWorker {
  static made: FakeWorker[] = [];
  static answer: 'ready' | 'error' = 'ready';
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  constructor() {
    FakeWorker.made.push(this);
  }
  postMessage(m: { type: string }) {
    if (m.type === 'load') queueMicrotask(() => this.onmessage?.({ data: { type: FakeWorker.answer, message: 'No models here.' } } as MessageEvent));
  }
  crash() {
    this.onerror?.({ message: 'out of memory' } as ErrorEvent);
  }
  terminate() {
    this.terminated = true;
  }
}

const g = globalThis as { Worker?: unknown };
const saved = g.Worker;
beforeAll(() => {
  g.Worker = FakeWorker;
});
afterAll(() => {
  g.Worker = saved;
});

describe('the face finder', () => {
  it('lets a worker that could not start go, and starts a new one next time', async () => {
    FakeWorker.made = [];
    FakeWorker.answer = 'error';
    const f = new FaceFinder();
    await expect(f.start()).rejects.toThrow('No models here.');
    expect(FakeWorker.made[0]?.terminated).toBe(true);
    FakeWorker.answer = 'ready';
    await f.start();
    expect(FakeWorker.made).toHaveLength(2);
    f.stop();
  });

  it('gives back what was asked when its worker falls over (nothing waits forever)', async () => {
    FakeWorker.made = [];
    FakeWorker.answer = 'ready';
    const f = new FaceFinder();
    await f.start();
    const looking = f.look('/a.mp4', [0, 1]);
    FakeWorker.made[0]?.crash();
    await expect(looking).resolves.toEqual([[], []]);
  });
});
