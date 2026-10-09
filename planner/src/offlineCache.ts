// The last copy of your plans, kept on this device so the installed app still
// opens them (read-only) with no internet. One copy per signed-in account,
// cleared on sign out. Only what the Planner showed you: never the sign-in
// itself (Supabase keeps that) and never anything to send later.

import type { Block } from './blocks';
import type { Item } from './items';
import type { Message } from './chatModel';
import type { Plan, PlanComment, PlanCue, PlanSummary, Role } from './model';
import type { Who } from './session';
import { offlineDaysOf } from '../../app/src/auth/access';

const PREFIX = 'lumora.planner.cache.';
/** The Supabase session's storage key (see session.ts). */
const SESSION_KEY = 'lumora.planner';
/** Plans kept per account: the ones opened most recently. */
export const KEEP_PLANS = 12;

export interface PlanCopy {
  plan?: Plan;
  cues?: PlanCue[];
  comments?: PlanComment[];
  role?: Role | null;
  blocks?: Block[];
  /** The lists (crew, contacts, tasks, gear, budget). */
  items?: Item[];
  messages?: Message[];
  /** When this copy was last written (ms). */
  at: number;
}

interface Copy {
  who?: Extract<Who, { s: 'in' }>;
  plans?: PlanSummary[];
  plansAt?: number;
  open: Record<string, PlanCopy>;
}

let user: string | null = null;

/** A failure to reach the server at all (not a refusal). */
export const unreachable = (e: unknown): boolean =>
  (typeof navigator !== 'undefined' && navigator.onLine === false) ||
  /cannot reach|fetch|network|load failed/i.test(e instanceof Error ? e.message : String(e));

/** Whose copy is read and written from now on (null: nobody's). */
export function setCacheUser(userId: string | null): void {
  user = userId;
}

function read(id: string): Copy {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    const c = raw ? (JSON.parse(raw) as Partial<Copy>) : {};
    return { ...c, open: c.open && typeof c.open === 'object' ? c.open : {} };
  } catch {
    return { open: {} };
  }
}

function write(id: string, c: Copy): void {
  // Oldest plans go first when there are too many, or the device is full.
  const ids = Object.keys(c.open).sort((a, b) => (c.open[b]?.at ?? 0) - (c.open[a]?.at ?? 0));
  for (const old of ids.slice(KEEP_PLANS)) delete c.open[old];
  for (let keep = Math.min(ids.length, KEEP_PLANS); keep >= 0; keep--) {
    try {
      localStorage.setItem(PREFIX + id, JSON.stringify(c));
      return;
    } catch {
      const drop = ids[keep - 1];
      if (drop) delete c.open[drop];
    }
  }
}

/** Who was signed in here, as last checked with the server. */
export function rememberWho(who: Extract<Who, { s: 'in' }>): void {
  setCacheUser(who.access.userId);
  const c = read(who.access.userId);
  c.who = who;
  write(who.access.userId, c);
}

/** The signed-in account in Supabase's own storage (no network needed), if any. */
export function sessionUser(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const s = raw ? (JSON.parse(raw) as { user?: { id?: unknown } }) : null;
    return typeof s?.user?.id === 'string' ? s.user.id : null;
  } catch {
    return null;
  }
}

/**
 * Who this device is signed in as, as last checked with the server, if a copy
 * of their plans is here: the app opens with it at once, then checks again.
 */
export function lastWho(): Extract<Who, { s: 'in' }> | null {
  const id = sessionUser();
  if (!id) return null;
  const c = read(id);
  if (!c.who || c.who.access.userId !== id || !c.plans) return null;
  // Not checked in for longer than the Lumora team allows (Sign-in settings → Offline use).
  if (c.plansAt && Date.now() - c.plansAt > offlineDaysOf(c.who.access) * 86_400_000) return null;
  setCacheUser(id);
  return { ...c.who, access: { ...c.who.access, offline: false } };
}

/** With no internet: who this device is signed in as, if a copy of their plans is here. */
export function offlineWho(): Extract<Who, { s: 'in' }> | null {
  const who = lastWho();
  return who && { ...who, access: { ...who.access, offline: true } };
}

export function rememberPlans(plans: PlanSummary[]): void {
  if (!user) return;
  const c = read(user);
  c.plans = plans;
  c.plansAt = Date.now();
  write(user, c);
}

export function savedPlans(): { plans: PlanSummary[]; at: number } | null {
  if (!user) return null;
  const c = read(user);
  return c.plans ? { plans: c.plans, at: c.plansAt ?? 0 } : null;
}

/** Keep part of one plan (what has just loaded). */
export function rememberPlan(planId: string, part: Omit<PlanCopy, 'at'>): void {
  if (!user) return;
  const c = read(user);
  // Always the newest, even within the same millisecond, so it is never the one dropped.
  const at = Math.max(Date.now(), ...Object.values(c.open).map((p) => p.at + 1));
  c.open[planId] = { ...c.open[planId], ...part, at };
  write(user, c);
}

export function savedPlan(planId: string): PlanCopy | null {
  if (!user) return null;
  return read(user).open[planId] ?? null;
}

/** Signed out: every account's copy goes. */
export function clearCache(): void {
  user = null;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // Nothing to clear.
  }
}
