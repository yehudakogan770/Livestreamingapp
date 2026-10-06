// The calendar of plans: month, week and agenda. Dates are local, as
// "2026-10-06" strings (like a plan's event date). No network and no React here.

import { isoDate, parseClock, type PlanSummary } from './model';

export type CalView = 'month' | 'week' | 'agenda';

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
