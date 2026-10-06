// Lumora Planner: the shared run of show. Plans, cues and comments as the app
// uses them, the rows they are stored as (supabase/update-5-planner.sql), and
// the arithmetic: order, times, totals. No network and no React here, so Lumora
// itself uses this file too (Run of show → Load from Planner…).

export type Role = 'owner' | 'editor' | 'viewer';

export type Segment = 'camera' | 'video' | 'slide' | 'title' | 'lyrics' | 'countdown' | 'speaker' | 'break' | 'custom';

export const SEGMENTS: { id: Segment; name: string; short: string }[] = [
  { id: 'camera', name: 'Camera shot', short: 'CAM' },
  { id: 'video', name: 'Video', short: 'VID' },
  { id: 'slide', name: 'Slide', short: 'SLD' },
  { id: 'title', name: 'Title / name', short: 'TTL' },
  { id: 'lyrics', name: 'Song lyrics', short: 'LYR' },
  { id: 'countdown', name: 'Countdown', short: 'CDN' },
  { id: 'speaker', name: 'Speaker', short: 'SPK' },
  { id: 'break', name: 'Break', short: 'BRK' },
  { id: 'custom', name: 'Custom', short: 'CUS' },
];

export const segmentName = (s: Segment): string => SEGMENTS.find((x) => x.id === s)?.name ?? 'Custom';
export const isSegment = (s: unknown): s is Segment => SEGMENTS.some((x) => x.id === s);

export interface Plan {
  id: string;
  owner: string;
  name: string;
  /** "2026-10-06", or '' when not set. */
  eventDate: string;
  venue: string;
  /** When the show starts, "19:30" (24-hour), or ''. */
  startTime: string;
  notes: string;
  updatedAt: number;
  updatedBy: string;
}

export interface PlanCue {
  id: string;
  planId: string;
  /** Sort key: cues are shown in order of position. */
  position: number;
  section: string;
  title: string;
  segment: Segment;
  /** Who is responsible (a person or a role). */
  who: string;
  notes: string;
  /** A fixed start, "19:45" (24-hour); '' follows the cue before. */
  startTime: string;
  /** Planned length in seconds, or null. */
  durationSec: number | null;
  /** Lumora hints: the input to put on air, the overlay (or preset) to show, the transition. */
  input: string;
  overlay: string;
  transition: string;
  updatedAt: number;
  updatedBy: string;
}

export interface PlanComment {
  id: string;
  planId: string;
  cueId: string;
  author: string;
  authorName: string;
  text: string;
  createdAt: number;
}

export interface PlanSummary {
  id: string;
  name: string;
  eventDate: string;
  venue: string;
  startTime: string;
  role: Role;
  ownerName: string;
  cueCount: number;
  updatedAt: number;
  updatedBy: string;
}

// ---- Rows (snake_case, as stored) ----

export interface PlanRow {
  id: string;
  owner: string;
  name: string;
  event_date: string | null;
  venue: string;
  start_time: string;
  notes: string;
  updated_at: string;
  updated_by_name: string;
}

export interface CueRow {
  id: string;
  plan_id: string;
  position: number;
  section: string;
  title: string;
  segment: string;
  who: string;
  notes: string;
  start_time: string;
  duration_sec: number | null;
  input_hint: string;
  overlay_hint: string;
  transition_hint: string;
  updated_at?: string;
  updated_by_name?: string;
}

export interface CommentRow {
  id: string;
  plan_id: string;
  cue_id: string;
  author: string;
  author_name: string;
  text: string;
  created_at: string;
}

export interface SummaryRow {
  id: string;
  name: string;
  event_date: string | null;
  venue: string;
  start_time: string;
  role: Role;
  owner_name: string;
  cue_count: number;
  updated_at: string;
  updated_by_name: string;
}

const time = (s: string | undefined | null): number => (s ? Date.parse(s) || 0 : 0);

