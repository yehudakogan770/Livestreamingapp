// Lumora's Stream Deck actions: what each key sends, and when a key has to be
// held before it does anything (PANIC, going live, stopping a recording).

import type { DeckState, ScreenId } from './show';

export const PLUGIN = 'com.lumora.streamdeck';

export const KINDS = [
  'take',
  'cut',
  'blank',
  'panic',
  'input',
  'overlay',
  'preset',
  'replay',
  'record',
  'golive',
  'countdown',
  'nextcue',
  'screen',
  'rehearsal',
  'backup',
] as const;
export type Kind = (typeof KINDS)[number];

export const uuid = (kind: Kind): string => `${PLUGIN}.${kind}`;
export const kindOf = (id: string): Kind | null => {
  const k = id.startsWith(`${PLUGIN}.`) ? id.slice(PLUGIN.length + 1) : '';
  return (KINDS as readonly string[]).includes(k) ? (k as Kind) : null;
};

/** Each key's own settings (chosen in its property inspector). All optional. */
export interface KeySettings {
  [key: string]: string | boolean | undefined;
  /** Text on the key instead of the usual one. */
  label?: string;
  /** "deck" (follow the Screen key, the default), "live" or "back". */
  screen?: string;
  /** Take: the transition ("" = Lumora's own). */
  transition?: string;
  /** Blank: "blank" (black now, toggles) or "ftb" (fade to black). */
  mode?: string;
  /** Input: its id, and its name (to find it again if the id changes). */
  input?: string;
  inputName?: string;
  /** Input: "next" (press lines it up, press twice to cut) or "air" (press cuts). */
  press?: string;
  /** Overlay channel, "1" – "4". */
  channel?: string;
  /** Preset: its id, or "next" / "previous". */
  preset?: string;
  presetName?: string;
  /** Replay: seconds ("5", "10", "20", "30") and slow motion. */
  seconds?: string;
  slow?: boolean;
  /** Record: stopping needs a hold (default on). */
  holdToStop?: boolean;
  /** Countdown: its id, and "toggle" (default), "start", "pause" or "reset". */
  countdown?: string;
  countdownName?: string;
}

/** The plugin-wide settings, shared by every key. */
export interface GlobalSettings {
  [key: string]: string | undefined;
  /** Where Lumora is: "127.0.0.1:8765" (this computer) or another computer's address. */
  address?: string;
  /** The phone remote's PIN (Settings → Phone remote in Lumora). */
  pin?: string;
  /** The screen keys work on, switched by the Screen key. */
  screen?: string;
}

/** How long a key must be held for something that can't be taken back. */
export const HOLD_MS = 1000;
/** A second press this soon is a double press. */
export const DOUBLE_MS = 400;

/** Transitions a TAKE key may choose (Lumora's names). */
export const TRANSITIONS = ['cut', 'fade', 'merge', 'dip', 'wipe', 'slide', 'iris', 'zoom', 'stinger1', 'stinger2'] as const;

export function screenFor(s: KeySettings, deck: ScreenId): ScreenId {
  return s.screen === 'live' || s.screen === 'back' ? s.screen : deck;
}

/** The input a key is for: by id, else by its remembered name (an event opened again). */
export function findInput(state: DeckState, s: KeySettings) {
  return state.inputs.find((i) => i.id === s.input) ?? (s.inputName ? state.inputs.find((i) => i.name === s.inputName) : undefined);
}

export function findPreset(state: DeckState, s: KeySettings) {
  return state.presets.find((p) => p.id === s.preset) ?? (s.presetName ? state.presets.find((p) => p.name === s.presetName) : undefined);
}

export function findCountdown(state: DeckState, s: KeySettings) {
  return (
    state.countdowns.find((c) => c.id === s.countdown) ??
    (s.countdownName ? state.countdowns.find((c) => c.name === s.countdownName) : undefined) ??
    (s.countdown ? undefined : state.countdowns[0])
  );
}

export const channelOf = (s: KeySettings): number => {
  const n = Number.parseInt(s.channel ?? '1', 10);
  return n >= 1 && n <= 4 ? n : 1;
};

export const secondsOf = (s: KeySettings): number => {
  const n = Number.parseInt(s.seconds ?? '10', 10);
  return n >= 1 && n <= 60 ? n : 10;
};

