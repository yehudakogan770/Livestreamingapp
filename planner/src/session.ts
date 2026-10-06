// Signing in to the Planner: the same Lumora accounts (and Supabase project)
// as the app. Approved accounts that may use Lumora, and the Lumora team.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { accessFrom, mayUse, type Access, type Profile } from '../../app/src/auth/access';
import { AUTH_KEY, AUTH_URL } from '../../app/src/auth/config';

let client: SupabaseClient | null = null;
export function db(): SupabaseClient {
  client ??= createClient(AUTH_URL, AUTH_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'lumora.planner' } });
  return client;
}

export type Who = { s: 'out' } | { s: 'in'; access: Access } | { s: 'denied'; access: Access; why: string };

/** Whether this account may use the Planner, in words when it may not. */
export function verdict(a: Access): Who {
  if (a.state === 'blocked') return { s: 'denied', access: a, why: 'This account has been turned off. Ask the Lumora team if you think that is a mistake.' };
  if (a.state === 'pending') return { s: 'denied', access: a, why: 'This account is waiting for the Lumora team to approve it.' };
  if (!mayUse(a, 'lumora'))
    return { s: 'denied', access: a, why: 'This account is not set up for Lumora. The Lumora team can turn it on in People and approvals.' };
  return { s: 'in', access: a };
}

export async function whoAmI(): Promise<Who> {
  const { data } = await db().auth.getSession();
  const user = data.session?.user;
  if (!user) return { s: 'out' };
  const { data: p, error } = await db().from('profiles').select('*').eq('id', user.id).single<Profile>();
  if (error) throw new Error(/fetch|network|failed/i.test(error.message) ? 'Cannot reach the Lumora account server. Check the connection.' : error.message);
  return verdict(accessFrom(p));
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await db().auth.signInWithPassword({ email: email.trim(), password });
  if (!error) return;
  if (/invalid login credentials/i.test(error.message)) throw new Error('That email and password do not match.');
  if (/email not confirmed/i.test(error.message)) throw new Error('Please confirm your email first (check your inbox), then sign in.');
  if (/fetch|network|failed/i.test(error.message)) throw new Error('Cannot reach the Lumora account server. Check the connection.');
  throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  await db().auth.signOut();
}

export function onSignInChange(f: () => void): () => void {
  const { data } = db().auth.onAuthStateChange((event) => {
    // Outside the callback: Supabase calls made inside it wait on each other.
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') setTimeout(f, 0);
  });
  return () => data.subscription.unsubscribe();
}