export function planFromRow(r: PlanRow): Plan {
  return {
    id: r.id,
    owner: r.owner,
    name: r.name ?? '',
    eventDate: r.event_date ?? '',
    venue: r.venue ?? '',
    startTime: r.start_time ?? '',
    notes: r.notes ?? '',
    updatedAt: time(r.updated_at),
    updatedBy: r.updated_by_name ?? '',
  };
}

export function cueFromRow(r: CueRow): PlanCue {
  return {
    id: r.id,
    planId: r.plan_id,
    position: Number(r.position) || 0,
    section: r.section ?? '',
    title: r.title ?? '',
    segment: isSegment(r.segment) ? r.segment : 'custom',
    who: r.who ?? '',
    notes: r.notes ?? '',
    startTime: r.start_time ?? '',
    durationSec: r.duration_sec ?? null,
    input: r.input_hint ?? '',
    overlay: r.overlay_hint ?? '',
    transition: r.transition_hint ?? '',
    updatedAt: time(r.updated_at),
    updatedBy: r.updated_by_name ?? '',
  };
}

/** The columns people may write (the server stamps updated_at and who). */
export function cueToRow(c: PlanCue): CueRow {
  return {
    id: c.id,
    plan_id: c.planId,
    position: c.position,
    section: c.section.slice(0, 60),
    title: c.title.slice(0, 120),
    segment: c.segment,
    who: c.who.slice(0, 80),
    notes: c.notes.slice(0, 4000),
    start_time: c.startTime,
    duration_sec: c.durationSec,
    input_hint: c.input.slice(0, 80),
    overlay_hint: c.overlay.slice(0, 80),
    transition_hint: c.transition.slice(0, 40),
  };
}

export function commentFromRow(r: CommentRow): PlanComment {
  return { id: r.id, planId: r.plan_id, cueId: r.cue_id, author: r.author, authorName: r.author_name ?? '', text: r.text ?? '', createdAt: time(r.created_at) };
}

export function summaryFromRow(r: SummaryRow): PlanSummary {
  return {
    id: r.id,
    name: r.name || 'Untitled plan',
    eventDate: r.event_date ?? '',
    venue: r.venue ?? '',
    startTime: r.start_time ?? '',
    role: r.role,
    ownerName: r.owner_name ?? '',
    cueCount: r.cue_count ?? 0,
    updatedAt: time(r.updated_at),
    updatedBy: r.updated_by_name ?? '',
  };
}

// ---- Order ----

/** Gap between positions when cues are numbered afresh. */
export const STEP = 1024;

export const byPosition = (a: { position: number; id: string }, b: { position: number; id: string }): number =>
  a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function sortCues<T extends { position: number; id: string }>(cues: readonly T[]): T[] {
  return [...cues].sort(byPosition);
}

/** A position between two neighbors (either may be missing: start or end of the list). */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return STEP;
  if (before === null) return after! - STEP;
  if (after === null) return before + STEP;
  return (before + after) / 2;
}

/** Positions too close together to split again (they are then numbered afresh). */
const tooClose = (a: number, b: number): boolean => Math.abs(b - a) < 1e-6;

/**
 * Move the cue at `from` so it ends up at index `to` (in the sorted list).
 * Returns the cues whose position changed (usually just the one moved; all of
 * them when the gap had run out), with their new positions.
 */
export function moveCue<T extends { position: number; id: string }>(cues: readonly T[], from: number, to: number): T[] {
  const sorted = sortCues(cues);
  if (from === to || from < 0 || from >= sorted.length || to < 0 || to >= sorted.length) return [];
  const moving = sorted[from]!;
  const rest = sorted.filter((_, i) => i !== from);
  const before = rest[to - 1]?.position ?? null;
  const after = rest[to]?.position ?? null;
  if (before !== null && after !== null && tooClose(before, after)) {
    rest.splice(to, 0, moving);
    return renumber(rest).filter((c, i) => c.position !== rest[i]!.position);
  }
  return [{ ...moving, position: positionBetween(before, after) }];
}

/** Every cue numbered afresh, STEP apart, in its current order. */
export function renumber<T extends { position: number; id: string }>(cues: readonly T[]): T[] {
  return cues.map((c, i) => ({ ...c, position: (i + 1) * STEP }));
}

