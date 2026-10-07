// Who is signed in, for the rest of the app, and the Lumora team's feature
// switches (kept apart from Gate.tsx so features can ask without loading it).

import { createContext, useContext, useState } from 'react';
import type { Access } from './access';
import { featureOn, keepWhileInUse, type FeatureKey } from './rules';

/** Who is signed in (null while the lock is off). */
export const AccessCtx = createContext<{ access: Access | null; signOut: () => void }>({ access: null, signOut: () => {} });
export const useAccess = () => useContext(AccessCtx);

/**
 * Is this feature on (the Lumora team's Features)? Checked at start and every
 * 15 minutes. Something in use (`inUse`, e.g. captions during a show) stays on
 * when it is switched off, until it is no longer in use or the app starts again.
 * Always on while the sign-in is off.
 */
export function useFeature(key: FeatureKey, inUse = false): boolean {
  const { access } = useAccess();
  const on = featureOn(access?.rules, key);
  const [kept, setKept] = useState(on);
  const next = keepWhileInUse(on, inUse, kept);
  if (next !== kept) setKept(next);
  return next;
}
