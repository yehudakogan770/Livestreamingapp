// Whether this person agreed to send anonymous error reports. Nothing is sent
// until they say yes; they are asked once, and can change it any time
// (Lumora: Settings; Lumora Studio: Help).

export type Consent = 'unasked' | 'yes' | 'no';

const KEY = 'lumora.errorReports';
type Listener = (c: Consent) => void;
const listeners = new Set<Listener>();

export function readConsent(store: Pick<Storage, 'getItem'> | null = safeStorage()): Consent {
  try {
    const v = store?.getItem(KEY);
    return v === 'yes' || v === 'no' ? v : 'unasked';
  } catch {
    return 'unasked';
  }
}

export function setConsent(c: 'yes' | 'no', store: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    store?.setItem(KEY, c);
  } catch {
    // Not remembered: asked again next time (and nothing is sent meanwhile).
  }
  for (const l of listeners) l(c);
}

/** Error reports go out only after a clear yes. */
export const mayAutoSend = (c: Consent): boolean => c === 'yes';

/** Ask once, after signing in (never on the sign-in screen or in a test build). */
export const shouldAsk = (c: Consent, signedIn: boolean, testBuild: boolean): boolean => c === 'unasked' && signedIn && !testBuild;

export function onConsentChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
