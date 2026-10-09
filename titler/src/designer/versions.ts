// Versions of a title: snapshots kept on this computer (IndexedDB), named by
// the designer or made when it is saved, to look back at and restore (a
// restore is one step that can be undone). Kept per title; the oldest go
// past 50.

import type { TitleProject } from '../core/types';

export interface Version {
  id: string;
  /** The title it belongs to (TitleProject.id). */
  title: string;
  name: string;
  at: number;
  /** Size of the kept copy, bytes. */
  size: number;
}

interface Kept extends Version {
  project: string;
}

export const MAX_VERSIONS = 50;
const DB = 'lumora-titler';
const STORE = 'versions';

/** Where versions are kept: IndexedDB in a browser, memory where there is none (tests). */
export interface VersionStore {
  all(): Promise<Kept[]>;
  put(v: Kept): Promise<void>;
  remove(id: string): Promise<void>;
}

export function memoryStore(): VersionStore {
  const m = new Map<string, Kept>();
  return {
    all: async () => [...m.values()],
    put: async (v) => void m.set(v.id, v),
    remove: async (id) => void m.delete(id),
  };
}

function idbStore(): VersionStore {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  const run = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) =>
    open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const req = fn(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }),
    );
  return {
    all: () => run<Kept[]>('readonly', (s) => s.getAll() as IDBRequest<Kept[]>),
    put: (v) => run('readwrite', (s) => s.put(v)).then(() => {}),
    remove: (id) => run('readwrite', (s) => s.delete(id)).then(() => {}),
  };
}

let shared: VersionStore | null = null;
export function versionStore(): VersionStore {
  shared ??= typeof indexedDB !== 'undefined' ? idbStore() : memoryStore();
  return shared;
}

const strip = ({ project: _p, ...v }: Kept): Version => v;

/** A title's versions, newest first. */
export async function listVersions(titleId: string, store = versionStore()): Promise<Version[]> {
  return (await store.all().catch(() => []))
    .filter((v) => v.title === titleId)
    .sort((a, b) => b.at - a.at)
    .map(strip);
}

/** Keep a version of the title as it is now. */
export async function saveVersion(p: TitleProject, name: string, store = versionStore(), now = Date.now()): Promise<Version> {
  const project = JSON.stringify(p);
  const v: Kept = { id: `${p.id}-${now}-${Math.random().toString(36).slice(2, 7)}`, title: p.id, name: name.trim() || 'Version', at: now, size: project.length, project };
  await store.put(v);
  const mine = (await store.all()).filter((x) => x.title === p.id).sort((a, b) => b.at - a.at);
  for (const old of mine.slice(MAX_VERSIONS)) await store.remove(old.id);
  return strip(v);
}

export async function readVersion(id: string, store = versionStore()): Promise<TitleProject | null> {
  const v = (await store.all()).find((x) => x.id === id);
  if (!v) return null;
  try {
    return JSON.parse(v.project) as TitleProject;
  } catch {
    return null;
  }
}

export const removeVersion = (id: string, store = versionStore()) => store.remove(id);
