import { describe, expect, test, vi } from 'vitest';
import { Undo, withTestSession, type SessionApi } from './session';

function fakeApi(over: Partial<SessionApi> = {}) {
  const log: string[] = [];
  const api: SessionApi = {
    begin: vi.fn(async (userDrive: boolean) => {
      log.push(`begin ${userDrive}`);
      return { folder: '/rec/lumora-test-event-1' };
    }),
    end: vi.fn(async () => {
      log.push('end');
      return true;
    }),
    cleanup: vi.fn(async (folder: string, replays: string[]) => {
      log.push(`cleanup ${folder} ${replays.join(',')}`);
    }),
    ...over,
  };
  return { api, log };
}

describe('undo', () => {
  test('runs newest first, once, past failures', async () => {
    const u = new Undo();
    const order: string[] = [];
    u.add('a', () => order.push('a'));
    u.add('b', () => {
      throw new Error('b broke');
    });
    u.add('c', async () => order.push('c'));
    expect(u.pending).toEqual(['c', 'b', 'a']);
    const r = await u.runAll();
    expect(order).toEqual(['c', 'a']);
    expect(r.find((x) => x.name === 'b')).toMatchObject({ ok: false, error: 'b broke' });
    expect(await u.runAll()).toEqual([]);
    expect(order).toEqual(['c', 'a']);
  });

  test('something added after the end is undone at once', async () => {
    const u = new Undo();
    await u.runAll();
    const late = vi.fn();
    u.add('late', late);
    await Promise.resolve();
    await Promise.resolve();
    expect(late).toHaveBeenCalled();
  });
});

describe('the person’s event is always put back', () => {
  test('after a test that finishes: everything undone, the event back, then the files removed', async () => {
    const { api, log } = fakeApi();
    const r = await withTestSession(api, true, async ({ undo, replays }) => {
      undo.add('stop the recording', () => log.push('stop recording'));
      replays.push('/data/replays/replay-1.webm');
      return 42;
    });
    expect(r.value).toBe(42);
    expect(r.restored).toBe(true);
    expect(log).toEqual(['begin true', 'stop recording', 'end', 'cleanup /rec/lumora-test-event-1 /data/replays/replay-1.webm']);
  });

  test('after a step throws (or Stop): still put back', async () => {
    const { api, log } = fakeApi();
    const r = await withTestSession(api, false, async ({ undo }) => {
      undo.add('close the outputs', () => log.push('close outputs'));
      throw new Error('Stopped');
    });
    expect(r.error).toBeInstanceOf(Error);
    expect(r.restored).toBe(true);
    expect(log).toEqual(['begin false', 'close outputs', 'end', 'cleanup /rec/lumora-test-event-1 ']);
  });

  test('an undo that fails does not stop the event coming back', async () => {
    const { api, log } = fakeApi();
    const r = await withTestSession(api, true, async ({ undo }) => {
      undo.add('stop the stream', () => {
        throw new Error('stream stuck');
      });
    });
    expect(r.restored).toBe(true);
    expect(log).toContain('end');
    expect(r.undo.find((u) => u.name === 'stop the stream')!.ok).toBe(false);
  });

  test('if putting it back fails, it says so (Lumora puts it back at the next start) and still cleans up', async () => {
    const { api, log } = fakeApi({
      end: vi.fn(async () => {
        throw new Error('disk full');
      }),
    });
    const r = await withTestSession(api, true, async () => 1);
    expect(r.restored).toBe(false);
    expect(log.some((l) => l.startsWith('cleanup'))).toBe(true);
  });

  test('if the test could not start, nothing else happens', async () => {
    const body = vi.fn();
    const { api } = fakeApi({
      begin: vi.fn(async () => {
        throw new Error('Lumora is recording');
      }),
    });
    const r = await withTestSession(api, true, body);
    expect(body).not.toHaveBeenCalled();
    expect(r.restored).toBeNull();
    expect(api.end).not.toHaveBeenCalled();
    expect(api.cleanup).not.toHaveBeenCalled();
  });

  test('restore runs after everything the test started was undone, and calls back after', async () => {
    const after = vi.fn();
    const { api, log } = fakeApi();
    await withTestSession(
      api,
      true,
      async ({ undo }) => {
        undo.add('one', () => log.push('one'));
        undo.add('two', () => log.push('two'));
      },
      async () => {
        after();
        log.push('after');
      },
    );
    expect(log.slice(1)).toEqual(['two', 'one', 'end', 'after', 'cleanup /rec/lumora-test-event-1 ']);
  });
});
