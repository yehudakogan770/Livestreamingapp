import { describe, expect, it } from 'vitest';
import { accessFrom, cachedAccess, mayUse, OFFLINE_DAYS } from './access';

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
});
