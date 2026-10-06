// The backup lineup (automatic failover): when the input on air loses its
// picture, the next input in the lineup that still has one goes on air by
// itself. The plan is kept with the event (crates/engine/src/event.rs); the
// watching and switching happen here, in the control window, where the
// pictures arrive. Pure: the clock and what is down are passed in, so every
// rule can be tested without cameras.

import type { Action } from './types/Action';
import type { Backup } from './types/Backup';
import type { ScreenId } from './types/ScreenId';
import type { Show } from './types/Show';
import type { Source } from './types/Source';

/** A take by the operator this recent is never overruled. */
export const MANUAL_GRACE_MS = 3000;
/** At most one automatic switch per screen this often (no ping-pong). */
export const SWITCH_GAP_MS = 2000;
/** An input that lost its picture this recently is not switched to. */
export const RECENT_FAIL_MS = 5000;
/** A lost input counts as back once its picture has been steady this long. */
export const BACK_STEADY_MS = 2000;

export function defaultBackup(): Backup {
  return { on: true, lineup: [], lostAfterMs: 1500, fadeMs: 0, switchBack: false, screens: ['live', 'back'] };
}

/** Within limits, like the engine's `Backup::cleaned`. */
export function cleanBackup(b: Backup): Backup {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));
  return {
    on: b.on,
    lineup: [...new Set(b.lineup.filter((id) => id.trim()))].slice(0, 32),
    lostAfterMs: clamp(b.lostAfterMs, 500, 10_000),
    fadeMs: clamp(b.fadeMs, 0, 2000),
    switchBack: b.switchBack,
    screens: [...new Set(b.screens)],
  };
}

/** The event's backup plan (older shows without one get the default). */
export const backupOf = (show: Show): Backup => show.event.backup ?? defaultBackup();

/** Inputs that make a picture of their own and can lose it (what the lineup watches). */
export const LIVE_KINDS: ReadonlySet<Source['kind']['type']> = new Set(['camera', 'stream', 'screen', 'guest']);

/** Inputs that can stand in for another: anything with a picture (not sound or overlays). */
export function canStandIn(src: Source): boolean {
  const k = src.kind.type;
  if (k === 'microphone') return false;
  if (k === 'video' && /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(src.kind.path)) return false;
  return true;
}

/** The input showing the event's logo, if there is one. */
export function logoInput(show: Show): Source | null {
  const logo = show.event.logo;
  if (!logo) return null;
  return show.sources.find((s) => s.kind.type === 'image' && s.kind.path === logo) ?? null;
}

/** The automatic lineup: the cameras (and live streams) in input order, then the logo. */
export function automaticLineup(show: Show): string[] {
  const live = show.sources.filter((s) => LIVE_KINDS.has(s.kind.type) && s.kind.type !== 'guest').map((s) => s.id);
  const logo = logoInput(show);
  return logo ? [...live, logo.id] : live;
}

/** The lineup in use: the operator's own (inputs that still exist), or the automatic one. */
export function lineupOf(show: Show): string[] {
  const b = backupOf(show);
  if (!b.lineup.length) return automaticLineup(show);
  return b.lineup.filter((id) => show.sources.some((s) => s.id === id && canStandIn(s)));
}

/** Is the lineup doing anything (on, and something to switch to)? */
export function lineupActive(show: Show): boolean {
  return backupOf(show).on && lineupOf(show).length >= 2;
}

/** The screens it looks after now (the Back Screen while it follows Live is looked after through Live). */
export function watchedScreens(show: Show): ScreenId[] {
  return backupOf(show).screens.filter((sc) => !(sc === 'back' && show.backFollowsLive));
}

const allowedOn = (src: Source, screen: ScreenId) => screen === 'monitor' || !src.screens?.length || src.screens.includes(screen);

/**
 * The input to switch to when `from` is lost on `screen`: the ones after it in
 * the lineup, then the ones before it, skipping anything down, anything that
 * lost its picture moments ago, and anything not meant for that screen.
 */
export function nextInLineup(
  show: Show,
  screen: ScreenId,
  from: string | null,
  down: ReadonlySet<string>,
  wentDown: ReadonlyMap<string, number>,
  now: number,
): string | null {
  const lineup = lineupOf(show);
  const at = from === null ? -1 : lineup.indexOf(from);
  const order = at >= 0 ? [...lineup.slice(at + 1), ...lineup.slice(0, at)] : lineup;
  for (const id of order) {
    if (id === from || down.has(id)) continue;
    const lost = wentDown.get(id);
    if (lost !== undefined && now - lost < RECENT_FAIL_MS) continue;
    const src = show.sources.find((s) => s.id === id);
    if (!src || !allowedOn(src, screen)) continue;
    return id;
  }
  return null;
}

export type NoticeKind =
  /** `from` lost its picture; `to` went on air instead. */
  | 'switched'
  /** `from` lost its picture and nothing in the lineup has one: the logo shows. */
  | 'allDown'
  /** `from` has its picture again (the operator decides whether to take it). */
  | 'back'
  /** `from` has its picture again and was taken back by itself. */
  | 'switchedBack';

