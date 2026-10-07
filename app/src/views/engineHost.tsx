// Settings → Engine…: opened from the Settings menu. The dialog is loaded the
// first time it opens; the host also keeps the backup lineup's watch fed from
// the unified engine while it runs.

import { useEffect, useSyncExternalStore } from 'react';
import { lazyPart } from '../components/lazyPart';
import { watchEngineHealth } from '../engine/unified';

const EngineDialog = lazyPart(() => import('./EngineDialog').then((m) => m.EngineDialog));

let open = false;
const listeners = new Set<() => void>();
function setOpen(v: boolean) {
  open = v;
  for (const l of listeners) l();
}
/** Open Settings → Engine. */
export const openEngineSettings = (): void => setOpen(true);
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Lives in the control window; shows the Engine dialog when asked. */
export function EngineSettingsHost() {
  const isOpen = useSyncExternalStore(subscribe, () => open);
  useEffect(() => watchEngineHealth(), []);
  return isOpen ? <EngineDialog onClose={() => setOpen(false)} /> : null;
}
