import { describe, expect, it } from 'vitest';
import { markSeen, readSeen, REQUIREMENTS, seenKey, shouldAutoRun } from './seen';

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('when the check runs by itself', () => {
  it('runs the first time on a computer', () => {
    const s = memoryStore();
    expect(readSeen('lumora', s)).toBeNull();
    expect(shouldAutoRun(readSeen('lumora', s))).toBe(true);
  });

  it('then not again — not even after an update that keeps the requirements', () => {
    const s = memoryStore();
    markSeen('lumora', '1.0.0', 'risky', s, 1000);
    expect(readSeen('lumora', s)).toEqual({ requirements: REQUIREMENTS, version: '1.0.0', verdict: 'risky', at: 1000 });
    expect(shouldAutoRun(readSeen('lumora', s))).toBe(false);
    // Each app keeps its own.
    expect(shouldAutoRun(readSeen('studio', s))).toBe(true);
  });

  it('again after an update that changes the requirements', () => {
    const s = memoryStore();
    markSeen('studio', '1.0.0', 'yes', s);
    expect(shouldAutoRun(readSeen('studio', s), REQUIREMENTS + 1)).toBe(true);
  });

  it('treats something unreadable as never checked', () => {
    const s = memoryStore();
    s.m.set(seenKey('lumora'), '{not json');
    expect(readSeen('lumora', s)).toBeNull();
    s.m.set(seenKey('lumora'), '{"version":"1"}');
    expect(readSeen('lumora', s)).toBeNull();
    expect(readSeen('lumora', null)).toBeNull();
  });
});