/** Where a new cue goes: just after `afterId` (or at the end). */
export function positionAfter(cues: readonly { position: number; id: string }[], afterId: string | null): number {
  const sorted = sortCues(cues);
  const i = afterId === null ? sorted.length - 1 : sorted.findIndex((c) => c.id === afterId);
  if (i < 0) return positionBetween(sorted.at(-1)?.position ?? null, null);
  return positionBetween(sorted[i]!.position, sorted[i + 1]?.position ?? null);
}

// ---- Time ----

/** "19:30", "7:30 pm", "7:30PM", "7pm", "19:30:15" → seconds after midnight, or null. */
export function parseClock(text: string): number | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?\s*$/i.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  const ampm = m[4]?.toLowerCase();
  if (!m[2] && !ampm) return null;
  if (mi > 59 || s > 59) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === 'p' ? 12 : 0);
  } else if (h > 23) return null;
  return h * 3600 + mi * 60 + s;
}

/** Seconds after midnight as "19:30" (or "19:30:15"), how it is stored. */
export function clock24(secs: number): string {
  const d = ((Math.round(secs) % 86_400) + 86_400) % 86_400;
  const h = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = d % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${s ? `:${String(s).padStart(2, '0')}` : ''}`;
}

/** Seconds after midnight as "7:30 PM" (or "7:30:15 PM"). Past midnight wraps. */
export function clock12(secs: number, withSeconds = false): string {
  const d = ((Math.round(secs) % 86_400) + 86_400) % 86_400;
  const h = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = d % 60;
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')}${withSeconds || s ? `:${String(s).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** A stored "19:30" as "7:30 PM"; '' stays ''. */
export function showClock(stored: string): string {
  const s = parseClock(stored);
  return s === null ? '' : clock12(s);
}

/** "5:00", "1:02:30", "90" (seconds), "5m", "1h 30m", "45s" → seconds, or null ('' too). */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  // A bare number is minutes ("20" is 20 minutes, "1.5" is a minute and a half).
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60);
  if (/^\d+(:\d{1,2}){0,2}$/.test(t)) {
    const parts = t.split(':').map(Number);
    if (parts.slice(1).some((n) => n > 59)) return null;
    return parts.reduce((a, n) => a * 60 + n, 0);
  }
  const units = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?|ins?)?)?\s*(?:(\d+)\s*s(?:ec(?:onds?)?|ecs?)?)?$/.exec(t);
  if (!units || !(units[1] || units[2] || units[3])) return null;
  return Math.round(Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0));
}

/** Seconds as "5:00" / "1:02:30"; null as ''. */
export function formatDuration(secs: number | null): string {
  if (secs === null) return '';
  const neg = secs < 0;
  const d = Math.abs(Math.round(secs));
  const h = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = d % 60;
  const body = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return neg ? `-${body}` : body;
}

export interface Timed {
  id: string;
  /** Seconds after midnight of the event day (may pass 86400 after midnight), or null when unknown. */
  start: number | null;
  end: number | null;
  /** Its start is fixed (a hard time), not "after the one before". */
  fixed: boolean;
  /** Fixed start minus when the cue before ends: positive is a gap, negative runs over. */
  drift: number | null;
  /** Running total of planned lengths up to the start of this cue. */
  elapsed: number;
}

export interface Schedule {
  rows: Timed[];
  /** Sum of the planned lengths. */
  totalSec: number;
  /** When the last cue ends, if known. */
  endSec: number | null;
  /** Cues with no length. */
  untimed: number;
  /** Planned length per segment type. */
  bySegment: Partial<Record<Segment, number>>;
}

/**
 * When each cue starts and ends: a fixed start where it has one, otherwise
 * right after the cue before (the first one at the show's start time).
 * Times keep counting past midnight (a cue at 00:30 after one at 23:50 is 24:30).
 */
