// Who is using Lumora, and whether they may: worked out from their profile,
// and remembered so the app keeps working offline during an event.

import { DEFAULT_OFFLINE_DAYS, featureOn, rulesFrom, type SignInRules } from './rules';

export type AccessState = 'pending' | 'approved' | 'blocked';

export interface Access {
  state: AccessState;
  userId: string;
  email: string;
  name: string;
  admin: boolean;
  /** May use Lumora (the Lumora team always may). */
  lumora: boolean;
  /** May use Lumora Studio (the Lumora team always may). */
  studio: boolean;
  /** Checked a while ago (no internet now). */
  offline?: boolean;
  /** Two-step sign-in (an authenticator app's code) is on for this account. */
  twoStep?: boolean;
  /** Two-step sign-in is on, but this session has not given the code yet. */
  codeNeeded?: boolean;
  /** This session gave the code (needed for the Lumora team's actions). */
  aal2?: boolean;
  /** Two-step sign-in is required (Sign-in settings) but not set up yet: set it up first. */
  setupNeeded?: boolean;
  /** The Lumora team's sign-in rules and switches, for this account (missing before update 9). */
  rules?: SignInRules;
}

export interface Profile {
  id: string;
  email: string;
  name: string;
  approved: boolean;
  blocked: boolean;
  is_admin: boolean;
  /** Missing before update-4-app-access.sql: then both apps. */
  lumora?: boolean;
  studio?: boolean;
  /** Made in the Planner (a teammate), not asking for Lumora or Studio. Missing before update-6-security.sql. */
  planner_only?: boolean;
  created_at?: string;
}

/** The two apps one account can be set up for. */
export type Product = 'lumora' | 'studio';
export const PRODUCT_NAME: Record<Product, string> = { lumora: 'Lumora', studio: 'Lumora Studio' };

export function accessFrom(p: Profile): Access {
  const admin = p.is_admin && !p.blocked;
  return {
    state: p.blocked ? 'blocked' : p.approved ? 'approved' : 'pending',
    userId: p.id,
    email: p.email,
    name: p.name,
    admin,
    lumora: admin || p.lumora !== false,
    studio: admin || p.studio !== false,
  };
}

/** Has the Lumora team paused this app (Features)? Never for the Lumora team. */
export function paused(a: Access, product: Product): boolean {
  return !a.admin && !featureOn(a.rules, product);
}

/**
 * May this person open this app now? (Approved, set up for it, the code given
 * if they use two-step sign-in, two-step set up if required, and the app not paused.)
 */
export function mayUse(a: Access, product: Product): boolean {
  return a.state === 'approved' && (a.admin || a[product] !== false) && !a.codeNeeded && !a.setupNeeded && !paused(a, product);
}

/**
 * How long Lumora keeps working without checking in (offline events), unless
 * the Lumora team chose another number (Sign-in settings → Offline use). With
 * internet it always checks the account again when it starts.
 */
export const OFFLINE_DAYS = DEFAULT_OFFLINE_DAYS;

/** The days the remembered answer is good for (as the Lumora team set it when it was remembered). */
export const offlineDaysOf = (a: { rules?: SignInRules } | null | undefined): number => (a?.rules ? rulesFrom(a.rules).offlineDays : OFFLINE_DAYS);
const KEY = 'lumora.access';

interface Saved extends Access {
  at: number;
}

/**
 * The last answer for this person, if it is recent enough to use offline (and,
 * for an account with two-step sign-in, only if this session gave the code:
 * `aal` is the session's level, 'aal1' or 'aal2').
 */
export function cachedAccess(saved: Saved | null, userId: string, now: number, aal: string | null = null): Access | null {
  if (!saved || saved.userId !== userId) return null;
  if (!(now >= saved.at) || now - saved.at > offlineDaysOf(saved) * 86_400_000) return null;
  if (saved.twoStep && aal !== 'aal2') return null;
  if (saved.setupNeeded) return null;
  const { at: _at, ...a } = saved;
  // Remembered before accounts had apps: both, as on the server.
  return { ...a, lumora: a.lumora !== false, studio: a.studio !== false, offline: true, codeNeeded: false, ...(a.rules ? { rules: rulesFrom(a.rules) } : {}) };
}

/** Is this "no internet" (so the remembered answer may be used), not a real answer from the server? */
export function isOffline(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
  if (/AuthRetryableFetchError|TypeError|AbortError/.test(name)) return true;
  const m = e instanceof Error ? e.message : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  return /failed to fetch|fetch failed|networkerror|network error|load failed|network request failed|timed? ?out|ECONN|ENOTFOUND|EAI_AGAIN/i.test(m);
}

export function saveAccess(a: Access): void {
  // An account with two-step sign-in is remembered only once the code was given.
  if (a.codeNeeded || a.setupNeeded) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...a, offline: undefined, codeNeeded: undefined, at: Date.now() }));
  } catch {
    // Not remembered: it is checked again next time.
  }
}

export function loadAccess(): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
  } catch {
    return null;
  }
}

export function forgetAccess(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
