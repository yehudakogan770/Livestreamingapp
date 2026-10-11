// The calendar of plans: month, week, day and agenda. Dates are local, as
// "2026-10-06" strings (like a plan's event date). A plan's times are its
// event's own (in its time zone, when it has one). No network and no React here.

import { clock12, isoDate, otherZone, parseClock, zoneAbbr, zonedMoment, type PlanSummary } from './model';

export type CalView = 'month' | 'week' | 'day' | 'agenda';
export const CAL_VIEWS: readonly CalView[] = ['month', 'week', 'day', 'agenda'];

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-10-06" → a local Date at midnight. */
export function parseDay(d: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function addDays(d: string, n: number): string {
  const x = parseDay(d)!;
  return isoDate(new Date(x.getFullYear(), x.getMonth(), x.getDate() + n));
}

/** The same day n months on (the 31st becomes the month's last day). */
export function addMonths(d: string, n: number): string {
  const x = parseDay(d)!;
  const first = new Date(x.getFullYear(), x.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return isoDate(new Date(first.getFullYear(), first.getMonth(), Math.min(x.getDate(), last)));
}

/** The Sunday a week starts on. */
export function weekStart(d: string): string {
  return addDays(d, -parseDay(d)!.getDay());
}

/** The 7 days of the week `d` is in. */
export const weekDays = (d: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(weekStart(d), i));

/** The weeks shown for the month `d` is in: whole weeks, Sunday first (5 or 6 rows). */
export function monthGrid(d: string): string[][] {
  const x = parseDay(d)!;
  const first = isoDate(new Date(x.getFullYear(), x.getMonth(), 1));
  const lastDay = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  const last = isoDate(new Date(x.getFullYear(), x.getMonth(), lastDay));
  const weeks: string[][] = [];
  for (let w = weekStart(first); w <= last; w = addDays(w, 7)) weeks.push(weekDays(w));
  return weeks;
}

export const sameMonth = (a: string, b: string): boolean => a.slice(0, 7) === b.slice(0, 7);

/** "October 2026". */
export function monthTitle(d: string): string {
  return parseDay(d)!.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** "Oct 4 – 10, 2026" (or across months / years). */
export function weekTitle(d: string): string {
  const [a, b] = [parseDay(weekStart(d))!, parseDay(addDays(weekStart(d), 6))!];
  const m = (x: Date) => x.toLocaleDateString('en-US', { month: 'short' });
  if (a.getFullYear() !== b.getFullYear()) return `${m(a)} ${a.getDate()}, ${a.getFullYear()} – ${m(b)} ${b.getDate()}, ${b.getFullYear()}`;
  if (a.getMonth() !== b.getMonth()) return `${m(a)} ${a.getDate()} – ${m(b)} ${b.getDate()}, ${b.getFullYear()}`;
  return `${m(a)} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`;
}

/** "Tuesday, October 6" (with the year when it is not this year's). */
export function dayTitle(d: string, today: string): string {
  const x = parseDay(d)!;
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' };
  if (d.slice(0, 4) !== today.slice(0, 4)) opts.year = 'numeric';
  return x.toLocaleDateString('en-US', opts);
}

const startOf = (p: PlanSummary): number => parseClock(p.startTime) ?? -1;

/** Plans by their date, each day's in order of start time. Plans with no date are left out. */
export function plansByDay(plans: readonly PlanSummary[]): Map<string, PlanSummary[]> {
  const m = new Map<string, PlanSummary[]>();
  for (const p of plans) {
    if (!p.eventDate) continue;
    const list = m.get(p.eventDate) ?? [];
    list.push(p);
    m.set(p.eventDate, list);
  }
  for (const list of m.values()) list.sort((a, b) => startOf(a) - startOf(b) || a.name.localeCompare(b.name));
  return m;
}

/** The agenda: days with plans from `from` on (or before it, `past`), in order. */
export function agenda(plans: readonly PlanSummary[], from: string, past = false): { day: string; plans: PlanSummary[] }[] {
  const days = [...plansByDay(plans).entries()].filter(([d]) => (past ? d < from : d >= from)).map(([day, list]) => ({ day, plans: list }));
  days.sort((a, b) => (a.day < b.day ? -1 : 1));
  return past ? days.reverse() : days;
}

/** The upcoming plans (today on, soonest first), for the sidebar. */
export function upcoming(plans: readonly PlanSummary[], today: string, n = 8): PlanSummary[] {
  return agenda(plans, today)
    .flatMap((d) => d.plans)
    .slice(0, n);
}

/** Move the calendar on by n of its views (months, weeks or days). */
export function stepView(view: CalView, d: string, n: number): string {
  if (view === 'month') return addMonths(d, n);
  if (view === 'week') return addDays(d, 7 * n);
  return addDays(d, n);
}

/**
 * The day a key moves to in the month grid: arrows by a day or a week, Home
 * and End to the week's ends, Page Up and Page Down by a month (Shift: a year).
 * Null for other keys.
 */
export function dayForKey(d: string, key: string, shift = false): string | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(d, -1);
    case 'ArrowRight':
      return addDays(d, 1);
    case 'ArrowUp':
      return addDays(d, -7);
    case 'ArrowDown':
      return addDays(d, 7);
    case 'Home':
      return weekStart(d);
    case 'End':
      return addDays(weekStart(d), 6);
    case 'PageUp':
      return addMonths(d, shift ? -12 : -1);
    case 'PageDown':
      return addMonths(d, shift ? 12 : 1);
    default:
      return null;
  }
}

/** "Sunday, October 11, 2026": the day view's title. */
export function longDay(d: string): string {
  return parseDay(d)!.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/** Without an end, a plan fills this long in the week and day views. */
export const DEFAULT_MINUTES = 60;
/** The shortest a plan is drawn in the week and day views (so its name fits). */
const MIN_MINUTES = 30;

/** A plan placed on the time grid: minutes after midnight, and its column among the plans it overlaps. */
export interface Placed {
  plan: PlanSummary;
  start: number;
  end: number;
  /** 0-based column, and how many columns its group of overlapping plans needs. */
  col: number;
  cols: number;
}

/** A plan's start and end, in minutes after midnight on its day (null: no start time). */
export function planSpan(p: PlanSummary): { start: number; end: number } | null {
  const s = parseClock(p.startTime);
  if (s === null) return null;
  const start = Math.floor(s / 60);
  const e = p.endBy ? parseClock(p.endBy) : null;
  let end = e === null ? start + DEFAULT_MINUTES : Math.floor(e / 60);
  if (end <= start) end = e === null ? start + DEFAULT_MINUTES : 24 * 60; // Over past midnight: to the end of the day.
  return { start, end: Math.min(24 * 60, Math.max(end, start + MIN_MINUTES)) };
}

/**
 * The day's timed plans laid out side by side where they overlap (like any
 * calendar): each group of overlapping plans shares the width in columns.
 */
export function placeDay(plans: readonly PlanSummary[]): Placed[] {
  const timed = plans
    .map((plan) => ({ plan, span: planSpan(plan) }))
    .filter((x): x is { plan: PlanSummary; span: { start: number; end: number } } => x.span !== null)
    .sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end);
  const out: Placed[] = [];
  let group: Placed[] = [];
  let colEnds: number[] = [];
  let groupEnd = -1;
  const close = () => {
    for (const p of group) p.cols = colEnds.length;
    group = [];
    colEnds = [];
  };
  for (const { plan, span } of timed) {
    if (span.start >= groupEnd) close();
    let col = colEnds.findIndex((end) => end <= span.start);
    if (col < 0) col = colEnds.push(0) - 1;
    colEnds[col] = span.end;
    const p: Placed = { plan, start: span.start, end: span.end, col, cols: 1 };
    group.push(p);
    out.push(p);
    groupEnd = Math.max(groupEnd, span.end);
  }
  close();
  return out;
}

/** "6 PM", "6:30 PM": short times for the calendar. */
export function shortClock(minutes: number): string {
  return clock12(minutes * 60).replace(':00 ', ' ');
}

/** "9 AM", "12 PM" for the time grid's hours. */
export const hourLabel = (h: number): string => shortClock(h * 60);

/**
 * A plan's start for the calendar: "6 PM", and, when its event is in another
 * time zone than this device's, that zone ("6 PM CDT") and the time here.
 */
export function planTime(p: PlanSummary): { short: string; zone: string; here: string } {
  const span = planSpan(p);
  if (!span) return { short: '', zone: '', here: '' };
  const short = shortClock(span.start);
  const tz = p.timeZone ? otherZone(p.timeZone, parseDay(p.eventDate) ?? new Date()) : '';
  if (!tz || !p.eventDate) return { short, zone: '', here: '' };
  const at = zonedMoment(p.eventDate, span.start * 60, tz);
  const here = at ? at.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', weekday: 'short' }).replace(':00 ', ' ') : '';
  return { short, zone: zoneAbbr(tz, at ?? new Date()), here };
}

/** The first hour the week or day view shows at the top: an hour before the earliest plan, or 8 AM. */
export function firstHour(plans: readonly PlanSummary[]): number {
  const starts = plans
    .map(planSpan)
    .filter((s): s is { start: number; end: number } => s !== null)
    .map((s) => s.start);
  if (!starts.length) return 8;
  return Math.max(0, Math.min(8, Math.floor(Math.min(...starts) / 60) - 1));
}
