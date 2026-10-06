// A plan's schedule: the people side of the day (crew call, load-in, sound
// check, doors, show, strike…), as time blocks over one or more days. The rows
// they are stored as (supabase/update-8-planner.sql), their order, the day
// timeline's layout and "My schedule". No network and no React here.

import { clock12, parseClock } from './model';

export interface Block {
  id: string;
  planId: string;
  /** "2026-10-06", or '' when not set. */
  day: string;
  /** "15:00" (24-hour), or ''. */
  starts: string;
  ends: string;
  title: string;
  location: string;
  /** People or roles, e.g. "Crew, Audio". */
  who: string;
  notes: string;
  sort: number;
  updatedAt: number;
  updatedBy: string;
}

export interface BlockRow {
  id: string;
  plan_id: string;
  day: string | null;
  starts: string | null;
  ends: string | null;
  title: string;
  location: string;
  who: string;
  notes: string;
  sort: number;
  updated_at?: string;
  updated_by_name?: string;
}

/** "15:00:00" (as Postgres gives a time) → "15:00"; anything else → ''. */
export function hhmm(t: string | null | undefined): string {
  const m = /^(\d{2}):(\d{2})/.exec(t ?? '');
  return m ? `${m[1]}:${m[2]}` : '';
}

export function blockFromRow(r: BlockRow): Block {
  return {
    id: r.id,
    planId: r.plan_id,
    day: r.day ?? '',
    starts: hhmm(r.starts),
    ends: hhmm(r.ends),
    title: r.title ?? '',
    location: r.location ?? '',
    who: r.who ?? '',
    notes: r.notes ?? '',
    sort: Number(r.sort) || 0,
    updatedAt: r.updated_at ? Date.parse(r.updated_at) || 0 : 0,
    updatedBy: r.updated_by_name ?? '',
  };
}

export function blockToRow(b: Block): BlockRow {
  return {
    id: b.id,
    plan_id: b.planId,
    day: b.day || null,
    starts: b.starts || null,
    ends: b.ends || null,
    title: b.title.slice(0, 120),
    location: b.location.slice(0, 120),
    who: b.who.slice(0, 200),
    notes: b.notes.slice(0, 2000),
    sort: b.sort,
  };
}

const mins = (t: string): number | null => {
  const s = parseClock(t);
  return s === null ? null : Math.round(s / 60);
};

/** By day (no day last), then start (no time first in its day), then sort. */
export function sortBlocks(list: readonly Block[]): Block[] {
  return [...list].sort((a, b) => {
    if (a.day !== b.day) return !a.day ? 1 : !b.day ? -1 : a.day < b.day ? -1 : 1;
    const sa = mins(a.starts);
    const sb = mins(b.starts);
    if (sa !== sb) return sa === null ? -1 : sb === null ? 1 : sa - sb;
    return a.sort - b.sort || a.id.localeCompare(b.id);
  });
}

export interface Day {
  /** "2026-10-06", or '' for blocks with no day. */
  day: string;
  blocks: Block[];
}

/** Blocks grouped by day, in order. */
export function byDay(list: readonly Block[]): Day[] {
  const days: Day[] = [];
  for (const b of sortBlocks(list)) {
    const last = days.at(-1);
    if (last && last.day === b.day) last.blocks.push(b);
    else days.push({ day: b.day, blocks: [b] });
  }
  return days;
}

/** "3:00 – 5:00 PM", "3:00 PM", or '' (both ends in one half of the day share AM/PM). */
export function blockTime(b: Pick<Block, 'starts' | 'ends'>): string {
  const s = parseClock(b.starts);
  const e = parseClock(b.ends);
  if (s === null) return e === null ? '' : `until ${clock12(e)}`;
  if (e === null) return clock12(s);
  const a = clock12(s);
  const z = clock12(e);
  return a.slice(-2) === z.slice(-2) ? `${a.slice(0, -3)} – ${z}` : `${a} – ${z}`;
}

/** Minutes a block lasts (an end before the start runs past midnight); null without both times. */
export function blockMinutes(b: Pick<Block, 'starts' | 'ends'>): number | null {
  const s = mins(b.starts);
  const e = mins(b.ends);
  if (s === null || e === null) return null;
  return e >= s ? e - s : e + 1440 - s;
}

export interface Placed {
  block: Block;
  /** Minutes after midnight. */
  top: number;
  height: number;
  /** Side-by-side lanes for blocks at the same time. */
  lane: number;
  lanes: number;
}

/**
 * One day on a timeline: blocks with a start, placed by time, overlapping
 * ones side by side. A block with no end shows as 30 minutes.
 */
