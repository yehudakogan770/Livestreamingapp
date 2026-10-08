// Settings → ATEM switcher… and Settings → Blackmagic program out…: opened
// from the Settings menu, each dialog loaded the first time it opens.

import { useSyncExternalStore } from 'react';
import { lazyPart } from '../components/lazyPart';
import type { Source } from '../engine/types/Source';

const AtemDialog = lazyPart(() => import('./AtemDialog').then((m) => m.AtemDialog));
const DeckLinkOutputDialog = lazyPart(() => import('./DeckLinkOutputDialog').then((m) => m.DeckLinkOutputDialog));

type Open = 'atem' | 'cardOut' | null;
let open: Open = null;
const listeners = new Set<() => void>();
function setOpen(v: Open) {
  open = v;
  for (const l of listeners) l();
}
/** Open Settings → ATEM switcher. */
export const openAtemSettings = (): void => setOpen('atem');
/** Open Settings → Blackmagic program out. */
export const openCardOutput = (): void => setOpen('cardOut');
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Lives in the control window; shows the ATEM and program out dialogs when asked. */
export function ProHardwareHost({ sources }: { sources: Source[] }) {
  const which = useSyncExternalStore(subscribe, () => open);
  if (which === 'atem') return <AtemDialog sources={sources} onClose={() => setOpen(null)} />;
  if (which === 'cardOut') return <DeckLinkOutputDialog onClose={() => setOpen(null)} />;
  return null;
}
