// VST3 effects while editing: a clip's sound through its plug-ins is made in
// the background (the stretch of the file it plays) and played instead of
// the file once ready; until then the clip is heard without them.
import { pluginChain, pluginSpan, type ChainLink } from '../model/plugins';
import type { Clip, MediaItem } from '../model/types';
import { inApp, native } from '../native';

const ready = new Map<string, string>();
const making = new Map<string, Promise<string>>();
const failed = new Map<string, string>();
const listeners = new Set<() => void>();

/** Told when a clip's plug-in sound is ready (or failed). */
export function onPluginSound(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

const keyOf = (path: string, from: number, seconds: number, chain: ChainLink[]) => `${path}|${from}|${seconds}|${JSON.stringify(chain)}`;

/** Make (or find) a stretch of a file through plug-ins; the same request in flight is shared. */
export function renderPlugins(path: string, from: number, seconds: number, chain: ChainLink[], make = native.vstRender): Promise<string> {
  const key = keyOf(path, from, seconds, chain);
  const have = ready.get(key);
  if (have) return Promise.resolve(have);
  let job = making.get(key);
  if (!job) {
    job = make(path, from, seconds, chain)
      .then((out) => {
        ready.set(key, out);
        failed.delete(key);
        return out;
      })
      .catch((e: unknown) => {
        failed.set(key, e instanceof Error ? e.message : String(e));
        throw e;
      })
      .finally(() => {
        making.delete(key);
        for (const f of listeners) f();
      });
    making.set(key, job);
  }
  return job;
}

/**
 * A clip's sound through its plug-ins, if it is ready: the file and where it
 * starts in the original (seconds). Starts making it the first time it is asked for.
 */
export function pluginSound(c: Clip, m: MediaItem, fps: number): { path: string; from: number } | null {
  if (!inApp()) return null;
  const chain = pluginChain(c);
  if (!chain.length) return null;
  const span = pluginSpan(c, m, fps);
  if (!span) return null;
  const path = m.missing && m.proxy ? m.proxy : m.path;
  const key = keyOf(path, span.from, span.seconds, chain);
  const have = ready.get(key);
  if (have) return { path: have, from: span.from };
  if (!making.has(key) && !failed.has(key)) void renderPlugins(path, span.from, span.seconds, chain).catch(() => undefined);
  return null;
}

/** Why a clip's plug-ins couldn't be run (null: fine, or not tried yet). */
export function pluginProblem(c: Clip, m: MediaItem, fps: number): string | null {
  const chain = pluginChain(c);
  const span = chain.length ? pluginSpan(c, m, fps) : null;
  if (!span) return null;
  return failed.get(keyOf(m.missing && m.proxy ? m.proxy : m.path, span.from, span.seconds, chain)) ?? null;
}

/** Plug-in sound being made now. */
export const makingPluginSound = (): number => making.size;
