// HDR files in an HDR sequence: watched from a copy that keeps their signal
// (PQ or HLG code values; made once by FFmpeg, in the background) so the
// viewer shows their real highlights. Until it is ready the tone-mapped
// edit-friendly copy plays (treated as SDR).
import type { MediaItem } from '../model/types';
import { inApp, native } from '../native';
import type { Transfer } from '../render/hdr';

const ready = new Map<string, string>();
const making = new Set<string>();
const failed = new Set<string>();
const listeners = new Set<() => void>();

/** Told when a signal copy becomes ready. */
export function onSignalCopy(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** How a file codes brightness. */
export const mediaTransfer = (m: MediaItem): Transfer =>
  m.source?.hdr ? (m.source.transfer && m.source.transfer !== 'sdr' ? m.source.transfer : 'pq') : 'sdr';

/** The signal copy of an HDR file, or null while it is made (started here the first time) or for SDR files. */
export function signalCopy(m: MediaItem, make: typeof native.hdrCopy = native.hdrCopy): string | null {
  if (!m.source?.hdr || m.missing || m.kind !== 'video') return null;
  if (!inApp() && make === native.hdrCopy) return null;
  const have = ready.get(m.path);
  if (have) return have;
  if (making.has(m.path) || failed.has(m.path)) return null;
  making.add(m.path);
  make(m.path, m.duration)
    .then((out) => {
      ready.set(m.path, out);
      for (const f of listeners) f();
    })
    .catch(() => failed.add(m.path))
    .finally(() => making.delete(m.path));
  return null;
}

/** HDR files whose signal copies are being made. */
export const makingSignalCopies = (): number => making.size;

/** Forget everything (tests). */
export function resetSignalCopies(): void {
  ready.clear();
  making.clear();
  failed.clear();
}
