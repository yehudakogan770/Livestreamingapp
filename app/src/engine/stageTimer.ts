// The time left as the people on stage see it on the Monitor: amber when it is
// time to wrap up, red in the last minute, and after zero the time over
// (+1:05) so a speaker knows how far over they are. A bar shows how much of
// the time has gone.

import { countdownRemaining, formatCountdown } from './timing';
import type { Countdown } from './types/Countdown';
import type { Monitor } from './types/Monitor';

export type TimerTone = 'normal' | 'wrapUp' | 'urgent' | 'over' | 'paused';

export interface StageTimer {
  tone: TimerTone;
  text: string;
  /** How much of the time has gone, 0 – 1 (null: no bar). */
  gone: number | null;
}

/** The last minute is always red. */
export const URGENT_MS = 60_000;

/** m:ss (or h:mm:ss) counting up, whole seconds gone. */
export function overText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `+${h}:${String(m).padStart(2, '0')}:${ss}` : `+${m}:${ss}`;
}

export function stageTimer(c: Countdown, m: Pick<Monitor, 'wrapUpS' | 'overtime' | 'progress'>, now: number): StageTimer {
  const format = c.format === 'auto' ? 'minSec' : c.format;
  const left = countdownRemaining(c, now);
  const gone = m.progress !== false && c.lengthMs > 0 ? Math.min(1, Math.max(0, 1 - left / c.lengthMs)) : null;
  if (c.endsAt === null) return { tone: 'paused', text: formatCountdown(left, format), gone };
  if (left > 0) {
    const wrap = (m.wrapUpS ?? 120) * 1000;
    const tone: TimerTone = left <= URGENT_MS ? 'urgent' : wrap > 0 && left <= wrap ? 'wrapUp' : 'normal';
    return { tone, text: formatCountdown(left, format), gone };
  }
  // At zero: the words chosen for the end, or the time over.
  if (c.atZero.type === 'showText') return { tone: 'urgent', text: c.endText, gone };
  const over = now - c.endsAt;
  if (m.overtime !== false && over >= 1000) return { tone: 'over', text: overText(over), gone };
  return { tone: 'urgent', text: formatCountdown(0, format), gone };
}
