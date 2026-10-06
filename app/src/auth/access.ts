// Who is using Lumora, and whether they may: worked out from their profile,
// and remembered so the app keeps working offline during an event.

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

/** May this person open this app now? (Approved, and set up for it.) */
export function mayUse(a: Access, product: Product): boolean {
  return a.state === 'approved' && (a.admin || a[product] !== false);
}

/** How long Lumora keeps working without checking in (offline events). */
export const OFFLINE_DAYS = 30;
const KEY = 'lumora.access';

interface Saved extends Access {
  at: number;
}

/** The last answer for this person, if it is recent enough to use offline. */
export function cachedAccess(saved: Saved | null, userId: string, now: number): Access | null {
  if (!saved || saved.userId !== userId) return null;
  if (now - saved.at > OFFLINE_DAYS * 86_400_000) return null;
  const { at: _at, ...a } = saved;
  // Remembered before accounts had apps: both, as on the server.
  return { ...a, lumora: a.lumora !== false, studio: a.studio !== false, offline: true };
}

export function saveAccess(a: Access): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...a, offline: undefined, at: Date.now() }));
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
