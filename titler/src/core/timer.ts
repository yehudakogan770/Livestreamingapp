// Timer fields: a game clock, shot clock, countdown or stopwatch that runs
// inside the title (in Lumora, in Studio, and in exported templates with no
// Lumora around). A timer's value is text:
//
//   "10:00"                stopped at 10:00 (also "600", "1:02:03", "45.5")
//   "600@1760000000000"    600 s when it started running, at that time (ms
//                          since 1970): every screen shows the same time
//
// With "starts when taken", a stopped timer runs from the moment the graphic
// is taken (the render's clock), for titles that count by themselves.

import type { Variable } from './types';

export type TimerFormat = NonNullable<NonNullable<Variable['timer']>['format']>;

export interface TimerState {
  /** Seconds shown when it started (or now, when stopped). */
  secs: number;
  /** Running since (ms since 1970), or null when stopped. */
  since: number | null;
}

/** "10:00", "1:02:03", "45.5" or "600" as seconds (NaN when it is none of these). */
export function parseClock(text: string): number {
  const t = text.trim();
  if (!t) return NaN;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = /^(-)?(?:(\d+):)?(\d{1,3}):(\d{1,2}(?:\.\d+)?)$/.exec(t);
  if (!m) return NaN;
  const secs = Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
  return m[1] ? -secs : secs;
}

export function parseTimer(raw: string): TimerState {
  const at = raw.lastIndexOf('@');
  if (at > 0) {
    const secs = parseClock(raw.slice(0, at));
    const since = Number(raw.slice(at + 1));
    if (Number.isFinite(secs) && Number.isFinite(since)) return { secs, since };
  }
  const secs = parseClock(raw);
  return { secs: Number.isFinite(secs) ? secs : 0, since: null };
}

/** Seconds a timer shows now (`clock`: seconds since the graphic was taken, for timers that start when taken). */
export function timerSeconds(v: Pick<Variable, 'timer' | 'value'>, raw: string, nowMs: number, clock: number | null): number {
  const s = parseTimer(raw);
  const dir = v.timer?.dir === 'up' ? 1 : -1;
  let passed = 0;
  if (s.since !== null) passed = Math.max(0, (nowMs - s.since) / 1000);
  else if (v.timer?.auto && clock !== null) passed = Math.max(0, clock);
  let secs = s.secs + dir * passed;
  const stop = v.timer?.stop ?? (dir < 0 ? 0 : undefined);
  if (stop !== undefined) secs = dir < 0 ? Math.max(stop, secs) : Math.min(stop, secs);
  return secs;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Seconds as the timer shows them. Counting down, a part second shows as the next whole one (10:00 for 599.4). */
export function formatClock(secs: number, format: TimerFormat = 'm:ss', down = true): string {
  const neg = secs < 0;
  let s = Math.abs(secs);
  if (format === 'm:ss.t' || format === 'ss.t') {
    const tenths = Math.floor(s * 10 + 1e-6);
    const whole = Math.floor(tenths / 10);
    const t = tenths % 10;
    if (format === 'ss.t') return `${neg ? '-' : ''}${whole}.${t}`;
    return `${neg ? '-' : ''}${Math.floor(whole / 60)}:${pad(whole % 60)}.${t}`;
  }
  s = down ? Math.ceil(s - 1e-6) : Math.floor(s + 1e-6);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const sign = neg ? '-' : '';
  switch (format) {
    case 'ss':
      return `${sign}${s}`;
    case 'mm:ss':
      return `${sign}${pad(Math.floor(s / 60))}:${pad(r)}`;
    case 'h:mm:ss':
      return `${sign}${h}:${pad(m)}:${pad(r)}`;
    default:
      return `${sign}${Math.floor(s / 60)}:${pad(r)}`;
  }
}

/** The timer's text now. */
export function timerText(v: Pick<Variable, 'timer' | 'value'>, raw: string, nowMs: number, clock: number | null): string {
  return formatClock(timerSeconds(v, raw, nowMs, clock), v.timer?.format, v.timer?.dir !== 'up');
}

export const timerRunning = (raw: string) => parseTimer(raw).since !== null;

/** The operator's buttons: the timer's new value. */
export function timerCommand(v: Pick<Variable, 'timer' | 'value'>, raw: string, cmd: 'start' | 'stop' | 'toggle' | 'reset' | 'add', nowMs: number, amount = 0): string {
  const s = parseTimer(raw);
  const shown = timerSeconds({ ...v, timer: v.timer ? { ...v.timer, auto: false } : v.timer }, raw, nowMs, null);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  switch (cmd) {
    case 'start':
      return s.since !== null ? raw : `${round(shown)}@${nowMs}`;
    case 'stop':
      return s.since === null ? raw : String(round(shown));
    case 'toggle':
      return s.since !== null ? String(round(shown)) : `${round(shown)}@${nowMs}`;
    case 'reset':
      return String(round(parseTimer(v.value).secs));
    case 'add':
      return s.since !== null ? `${round(shown + amount)}@${nowMs}` : String(round(shown + amount));
  }
}
