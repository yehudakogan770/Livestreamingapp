// Bringing two people's saves together. A project is compared piece by piece
// (each sequence, media item, bin and camera group by its id), so one person
// editing Sequence 1 and another editing Sequence 2 never get in each other's
// way. Things that belong to one computer only (where the files are, the
// playhead, which sequence is open) are left out of the comparison.

import type { Bin, MediaItem, MulticamGroup, Project, Sequence } from '../model/types';

type Piece = MediaItem | Bin | MulticamGroup | Sequence;
type Part = 'media' | 'bins' | 'groups' | 'sequences';
const PARTS: Part[] = ['sequences', 'media', 'bins', 'groups'];

/** The same piece (by its content, leaving out what belongs to one computer). */
const keys = new WeakMap<object, string>();
function keyOf(part: Part, x: Piece): string {
  let k = keys.get(x);
  if (k === undefined) {
    if (part === 'media') {
      const { path: _p, proxy: _x, missing: _m, ...rest } = x as MediaItem;
      k = JSON.stringify(rest);
    } else if (part === 'sequences') {
      const { playhead: _p, ...rest } = x as Sequence;
      k = JSON.stringify(rest);
    } else k = JSON.stringify(x);
    keys.set(x, k);
  }
  return k;
}

const same = (part: Part, a: Piece | undefined, b: Piece | undefined): boolean => a === b || (!!a && !!b && keyOf(part, a) === keyOf(part, b));
const byId = <T extends { id: string }>(list: T[]): Map<string, T> => new Map(list.map((x) => [x.id, x]));

/** What one save changed, compared with the one before it. */
export interface Changes {
  /** Pieces added or changed (their new content). */
  put: { [P in Part]: Project[P] };
  /** Ids of pieces taken out. */
  gone: { [P in Part]: string[] };
  name: string | null;
}

export function diff(base: Project, next: Project): Changes {
  const put = { media: [], bins: [], groups: [], sequences: [] } as unknown as Changes['put'];
  const gone: Changes['gone'] = { media: [], bins: [], groups: [], sequences: [] };
  for (const part of PARTS) {
    const before = byId<Piece>(base[part]);
    const after = byId<Piece>(next[part]);
    for (const [id, x] of after) if (!same(part, before.get(id), x)) (put[part] as Piece[]).push(x);
    for (const id of before.keys()) if (!after.has(id)) gone[part].push(id);
  }
  return { put, gone, name: base.name !== next.name ? next.name : null };
}

export const nothingChanged = (c: Changes): boolean => c.name === null && PARTS.every((part) => c.put[part].length === 0 && c.gone[part].length === 0);

/** Ids of the sequences that differ (added, changed or taken out). */
export function changedSequences(before: Project, after: Project): string[] {
  if (before.sequences === after.sequences) return [];
  const c = diff({ ...before, media: [], bins: [], groups: [] }, { ...after, media: [], bins: [], groups: [] });
  return [...c.put.sequences.map((s) => s.id), ...c.gone.sequences];
}

/** Anything changed that would be saved (not just the playhead, open sequence or file places). */
export function realChange(before: Project, after: Project): boolean {
  return before !== after && !nothingChanged(diff(before, after));
}

/**
 * Put changes made elsewhere into a project. Media keeps this computer's
 * own file places when it already has the item.
 */
export function bringIn(target: Project, c: Changes): Project {
  if (nothingChanged(c)) return target;
  const out = { ...target } as Project;
  for (const part of PARTS) {
    const put = byId<Piece>(c.put[part]);
    const gone = new Set(c.gone[part]);
    if (put.size === 0 && gone.size === 0) continue;
    const list: Piece[] = [];
    for (const x of target[part] as Piece[]) {
      if (gone.has(x.id)) continue;
      const y = put.get(x.id);
      if (!y) list.push(x);
      else if (part === 'media') {
        const m = x as MediaItem;
        list.push({ ...(y as MediaItem), path: m.path, proxy: m.proxy, ...(m.missing ? { missing: true } : {}) });
      } else list.push(y);
      put.delete(x.id);
    }
    for (const y of put.values()) list.push(y);
    (out as unknown as Record<Part, Piece[]>)[part] = list;
  }
  if (c.name !== null) out.name = c.name;
  if (!out.sequences.some((s) => s.id === out.open)) out.open = out.sequences[0]?.id ?? '';
  return out;
}

const label = (part: Part, x: Piece | undefined): string => {
  const name = x && 'name' in x ? x.name : '';
  const what = part === 'sequences' ? 'Sequence' : part === 'media' ? 'Media' : part === 'bins' ? 'Bin' : 'Camera group';
  return name ? `${what} “${name}”` : what;
};

/** Pieces both people changed in different ways since `base` (plain-English names). */
export function conflicts(base: Project, mine: Project, theirs: Project): string[] {
  const out: string[] = [];
  for (const part of PARTS) {
    const b = byId<Piece>(base[part]);
    const m = byId<Piece>(mine[part]);
    const t = byId<Piece>(theirs[part]);
    for (const id of new Set([...b.keys(), ...m.keys(), ...t.keys()])) {
      const mineChanged = !same(part, b.get(id), m.get(id));
      const theirsChanged = !same(part, b.get(id), t.get(id));
      if (mineChanged && theirsChanged && !same(part, m.get(id), t.get(id))) out.push(label(part, m.get(id) ?? t.get(id) ?? b.get(id)));
    }
  }
  if (mine.name !== base.name && theirs.name !== base.name && mine.name !== theirs.name) out.push('Project name');
  return out;
}

export type Merged = { ok: true; project: Project; changes: Changes } | { ok: false; conflicts: string[] };

/** My project with their changes since `base` brought in, unless we both changed the same piece. */
export function merge(base: Project, mine: Project, theirs: Project): Merged {
  const clash = conflicts(base, mine, theirs);
  if (clash.length) return { ok: false, conflicts: clash };
  const changes = diff(base, theirs);
  return { ok: true, project: bringIn(mine, changes), changes };
}

/**
 * What is put online: media that was already shared keeps the shared file
 * place (each person's own place stays on their computer), and nothing
 * that only matters here (missing marks).
 */
export function forUpload(mine: Project, base: Project | null): Project {
  const before = base ? byId(base.media) : new Map<string, MediaItem>();
  return {
    ...mine,
    media: mine.media.map(({ missing: _m, ...m }) => {
      const b = before.get(m.id);
      return b ? { ...m, path: b.path, proxy: b.proxy } : m;
    }),
  };
}
