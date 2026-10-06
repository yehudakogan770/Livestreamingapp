// Signing in to the Planner: the same Lumora accounts (and Supabase project)
// as the app. Approved accounts that may use Lumora (and the Lumora team) make
// plans; anyone with an account works on the plans they were invited to.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { accessFrom, mayUse, type Access, type Profile } from '../../app/src/auth/access';
import { AUTH_KEY, AUTH_URL } from '../../app/src/auth/config';
import { aalOf } from '../../app/src/auth/mfa';
import { MIN_PASSWORD, weakPassword } from '../../app/src/auth/password';
import { clearCache } from './offlineCache';

let client: SupabaseClient | null = null;
export function db(): SupabaseClient {
  client ??= createClient(AUTH_URL, AUTH_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'lumora.planner' } });
  return client;
}

/**
 * Signed out; asked for the two-step code; in (making plans only with Lumora
 * access, otherwise a teammate on the plans shared with them); or not let in.
 */
export type Who = { s: 'out' } | { s: 'code'; access: Access } | { s: 'in'; access: Access; canPlan: boolean } | { s: 'denied'; access: Access; why: string };

/** What this account may do in the Planner. */
export function verdict(a: Access): Who {
  if (a.state === 'blocked') return { s: 'denied', access: a, why: 'This account has been turned off. Ask the Lumora team if you think that is a mistake.' };
  if (a.codeNeeded) return { s: 'code', access: a };
  // Waiting for approval, or not set up for Lumora: a teammate (the plans shared with them only).
  return { s: 'in', access: a, canPlan: mayUse(a, 'lumora') };
}

const offline = (m: string) => /fetch|network|failed/i.test(m);
const plainly = (m: string) => (offline(m) ? 'Cannot reach the Lumora account server. Check the connection.' : m);

export async function whoAmI(): Promise<Who> {
  const { data } = await db().auth.getSession();
  const session = data.session;
  if (!session) return { s: 'out' };
  // Checked with the server: a deleted account or an ended session signs out.
  const u = await db().auth.getUser();
  if (u.error) {
    if (offline(u.error.message)) throw new Error(plainly(u.error.message));
    await db()
      .auth.signOut({ scope: 'local' })
      .catch(() => {});
    clearCache();
    return { s: 'out' };
  }
  const { data: p, error } = await db().from('profiles').select('*').eq('id', session.user.id).single<Profile>();
  if (error) throw new Error(plainly(error.message));
  const twoStep = (u.data.user.factors ?? []).some((f) => f.status === 'verified');
  const aal = aalOf(session.access_token);
  const who = verdict({ ...accessFrom(p), twoStep, aal2: aal === 'aal2', codeNeeded: twoStep && aal !== 'aal2' });
  // Plans this email was invited to before the account existed.
  if (who.s === 'in')
    await db()
      .rpc('claim_planner_invites')
      .then(undefined, () => {});
  return who;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await db().auth.signInWithPassword({ email: email.trim(), password });
  if (!error) return;
  if (/invalid login credentials/i.test(error.message)) throw new Error('That email and password do not match.');
  if (/email not confirmed/i.test(error.message)) throw new Error('Please confirm your email first (check your inbox), then sign in.');
  throw new Error(plainly(error.message));
}

/**
 * A teammate's account, made here: it works on the plans it is invited to
 * (no approval needed for that). Returns false if the email must be confirmed first.
 */
export async function signUp(name: string, email: string, password: string): Promise<boolean> {
  const weak = weakPassword(password);
  if (weak) throw new Error(weak);
  const { data, error } = await db().auth.signUp({
    email: email.trim(),
    password,
    options: { data: { name: name.trim().slice(0, 80), planner: true }, emailRedirectTo: location.href.split('#')[0] },
  });
  if (!error) return data.session !== null;
  if (/already registered|already been registered/i.test(error.message)) throw new Error('There is already an account with that email. Sign in instead.');
  if (/password/i.test(error.message)) throw new Error(`The password needs at least ${MIN_PASSWORD} characters, with letters and numbers.`);
  throw new Error(plainly(error.message));
}

export async function signOut(): Promise<void> {
  // The copy of the plans kept on this device goes with the sign-in.
  clearCache();
  await db().auth.signOut({ scope: 'local' });
}

export function onSignInChange(f: () => void): () => void {
  const { data } = db().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') clearCache();
    // Outside the callback: Supabase calls made inside it wait on each other.
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED' || event === 'MFA_CHALLENGE_VERIFIED') setTimeout(f, 0);
  });
  return () => data.subscription.unsubscribe();
}
