import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

apply('planner/src/model.ts', [
("""  notes: string;
  updatedAt: number;
  updatedBy: string;
}

export interface PlanCue {""", """  notes: string;
  updatedAt: number;
  updatedBy: string;
  /** Where the show happens, "America/New_York" (IANA), or '': the time where each person is. */
  timeZone: string;
  /** The show must be over by then, "21:00", or ''. */
  endBy: string;
  /** Extra columns on the cue sheet (Camera, Audio, Lights…). */
  columns: CustomColumn[];
  /** A template: listed with the templates, not with the plans. */
  isTemplate: boolean;
  /** The public read-only link's token, or null (off). Only the owner turns it on or off. */
  shareToken: string | null;
  /** What the public link shows: the agenda (titles and times) or the crew view (with notes and scripts). */
  shareScope: 'agenda' | 'crew';
  /** The server has the show-day tools (supabase/update-10-planner-pro.sql). */
  pro: boolean;
}

export interface CustomColumn {
  id: string;
  name: string;
}

/** Cue colors (a tag for the crew, shown as a stripe on the row). */
export const CUE_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const;
export type CueColor = (typeof CUE_COLORS)[number] | '';
export const COLOR_NAMES: Record<Exclude<CueColor, ''>, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  gray: 'Gray',
};
const isColor = (c: unknown): c is CueColor => c === '' || (CUE_COLORS as readonly unknown[]).includes(c);
export const MAX_COLUMNS = 12;
export const MAX_SCRIPT = 20_000;

export interface PlanCue {"""),
("""  transition: string;
  updatedAt: number;
  updatedBy: string;
}

export interface PlanComment {""", """  transition: string;
  /** What is said, for the prompter (plain text). */
  script: string;
  color: CueColor;
  /** Floated: kept in the list but left out of the timing (a spare, or cut for now). */
  skip: boolean;
  /** Values for the plan's extra columns, by column id. */
  custom: Record<string, string>;
  updatedAt: number;
  updatedBy: string;
}

export interface PlanComment {"""),
("""  text: string;
  createdAt: number;
}

export interface PlanSummary {""", """  text: string;
  createdAt: number;
  /** People named with @ (account ids). */
  mentions: string[];
}

export interface PlanSummary {"""),
("""  updated_at: string;
  updated_by_name: string;
}

export interface CueRow {""", """  updated_at: string;
  updated_by_name: string;
  time_zone?: string;
  end_by?: string;
  columns?: unknown;
  is_template?: boolean;
  share_token?: string | null;
  share_scope?: string;
}

export interface CueRow {"""),
("""  transition_hint: string;
  updated_at?: string;
  updated_by_name?: string;
}""", """  transition_hint: string;
  script?: string;
  color?: string;
  skip?: boolean;
  custom?: unknown;
  updated_at?: string;
  updated_by_name?: string;
}"""),
("""  text: string;
  created_at: string;
}

export interface SummaryRow {""", """  text: string;
  created_at: string;
  mentions?: string[] | null;
}

export interface SummaryRow {"""),
("""    updatedAt: time(r.updated_at),
    updatedBy: r.updated_by_name ?? '',
  };
}

export function cueFromRow""", """    updatedAt: time(r.updated_at),
    updatedBy: r.updated_by_name ?? '',
    timeZone: r.time_zone ?? '',
    endBy: r.end_by ?? '',
    columns: columnsFrom(r.columns),
    isTemplate: r.is_template === true,
    shareToken: r.share_token ?? null,
    shareScope: r.share_scope === 'crew' ? 'crew' : 'agenda',
    pro: 'time_zone' in r,
  };
}

/** The extra columns as stored (anything malformed is dropped). */
export function columnsFrom(v: unknown): CustomColumn[] {
  if (!Array.isArray(v)) return [];
  const out: CustomColumn[] = [];
  for (const c of v) {
    if (!c || typeof c !== 'object') continue;
    const { id, name } = c as { id?: unknown; name?: unknown };
    if (typeof id === 'string' && id && typeof name === 'string' && !out.some((o) => o.id === id)) out.push({ id: id.slice(0, 40), name: name.slice(0, 40) });
  }
  return out.slice(0, MAX_COLUMNS);
}

function customFrom(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string' && val) out[k] = val;
  return out;
}

export function cueFromRow"""),
("""    transition: r.transition_hint ?? '',
    updatedAt: time(r.updated_at),""", """    transition: r.transition_hint ?? '',
    script: r.script ?? '',
    color: isColor(r.color) ? r.color : '',
    skip: r.skip === true,
    custom: customFrom(r.custom),
    updatedAt: time(r.updated_at),"""),
("""/** The columns people may write (the server stamps updated_at and who). */
export function cueToRow(c: PlanCue): CueRow {
  return {""", """/** The columns people may write (the server stamps updated_at and who). `pro`: the server has update 10's columns. */
export function cueToRow(c: PlanCue, pro = true): CueRow {
  const extra = pro
    ? {
        script: c.script.slice(0, MAX_SCRIPT),
        color: c.color,
        skip: c.skip,
        custom: Object.fromEntries(Object.entries(c.custom).map(([k, v]) => [k, v.slice(0, 200)])),
      }
    : {};
  return {
    ...extra,"""),
("""  return { id: r.id, planId: r.plan_id, cueId: r.cue_id, author: r.author, authorName: r.author_name ?? '', text: r.text ?? '', createdAt: time(r.created_at) };""",
"""  return {
    id: r.id,
    planId: r.plan_id,
    cueId: r.cue_id,
    author: r.author,
    authorName: r.author_name ?? '',
    text: r.text ?? '',
    createdAt: time(r.created_at),
    mentions: r.mentions ?? [],
  };"""),
("""  /** Running total of planned lengths up to the start of this cue. */
  elapsed: number;
}""", """  /** Running total of planned lengths up to the start of this cue. */
  elapsed: number;
  /** Floated: left out of the timing (start is where it would go). */
  skipped?: boolean;
}"""),
("""  for (const c of sortCues(cues)) {
    let start = at;""", """  for (const c of sortCues(cues)) {
    if (c.skip) {
      rows.push({ id: c.id, start: at, end: null, fixed: false, drift: null, elapsed, skipped: true });
      continue;
    }
    let start = at;"""),
("""  const last = rows.at(-1);
  return { rows, totalSec: total, endSec: last ? last.end : null, untimed, bySegment };""", """  const last = rows.filter((r) => !r.skipped).at(-1);
  return { rows, totalSec: total, endSec: last ? last.end : null, untimed, bySegment };"""),
("""    if (r.start !== null && r.start <= nowSec""", """    if (!r.skipped && r.start !== null && r.start <= nowSec"""),
("""export function eventSeconds(eventDate: string, now: Date): number | null {
  const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(eventDate);
  if (!m) return null;
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const secs = Math.floor((now.getTime() - day.getTime()) / 1000);
  return secs >= 0 && secs < 2 * 86_400 ? secs : null;
}""", """export function eventSeconds(eventDate: string, now: Date, timeZone = ''): number | null {
  const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(eventDate);
  if (!m) return null;
  let secs: number;
  const zoned = timeZone ? zoneParts(now, timeZone) : null;
  if (zoned) {
    const days = Math.round((Date.UTC(zoned.y, zoned.mo - 1, zoned.d) - Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) / 86_400_000);
    secs = days * 86_400 + zoned.h * 3600 + zoned.mi * 60 + zoned.s;
  } else {
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    secs = Math.floor((now.getTime() - day.getTime()) / 1000);
  }
  return secs >= 0 && secs < 2 * 86_400 ? secs : null;
}

// ---- Time zones ----

const zoneFormats = new Map<string, Intl.DateTimeFormat | null>();
function zoneFormat(tz: string): Intl.DateTimeFormat | null {
  if (!zoneFormats.has(tz)) {
    try {
      zoneFormats.set(
        tz,
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hourCycle: 'h23',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
        }),
      );
    } catch {
      zoneFormats.set(tz, null);
    }
  }
  return zoneFormats.get(tz)!;
}

/** Is this a time zone the browser knows ("America/Chicago")? */
export const validZone = (tz: string): boolean => !!tz && zoneFormat(tz) !== null;

/** The date and time on the wall clock in a time zone, or null if the zone is unknown. */
export function zoneParts(d: Date, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } | null {
  const f = zoneFormat(tz);
  if (!f) return null;
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(d)) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour! % 24, mi: p.minute!, s: p.second! };
}

/** Minutes the zone is ahead of UTC at that moment (New York in summer: -240). */
export function zoneOffset(d: Date, tz: string): number | null {
  const p = zoneParts(d, tz);
  if (!p) return null;
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(d.getTime() / 1000) * 1000) / 60_000);
}

/** The moment a wall-clock time on a date happens in a zone (or on this device, without one). */
export function zonedMoment(date: string, secs: number, tz: string): Date | null {
  const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!tz || !validZone(tz)) return new Date(y, mo, d, 0, 0, secs);
  const guess = Date.UTC(y, mo, d, 0, 0, secs);
  // Twice: the offset can differ across a daylight saving change.
  let t = guess - (zoneOffset(new Date(guess), tz) ?? 0) * 60_000;
  t = guess - (zoneOffset(new Date(t), tz) ?? 0) * 60_000;
  return new Date(t);
}

/** This device's time zone ("America/Los_Angeles"), or ''. */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

/** "EDT", "GMT+2"… for a zone at a moment. */
export function zoneAbbr(tz: string, d = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/** A plan's zone when it differs from this device's (so times can be shown both ways), else ''. */
export function otherZone(tz: string, d = new Date()): string {
  if (!tz || !validZone(tz)) return '';
  const here = localZone();
  if (!here || here === tz) return '';
  return zoneOffset(d, tz) === zoneOffset(d, here) ? '' : tz;
}

/** Common time zones for the picker (any IANA name can be typed too). */
export const COMMON_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Asia/Jerusalem',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];"""),
("""    input: '',
    overlay: '',
    transition: '',
    updatedAt: 0,
    updatedBy: '',
  };
}""", """    input: '',
    overlay: '',
    transition: '',
    script: '',
    color: '',
    skip: false,
    custom: {},
    updatedAt: 0,
    updatedBy: '',
  };
}

/** A plan with nothing filled in (for tests, and pages that build one). */
export function blankPlan(id: string, more: Partial<Plan> = {}): Plan {
  return {
    id,
    owner: '',
    name: '',
    eventDate: '',
    venue: '',
    startTime: '',
    notes: '',
    updatedAt: 0,
    updatedBy: '',
    timeZone: '',
    endBy: '',
    columns: [],
    isTemplate: false,
    shareToken: null,
    shareScope: 'agenda',
    pro: true,
    ...more,
  };
}

/** Words in a script, and about how long it takes to read aloud (150 words a minute). */
export function scriptLength(text: string): { words: number; secs: number } {
  const words = text.trim() ? text.trim().split(/\\s+/).length : 0;
  return { words, secs: Math.round((words / 150) * 60) };
}"""),
])