/** Does this press need a hold before anything happens? */
export function needsHold(kind: Kind, s: KeySettings, state: DeckState | null): boolean {
  if (kind === 'panic' || kind === 'golive') return true;
  if (kind === 'record') return s.holdToStop !== false && !!state?.app.recording;
  return false;
}

/** What a key sends to Lumora. */
export type Request =
  | { to: 'action'; body: Record<string, unknown> }
  | { to: 'app'; body: Record<string, unknown> }
  /** The Screen key: changes which screen the other keys work on (nothing is sent). */
  | { to: 'screen'; screen: ScreenId }
  /** Nothing to do (with why, shown briefly on the key). */
  | { to: 'none'; why: string };

export type Gesture = 'press' | 'double';

/** What pressing a key does now, given the show as it is. */
export function request(kind: Kind, s: KeySettings, state: DeckState | null, deck: ScreenId, gesture: Gesture = 'press'): Request {
  const screen = screenFor(s, deck);
  if (kind === 'screen') return { to: 'screen', screen: deck === 'live' ? 'back' : 'live' };
  if (!state) return { to: 'none', why: 'offline' };
  switch (kind) {
    case 'take': {
      const body: Record<string, unknown> = { type: 'take', screen };
      if (s.transition && (TRANSITIONS as readonly string[]).includes(s.transition)) body.transition = s.transition;
      return { to: 'action', body };
    }
    case 'cut':
      return { to: 'action', body: { type: 'take', screen, transition: 'cut' } };
    case 'blank':
      return s.mode === 'ftb'
        ? { to: 'action', body: { type: 'fadeToBlack', screen } }
        : { to: 'action', body: { type: 'setBlank', screens: [screen], value: !state.screens[screen].blank } };
    case 'panic':
      return { to: 'action', body: { type: 'panic', value: !state.panic } };
    case 'input': {
      const input = findInput(state, s);
      if (!input) return { to: 'none', why: 'choose an input' };
      const toAir = s.press === 'air' || gesture === 'double';
      return toAir
        ? { to: 'action', body: { type: 'cutTo', screen, sourceId: input.id } }
        : { to: 'action', body: { type: 'setPreview', screen, sourceId: input.id } };
    }
    case 'overlay': {
      const ch = channelOf(s);
      const o = state.overlays[ch - 1];
      return { to: 'action', body: { type: 'setOverlayOn', channel: ch - 1, value: !o?.on } };
    }
    case 'preset': {
      if (s.preset === 'next') return { to: 'action', body: { type: 'nextPreset' } };
      if (s.preset === 'previous') return { to: 'action', body: { type: 'previousPreset' } };
      const p = findPreset(state, s);
      return p ? { to: 'action', body: { type: 'pickPreset', id: p.id } } : { to: 'none', why: 'choose a preset' };
    }
    case 'replay':
      // Replay keeps the last minute only once switched on: the first press switches it on.
      return state.app.replay
        ? { to: 'app', body: { command: 'replay', seconds: secondsOf(s), slow: s.slow === true } }
        : { to: 'app', body: { command: 'replayBuffer', on: true } };
    case 'record':
      return { to: 'app', body: { command: 'record', on: !state.app.recording } };
    case 'golive':
      return { to: 'app', body: { command: 'stream', on: !state.app.streaming } };
    case 'rehearsal':
      if (state.app.streaming) return { to: 'none', why: 'live now' };
      return { to: 'app', body: { command: 'rehearsal', on: !state.app.rehearsal } };
    case 'countdown': {
      const c = findCountdown(state, s);
      if (!c) return { to: 'none', why: 'no countdown' };
      const mode = s.mode === 'start' || s.mode === 'pause' || s.mode === 'reset' ? s.mode : c.running ? 'pause' : 'start';
      const type = mode === 'start' ? 'startCountdown' : mode === 'pause' ? 'pauseCountdown' : 'resetCountdown';
      return { to: 'action', body: { type, id: c.id } };
    }
    case 'nextcue':
      return state.run.cues ? { to: 'action', body: { type: 'nextCue' } } : { to: 'none', why: 'no cues' };
    case 'backup':
      return { to: 'action', body: { type: 'setBackupOn', value: !state.backup } };
  }
}
