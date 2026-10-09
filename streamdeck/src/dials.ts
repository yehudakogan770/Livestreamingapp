// Stream Deck + dials (and their touch strip): the T-bar on a dial, and sound
// faders for the Stream mix, mixes A and B, or one input. What turning,
// pushing and touching send, and what the strip shows.

import { screenFor, type Request } from './actions';
import type { Connection } from './protocol';
import type { DeckLevel, DeckState, ScreenId } from './show';

export const DIAL_KINDS = ['tbar', 'fader'] as const;
export type DialKind = (typeof DIAL_KINDS)[number];

export const isDialKind = (k: string): k is DialKind => (DIAL_KINDS as readonly string[]).includes(k);

/** Each dial's own settings (chosen in its property inspector). */
export interface DialSettings {
  [key: string]: string | boolean | undefined;
  /** T-bar: "deck" (follow the Screen key), "live" or "back". */
  screen?: string;
  /** Fader: "master" (the default), "a", "b", or an input's id. */
  target?: string;
  /** Fader: the input's name (to find it again if the id changes). */
  targetName?: string;
  /** How far one click of the dial moves: "1", "2" (the default) or "5" (%). */
  step?: string;
}

/** One click of the dial, as a fraction. */
export function stepOf(s: DialSettings, kind: DialKind): number {
  const n = Number.parseInt(s.step ?? '', 10);
  if (n === 1 || n === 2 || n === 5) return n / 100;
  return kind === 'tbar' ? 0.04 : 0.02;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const round = (n: number): number => Math.round(n * 1000) / 1000;

type Target = { kind: 'master' | 'a' | 'b'; level: DeckLevel; name: string } | { kind: 'input'; id: string; level: DeckLevel; name: string };

/** What a fader dial controls, as it is now. */
export function faderTarget(state: DeckState, s: DialSettings): Target | null {
  const t = s.target ?? 'master';
  if (t === '' || t === 'master') return { kind: 'master', level: state.audio.master, name: 'Stream' };
  if (t === 'a') return { kind: 'a', level: state.audio.a, name: 'Mix A' };
  if (t === 'b') return { kind: 'b', level: state.audio.b, name: 'Mix B' };
  const input = state.inputs.find((i) => i.id === t) ?? (s.targetName ? state.inputs.find((i) => i.name === s.targetName) : undefined);
  return input ? { kind: 'input', id: input.id, level: { volume: input.volume, muted: input.muted }, name: input.name } : null;
}

function setVolume(t: Target, volume: number): Request {
  const v = round(clamp01(volume));
  if (t.kind === 'master') return { to: 'action', body: { type: 'setMasterVolume', value: v } };
  if (t.kind === 'input') return { to: 'action', body: { type: 'updateSource', id: t.id, patch: { volume: v } } };
  return { to: 'action', body: { type: 'updateBus', bus: t.kind, patch: { volume: v } } };
}

function setMuted(t: Target, muted: boolean): Request {
  if (t.kind === 'master') return { to: 'action', body: { type: 'setMasterMuted', value: muted } };
  if (t.kind === 'input') return { to: 'action', body: { type: 'updateSource', id: t.id, patch: { muted } } };
  return { to: 'action', body: { type: 'updateBus', bus: t.kind, patch: { muted } } };
}

/**
 * The value a dial controls now: the T-bar's position or the sound level
 * (`pending`: a value just sent and not back from Lumora yet).
 */
export function dialValue(kind: DialKind, s: DialSettings, state: DeckState, deck: ScreenId): number | null {
  if (kind === 'tbar') return state.screens[screenFor(s, deck)].tbar;
  return faderTarget(state, s)?.level.volume ?? null;
}

/** Turning the dial by `ticks` clicks (negative: to the left), from `from` (the value now, or one just sent). */
export function dialRotate(
  kind: DialKind,
  s: DialSettings,
  state: DeckState | null,
  deck: ScreenId,
  ticks: number,
  from?: number,
): { request: Request; value: number | null } {
  if (!state) return { request: { to: 'none', why: 'offline' }, value: null };
  const step = stepOf(s, kind);
  if (kind === 'tbar') {
    const screen = screenFor(s, deck);
    const now = from ?? state.screens[screen].tbar;
    // All the way: the take completes (Lumora finishes it and the fader springs back).
    const v = clamp01(now + ticks * step);
    const value = v >= 0.995 ? 1 : round(v);
    return { request: { to: 'action', body: { type: 'setTbar', screen, value } }, value: value >= 1 ? 0 : value };
  }
  const t = faderTarget(state, s);
  if (!t) return { request: { to: 'none', why: 'choose what to control' }, value: null };
  const value = round(clamp01((from ?? t.level.volume) + ticks * step));
  return { request: setVolume(t, value), value };
}

/** Pushing the dial: T-bar: TAKE. Fader: mute or unmute. */
export function dialPush(kind: DialKind, s: DialSettings, state: DeckState | null, deck: ScreenId): Request {
  if (!state) return { to: 'none', why: 'offline' };
  if (kind === 'tbar') return { to: 'action', body: { type: 'take', screen: screenFor(s, deck) } };
  const t = faderTarget(state, s);
  return t ? setMuted(t, !t.level.muted) : { to: 'none', why: 'choose what to control' };
}

/** Touching the strip: T-bar: CUT. Fader: mute or unmute (as pushing). */
export function dialTouch(kind: DialKind, s: DialSettings, state: DeckState | null, deck: ScreenId): Request {
  if (!state) return { to: 'none', why: 'offline' };
  if (kind === 'tbar') return { to: 'action', body: { type: 'take', screen: screenFor(s, deck), transition: 'cut' } };
  return dialPush(kind, s, state, deck);
}

export interface Feedback {
  title: string;
  value: string;
  /** 0 – 100 for the bar. */
  indicator: number;
}

/** What the touch strip shows above the dial. */
export function dialFeedback(
  kind: DialKind,
  s: DialSettings,
  state: DeckState | null,
  deck: ScreenId,
  connection: Connection,
  pending: number | null = null,
): Feedback {
  if (!state || connection !== 'online') {
    const why = connection === 'wrongPin' ? 'Wrong PIN' : connection === 'off' ? 'Type the PIN' : 'Offline';
    return { title: kind === 'tbar' ? 'T-bar' : 'Fader', value: why, indicator: 0 };
  }
  if (kind === 'tbar') {
    const screen = screenFor(s, deck);
    const v = pending ?? state.screens[screen].tbar;
    return { title: `T-bar · ${screen === 'live' ? 'Live' : 'Back'}`, value: `${Math.round(v * 100)}%`, indicator: Math.round(v * 100) };
  }
  const t = faderTarget(state, s);
  if (!t) return { title: 'Fader', value: 'Choose', indicator: 0 };
  const v = pending ?? t.level.volume;
  return { title: t.name.slice(0, 14), value: t.level.muted ? 'Muted' : `${Math.round(v * 100)}%`, indicator: t.level.muted ? 0 : Math.round(v * 100) };
}
