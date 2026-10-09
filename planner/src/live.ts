// Show day: the plan as it runs. Who is on now and next, each cue's time left,
// and how far the show runs over or under. The state is kept on the server
// (planner_live, supabase/update-10-planner-pro.sql) and every screen works it
// out from there with the server's clock, so phones, the stage timer and the
// caller agree to the second. No network and no React here.

import { sortCues, type PlanCue } from './model';

export type LiveMode = 'show' | 'rehearsal';
export type LiveRunState = 'off' | 'running' | 'paused' | 'ended';

export interface Live {
  planId: string;
  runId: string;
  mode: LiveMode;
  state: LiveRunState;
  cueId: string | null;
  /** When the cue on now started (ms, server clock); moved later when paused or given more time. */
  cueStartedAt: number | null;
  /** When it was paused (ms), or null. */
  pausedAt: number | null;
  showStartedAt: number | null;
  message: string;
  messageOn: boolean;
  messageFlash: boolean;
  /** Who is calling it: the Planner, or Lumora running the plan's cues. */
  source: 'planner' | 'lumora';
  updatedAt: number;
  updatedBy: string;
}

export interface LiveRow {
  plan_id: string;
  run_id: string;
  mode: string;
  state: string;
  cue_id: string | null;
  cue_started_at: string | null;
  paused_at: string | null;
  show_started_at: string | null;
  message: string;
  message_on: boolean;
  message_flash: boolean;
  source?: string;
  updated_at?: string;
  updated_by_name?: string;
  server_now?: string;
}

export interface LogEntry {
  id: string;
  runId: string;
  mode: LiveMode;
  cueId: string;
  cueTitle: string;
  plannedSec: number | null;
  startedAt: number;
  endedAt: number | null;
  pausedSec: number;
}

export interface LogRow {
  id: string;
  run_id: string;
  mode: string;
  cue_id: string;
  cue_title: string;
  planned_sec: number | null;
  started_at: string;
  ended_at: string | null;
  paused_sec: number;
}

const ms = (s: string | null | undefined): number | null => (s ? Date.parse(s) || null : null);

export function liveFromRow(r: LiveRow): Live {
  return {
    planId: r.plan_id,
    runId: r.run_id,
    mode: r.mode === 'rehearsal' ? 'rehearsal' : 'show',
    state: r.state === 'running' || r.state === 'paused' || r.state === 'ended' ? r.state : 'off',
    cueId: r.cue_id,
    cueStartedAt: ms(r.cue_started_at),
    pausedAt: ms(r.paused_at),
    showStartedAt: ms(r.show_started_at),
    message: r.message ?? '',
    messageOn: r.message_on === true,
    messageFlash: r.message_flash === true,
    source: r.source === 'lumora' ? 'lumora' : 'planner',
    updatedAt: ms(r.updated_at) ?? 0,
    updatedBy: r.updated_by_name ?? '',
  };
}

export function logFromRow(r: LogRow): LogEntry {
  return {
    id: r.id,
    runId: r.run_id,
    mode: r.mode === 'rehearsal' ? 'rehearsal' : 'show',
    cueId: r.cue_id,
    cueTitle: r.cue_title ?? '',
    plannedSec: r.planned_sec,
    startedAt: ms(r.started_at) ?? 0,
    endedAt: ms(r.ended_at),
    pausedSec: Number(r.paused_sec) || 0,
  };
}

export const OFF: Omit<Live, 'planId'> = {
  runId: '',
  mode: 'show',
  state: 'off',
  cueId: null,
  cueStartedAt: null,
  pausedAt: null,
  showStartedAt: null,
  message: '',
  messageOn: false,
  messageFlash: false,
  source: 'planner',
  updatedAt: 0,
  updatedBy: '',
};

/** How long a log entry ran, in seconds (pauses left out), or null while it runs. */
export function actualSec(e: LogEntry): number | null {
  if (e.endedAt === null) return null;
  return Math.max(0, Math.round((e.endedAt - e.startedAt) / 1000) - e.pausedSec);
}

/** The next cue to go after index `i` (floated cues are passed over), or -1. */
export function nextIndex(cues: readonly PlanCue[], i: number): number {
  for (let j = i + 1; j < cues.length; j++) if (!cues[j]!.skip) return j;
  return -1;
}

/** The cue before index `i` that is not floated, or -1. */
export function prevIndex(cues: readonly PlanCue[], i: number): number {
  for (let j = i - 1; j >= 0; j--) if (!cues[j]!.skip) return j;
  return -1;
}

/** The first cue to go (not floated), or -1. */
export const firstIndex = (cues: readonly PlanCue[]): number => nextIndex(cues, -1);

export interface Now {
  /** Index of the cue on now (in the sorted cues), or -1. */
  index: number;
  next: number;
  /** Seconds the cue on now has run. */
  elapsed: number;
  /** Seconds left (negative: over), or null when it has no length. */
  remaining: number | null;
  /** 0..1 of its length gone (1 when over), or null. */
  progress: number | null;
  /**
   * The whole show: seconds over (positive) or under (negative) the plan,
   * counting what has run and the planned lengths still to come; null when
   * not running.
   */
  overUnder: number | null;
  /** When the show should now finish (ms, server clock), or null. */
  projectedEnd: number | null;
  running: boolean;
  paused: boolean;
}

/**
 * Where the show is at `now` (ms on the server clock). `log`: this run's
 * entries (for what has already run).
 */
