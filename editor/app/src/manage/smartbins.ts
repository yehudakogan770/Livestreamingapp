// Finding media: search (name, tags, notes, what is said in it), smart bins
// that fill themselves by rules, where a file is used, and what isn't used.
import { end } from '../model/seq';
import type { MediaItem, Project, SmartBin, SmartRule } from '../model/types';
import { uid } from '../model/types';

/** Media ids used by any sequence (directly, or as a camera of a multicam group used there). */
export function usedMedia(p: Project): Set<string> {
  const used = new Set<string>();
  const groups = new Set<string>();
  for (const s of p.sequences)
    for (const c of s.clips) {
      if (c.source.kind === 'media') used.add(c.source.media);
      if (c.source.kind === 'multicam') groups.add(c.source.group);
    }
  for (const g of p.groups) if (groups.has(g.id)) for (const a of g.angles) used.add(a.media);
  return used;
}

/** Does a search match (every word somewhere in the name, file name, tags, notes or transcript)? */
export function searchMatches(m: MediaItem, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [m.name, m.path.split(/[\\/]/).pop() ?? '', ...(m.tags ?? []).map((t) => `#${t}`), m.notes ?? '', m.source?.codec ?? ''].join(' ').toLowerCase();
  const said = () =>
    (m.transcript?.words ?? [])
      .map((w) => w.w)
      .join(' ')
      .toLowerCase();
  let spoken: string | null = null;
  return words.every((w) => {
    if (hay.includes(w)) return true;
    spoken ??= said();
    return spoken.includes(w);
  });
}

export function ruleMatches(m: MediaItem, r: SmartRule, used: Set<string>, now: number): boolean {
  switch (r.field) {
    case 'kind':
      return m.kind === r.is;
    case 'rating':
      return (m.rating ?? 0) >= r.atLeast;
    case 'tag':
      return (m.tags ?? []).some((t) => t.toLowerCase() === r.has.toLowerCase());
    case 'resolution':
      return m.kind !== 'audio' && Math.min(m.width, m.height) >= r.atLeast;
    case 'added':
      return m.addedAt !== undefined && now - m.addedAt <= r.withinDays * 86_400_000;
    case 'transcript':
      return !!m.transcript?.words.length === r.has;
    case 'used':
      return used.has(m.id) === r.is;
    case 'text':
      return searchMatches(m, r.has);
  }
}

/** The media a smart bin shows. */
export function smartBinItems(p: Project, bin: SmartBin, now = Date.now()): MediaItem[] {
  const used = usedMedia(p);
  if (!bin.rules.length) return [...p.media];
  return p.media.filter((m) =>
    bin.match === 'all' ? bin.rules.every((r) => ruleMatches(m, r, used, now)) : bin.rules.some((r) => ruleMatches(m, r, used, now)),
  );
}

/** A rule in words. */
export function describeRule(r: SmartRule): string {
  switch (r.field) {
    case 'kind':
      return r.is === 'video' ? 'Video' : r.is === 'audio' ? 'Sound' : 'Pictures';
    case 'rating':
      return `${'★'.repeat(Math.max(1, Math.min(5, r.atLeast)))} or more`;
    case 'tag':
      return `Tagged #${r.has}`;
    case 'resolution':
      return r.atLeast >= 2160 ? '4K and up' : `${r.atLeast}p and up`;
    case 'added':
      return r.withinDays <= 1 ? 'Added today' : `Added in the last ${r.withinDays} days`;
    case 'transcript':
      return r.has ? 'Transcribed' : 'Not transcribed';
    case 'used':
      return r.is ? 'Used in a sequence' : 'Not used';
    case 'text':
      return `Matches “${r.has}”`;
  }
}

/** Ready-made smart bins. */
export const SMART_PRESETS: { name: string; rules: SmartRule[] }[] = [
  { name: 'Video', rules: [{ field: 'kind', is: 'video' }] },
  { name: 'Sound', rules: [{ field: 'kind', is: 'audio' }] },
  { name: 'Pictures', rules: [{ field: 'kind', is: 'image' }] },
  { name: '4 stars and up', rules: [{ field: 'rating', atLeast: 4 }] },
  { name: '4K', rules: [{ field: 'resolution', atLeast: 2160 }] },
  { name: 'Added this week', rules: [{ field: 'added', withinDays: 7 }] },
  { name: 'Transcribed', rules: [{ field: 'transcript', has: true }] },
  { name: 'Unused', rules: [{ field: 'used', is: false }] },
];

export function newSmartBin(name: string, rules: SmartRule[], match: 'all' | 'any' = 'all'): SmartBin {
  return { id: uid('sb'), name, match, rules };
}

/** Every tag used in the project (for suggestions), most used first. */
export function allTags(p: Project): string[] {
  const count = new Map<string, number>();
  for (const m of p.media) for (const t of m.tags ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/** Tags typed as text (“interview, b-roll #exterior”), tidied. */
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,#\n]/)
        .map((t) => t.trim().replace(/\s+/g, '-'))
        .filter(Boolean),
    ),
  ];
}

export interface Use {
  seq: string;
  seqName: string;
  clip: string;
  start: number;
  end: number;
}

/** Where a file is used: each clip, in each sequence. */
export function usesOf(p: Project, mediaId: string): Use[] {
  const groups = new Set(p.groups.filter((g) => g.angles.some((a) => a.media === mediaId)).map((g) => g.id));
  const out: Use[] = [];
  for (const s of p.sequences)
    for (const c of s.clips) {
      const src = c.source;
      if ((src.kind === 'media' && src.media === mediaId) || (src.kind === 'multicam' && groups.has(src.group)))
        out.push({ seq: s.id, seqName: s.name, clip: c.id, start: c.start, end: end(c) });
    }
  return out.sort((a, b) => a.seqName.localeCompare(b.seqName) || a.start - b.start);
}

/** The project without the media no sequence uses (multicam cameras of used groups stay). */
export function removeUnused(p: Project): { project: Project; removed: number } {
  const used = usedMedia(p);
  // Cameras of any multicam group stay (the group needs them).
  for (const g of p.groups) for (const a of g.angles) used.add(a.media);
  const media = p.media.filter((m) => used.has(m.id));
  return { project: { ...p, media }, removed: p.media.length - media.length };
}

/** Set a file's stars, tags or notes. */
export function setMediaInfo(p: Project, id: string, info: Partial<Pick<MediaItem, 'rating' | 'tags' | 'notes' | 'name'>>): Project {
  return { ...p, media: p.media.map((m) => (m.id === id ? { ...m, ...info } : m)) };
}
