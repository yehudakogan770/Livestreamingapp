// The title's data sources read while it is designed: each on its own
// interval, whatever panel is showing, and the fields' preview values follow
// the row chosen. The Data panel shows what each read found.

import { useEffect, useSyncExternalStore } from 'react';
import { readSource, valuesFromRow, type Table } from '../core/data';
import type { DataSource } from '../core/types';
import type { Store } from './store';

export class LiveData {
  /** Each source's last read: its table, or why it could not be read. */
  results = new Map<string, Table | string>();
  private last = new Map<string, number>();
  /** Sources being read now (a slow address is not asked again until it answers). */
  private busy = new Set<string>();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(private store: Store) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  snapshot = () => this.version;

  async read(src: DataSource, read: typeof readSource = readSource, now = Date.now()): Promise<void> {
    this.last.set(src.id, now);
    this.busy.add(src.id);
    try {
      const t = await read(src);
      this.results.set(src.id, t);
      const p = this.store.get().project;
      const keys = p.variables.map((v) => v.key);
      this.store.set((s) => ({ values: { ...s.values, ...valuesFromRow(src, t, keys, p.variables) } }));
    } catch (e) {
      this.results.set(src.id, e instanceof Error ? e.message : 'It could not be read.');
    } finally {
      this.busy.delete(src.id);
    }
    this.version++;
    this.listeners.forEach((f) => f());
  }

  /** Read the sources that are due (each source's own interval, seconds). */
  tick(now = Date.now(), read?: typeof readSource): void {
    for (const s of this.store.get().project.data ?? []) {
      if (!(s.refresh > 0) || !s.url || this.busy.has(s.id)) continue;
      if (now - (this.last.get(s.id) ?? 0) < s.refresh * 1000) continue;
      void this.read(s, read, now);
    }
  }
}

const all = new WeakMap<Store, LiveData>();

export function liveData(store: Store): LiveData {
  let d = all.get(store);
  if (!d) all.set(store, (d = new LiveData(store)));
  return d;
}

/** Keep the open title's data sources read (the designer runs this once). */
export function useLiveData(store: Store): void {
  useEffect(() => {
    const d = liveData(store);
    const id = setInterval(() => d.tick(), 500);
    return () => clearInterval(id);
  }, [store]);
}

/** The Data panel: the last results, kept up to date. */
export function useLiveResults(store: Store): Map<string, Table | string> {
  const d = liveData(store);
  useSyncExternalStore(d.subscribe, d.snapshot);
  return d.results;
}
