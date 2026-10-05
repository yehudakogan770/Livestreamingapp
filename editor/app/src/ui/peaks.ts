import { useSyncExternalStore } from 'react';
import { inApp, native, type Strip } from '../native';

/** Waveforms of the sound files, fetched once each. */
const store = new Map<string, Uint8Array | 'loading' | 'failed'>();
const listeners = new Set<() => void>();
let version = 0;

function load(path: string) {
  if (store.has(path)) return;
  store.set(path, 'loading');
  const get = inApp() ? native.peaks(path) : demoPeaks();
  void get
    .then((p) => store.set(path, p))
    .catch(() => store.set(path, 'failed'))
    .finally(() => {
      version += 1;
      for (const f of listeners) f();
    });
}

/** A made-up waveform for the browser demo. */
async function demoPeaks(): Promise<Uint8Array> {
  const n = 100 * 60 * 10;
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.round(60 + 80 * Math.abs(Math.sin(i / 37) * Math.sin(i / 7.3)) + 40 * Math.abs(Math.sin(i / 211)));
  return a;
}

export function usePeaks(paths: string[]): (path: string) => Uint8Array | null {
  useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => version,
  );
  for (const p of paths) load(p);
  return (path) => {
    const v = store.get(path);
    return v instanceof Uint8Array ? v : null;
  };
}

/** Picture strips of the videos (small frames along the length), fetched once each. */
const strips = new Map<string, Strip | 'loading' | 'failed'>();

export function useStrip(path: string | null, seconds: number): Strip | null {
  useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => version,
  );
  if (!path || !inApp()) return null;
  if (!strips.has(path)) {
    strips.set(path, 'loading');
    void native
      .strip(path, seconds)
      .then((s) => strips.set(path, s))
      .catch(() => strips.set(path, 'failed'))
      .finally(() => {
        version += 1;
        for (const f of listeners) f();
      });
  }
  const v = strips.get(path);
  return v && typeof v === 'object' ? v : null;
}
