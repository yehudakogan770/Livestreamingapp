// Going live at a set time: the stream starts a few minutes early with the
// countdown on screen (counting to the start time); at zero the countdown
// puts on air what is lined up in Next. Kept on this computer, so a restart
// doesn't lose it.

export interface Schedule {
  /** When the event starts (ms since 1970). */
  at: number;
  /** Start streaming this many minutes before, with the countdown showing. */
  earlyMin: number;
}

const KEY = 'lumora.schedule';

export function loadSchedule(now = Date.now()): Schedule | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Schedule | null;
    // A start time long gone is forgotten.
    return s && typeof s.at === 'number' && s.at > now - 60_000 ? s : null;
  } catch {
    return null;
  }
}

export function saveSchedule(s: Schedule | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // Not kept: it still runs while Lumora stays open.
  }
}

/** The next time the clock shows "HH:MM" (today, or tomorrow if that's passed). */
export function nextAt(hhmm: string, now = new Date()): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** What should happen now: nothing yet, start the stream (with the countdown), or it's time. */
export function due(s: Schedule, now: number): 'wait' | 'start' | 'time' {
  if (now >= s.at) return 'time';
  if (now >= s.at - s.earlyMin * 60_000) return 'start';
  return 'wait';
}

/** "7:30 PM" */
export const timeText = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
