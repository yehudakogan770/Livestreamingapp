// A plan's lists: crew (the call sheet), contacts, tasks (for the plan or one
// cue), gear and budget. One table (planner_items, supabase/update-10-planner-pro.sql)
// with the fields each list uses. No network and no React here.

import { clock12, parseClock } from './model';

export type ItemKind = 'crew' | 'contact' | 'task' | 'gear' | 'budget';

export interface Item {
  id: string;
  planId: string;
  kind: ItemKind;
  /** A task on one cue, or null. */
  cueId: string | null;
  sort: number;
  /** Crew and contacts: the name. Tasks: what to do. Gear: the item. Budget: the line. */
  title: string;
  /** Crew: position. Contacts: company or what for. Gear: department. Budget: category. */
  role: string;
  /** Tasks: who (in words). Gear: who brings it. Budget: vendor. */
  person: string;
  /** Tasks: the account it is for (they are told, and can tick it off). */
  personId: string | null;
  phone: string;
  email: string;
  /** Crew: call time, "15:00". */
  callTime: string;
  /** Crew: call day. Tasks: due. */
  day: string;
  qty: number | null;
  /** Budget: estimate. Gear: cost. */
  amount: number | null;
  /** Budget: actual. */
  actual: number | null;
  /** Gear: needed, packed, on site, returned. Budget: paid or not. */
  status: string;
  done: boolean;
  notes: string;
  updatedAt: number;
  updatedBy: string;
}

export interface ItemRow {
  id: string;
  plan_id: string;
  kind: string;
  cue_id: string | null;
  sort: number;
  title: string;
  role: string;
  person: string;
  person_id: string | null;
  phone: string;
  email: string;
  call_time: string;
  day: string | null;
  qty: number | null;
  amount: number | string | null;
  actual: number | string | null;
  status: string;
  done: boolean;
  notes: string;
  updated_at?: string;
  updated_by_name?: string;
}

export const KINDS: ItemKind[] = ['crew', 'contact', 'task', 'gear', 'budget'];
const isKind = (k: unknown): k is ItemKind => KINDS.includes(k as ItemKind);

/** Words for each list. */
export const KIND_WORDS: Record<ItemKind, { name: string; one: string; title: string; role: string; person: string; empty: string }> = {
  crew: {
    name: 'Crew',
    one: 'person',
    title: 'Name',
    role: 'Position',
    person: '',
    empty: 'Add the crew and their call times: the call sheet prints from here.',
  },
  contact: {
    name: 'Contacts',
    one: 'contact',
    title: 'Name',
    role: 'Company or what for',
    person: '',
    empty: 'Venue manager, caterer, rental house, the client: everyone the team may need to call.',
  },
  task: { name: 'Tasks', one: 'task', title: 'Task', role: '', person: 'Who', empty: 'What has to be done before the show, and by whom.' },
  gear: { name: 'Gear', one: 'item', title: 'Item', role: 'Department', person: 'Who brings it', empty: 'Cameras, mics, cables, staging: what to bring and where it is.' },
  budget: { name: 'Budget', one: 'line', title: 'Line', role: 'Category', person: 'Vendor', empty: 'Planned and actual costs. Only the owner and editors see the budget.' },
};

export const GEAR_STATUS = ['Needed', 'Packed', 'On site', 'Returned'];
export const BUDGET_STATUS = ['', 'Quoted', 'Approved', 'Paid'];

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function itemFromRow(r: ItemRow): Item {
  return {
    id: r.id,
    planId: r.plan_id,
    kind: isKind(r.kind) ? r.kind : 'task',
    cueId: r.cue_id ?? null,
    sort: Number(r.sort) || 0,
    title: r.title ?? '',
    role: r.role ?? '',
    person: r.person ?? '',
    personId: r.person_id ?? null,
    phone: r.phone ?? '',
    email: r.email ?? '',
    callTime: r.call_time ?? '',
    day: r.day ?? '',
    qty: r.qty ?? null,
    amount: num(r.amount),
    actual: num(r.actual),
    status: r.status ?? '',
    done: r.done === true,
    notes: r.notes ?? '',
    updatedAt: r.updated_at ? Date.parse(r.updated_at) || 0 : 0,
    updatedBy: r.updated_by_name ?? '',
  };
}

