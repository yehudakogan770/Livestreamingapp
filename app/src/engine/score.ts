// Scoreboards (mirrors crates/engine/src/score.rs).

import type { GameClock } from './types/GameClock';
import type { Scoreboard } from './types/Scoreboard';

export function defaultScoreboard(): Scoreboard {
  return {
    home: { name: 'Home', short: 'HOM', color: '#2f80ed', score: 0 },
    away: { name: 'Away', short: 'AWY', color: '#e0473b', score: 0 },
    period: '1st',
    clock: { countDown: false, lengthMs: 45 * 60 * 1000, runMs: 0, since: null },
    showClock: true,
    style: 'bug',
    title: '',
    link: { homeName: '', homeScore: '', awayName: '', awayScore: '', period: '' },
  };
}

export const clockElapsed = (c: GameClock, now: number) => c.runMs + (c.since === null ? 0 : Math.max(0, now - c.since));

/** What the clock shows at `now`, ms. */
export const clockShown = (c: GameClock, now: number) => (c.countDown ? Math.max(0, c.lengthMs - clockElapsed(c, now)) : clockElapsed(c, now));

export function runClock(c: GameClock, on: boolean, now: number): void {
  if (on && c.since === null) c.since = now;
  else if (!on && c.since !== null) {
    c.runMs = clockElapsed(c, now);
    c.since = null;
  }
}

export function setClock(c: GameClock, ms: number, now: number): void {
  c.runMs = c.countDown ? Math.max(0, c.lengthMs - ms) : ms;
  if (c.since !== null) c.since = now;
}

/** mm:ss (and tenths in the last minute of a countdown). */
export function formatGameClock(ms: number, countDown: boolean): string {
  if (countDown && ms < 60_000) return `${Math.floor(ms / 1000)}.${Math.floor((ms % 1000) / 100)}`;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function repairScoreboard(sb: Scoreboard): void {
  for (const [t, d] of [
    [sb.home, '#2f80ed'],
    [sb.away, '#e0473b'],
  ] as const) {
    t.name = [...t.name].slice(0, 40).join('');
    t.short = [...t.short].slice(0, 4).join('');
    if (!/^#[0-9a-fA-F]{6}$/.test(t.color)) t.color = d;
    t.score = Math.min(9999, Math.max(-999, Math.trunc(t.score)));
  }
  sb.period = [...sb.period].slice(0, 20).join('');
  sb.title = [...sb.title].slice(0, 80).join('');
  sb.clock.lengthMs = Math.min(24 * 3_600_000, sb.clock.lengthMs);
}