export interface Notice {
  kind: NoticeKind;
  screen: ScreenId;
  from: string;
  to: string | null;
  /** The clock this was decided at (the same clock passed to `step`). */
  at: number;
}

export interface StepResult {
  actions: Action[];
  notices: Notice[];
}

const take = (screen: ScreenId, id: string, fadeMs: number): Action =>
  fadeMs > 0 ? { type: 'playNow', screen, sourceId: id, transition: { kind: 'fade', durationMs: fadeMs } } : { type: 'cutTo', screen, sourceId: id };

/**
 * The failover itself. Call `step` with the show, what is down and the time,
 * whenever any of them changes (and a few times a second); dispatch the
 * actions it gives and show the notices.
 */
export class Failover {
  private lastProgram = new Map<ScreenId, string | null>();
  /** What an automatic switch put on air (to tell it from the operator's takes). */
  private expected = new Map<ScreenId, string>();
  private manualAt = new Map<ScreenId, number>();
  private autoAt = new Map<ScreenId, number>();
  private down = new Set<string>();
  /** When each input last lost its picture. */
  readonly wentDown = new Map<string, number>();
  /** When each input got its picture back. */
  private upSince = new Map<string, number>();
  /** Inputs lost while on air, waiting to come back (per screen). */
  private waiting = new Map<ScreenId, { id: string; at: number }[]>();
  /** Inputs already reported as "nothing to switch to" (said once). */
  private stranded = new Map<ScreenId, string>();

  /** The operator took something on this screen (also noticed from the show by itself). */
  manualTake(screen: ScreenId, now: number): void {
    this.manualAt.set(screen, now);
  }

  /** Inputs that were lost on air and are not back yet, by screen. */
  lostOnAir(screen: ScreenId): string[] {
    return (this.waiting.get(screen) ?? []).map((w) => w.id);
  }

  step(show: Show, down: ReadonlySet<string>, now: number): StepResult {
    const actions: Action[] = [];
    const notices: Notice[] = [];
    for (const id of down) if (!this.down.has(id)) this.wentDown.set(id, now);
    for (const id of this.down) if (!down.has(id)) this.upSince.set(id, now);
    this.down = new Set(down);

    // Who changed what is on air: an automatic switch, or the operator.
    for (const sc of ['live', 'back', 'monitor'] as const) {
      const p = show.screens[sc].program;
      if (this.lastProgram.has(sc) && this.lastProgram.get(sc) !== p) {
        if (this.expected.get(sc) === p) this.expected.delete(sc);
        else {
          this.manualAt.set(sc, now);
          this.expected.delete(sc);
        }
      }
      this.lastProgram.set(sc, p);
    }

    const b = backupOf(show);
    if (!b.on) {
      this.waiting.clear();
      this.stranded.clear();
      return { actions, notices };
    }
    const recent = (m: Map<ScreenId, number>, sc: ScreenId, ms: number) => {
      const t = m.get(sc);
      return t !== undefined && now - t < ms;
    };

    for (const sc of watchedScreens(show)) {
      const state = show.screens[sc];
      const p = state.program;
      // The operator took a lost input back by hand: nothing to offer any more.
      const wait = (this.waiting.get(sc) ?? []).filter((w) => !(w.id === p && !down.has(p)));
      this.waiting.set(sc, wait);
      if (this.stranded.get(sc) !== p || (p !== null && !down.has(p))) this.stranded.delete(sc);

      if (p !== null && down.has(p) && !show.panic) {
        if (recent(this.manualAt, sc, MANUAL_GRACE_MS) || recent(this.autoAt, sc, SWITCH_GAP_MS)) continue;
        const next = nextInLineup(show, sc, p, down, this.wentDown, now);
        if (next) {
          actions.push(take(sc, next, b.fadeMs));
          this.expected.set(sc, next);
          this.autoAt.set(sc, now);
          if (!wait.some((w) => w.id === p)) wait.push({ id: p, at: now });
          notices.push({ kind: 'switched', screen: sc, from: p, to: next, at: now });
        } else if (this.stranded.get(sc) !== p) {
          this.stranded.set(sc, p);
          if (!wait.some((w) => w.id === p)) wait.push({ id: p, at: now });
          notices.push({ kind: 'allDown', screen: sc, from: p, to: null, at: now });
        }
        continue;
      }

      // Lost inputs that have their picture back (steadily).
      for (const w of [...wait]) {
        if (down.has(w.id)) continue;
        const up = this.upSince.get(w.id) ?? 0;
        if (now - up < BACK_STEADY_MS) continue;
        this.waiting.set(
          sc,
          (this.waiting.get(sc) ?? []).filter((x) => x !== w),
        );
        const untouched = (this.manualAt.get(sc) ?? -Infinity) < w.at;
        if (b.switchBack && untouched && p !== w.id && !recent(this.autoAt, sc, SWITCH_GAP_MS)) {
          actions.push(take(sc, w.id, b.fadeMs));
          this.expected.set(sc, w.id);
          this.autoAt.set(sc, now);
          notices.push({ kind: 'switchedBack', screen: sc, from: w.id, to: p, at: now });
          break;
        }
        if (p !== w.id) notices.push({ kind: 'back', screen: sc, from: w.id, to: p, at: now });
      }
    }
    return { actions, notices };
  }
}
