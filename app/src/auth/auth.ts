// Signing in, and the Lumora team approving people (Supabase).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AUTH_KEY, AUTH_URL } from './config';
import { accessFrom, cachedAccess, forgetAccess, loadAccess, saveAccess, type Access, type Profile } from './access';

let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  client ??= createClient(AUTH_URL, AUTH_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'lumora.signin' } });
  return client;
}

/** The signed-in connection to the Lumora account server (Lumora Studio's team projects use it too). */
export const supabase = (): SupabaseClient => sb();

/** Plain words for what went wrong. */
function say(e: unknown): Error {
  const m = e instanceof Error ? e.message : String(e);
  if (/invalid login credentials/i.test(m)) return new Error('That email and password do not match. Check them and try again.');
  if (/already registered|already been registered/i.test(m)) return new Error('There is already an account with that email. Sign in instead.');
  if (/password should be at least/i.test(m)) return new Error('The password needs at least 6 characters.');
  if (/email not confirmed/i.test(m)) return new Error('Please confirm your email first (check your inbox), then sign in.');
  if (/same.*(old|current)|different from the old/i.test(m)) return new Error('The new password must be different from the current one.');
  if (/set_my_name|could not find the function/i.test(m)) return new Error('Changing names is not switched on yet on the Lumora account server.');
  if (/fetch|network|failed to/i.test(m)) return new Error('Lumora cannot reach the internet. Check the connection and try again.');
  return new Error(m);
}

/** Who is signed in and whether they may use Lumora (null: nobody is signed in). */
export async function checkAccess(): Promise<Access | null> {
  const { data } = await sb().auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  try {
    const { data: p, error } = await sb().from('profiles').select('*').eq('id', user.id).single<Profile>();
    if (error) throw error;
    const a = accessFrom(p);
    saveAccess(a);
    return a;
  } catch (e) {
    // No internet: what we knew last time, for a while (events are often offline).
    const known = cachedAccess(loadAccess(), user.id, Date.now());
    if (known) return known;
    throw say(e);
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw say(error);
}

/** Make an account. Returns false if the email must be confirmed first. */
export async function signUp(name: string, email: string, password: string): Promise<boolean> {
  const { data, error } = await sb().auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } });
  if (error) throw say(error);
  return data.session !== null;
}

export async function signOut(): Promise<void> {
  forgetAccess();
  await sb().auth.signOut();
}

export function onSignInChange(f: () => void): () => void {
  const { data } = sb().auth.onAuthStateChange(() => f());
  return () => data.subscription.unsubscribe();
}

/** Everyone who has an account (for the Lumora team). */
export async function listPeople(): Promise<Profile[]> {
  const { data, error } = await sb().from('profiles').select('*').order('created_at', { ascending: false });
  if (error) throw say(error);
  return data as Profile[];
}

/** What the Lumora team may change about an account: approval, and which apps it may use. */
export type PersonChange = Partial<Pick<Profile, 'approved' | 'blocked' | 'lumora' | 'studio'>>;

export async function setPerson(id: string, change: PersonChange): Promise<void> {
  const { error } = await sb().from('profiles').update(change).eq('id', id);
  if (error) throw say(error);
}

/** Change your own name (what the Lumora team sees). */
export async function changeName(name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new Error('Type a name first.');
  const { error } = await sb().rpc('set_my_name', { new_name: clean });
  if (error) throw say(error);
  await sb().auth.updateUser({ data: { name: clean } });
}

/** Change your password; the current one is checked first. */
export async function changePassword(email: string, current: string, next: string): Promise<void> {
  if (next.length < 6) throw new Error('The new password needs at least 6 characters.');
  const check = await sb().auth.signInWithPassword({ email, password: current });
  if (check.error) throw new Error('The current password is not right.');
  const { error } = await sb().auth.updateUser({ password: next });
  if (error) throw say(error);
}