export function whereNow(live: Live | null, cues: readonly PlanCue[], now: number, log: readonly LogEntry[] = []): Now {
  const sorted = sortCues(cues);
  const none: Now = { index: -1, next: -1, elapsed: 0, remaining: null, progress: null, overUnder: null, projectedEnd: null, running: false, paused: false };
  if (!live || (live.state !== 'running' && live.state !== 'paused') || !live.cueId) {
    if (live?.state === 'ended') return none;
    return { ...none, next: firstIndex(sorted) };
  }
  const index = sorted.findIndex((c) => c.id === live.cueId);
  const started = live.cueStartedAt ?? now;
  const at = live.state === 'paused' && live.pausedAt !== null ? live.pausedAt : now;
  const elapsed = Math.max(0, Math.round((at - started) / 1000));
  const cue = index >= 0 ? sorted[index]! : null;
  const len = cue?.durationSec ?? null;
  const remaining = len === null ? null : len - elapsed;
  const progress = len === null || len === 0 ? null : Math.min(1, elapsed / len);
  const next = index >= 0 ? nextIndex(sorted, index) : -1;

  // Planned: from the show's start, every cue (not floated) up to the one on
  // now, at its planned length. Actual: the time since the show started.
  let overUnder: number | null = null;
  let projectedEnd: number | null = null;
  if (index >= 0 && live.showStartedAt !== null) {
    const runIds = new Set(log.filter((e) => e.runId === live.runId).map((e) => e.cueId));
    const firstRun = sorted.findIndex((c) => runIds.has(c.id));
    const from = firstRun >= 0 && firstRun <= index ? firstRun : index;
    let plannedBefore = 0;
    for (let j = from; j < index; j++) if (!sorted[j]!.skip) plannedBefore += sorted[j]!.durationSec ?? 0;
    const pausedTotal = log.filter((e) => e.runId === live.runId).reduce((a, e) => a + e.pausedSec, 0);
    const actualBefore = Math.max(0, Math.round((started - live.showStartedAt) / 1000) - pausedTotal);
    const currentOver = len === null ? 0 : Math.max(0, elapsed - len);
    overUnder = actualBefore - plannedBefore + currentOver;
    let later = 0;
    for (let j = index + 1; j < sorted.length; j++) if (!sorted[j]!.skip) later += sorted[j]!.durationSec ?? 0;
    projectedEnd = now + (Math.max(0, remaining ?? 0) + later) * 1000;
  }
  return { index, next, elapsed, remaining, progress, overUnder, projectedEnd, running: live.state === 'running', paused: live.state === 'paused' };
}

/** "+2:05 over", "0:40 under", "On time". */
export function overUnderWords(secs: number | null): string {
  if (secs === null) return '';
  const a = Math.abs(Math.round(secs));
  if (a < 5) return 'On time';
  const m = Math.floor(a / 60);
  const s = a % 60;
  const t = m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return secs > 0 ? `${t} over` : `${t} under`;
}

/** A countdown as shown on the timers: "4:59", "0:03", "−1:20" (over), "1:02:00". */
export function timerText(secs: number): string {
  const neg = secs < 0;
  const a = Math.abs(secs);
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const s = a % 60;
  const body = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return neg ? `−${body}` : body;
}

/** The stage timer's color: plenty of time, wrap up (the last minute, or the last 10% of a long cue), over. */
export function timerTone(remaining: number | null, len: number | null): 'ok' | 'wrap' | 'over' {
  if (remaining === null) return 'ok';
  if (remaining < 0) return 'over';
  const wrap = len ? Math.max(30, Math.min(60, len * 0.1)) : 60;
  return remaining <= wrap ? 'wrap' : 'ok';
}

/** Each run (show or rehearsal), newest first, with its entries in order. */
export function runs(log: readonly LogEntry[]): { runId: string; mode: LiveMode; startedAt: number; entries: LogEntry[] }[] {
  const by = new Map<string, LogEntry[]>();
  for (const e of log) by.set(e.runId, [...(by.get(e.runId) ?? []), e]);
  return [...by.entries()]
    .map(([runId, entries]) => {
      const sorted = [...entries].sort((a, b) => a.startedAt - b.startedAt);
      return { runId, mode: sorted[0]!.mode, startedAt: sorted[0]!.startedAt, entries: sorted };
    })
    .sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * New lengths from a run: each cue it timed (finished) gets how long it really
 * ran, rounded to 5 seconds. A cue run twice gets the later time.
 */
export function lengthsFromRun(entries: readonly LogEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of [...entries].sort((a, b) => a.startedAt - b.startedAt)) {
    const s = actualSec(e);
    if (s !== null && s > 0) out.set(e.cueId, Math.max(5, Math.round(s / 5) * 5));
  }
  return out;
}

/** Seconds the server's clock is ahead of this device's, from a reading taken between `sent` and `got`. */
export function clockOffset(server: number, sent: number, got: number): number {
  return server - (sent + got) / 2;
}

/** A plain-words line for the crew: "On now: Welcome (Dana) · 3:12 left". */
export function crewLine(cues: readonly PlanCue[], n: Now): string {
  const sorted = sortCues(cues);
  if (n.index < 0) return n.next >= 0 ? `First: ${sorted[n.next]!.title.trim() || 'Untitled cue'}` : '';
  const c = sorted[n.index]!;
  const who = c.who.trim() ? ` (${c.who.trim()})` : '';
  const left = n.remaining === null ? '' : n.remaining < 0 ? ` · ${timerText(-n.remaining)} over` : ` · ${timerText(n.remaining)} left`;
  return `On now: ${c.title.trim() || 'Untitled cue'}${who}${left}`;
}

