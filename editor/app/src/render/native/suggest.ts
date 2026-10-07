// "Fastest by default": native playback (beta) is offered, with one click to
// turn it on, on computers whose graphics card it can use and that are strong
// enough for it to help. It is not turned on by itself while it is in beta;
// once the person chooses either way, it is never offered again.
import { gpuTierOf, type Facts } from '../../../../../app/src/syscheck/rules';

/** Remembered on this computer: the offer was answered (or dismissed). */
export const OFFERED_KEY = 'lumora-native-offered';

/**
 * The graphics card to offer native playback on, or null: the native engine
 * can run on a real (discrete or built-in) card, and Windows reports a card
 * of class 2 or better (good for 1080p and up, see the system check's rules).
 */
export function nativeOffer(facts: Pick<Facts, 'gpus' | 'native'> | null): string | null {
  const n = facts?.native;
  if (!facts || !n?.supported) return null;
  const strong = facts.gpus.filter((g) => gpuTierOf(g) >= 2).sort((a, b) => gpuTierOf(b) - gpuTierOf(a))[0];
  if (!strong) return null;
  const adapter = n.adapters.find((a) => a.kind === 'discrete') ?? n.adapters.find((a) => a.kind === 'integrated');
  return adapter?.name || strong.name;
}

/** Whether to ask at all: never chosen, never answered. */
export function mayOffer(chosen: boolean, store: Pick<Storage, 'getItem'> | null): boolean {
  if (chosen) return false;
  try {
    return store?.getItem(OFFERED_KEY) == null;
  } catch {
    return false;
  }
}

export function markOffered(store: Pick<Storage, 'setItem'> | null) {
  try {
    store?.setItem(OFFERED_KEY, '1');
  } catch {
    // Not remembered: it may be offered once more, which is fine.
  }
}
