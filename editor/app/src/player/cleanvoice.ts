// Voice isolation while editing: the neural model's cleaned copy of a file's
// sound (made once per strength by FFmpeg, in the background) is played in
// place of the original; until it is ready, filters stand in for it.
import type { MediaItem } from '../model/types';
import { inApp, native } from '../native';

/** The strength steps copies are made at (the film uses the same steps). */
export const voiceStep = (amount: number): number => Math.round(Math.max(0, Math.min(1, amount)) * 20) / 20;

const ready = new Map<string, string>();
const making = new Set<string>();
const failed = new Set<string>();
const listeners = new Set<() => void>();

const keyOf = (path: string, mix: number): string => `${path}|${mix}`;

/** Told when a cleaned copy becomes ready (the player picks it up on its next frame). */
export function onCleanVoice(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Copies being made now. */
export const cleaningVoice = (): number => making.size;

/**
 * The cleaned copy of a file's sound at a strength, or null while it is being
 * made (it is started here the first time it is asked for) or can't be made.
 */
export function cleanedSound(m: MediaItem, amount: number, make: typeof native.voiceClean = native.voiceClean): string | null {
  if (!inApp() && make === native.voiceClean) return null;
  const path = m.missing && m.proxy ? m.proxy : m.path;
  const mix = voiceStep(amount);
  const key = keyOf(path, mix);
  const have = ready.get(key);
  if (have) return have;
  if (making.has(key) || failed.has(key)) return null;
  making.add(key);
  make(path, m.duration, mix)
    .then((out) => {
      ready.set(key, out);
      for (const f of listeners) f();
    })
    .catch(() => failed.add(key))
    .finally(() => making.delete(key));
  return null;
}

/** Forget everything (tests). */
export function resetCleanVoice(): void {
  ready.clear();
  making.clear();
  failed.clear();
}
