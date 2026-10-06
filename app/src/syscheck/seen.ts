// When the system check runs by itself: the first start after installing,
// and again only when a new version changes what the apps need (REQUIREMENTS).
// Remembered on this computer, so it never nags.

import type { AppId, Verdict } from './rules';

/** Raise this when an update changes the requirements enough to check every computer again. */
export const REQUIREMENTS = 1;

export interface Seen {
  /** The requirements the computer was last checked against. */
  requirements: number;
  /** The app's version then. */
  version: string;
  verdict: Verdict | null;
  at: number;
}

export const seenKey = (app: AppId) => `lumora.syscheck.${app}`;

export function readSeen(app: AppId, store: Pick<Storage, 'getItem'> | null = safeStorage()): Seen | null {
  try {
    const raw = store?.getItem(seenKey(app));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Seen>;
    return typeof v.requirements === 'number'
      ? { requirements: v.requirements, version: String(v.version ?? ''), verdict: v.verdict ?? null, at: Number(v.at) || 0 }
      : null;
  } catch {
    return null;
  }
}

export function markSeen(app: AppId, version: string, verdict: Verdict | null, store: Pick<Storage, 'setItem'> | null = safeStorage(), now = Date.now()): void {
  try {
    const seen: Seen = { requirements: REQUIREMENTS, version, verdict, at: now };
    store?.setItem(seenKey(app), JSON.stringify(seen));
  } catch {
    // Not remembered: it may show once more next time, which is fine.
  }
}

/** Run by itself now? Never checked here, or checked against older requirements. */
export function shouldAutoRun(seen: Seen | null, requirements = REQUIREMENTS): boolean {
  return !seen || seen.requirements < requirements;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
