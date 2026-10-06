// Signing in, and the Lumora team approving people (Supabase).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AUTH_KEY, AUTH_URL } from './config';
import { accessFrom, cachedAccess, forgetAccess, isOffline, loadAccess, saveAccess, type Access, type Profile } from './access';
import { aalOf, twoStepState, type TwoStepState } from './mfa';
import { MIN_PASSWORD, weakPassword } from './password';

const STORAGE_KEY = 'lumora.signin';
let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  client ??= createClient(AUTH_URL, AUTH_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: STORAGE_KEY } });
  return client;
}

/** The signed-in connection to the Lumora account server (Lumora Studio's team projects use it too). */
export const supabase = (): SupabaseClient => sb();

export { MIN_PASSWORD, weakPassword };

/** Plain words for what went wrong. */
function say(e: unknown): Error {
  const m = e instanceof Error ? e.message : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/invalid login credentials/i.test(m)) return new Error('That email and password do not match. Check them and try again.');
  if (/already registered|already been registered/i.test(m)) return new Error('There is already an account with that email. Sign in instead.');
  if (/password should be at least|password.*(weak|characters)/i.test(m))
    return new Error(`The password needs at least ${MIN_PASSWORD} characters, with letters and numbers.`);
  if (/email not confirmed/i.test(m)) return new Error('Please confirm your email first (check your inbox), then sign in.');
  if (/same.*(old|current)|different from the old/i.test(m)) return new Error('The new password must be different from the current one.');
  if (/set_my_name|could not find the function/i.test(m)) return new Error('Changing names is not switched on yet on the Lumora account server.');
  if (/fetch|network|failed to/i.test(m)) return new Error('Lumora cannot reach the internet. Check the connection and try again.');
  return new Error(m);
}

/** Did the server say this sign-in is over (account deleted, session ended), rather than some other trouble? */
function signedOutByServer(e: unknown): boolean {
  const { status, name } = (e ?? {}) as { status?: unknown; name?: unknown };
  return name === 'AuthSessionMissingError' || status === 401 || status === 403 || status === 404;
}

/** The sign-in kept on this computer (read directly: for when there is no internet to renew it). */
function storedSession(): { user: { id: string }; access_token: string } | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { user?: { id?: unknown }; access_token?: unknown } | null;
    return s && typeof s.user?.id === 'string' && typeof s.access_token === 'string' ? { user: { id: s.user.id }, access_token: s.access_token } : null;
  } catch {
    return null;
  }
}

/**
 * Who is signed in and whether they may use Lumora (null: nobody is signed
 * in). With internet the account is always checked again with the server
 * (still there, approved, not blocked, set up for the app); only without
 * internet is the last answer used, for OFFLINE_DAYS.
 */
export async function checkAccess(): Promise<Access | null> {
  const { data, error } = await sb().auth.getSession();
  // Offline, a sign-in older than an hour can't be renewed: Supabase then
  // answers "no session", though this computer still has it.
  const session = data.session ?? (error && isOffline(error) ? storedSession() : null);
  if (!session) return null;
  const userId = session.user.id;
  const aal = aalOf(session.access_token);
  if (!data.session) {
    const known = cachedAccess(loadAccess(), userId, Date.now(), aal);
    if (known) return known;
    throw say(error);
  }
  const offline = (e: unknown): Access => {
    // No internet: what we knew last time, for a while (events are often offline).
    const known = isOffline(e) ? cachedAccess(loadAccess(), userId, Date.now(), aal) : null;
    if (known) return known;
    throw say(e);
  };
  // Is the sign-in still good on the server (the account not deleted, the session not ended)?
  let user;
  try {
    const r = await sb().auth.getUser();
    if (r.error) throw r.error;
    user = r.data.user;
  } catch (e) {
    if (isOffline(e)) return offline(e);
    if (!signedOutByServer(e)) throw say(e);
    // The server said no: signed out here too.
    forgetAccess();
    await sb()
      .auth.signOut({ scope: 'local' })
      .catch(() => {});
    return null;
  }
  let p: Profile;
  try {
    const r = await sb().from('profiles').select('*').eq('id', userId).maybeSingle<Profile>();
    if (r.error) throw r.error;
    if (!r.data) throw new Error('This account was not found on the Lumora account server. Sign out, then make a new account.');
    p = r.data;
  } catch (e) {
    return offline(e);
  }
  const twoStep = (user.factors ?? []).some((f) => f.status === 'verified');
  const a: Access = { ...accessFrom(p), twoStep, aal2: aal === 'aal2', codeNeeded: twoStep && aal !== 'aal2' };
  // Made in the Planner, now opening Lumora or Studio: ask the team for access.
  if (p.planner_only && a.state === 'pending')
    void sb()
      .rpc('request_app_access')
      .then(undefined, () => {});
  saveAccess(a);
  return a;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw say(error);
}

/** Make an account. Returns false if the email must be confirmed first. */
export async function signUp(name: string, email: string, password: string): Promise<boolean> {
  const weak = weakPassword(password);
  if (weak) throw new Error(weak);
  const { data, error } = await sb().auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } });
  if (error) throw say(error);
  return data.session !== null;
}

export async function signOut(): Promise<void> {
  forgetAccess();
  // This computer only: Lumora on another computer (maybe running an event) stays signed in.
  await sb().auth.signOut({ scope: 'local' });
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

/**
 * Is this the account's password? Checked on a separate connection, so this
 * window's sign-in (and its two-step code) stays as it is.
 */
export async function passwordIsRight(email: string, password: string): Promise<boolean> {
  const check = createClient(AUTH_URL, AUTH_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'lumora.check' } });
  const { error } = await check.auth.signInWithPassword({ email, password });
  if (error) return false;
  await check.auth.signOut({ scope: 'local' }).catch(() => {});
  return true;
}

/** Change your password; the current one is checked first. */
export async function changePassword(email: string, current: string, next: string): Promise<void> {
  const weak = weakPassword(next);
  if (weak) throw new Error(weak);
  if (!(await passwordIsRight(email, current))) throw new Error('The current password is not right.');
  const { error } = await sb().auth.updateUser({ password: next, current_password: current });
  if (error) throw say(error);
}

/** Two-step sign-in for the signed-in account. */
export const twoStepStatus = (): Promise<TwoStepState> => twoStepState(sb());

/** For the Lumora team: who has two-step sign-in on. */
export async function twoStepPeople(): Promise<Set<string>> {
  const { data, error } = await sb().rpc('admin_two_step_people');
  if (error) throw say(error);
  return new Set(((data ?? []) as unknown[]).map((r) => (typeof r === 'string' ? r : String(Object.values(r as object)[0]))));
}

/** For the Lumora team: turn off someone's two-step sign-in (they lost their phone). */
export async function resetTwoStep(id: string): Promise<void> {
  const { error } = await sb().rpc('admin_reset_two_step', { p_user: id });
  if (error) throw say(error);
}
