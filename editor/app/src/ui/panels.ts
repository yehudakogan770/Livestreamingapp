// The delivery and media-management windows (render queue, shortcuts,
// undo history, collect files, backups, clip info): which one is open.
import { useSyncExternalStore } from 'react';

export type Panel =
  | { kind: 'queue' }
  | { kind: 'shortcuts' }
  | { kind: 'undo' }
  | { kind: 'archive' }
  | { kind: 'backups' }
  | { kind: 'workspaces' }
  | { kind: 'mediaInfo'; media: string }
  | { kind: 'uses'; media: string }
  | { kind: 'smartBin'; id: string | null }
  | { kind: 'timelineExport' }
  | { kind: 'timelineImport' }
  | { kind: 'publish'; job: string };

class Panels {
  open: Panel | null = null;
  private listeners = new Set<() => void>();
  subscribe = (f: () => void): (() => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  show(p: Panel | null) {
    this.open = p;
    for (const f of this.listeners) f();
  }
  close = () => this.show(null);
}

export const panels = new Panels();

export function usePanel(): Panel | null {
  return useSyncExternalStore(panels.subscribe, () => panels.open);
}
