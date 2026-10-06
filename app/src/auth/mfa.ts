// Two-step sign-in: after the password, a 6-digit code from an authenticator
// app on the phone (Supabase MFA, TOTP). Works with any Supabase client, so
// Lumora, Lumora Studio and the Planner share it.

import type { SupabaseClient } from '@supabase/supabase-js';

/** The level a session's token says it signed in with: 'aal1' (password) or 'aal2' (password and code). */
export function aalOf(token: string | null | undefined): string | null {
  const part = token?.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(
      part
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(part.length / 4) * 4, '='),
    );
    const aal = (JSON.parse(json) as { aal?: unknown }).aal;
    return typeof aal === 'string' ? aal : null;
  } catch {
    return null;
  }
}

/** A code as typed: digits only (spaces and dashes are fine). */
export function cleanCode(code: string): string {
  return code.replace(/[\s-]/g, '');
}

export const isCode = (code: string): boolean => /^\d{6}$/.test(cleanCode(code));

/** Plain words for what went wrong with a code. */
export function sayCode(e: unknown): Error {
  const m = e instanceof Error ? e.message : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/invalid.*(totp|code)|code.*(invalid|incorrect)|mfa_verification_failed|challenge.*expired/i.test(m))
    return new Error('That code is not right. Check the time on your phone, and use the newest code.');
  if (/too many|rate limit|429/i.test(m)) return new Error('Too many tries. Wait a minute, then try again.');
  if (/aal2|AAL2/.test(m)) return new Error('Enter your current code first.');
  if (/mfa.*(disabled|not enabled)|totp.*disabled|factor type.*not enabled/i.test(m))
    return new Error('Two-step sign-in is not switched on on the Lumora account server yet. (The Lumora team turns on TOTP in Supabase.)');
  if (/fetch|network|failed to/i.test(m)) return new Error('Cannot reach the Lumora account server. Check the connection and try again.');
  return new Error(m);
}

export interface TwoStepState {
  /** The account has a working authenticator. */
  on: boolean;
  /** This session gave the code. */
  aal2: boolean;
  /** The authenticator asked for when signing in. */
  factorId: string | null;
}

/** Whether two-step sign-in is on, and whether this session gave the code (asks the server). */
export async function twoStepState(db: SupabaseClient): Promise<TwoStepState> {
  const [{ data: s }, { data: u, error }] = await Promise.all([db.auth.getSession(), db.auth.getUser()]);
  if (error) throw error;
  const verified = (u.user?.factors ?? []).filter((f) => f.status === 'verified' && f.factor_type === 'totp');
  return { on: verified.length > 0, aal2: aalOf(s.session?.access_token) === 'aal2', factorId: verified[0]?.id ?? null };
}

export interface NewAuthenticator {
  factorId: string;
  /** The QR code to scan, as a picture address. */
  qr: string;
  /** The same, to type in by hand. */
  secret: string;
}

/** Start adding an authenticator: a QR code (and key) to scan, then confirmCode. */
export async function startTwoStep(db: SupabaseClient, issuer = 'Lumora'): Promise<NewAuthenticator> {
  // Forget half-finished ones from before (scanned, but never confirmed).
  const { data: u } = await db.auth.getUser();
  for (const f of u.user?.factors ?? []) if (f.status !== 'verified') await db.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await db.auth.mfa.enroll({ factorType: 'totp', issuer, friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16)}` });
  if (error) throw sayCode(error);
  const raw = data.totp.qr_code;
  const svg = raw.startsWith('<') ? raw : raw.replace(/^data:image\/svg\+xml;(?:utf-?8|charset=utf-?8)?,/i, '');
  return { factorId: data.id, qr: svg.startsWith('<') ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : raw, secret: data.totp.secret };
}

/** Check a code for this authenticator (turns it on, or signs in with it). */
export async function confirmCode(db: SupabaseClient, factorId: string, code: string): Promise<void> {
  if (!isCode(code)) throw new Error('Type the 6-digit code from your authenticator app.');
  const { error } = await db.auth.mfa.challengeAndVerify({ factorId, code: cleanCode(code) });
  if (error) throw sayCode(error);
}

/** Give the code for this account's authenticator (at sign-in, or to confirm a change). */
export async function enterCode(db: SupabaseClient, code: string): Promise<void> {
  const st = await twoStepState(db);
  if (!st.factorId) throw new Error('Two-step sign-in is not on for this account.');
  await confirmCode(db, st.factorId, code);
}

/** Turn two-step sign-in off: the current code is checked first. */
export async function turnOffTwoStep(db: SupabaseClient, code: string): Promise<void> {
  await enterCode(db, code);
  const { data: u, error } = await db.auth.getUser();
  if (error) throw sayCode(error);
  for (const f of u.user?.factors ?? []) {
    const { error: e } = await db.auth.mfa.unenroll({ factorId: f.id });
    if (e) throw sayCode(e);
  }
  // The session now has fewer steps behind it: start from a fresh one.
  await db.auth.refreshSession();
}
