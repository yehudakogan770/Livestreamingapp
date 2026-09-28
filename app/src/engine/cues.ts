// Run of show (mirrors crates/engine/src/cues.rs).

import type { RunOfShow } from './types/RunOfShow';

export function emptyRun(): RunOfShow {
  return { cues: [], running: false, paused: false, current: null, cueStartedAt: 0, startedAt: 0, utcOffsetMin: 0 };
}

/** "19:30" / "19:30:15" as seconds after midnight, or null. */
export function clockSeconds(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!m) return null;
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  return h < 24 && mi < 60 && s < 60 ? h * 3600 + mi * 60 + s : null;
}

export function nextCueIndex(r: RunOfShow): number | null {
  const i = r.current === null ? 0 : r.current + 1;
  return i < r.cues.length ? i : null;
}

export function localSeconds(r: RunOfShow, now: number): number {
  const secs = Math.floor(now / 1000) + r.utcOffsetMin * 60;
  return ((secs % 86_400) + 86_400) % 86_400;
}

/** The next cue if it is time for it to run by itself. */
export function cueDue(r: RunOfShow, now: number): number | null {
  if (!r.running || r.paused) return null;
  const i = nextCueIndex(r);
  if (i === null) return null;
  const t = r.cues[i]!.trigger;
  if (t.type === 'clock') {
    const at = clockSeconds(t.time);
    const s = localSeconds(r, now);
    return at !== null && s >= at && s - at < 12 * 3600 ? i : null;
  }
  if (t.type === 'afterPrevious') {
    const len = r.current !== null ? r.cues[r.current]?.lengthMs : null;
    return len != null && now >= r.cueStartedAt + len ? i : null;
  }
  return null;
}

/** When the next cue will run by itself (ms since 1970), if it will. */
export function nextCueAt(r: RunOfShow, now: number): number | null {
  if (!r.running || r.paused) return null;
  const i = nextCueIndex(r);
  if (i === null) return null;
  const t = r.cues[i]!.trigger;
  if (t.type === 'clock') {
    const at = clockSeconds(t.time);
    if (at === null) return null;
    const s = localSeconds(r, now);
    const wait = at >= s ? at - s : at + 86_400 - s;
    return now - (now % 1000) + wait * 1000;
  }
  if (t.type === 'afterPrevious') {
    const len = r.current !== null ? r.cues[r.current]?.lengthMs : null;
    return len != null ? r.cueStartedAt + len : null;
  }
  return null;
}
