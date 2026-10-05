// Saving a shared project safely. Each save says which version it was made
// from; if someone else saved in between, their changes are brought in and
// it tries again. Only when both changed the same piece does the person have
// to choose (reload theirs, or keep theirs and save mine as a copy).

import type { Project } from '../model/types';
import { conflicts, diff, forUpload, merge, nothingChanged, type Changes } from './merge';

export interface SaveApi {
  /** The new version, or null if `base` is no longer the newest. */
  save(base: number, doc: Project): Promise<number | null>;
  load(): Promise<Synced>;
}

/** Where this computer is: the version it last had, and that version's project. */
export interface Synced {
  version: number;
  base: Project;
}

export type SaveResult =
  /** Saved. `brought` is what others changed in between (put it into what is shown). */
  { kind: 'saved'; synced: Synced; brought: Changes[] } | { kind: 'conflict'; theirs: Synced; conflicts: string[]; brought: Changes[] };

/** Tries this many times while others keep saving at the same moment. */
const TRIES = 4;

export async function saveFlow(api: SaveApi, start: Synced, mine: Project): Promise<SaveResult> {
  let synced = start;
  let current = mine;
  const brought: Changes[] = [];
  for (let i = 0; i < TRIES; i++) {
    const upload = forUpload(current, synced.base);
    const v = await api.save(synced.version, upload);
    if (v !== null) return { kind: 'saved', synced: { version: v, base: upload }, brought };
    const latest = await api.load();
    const m = merge(synced.base, current, latest.base);
    if (!m.ok) return { kind: 'conflict', theirs: latest, conflicts: m.conflicts, brought };
    if (!nothingChanged(m.changes)) brought.push(m.changes);
    current = m.project;
    synced = latest;
  }
  throw new Error('Others keep saving this project at the same moment. Lumora Studio will try again shortly.');
}

export type PullResult = { kind: 'same' } | { kind: 'brought'; synced: Synced; changes: Changes } | { kind: 'conflict'; theirs: Synced; conflicts: string[] };

/** Someone else saved: bring their version in, unless it clashes with my unsaved changes. */
export function pullFlow(start: Synced, mine: Project, latest: Synced): PullResult {
  if (latest.version <= start.version) return { kind: 'same' };
  const clash = conflicts(start.base, mine, latest.base);
  if (clash.length) return { kind: 'conflict', theirs: latest, conflicts: clash };
  return { kind: 'brought', synced: latest, changes: diff(start.base, latest.base) };
}
