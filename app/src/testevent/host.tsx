// Settings → Run a test event…: opened from any menu. The window itself (and
// the test runner) is loaded the first time it opens.

import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { lazyPart } from '../components/lazyPart';
import { isInsideLumora, type EngineClient } from '../engine/client';
import type { Show } from '../engine/types/Show';

const TestEventDialog = lazyPart(() => import('./TestEvent').then((m) => m.TestEventDialog));

// ---- opening it from any menu (and from the system check's results) ----
let open = false;
const listeners = new Set<() => void>();
function setOpen(v: boolean) {
  open = v;
  for (const l of listeners) l();
}
/** Open the test event window (Settings → Run a test event…). */
export const openTestEvent = (): void => setOpen(true);
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Lives inside the control window's providers; shows the window when asked. */
export function TestEventHost({ show, client }: { show: Show; client: EngineClient }) {
  const isOpen = useSyncExternalStore(subscribe, () => open);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!isInsideLumora()) return;
    void invoke<boolean>('test_event_restored_at_start')
      .then((r) => r && setNotice('A test event was cut short last time. Your event has been put back exactly as it was.'))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(t);
  }, [notice]);
  return (
    <>
      {isOpen && <TestEventDialog show={show} client={client} onClose={() => setOpen(false)} />}
      {notice && (
        <div className="app-notice" role="status">
          {notice}
        </div>
      )}
    </>
  );
}