export function layoutDay(blocks: readonly Block[]): { placed: Placed[]; from: number; to: number } {
  const timed = sortBlocks(blocks).filter((b) => mins(b.starts) !== null);
  const placed: Placed[] = timed.map((b) => {
    const top = mins(b.starts)!;
    const len = blockMinutes(b);
    return { block: b, top, height: Math.max(len === null ? 30 : len, 15), lane: 0, lanes: 1 };
  });
  // Clusters of overlapping blocks share their lane count.
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const close = () => {
    const n = Math.max(1, ...cluster.map((p) => p.lane + 1));
    for (const p of cluster) p.lanes = n;
    cluster = [];
  };
  for (const p of placed) {
    if (cluster.length && p.top >= clusterEnd) close();
    const busy = new Set(cluster.filter((q) => q.top + q.height > p.top).map((q) => q.lane));
    let lane = 0;
    while (busy.has(lane)) lane++;
    p.lane = lane;
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.top + p.height);
  }
  close();
  const starts = placed.map((p) => p.top);
  const ends = placed.map((p) => p.top + p.height);
  const from = starts.length ? Math.max(0, Math.floor(Math.min(...starts) / 60) * 60 - 60) : 8 * 60;
  const to = ends.length ? Math.min(30 * 60, Math.ceil(Math.max(...ends) / 60) * 60 + 60) : 22 * 60;
  return { placed, from, to: Math.max(to, from + 4 * 60) };
}

/** Words that mean everyone. */
const EVERYONE = /^(all|everyone|everybody|all crew|all hands|whole team|team)$/i;

/**
 * "My schedule": blocks for this person, by name (full or first name) or by
 * any of their roles, or for everyone. `who` is split on commas, "and", "&" and "/".
 */
export function isMine(b: Pick<Block, 'who'>, name: string, roles: readonly string[]): boolean {
  const parts = b.who
    .split(/,|;|\/|&|\band\b|\+/i)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return false;
  if (parts.some((p) => EVERYONE.test(p))) return true;
  const me = name.trim().toLowerCase();
  const first = me.split(/\s+/)[0] ?? '';
  const wanted = [me, first, ...roles.map((r) => r.trim().toLowerCase())].filter((w) => w.length > 1);
  return parts.some((p) => wanted.some((w) => p === w || p.split(/\s+/).includes(w) || (w.includes(' ') && p.includes(w))));
}

/** A typical show day around the show's start ("19:30"), for an empty schedule. */
export function typicalDay(showStart: string): { starts: string; ends: string; title: string; who: string }[] {
  const s = mins(showStart) ?? 19 * 60 + 30;
  const at = (m: number) => {
    const d = (((s + m) % 1440) + 1440) % 1440;
    return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`;
  };
  return [
    { starts: at(-330), ends: at(-300), title: 'Crew call', who: 'All crew' },
    { starts: at(-300), ends: at(-180), title: 'Load-in', who: 'Crew' },
    { starts: at(-180), ends: at(-120), title: 'Sound check', who: 'Audio' },
    { starts: at(-120), ends: at(-60), title: 'Rehearsal', who: 'Everyone' },
    { starts: at(-30), ends: at(0), title: 'Doors', who: 'Front of house' },
    { starts: at(0), ends: at(120), title: 'Show', who: 'Everyone' },
    { starts: at(120), ends: at(210), title: 'Strike', who: 'Crew' },
  ];
}

/** A new block with nothing filled in. */
export function blankBlock(planId: string, id: string, day: string, sort: number): Block {
  return { id, planId, day, starts: '', ends: '', title: '', location: '', who: '', notes: '', sort, updatedAt: 0, updatedBy: '' };
}

/** A block as it came from the server: it replaces ours unless we have unsaved changes to it. */
export function mergeBlock(list: readonly Block[], incoming: Block, pending: ReadonlySet<string>): Block[] {
  const i = list.findIndex((b) => b.id === incoming.id);
  if (i < 0) return [...list, incoming];
  if (pending.has(incoming.id)) return [...list];
  const next = [...list];
  next[i] = incoming;
  return next;
}

// The roles this person goes by, per plan (for "My schedule"), on this device.
const ROLES_KEY = 'lumora.planner.myRoles';
export function loadRoles(): string {
  try {
    return localStorage.getItem(ROLES_KEY) ?? '';
  } catch {
    return '';
  }
}
export function saveRoles(text: string): void {
  try {
    localStorage.setItem(ROLES_KEY, text);
  } catch {
    // Not remembered.
  }
}
export const splitRoles = (text: string): string[] =>
  text
    .split(/,|;/)
    .map((s) => s.trim())
    .filter(Boolean);
