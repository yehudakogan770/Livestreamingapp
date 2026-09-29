import { useSyncExternalStore } from 'react';

// Files being copied into Lumora right now (big videos take a moment).
let names: string[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** Run `work` while showing "Copying <name> into Lumora…". */
export async function whileCopying<T>(name: string, work: () => Promise<T>): Promise<T> {
  names = [...names, name];
  changed();
  try {
    return await work();
  } finally {
    const i = names.indexOf(name);
    names = names.filter((_, j) => j !== i);
    changed();
  }
}

/** The files being copied now. */
export function useCopying(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => names,
  );
}
