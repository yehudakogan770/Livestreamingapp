import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accessFrom, saveAccess, type Profile } from './access';

// A pretend Supabase: what the server (or no internet) answers.
const token = (aal: string) => `x.${btoa(JSON.stringify({ sub: 'u1', aal }))}.y`;
const offline = { name: 'AuthRetryableFetchError', message: 'Failed to fetch' };
let session: { user: { id: string }; access_token: string } | null;
let sessionError: unknown = null;
let user: () => Promise<{ data: { user: unknown }; error: unknown }>;
let profile: () => Promise<{ data: Profile | null; error: unknown }>;
const signOut = vi.fn(() => Promise.resolve({ error: null }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session }, error: sessionError }),
      getUser: () => user(),
      signOut: () => signOut(),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => profile() }) }) }),
    rpc: () => Promise.resolve({ error: null }),
  }),
}));

const { checkAccess } = await import('./auth');

const approved: Profile = { id: 'u1', email: 'a@b.c', name: 'Ann', approved: true, blocked: false, is_admin: false, lumora: true, studio: true };

beforeEach(() => {
  localStorage.clear();
  signOut.mockClear();
  session = { user: { id: 'u1' }, access_token: token('aal1') };
  sessionError = null;
  user = () => Promise.resolve({ data: { user: { id: 'u1', factors: [] } }, error: null });
  profile = () => Promise.resolve({ data: approved, error: null });
});

describe('checking the account when the app starts', () => {
  it('with internet, the server decides (a block counts at once, whatever was remembered)', async () => {
    saveAccess(accessFrom(approved));
    profile = () => Promise.resolve({ data: { ...approved, blocked: true }, error: null });
    expect(await checkAccess()).toMatchObject({ state: 'blocked' });
  });

  it('an account deleted (or a session ended) on the server signs out here too', async () => {
    saveAccess(accessFrom(approved));
    user = () => Promise.resolve({ data: { user: null }, error: { name: 'AuthApiError', status: 403, message: 'User from sub claim in JWT does not exist' } });
    expect(await checkAccess()).toBeNull();
    expect(signOut).toHaveBeenCalled();
  });

  it('a refusal from the server is never answered from what was remembered', async () => {
    saveAccess(accessFrom(approved));
    profile = () => Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied for table profiles' } });
    await expect(checkAccess()).rejects.toThrow(/permission denied/);
    profile = () => Promise.resolve({ data: null, error: null });
    await expect(checkAccess()).rejects.toThrow(/not found/);
  });

  it('without internet, what was remembered (up to 7 days)', async () => {
    saveAccess(accessFrom(approved));
    user = () => Promise.reject(Object.assign(new TypeError('Failed to fetch')));
    expect(await checkAccess()).toMatchObject({ state: 'approved', offline: true });
    localStorage.clear();
    await expect(checkAccess()).rejects.toThrow(/internet/);
  });

  it('without internet and an hour-old sign-in (it cannot be renewed), still what was remembered', async () => {
    saveAccess(accessFrom(approved));
    localStorage.setItem('lumora.signin', JSON.stringify({ user: { id: 'u1' }, access_token: token('aal1') }));
    session = null;
    sessionError = offline;
    expect(await checkAccess()).toMatchObject({ state: 'approved', offline: true });
  });

  it('with two-step sign-in on, the code is asked for, and only then remembered', async () => {
    user = () => Promise.resolve({ data: { user: { id: 'u1', factors: [{ id: 'f', status: 'verified', factor_type: 'totp' }] } }, error: null });
    expect(await checkAccess()).toMatchObject({ twoStep: true, codeNeeded: true });
    expect(localStorage.getItem('lumora.access')).toBeNull();
    session = { user: { id: 'u1' }, access_token: token('aal2') };
    expect(await checkAccess()).toMatchObject({ twoStep: true, codeNeeded: false, aal2: true });
    expect(localStorage.getItem('lumora.access')).not.toBeNull();
  });
});
