import { describe, expect, it } from 'vitest';
import { accessFrom, cachedAccess, isOffline, mayUse, OFFLINE_DAYS } from './access';

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

  it('accounts from before apps could be chosen may use both', () => {
    const a = accessFrom({ ...p, approved: true });
    expect(a).toMatchObject({ lumora: true, studio: true });
    expect(mayUse(a, 'lumora') && mayUse(a, 'studio')).toBe(true);
  });

  it('an account is set up for one app, both, or (before approval) neither', () => {
    const studioOnly = accessFrom({ ...p, approved: true, lumora: false, studio: true });
    expect(mayUse(studioOnly, 'studio')).toBe(true);
    expect(mayUse(studioOnly, 'lumora')).toBe(false);
    const lumoraOnly = accessFrom({ ...p, approved: true, lumora: true, studio: false });
    expect(mayUse(lumoraOnly, 'lumora')).toBe(true);
    expect(mayUse(lumoraOnly, 'studio')).toBe(false);
    // Not approved (or blocked): neither app, whatever is ticked.
    const waiting = accessFrom({ ...p, lumora: true, studio: true });
    expect(mayUse(waiting, 'lumora') || mayUse(waiting, 'studio')).toBe(false);
    const blocked = accessFrom({ ...p, approved: true, blocked: true, lumora: true, studio: true });
    expect(mayUse(blocked, 'lumora') || mayUse(blocked, 'studio')).toBe(false);
  });

  it('the Lumora team always has both apps', () => {
    const a = accessFrom({ ...p, approved: true, is_admin: true, lumora: false, studio: false });
    expect(mayUse(a, 'lumora') && mayUse(a, 'studio')).toBe(true);
  });

  it('offline, the remembered apps still count (and older saves mean both)', () => {
    const saved = { ...accessFrom({ ...p, approved: true, lumora: true, studio: false }), at: 1_000 };
    const known = cachedAccess(saved, 'u1', 2_000)!;
    expect(mayUse(known, 'lumora')).toBe(true);
    expect(mayUse(known, 'studio')).toBe(false);
    const { lumora: _l, studio: _s, ...old } = saved;
    expect(cachedAccess(old as typeof saved, 'u1', 2_000)).toMatchObject({ lumora: true, studio: true });
    const waiting = { ...accessFrom({ ...p, lumora: true, studio: true }), at: 1_000 };
    expect(mayUse(cachedAccess(waiting, 'u1', 2_000)!, 'lumora')).toBe(false);
  });

  it('offline sign-in is remembered for 7 days, no more', () => {
    expect(OFFLINE_DAYS).toBe(7);
    const saved = { ...accessFrom({ ...p, approved: true }), at: 1_000 };
    expect(cachedAccess(saved, 'u1', 1_000 + 7 * 86_400_000)).not.toBeNull();
    expect(cachedAccess(saved, 'u1', 1_000 + 7 * 86_400_000 + 1)).toBeNull();
    // A clock turned back does not stretch it.
    expect(cachedAccess(saved, 'u1', 500)).toBeNull();
  });

  it('offline, an account with two-step sign-in needs a session that gave the code', () => {
    const saved = { ...accessFrom({ ...p, approved: true }), twoStep: true, at: 1_000 };
    expect(cachedAccess(saved, 'u1', 2_000, 'aal1')).toBeNull();
    expect(cachedAccess(saved, 'u1', 2_000, null)).toBeNull();
    expect(cachedAccess(saved, 'u1', 2_000, 'aal2')).toMatchObject({ state: 'approved', offline: true, codeNeeded: false });
  });

  it('a code still to give keeps the app closed', () => {
    const a = { ...accessFrom({ ...p, approved: true }), twoStep: true, codeNeeded: true };
    expect(mayUse(a, 'lumora')).toBe(false);
    expect(mayUse({ ...a, codeNeeded: false }, 'lumora')).toBe(true);
  });

  it('only "no internet" falls back to the remembered answer; a real answer from the server does not', () => {
    expect(isOffline(new TypeError('Failed to fetch'))).toBe(true);
    expect(isOffline({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' })).toBe(true);
    expect(isOffline({ message: 'TypeError: NetworkError when attempting to fetch resource.' })).toBe(true);
    expect(isOffline({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })).toBe(false);
    expect(isOffline({ name: 'AuthApiError', message: 'User from sub claim in JWT does not exist' })).toBe(false);
    expect(isOffline(new Error('permission denied for table profiles'))).toBe(false);
  });
});
