import { describe, expect, it, vi } from 'vitest';
import { ReportQueue, type ReportRow } from './queue';

const row = (fingerprint: string): ReportRow => ({
  kind: 'error',
  app: 'lumora',
  version: '1',
  os: 'x',
  message: fingerprint,
  stack: '',
  logs: '',
  fingerprint,
});

/** A queue on a pretend clock: `tick(ms)` moves time and runs timers that are due. */
function setup(send: (rows: ReportRow[]) => Promise<void>, o: Partial<ConstructorParameters<typeof ReportQueue>[0]> = {}) {
  let now = 0;
  let timers: { at: number; f: () => void }[] = [];
  const q = new ReportQueue({ send, now: () => now, later: (f, ms) => timers.push({ at: now + ms, f }), ...o });
  const tick = async (ms: number) => {
    now += ms;
    const due = timers.filter((t) => t.at <= now);
    timers = timers.filter((t) => t.at > now);
    for (const t of due) t.f();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { q, tick };
}

describe('sending error reports in batches', () => {
  it('waits a moment and sends what came together in one go', async () => {
    const send = vi.fn(async (_rows: ReportRow[]) => {});
    const { q, tick } = setup(send);
    q.add(row('a'));
    q.add(row('b'));
    expect(send).not.toHaveBeenCalled();
    await tick(5_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toHaveLength(2);
    expect(q.size).toBe(0);
  });

  it('sends at once when a batch is full', async () => {
    const send = vi.fn(async () => {});
    const { q } = setup(send, { maxBatch: 3 });
    for (const f of ['a', 'b', 'c']) q.add(row(f));
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends the same problem only once an hour', async () => {
    const send = vi.fn(async () => {});
    const { q, tick } = setup(send);
    expect(q.add(row('loop'))).toBe('queued');
    expect(q.add(row('loop'))).toBe('duplicate');
    await tick(30 * 60_000);
    expect(q.add(row('loop'))).toBe('duplicate');
    await tick(31 * 60_000);
    expect(q.add(row('loop'))).toBe('queued');
  });

  it('never sends more than its limit in ten minutes', async () => {
    const send = vi.fn(async () => {});
    const { q, tick } = setup(send, { perWindow: 3 });
    expect(['a', 'b', 'c', 'd', 'e'].map((f) => q.add(row(f)))).toEqual(['queued', 'queued', 'queued', 'limited', 'limited']);
    await tick(10 * 60_000);
    expect(q.add(row('f'))).toBe('queued');
  });

  it('tries again later when offline, then gives up', async () => {
    const send = vi.fn(async () => {
      throw new Error('offline');
    });
    const { q, tick } = setup(send, { tries: 2 });
    q.add(row('a'));
    await tick(5_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.size).toBe(1);
    await tick(60_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(q.size).toBe(0);
  });

  it('keeps only the newest waiting reports', () => {
    const { q } = setup(async () => {}, { maxPending: 2, maxBatch: 100, perWindow: 100 });
    for (const f of ['a', 'b', 'c']) q.add(row(f));
    expect(q.size).toBe(2);
  });
});
