// Which countdown input a screen or control is about. Each countdown input
// has its own timer, so the next one can be prepared while another is on air.

import type { Countdown } from './types/Countdown';
import type { ScreenId } from './types/ScreenId';
import type { Show } from './types/Show';

/** A countdown input's timer, or null if `id` is not a countdown. */
export function timerOf(show: Show, id: string | null): Countdown | null {
  const k = show.sources.find((x) => x.id === id)?.kind;
  return k?.type === 'countdown' ? k.timer : null;
}

/**
 * The countdown that matters most now (mirrors Show::main_countdown): on air
 * on Live, then Back, then any running, then the first. Used by the stage
 * monitor and by steps that don't name one.
 */
export function mainCountdown(show: Show): string | null {
  for (const sc of ['live', 'back'] as const) if (timerOf(show, show.screens[sc].program)) return show.screens[sc].program;
  const cds = show.sources.filter((x) => x.kind.type === 'countdown');
  const running = cds.find((x) => x.kind.type === 'countdown' && x.kind.timer.endsAt !== null);
  return (running ?? cds[0])?.id ?? null;
}

/**
 * The countdown the controls work on for a screen: the one in Next (being
 * prepared), else the one on air, else the main one.
 */
export function countdownTarget(show: Show, screen: ScreenId | null): { id: string; where: 'next' | 'onAir' | 'other' } | null {
  if (screen && screen !== 'monitor') {
    const sc = show.screens[screen];
    if (sc.preview !== sc.program && timerOf(show, sc.preview)) return { id: sc.preview!, where: 'next' };
    if (timerOf(show, sc.program)) return { id: sc.program!, where: 'onAir' };
  }
  const id = mainCountdown(show);
  return id ? { id, where: 'other' } : null;
}
