// Scene (shot) detection: FFmpeg's scene score finds where the picture cuts,
// and a long clip becomes subclips, one per shot, in a bin of its own.
import type { Doc } from '../doc';
import { uid, type MediaItem, type Project } from '../model/types';
import { inApp } from '../native';
import { manageNative } from './native';

/** The shots between cuts (seconds): very short ones are joined to the shot before. */
export function shotsFromCuts(duration: number, cuts: readonly number[], minLength = 1): [number, number][] {
  if (!(duration > 0)) return [];
  const marks = [...new Set(cuts.filter((t) => t > 0 && t < duration).map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
  const out: [number, number][] = [];
  let start = 0;
  for (const t of marks) {
    if (t - start < minLength) continue;
    out.push([start, t]);
    start = t;
  }
  const last = out[out.length - 1];
  if (duration - start < minLength && last) last[1] = duration;
  else out.push([start, duration]);
  return out;
}

const clock = (s: number): string => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

/** A file's shots as subclips (in a new bin, named after it). */
export function addShots(p: Project, mediaId: string, shots: [number, number][]): Project {
  const m = p.media.find((x) => x.id === mediaId);
  if (!m || shots.length < 2) return p;
  const bin = { id: uid('b'), name: `${m.name} · shots`, parent: m.bin };
  const subs: MediaItem[] = shots.map(([a, b], i) => {
    const { transcript: _t, range: _r, ...rest } = m;
    return { ...rest, id: uid('m'), name: `${m.name} · shot ${i + 1} (${clock(a)})`, bin: bin.id, range: [a, b] as [number, number], addedAt: Date.now() };
  });
  return { ...p, bins: [...p.bins, bin], media: [...p.media, ...subs] };
}

const KEY = 'lumora-edit-shots-on-import';

/** Split long clips into shots as they are imported (this computer's choice). */
export function shotsOnImport(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
export function setShotsOnImport(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Not kept: fine.
  }
}

/** Clips at least this long are split on import. */
export const LONG_CLIP = 60;

/** Find a file's shots and add them as subclips. Returns how many shots there are. */
export async function detectShots(doc: Doc, mediaId: string, threshold = 0.4): Promise<number> {
  const m = doc.project.media.find((x) => x.id === mediaId);
  if (!m || m.kind !== 'video' || !inApp()) return 0;
  const cuts = await manageNative.sceneCuts(m.missing && m.proxy ? m.proxy : m.path, threshold);
  const [a0, a1] = m.range ?? [0, m.duration];
  const shots = shotsFromCuts(
    a1 - a0,
    cuts.map((t) => t - a0),
    1,
  ).map(([a, b]) => [a + a0, b + a0] as [number, number]);
  if (shots.length < 2) return shots.length;
  doc.edit((p) => addShots(p, mediaId, shots), 'Split into shots');
  return shots.length;
}

/** After an import: long clips are split into shots (when that is switched on). */
export async function shotsAfterImport(doc: Doc, ids: string[]): Promise<void> {
  if (!shotsOnImport()) return;
  for (const id of ids) {
    const m = doc.project.media.find((x) => x.id === id);
    if (m?.kind === 'video' && m.duration >= LONG_CLIP) await detectShots(doc, id).catch(() => 0);
  }
}
