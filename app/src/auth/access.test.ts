import { describe, expect, it } from 'vitest';
import { accessFrom, cachedAccess, OFFLINE_DAYS } from './access';

const p = { id: 'u1', email: 'a@b.c', name: 'Ann', approved: false, blocked: false, is_admin: false };

describe('who may use Lumora', () => {
  it('reads an account: waiting, approved, blocked', () => {
    expect(accessFrom(p).state).toBe('pending');
    expect(accessFrom({ ...p, approved: true }).state).toBe('approved');
    expect(accessFrom({ ...p, approved: true, blocked: true }).state).toBe('blocked');
    expect(accessFrom({ ...p, approved: true, blocked: true, is_admin: true }).admin).toBe(false);
  });

  it('keeps working offline for a while, for the same person only', () => {
    const saved = { ...accessFrom({ ...p, approved: true }), at: 1_000 };
    expect(cachedAccess(saved, 'u1', 1_000 + 86_400_000)).toMatchObject({ state: 'approved', offline: true });
    expect(cachedAccess(saved, 'someone-else', 2_000)).toBeNull();
    expect(cachedAccess(saved, 'u1', 1_000 + (OFFLINE_DAYS + 1) * 86_400_000)).toBeNull();
  });
});
