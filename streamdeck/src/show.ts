// What the Stream Deck needs from Lumora's show: a small, flat summary of the
// show JSON the remote server sends (`event: show`), plus what the control
// window says is running (`event: app`).

export type ScreenId = 'live' | 'back';
export const SCREENS: readonly ScreenId[] = ['live', 'back'];

export interface DeckInput {
  id: string;
  /** 1-based, as numbered on Lumora's tiles. */
  number: number;
  name: string;
  /** Countdown, camera, video… */
  kind: string;
}

export interface DeckScreen {
  program: string | null;
  preview: string | null;
  blank: boolean;
}

export interface DeckOverlay {
  /** 1 – 4, as shown in Lumora. */
  channel: number;
  on: boolean;
  inNext: boolean;
  /** The name of the input in this channel. */
  name: string | null;
}

export interface DeckPreset {
  id: string;
  number: number;
  name: string;
}

export interface DeckCountdown {
  id: string;
  name: string;
  running: boolean;
  /** Lumora's clock: the moment it reaches zero (while running). */
  endsAt: number | null;
  /** Time left while paused. */
  remainingMs: number;
}

export interface DeckSlideshow {
  id: string;
  name: string;
  /** The slide showing (0-based), and how many there are. */
  current: number;
  count: number;
  /** The screen it is on air on, and the one it is in Next on (if any). */
  onAir: ScreenId | null;
  inNext: ScreenId | null;
}

export interface DeckRun {
  cues: number;
  current: number | null;
  running: boolean;
  /** The name of the cue NEXT CUE runs. */
  next: string | null;
}

/** What the control window says is running. */
export interface AppState {
  recording: boolean;
  streaming: boolean;
  rehearsal: boolean;
  /** Instant replay is keeping the last minute. */
  replay: boolean;
  /** Something being started or stopped. */
  busy: boolean;
  /** The last problem starting something, with when it happened (ms since 1970). */
  error: { message: string; at: number } | null;
}

export interface DeckState {
  inputs: DeckInput[];
  screens: Record<ScreenId, DeckScreen>;
  overlays: DeckOverlay[];
  presets: DeckPreset[];
  activePreset: string | null;
  panic: boolean;
  /** The backup lineup (automatic failover) is on. */
  backup: boolean;
  countdowns: DeckCountdown[];
  slideshows: DeckSlideshow[];
  run: DeckRun;
  app: AppState;
}

export const NO_APP: AppState = { recording: false, streaming: false, rehearsal: false, replay: false, busy: false, error: null };

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function screen(v: unknown): DeckScreen {
  const s = obj(v);
  return { program: str(s.program), preview: str(s.preview), blank: s.blank === true };
}

/** The summary of a show (`snapshot.show`), keeping what the control window last said. */
export function deckState(show: unknown, app: AppState = NO_APP): DeckState {
  const s = obj(show);
  const sources = arr(s.sources).map(obj);
  const names = new Map(sources.map((x) => [str(x.id) ?? '', str(x.name) ?? '']));
  const inputs = sources.map((x, i) => ({
    id: str(x.id) ?? '',
    number: i + 1,
    name: str(x.name) ?? `Input ${i + 1}`,
    kind: str(obj(x.kind).type) ?? '',
  }));
  const screens = obj(s.screens);
  const overlays = arr(s.overlays)
    .slice(0, 4)
    .map(obj)
    .map((o, i) => {
      const id = str(o.sourceId);
      return { channel: i + 1, on: o.on === true, inNext: o.inNext === true, name: id ? (names.get(id) ?? null) : null };
    });
  const presets = arr(s.presets)
    .map(obj)
    .map((p, i) => ({ id: str(p.id) ?? '', number: i + 1, name: str(p.name) ?? `Preset ${i + 1}` }));
  const countdowns = sources
    .filter((x) => obj(x.kind).type === 'countdown')
    .map((x) => {
      const t = obj(obj(x.kind).timer);
      const endsAt = num(t.endsAt);
      return { id: str(x.id) ?? '', name: str(x.name) ?? 'Countdown', running: endsAt !== null, endsAt, remainingMs: num(t.remainingMs) ?? 0 };
    });
  const live = screen(obj(s.screens).live);
  const back = screen(obj(s.screens).back);
  const slideshows = sources
    .filter((x) => obj(x.kind).type === 'slideshow')
    .map((x) => {
      const k = obj(x.kind);
      const id = str(x.id) ?? '';
      const count = arr(k.slides).length;
      const where = (field: 'program' | 'preview'): ScreenId | null => (live[field] === id ? 'live' : back[field] === id ? 'back' : null);
      return {
        id,
        name: str(x.name) ?? 'Slideshow',
        current: Math.min(num(k.current) ?? 0, Math.max(0, count - 1)),
        count,
        onAir: where('program'),
        inNext: where('preview'),
      };
    });
  const run = obj(s.run);
  const cues = arr(run.cues).map(obj);
  const current = num(run.current);
  const nextCue = cues[current === null ? 0 : current + 1];
  return {
    inputs,
    screens: { live: screen(screens.live), back: screen(screens.back) },
    overlays,
    presets,
    activePreset: str(s.activePreset),
    panic: s.panic === true,
    // On unless the event turned it off (older Lumora: no lineup at all).
    backup: obj(s.event).backup !== undefined && obj(obj(s.event).backup).on !== false,
    countdowns,
    slideshows,
    run: { cues: cues.length, current, running: run.running === true, next: nextCue ? (str(nextCue.name) ?? null) : null },
    app,
  };
}

/** What the control window says, read defensively. */
export function appState(v: unknown): AppState {
  const a = obj(v);
  const e = obj(a.error);
  const message = str(e.message);
  return {
    recording: a.recording === true,
    streaming: a.streaming === true,
    rehearsal: a.rehearsal === true,
    replay: a.replay === true,
    busy: a.busy === true,
    error: message ? { message, at: num(e.at) ?? 0 } : null,
  };
}

/** An input's tally on a screen. */
export function tally(state: DeckState, id: string | null, on: ScreenId): 'program' | 'preview' | 'none' {
  if (!id) return 'none';
  const sc = state.screens[on];
  if (sc.program === id) return 'program';
  if (sc.preview === id) return 'preview';
  return 'none';
}

/** Time left on a countdown at `now` (Lumora's clock), in ms. */
export function remaining(c: DeckCountdown, now: number): number {
  return c.endsAt === null ? c.remainingMs : Math.max(0, c.endsAt - now);
}

/** 83 000 ms → "1:23"; an hour or more → "1:02:03". */
export function clock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