const money = (n: number | null): number | null => (n === null || !Number.isFinite(n) ? null : Math.round(Math.max(-9_999_999_999, Math.min(9_999_999_999, n)) * 100) / 100);

export function itemToRow(i: Item): ItemRow {
  return {
    id: i.id,
    plan_id: i.planId,
    kind: i.kind,
    cue_id: i.cueId,
    sort: i.sort,
    title: i.title.slice(0, 120),
    role: i.role.slice(0, 80),
    person: i.person.slice(0, 80),
    person_id: i.personId,
    phone: i.phone.slice(0, 40),
    email: i.email.slice(0, 120),
    call_time: i.callTime.slice(0, 8),
    day: i.day || null,
    qty: i.qty === null ? null : Math.max(0, Math.min(100_000, Math.round(i.qty))),
    amount: money(i.amount),
    actual: money(i.actual),
    status: i.status.slice(0, 30),
    done: i.done,
    notes: i.notes.slice(0, 2000),
  };
}

export function blankItem(planId: string, id: string, kind: ItemKind, sort: number, more: Partial<Item> = {}): Item {
  return {
    id,
    planId,
    kind,
    cueId: null,
    sort,
    title: '',
    role: '',
    person: '',
    personId: null,
    phone: '',
    email: '',
    callTime: '',
    day: '',
    qty: null,
    amount: null,
    actual: null,
    status: kind === 'gear' ? 'Needed' : '',
    done: false,
    notes: '',
    updatedAt: 0,
    updatedBy: '',
    ...more,
  };
}

/** One list, in order: crew by call time then name; tasks open first, by due date; the rest by their order. */
export function listOf(items: readonly Item[], kind: ItemKind, cueId?: string | null): Item[] {
  const list = items.filter((i) => i.kind === kind && (cueId === undefined || i.cueId === cueId));
  const bySort = (a: Item, b: Item) => a.sort - b.sort || (a.id < b.id ? -1 : 1);
  if (kind === 'crew') {
    return list.sort((a, b) => {
      const ta = parseClock(a.callTime) ?? Infinity;
      const tb = parseClock(b.callTime) ?? Infinity;
      return (a.day || '9999').localeCompare(b.day || '9999') || ta - tb || a.title.localeCompare(b.title) || bySort(a, b);
    });
  }
  if (kind === 'task') return list.sort((a, b) => Number(a.done) - Number(b.done) || (a.day || '9999').localeCompare(b.day || '9999') || bySort(a, b));
  return list.sort(bySort);
}

/** Budget totals (estimate, actual, and actual minus estimate). */
export function budgetTotals(items: readonly Item[]): { estimate: number; actual: number; diff: number } {
  let estimate = 0;
  let actual = 0;
  for (const i of items) {
    if (i.kind !== 'budget') continue;
    estimate += (i.amount ?? 0) * (i.qty ?? 1);
    actual += i.actual ?? 0;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { estimate: r(estimate), actual: r(actual), diff: r(actual - estimate) };
}

/** $1,250.00 */
export const dollars = (n: number | null): string =>
  n === null ? '' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1,250.50", "$1250", "1250" → 1250.5; '' → null; anything else → undefined (not a number). */
export function parseMoney(text: string): number | null | undefined {
  const t = text.trim().replace(/[$,\s]/g, '');
  if (!t) return null;
  if (!/^-?\d+(\.\d{0,2})?$/.test(t)) return undefined;
  return Number(t);
}

/** Tasks done, of all (for one cue, or the plan). */
export function taskCount(items: readonly Item[], cueId?: string): { done: number; all: number } {
  const tasks = items.filter((i) => i.kind === 'task' && (cueId === undefined || i.cueId === cueId));
  return { done: tasks.filter((t) => t.done).length, all: tasks.length };
}

/** The crew's call times grouped for the call sheet: "3:00 PM" → names. */
export function callGroups(items: readonly Item[]): { day: string; time: string; people: Item[] }[] {
  const out: { day: string; time: string; people: Item[] }[] = [];
  for (const p of listOf(items, 'crew')) {
    const secs = parseClock(p.callTime);
    const time = secs === null ? '' : clock12(secs);
    const last = out.at(-1);
    if (last && last.day === p.day && last.time === time) last.people.push(p);
    else out.push({ day: p.day, time, people: [p] });
  }
  return out;
}