export function schedule(cues: readonly PlanCue[], showStart: string): Schedule {
  const rows: Timed[] = [];
  let at: number | null = parseClock(showStart);
  let elapsed = 0;
  let total = 0;
  let untimed = 0;
  const bySegment: Partial<Record<Segment, number>> = {};
  let dayBase = 0;
  let lastStart: number | null = null;
  for (const c of sortCues(cues)) {
    let start = at;
    let fixed = false;
    let drift: number | null = null;
    const hard = parseClock(c.startTime);
    if (hard !== null) {
      let h = hard + dayBase;
      // A hard time earlier than the cue before started: the next day.
      if (lastStart !== null && h < lastStart - 6 * 3600) {
        dayBase += 86_400;
        h += 86_400;
      }
      fixed = true;
      drift = at === null ? null : h - at;
      start = h;
    }
    const len = c.durationSec;
    if (len === null) untimed++;
    else {
      total += len;
      bySegment[c.segment] = (bySegment[c.segment] ?? 0) + len;
    }
    const end = start !== null && len !== null ? start + len : null;
    rows.push({ id: c.id, start, end, fixed, drift, elapsed });
    if (start !== null) lastStart = start;
    elapsed += len ?? 0;
    // Without a length, the next cue's start is not known (unless it is fixed).
    at = end;
  }
  const last = rows.at(-1);
  return { rows, totalSec: total, endSec: last ? last.end : null, untimed, bySegment };
}

/** The index of the cue planned to be running at `nowSec` (seconds after the event day's midnight), or null. */
export function cueAt(s: Schedule, nowSec: number): number | null {
  for (let i = s.rows.length - 1; i >= 0; i--) {
    const r = s.rows[i]!;
    if (r.start !== null && r.start <= nowSec && (r.end === null || nowSec < r.end)) return i;
  }
  return null;
}

/** Seconds since midnight on the event date for a moment (local time); null when not that day or the next. */
export function eventSeconds(eventDate: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate);
  if (!m) return null;
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const secs = Math.floor((now.getTime() - day.getTime()) / 1000);
  return secs >= 0 && secs < 2 * 86_400 ? secs : null;
}

// ---- Live edits (last write wins per cue) ----

/**
 * A cue as it came from the server, merged into the list: it replaces ours
 * unless ours is newer, or we have unsaved changes to it (then ours goes up
 * next and wins).
 */
export function mergeCue(list: readonly PlanCue[], incoming: PlanCue, pending: ReadonlySet<string>): PlanCue[] {
  const i = list.findIndex((c) => c.id === incoming.id);
  if (i < 0) return [...list, incoming];
  const mine = list[i]!;
  if (pending.has(incoming.id) || mine.updatedAt > incoming.updatedAt) return [...list];
  const next = [...list];
  next[i] = incoming;
  return next;
}

export const removeCue = (list: readonly PlanCue[], id: string): PlanCue[] => list.filter((c) => c.id !== id);

/** A new cue with nothing filled in. */
export function blankCue(planId: string, id: string, position: number, section = ''): PlanCue {
  return {
    id,
    planId,
    position,
    section,
    title: '',
    segment: 'camera',
    who: '',
    notes: '',
    startTime: '',
    durationSec: null,
    input: '',
    overlay: '',
    transition: '',
    updatedAt: 0,
    updatedBy: '',
  };
}

/** A date stored as "2026-10-06" in American words: "Tuesday, October 6, 2026". */
export function longDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return '';
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/** "Oct 6, 2026". */
export function shortDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** A local date as "2026-10-06". */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Transitions Lumora knows, as people write them (Lumora matches them loosely). */
export const TRANSITION_NAMES = [
  'Cut',
  'Fade',
  'Dip',
  'Merge',
  'Wipe',
  'Wipe left',
  'Wipe up',
  'Wipe down',
  'Slide',
  'Slide right',
  'Slide up',
  'Slide down',
  'Cover',
  'Reveal',
  'Split',
  'Split vertical',
  'Iris',
  'Diamond',
  'Zoom',
  'Zoom out',
  'Blur',
  'Flash',
  'Luma clock',
  'Luma circle',
  'Luma blinds',
  'Luma diagonal',
  'Luma sparkle',
  'Luma heart',
  'Stinger 1',
  'Stinger 2',
];
