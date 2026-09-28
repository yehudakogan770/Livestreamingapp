// A small stand-in for the Rust engine, used only when the screens are opened
// in a plain browser (design work, automated UI tests). It follows the same
// rules as crates/engine for the actions the screens use. Inside Lumora the
// real engine is always used; nothing here runs at an event.

import type { Action } from './types/Action';
import type { ActionError } from './types/ActionError';
import type { ScreenId } from './types/ScreenId';
import type { ScreenState } from './types/ScreenState';
import type { Show } from './types/Show';
import type { Source } from './types/Source';
import { countdownFinished, countdownRemaining, sourceEnded, sourcePosition } from './timing';
import type { Countdown } from './types/Countdown';

const MIN_TRANSITION_MS = 100;
const MAX_COUNTDOWN_MS = 24 * 60 * 60 * 1000;
const oneLine = (t: string, max: number) => t.split(/\s+/).filter(Boolean).join(' ').slice(0, max);

function setRemaining(c: Countdown, ms: number, now: number) {
  const v = Math.min(MAX_COUNTDOWN_MS, Math.max(0, ms));
  if (c.endsAt !== null) c.endsAt = now + v;
  else c.remainingMs = v;
  if (v > 0) c.fired = false;
}

function countdownMs(ms: number, field: string): number {
  if (!(ms > 0 && ms <= MAX_COUNTDOWN_MS))
    throw new Refused({ code: 'invalidValue', field, reason: 'must be between 1 second and 24 hours' });
  return ms;
}
const MAX_TRANSITION_MS = 10_000;

class Refused extends Error {
  constructor(readonly detail: ActionError) {
    super(detail.code);
  }
}

const clampMs = (ms: number) => Math.min(MAX_TRANSITION_MS, Math.max(MIN_TRANSITION_MS, Math.round(ms)));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function finite(v: number, field: string): number {
  if (!Number.isFinite(v)) throw new Refused({ code: 'invalidValue', field, reason: 'must be a number' });
  return v;
}

function notMonitor(screen: ScreenId) {
  if (screen === 'monitor') throw new Refused({ code: 'monitorIsTextOnly' });
}

function find(s: Show, id: string): Source {
  const src = s.sources.find((x) => x.id === id);
  if (!src) throw new Refused({ code: 'unknownSource', id });
  return src;
}

/** A source that can go on a screen (exists and is not sound only). */
function picture(s: Show, id: string): Source {
  const src = find(s, id);
  if (src.kind.type === 'microphone') throw new Refused({ code: 'soundOnly', id });
  return src;
}

function video(s: Show, id: string): Source & { kind: { type: 'video' } } {
  const src = find(s, id);
  if (src.kind.type !== 'video') throw new Refused({ code: 'notAVideo', id });
  return src as Source & { kind: { type: 'video' } };
}

function startIfVideo(s: Show, id: string, now: number) {
  if (!s.settings.autoPlayOnTake) return;
  const src = s.sources.find((x) => x.id === id);
  if (!src || src.kind.type !== 'video') return;
  const ended = sourceEnded(src, now);
  if (src.kind.playback.playing && !ended) return;
  src.kind.playback = { playing: true, posS: ended ? 0 : sourcePosition(src, now), at: now };
}

function take(s: Show, screen: ScreenId, kind: Show['transition']['kind'], durationMs: number, now: number) {
  const sc = s.screens[screen];
  const incoming = sc.preview;
  if (incoming === null) throw new Refused({ code: 'nothingInPreview', screen });
  find(s, incoming);
  const outgoing = sc.program;
  sc.previous = outgoing !== incoming ? outgoing : null;
  sc.program = incoming;
  sc.preview = outgoing ?? incoming;
  sc.transition = { kind, durationMs, startedAt: now };
  sc.tbar = 0;
  startIfVideo(s, incoming, now);
}

function sameScreen(a: ScreenState, b: ScreenState) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function followLive(s: Show, liveBefore: ScreenState, wasFollowing: boolean, now: number) {
  if (!s.backFollowsLive) return;
  const live = s.screens.live;
  const back = s.screens.back;
  if (!wasFollowing) {
    if (back.program !== live.program) {
      back.previous = back.program !== live.program ? back.program : null;
      back.program = live.program;
      back.transition = { ...s.transition, startedAt: now };
    }
    back.tbar = 0;
  } else if (!sameScreen(live, liveBefore)) {
    back.program = live.program;
    back.previous = live.previous;
    back.transition = live.transition;
    back.tbar = live.tbar;
  }
}

function nextId(s: Show): string {
  let n = s.sources.length + 1;
  while (s.sources.some((x) => x.id === `src-${n}`)) n++;
  return `src-${n}`;
}

function apply(s: Show, a: Action, now: number) {
  switch (a.type) {
    case 'addSource': {
      const id = a.source.id ?? nextId(s);
      if (s.sources.some((x) => x.id === id)) throw new Refused({ code: 'duplicateSource', id });
      const kind = a.source.kind.type === 'video' ? { ...a.source.kind, playback: { playing: false, posS: 0, at: 0 } } : a.source.kind;
      s.sources.push({
        id,
        name: a.source.name.trim() || 'Untitled',
        kind,
        volume: clamp01(a.source.volume ?? 1),
        muted: a.source.muted ?? false,
        looping: a.source.looping ?? false,
        fit: a.source.fit ?? 'contain',
        audio: {
          ...(a.source.audio ?? { follow: kind.type !== 'microphone', toMaster: true, toA: true, toB: true, delayMs: 0 }),
          delayMs: Math.min(5000, Math.max(0, a.source.audio?.delayMs ?? 0)),
        },
      });
      return;
    }
    case 'updateSource': {
      const src = find(s, a.id);
      const p = a.patch;
      if (p.name !== undefined) src.name = p.name.trim() || 'Untitled';
      if (p.volume !== undefined) src.volume = clamp01(finite(p.volume, 'volume'));
      if (p.muted !== undefined) src.muted = p.muted;
      if (p.looping !== undefined) src.looping = p.looping;
      if (p.fit !== undefined) src.fit = p.fit;
      if (p.audio !== undefined) {
        const q = p.audio;
        const au = src.audio;
        if (q.follow !== undefined) au.follow = q.follow;
        if (q.toMaster !== undefined) au.toMaster = q.toMaster;
        if (q.toA !== undefined) au.toA = q.toA;
        if (q.toB !== undefined) au.toB = q.toB;
        if (q.delayMs !== undefined) au.delayMs = Math.min(5000, Math.max(0, q.delayMs));
      }
      if (p.color !== undefined) {
        if (src.kind.type !== 'color')
          throw new Refused({ code: 'invalidValue', field: 'color', reason: 'only colour sources have a colour' });
        src.kind.color = p.color;
      }
      return;
    }
    case 'removeSource': {
      find(s, a.id);
      s.sources = s.sources.filter((x) => x.id !== a.id);
      if (s.audio.solo === a.id) s.audio.solo = null;
      if (s.countdown.atZero.type === 'cutTo' && s.countdown.atZero.sourceId === a.id) s.countdown.atZero = { type: 'hold' };
      for (const sc of Object.values(s.screens)) {
        if (sc.preview === a.id) sc.preview = null;
        if (sc.program === a.id) sc.program = null;
        if (sc.previous === a.id) sc.previous = null;
      }
      return;
    }
    case 'moveSource': {
      const from = s.sources.findIndex((x) => x.id === a.id);
      if (from < 0) throw new Refused({ code: 'unknownSource', id: a.id });
      const [src] = s.sources.splice(from, 1);
      s.sources.splice(Math.min(a.index, s.sources.length), 0, src!);
      return;
    }
    case 'setPreview':
      notMonitor(a.screen);
      if (a.sourceId !== null) picture(s, a.sourceId);
      s.screens[a.screen].preview = a.sourceId;
      s.screens[a.screen].tbar = 0;
      return;
    case 'take':
      notMonitor(a.screen);
      take(s, a.screen, a.transition ?? s.transition.kind, clampMs(a.durationMs ?? s.transition.durationMs), now);
      return;
    case 'cutTo': {
      notMonitor(a.screen);
      picture(s, a.sourceId);
      const keep = s.screens[a.screen].preview;
      s.screens[a.screen].preview = a.sourceId;
      take(s, a.screen, 'cut', MIN_TRANSITION_MS, now);
      if (keep !== null) s.screens[a.screen].preview = keep;
      return;
    }
    case 'setTbar': {
      notMonitor(a.screen);
      const v = clamp01(finite(a.value, 'value'));
      const pv = s.screens[a.screen].preview;
      if (pv === null) throw new Refused({ code: 'nothingInPreview', screen: a.screen });
      if (v >= 0.999) take(s, a.screen, 'cut', MIN_TRANSITION_MS, now);
      else {
        s.screens[a.screen].tbar = v;
        if (v > 0) startIfVideo(s, pv, now);
      }
      return;
    }
    case 'setTransition':
      if (a.kind !== undefined) s.transition.kind = a.kind;
      if (a.durationMs !== undefined) s.transition.durationMs = clampMs(a.durationMs);
      return;
    case 'setBlank':
      if (a.screens.length === 0) throw new Refused({ code: 'invalidValue', field: 'screens', reason: 'choose at least one screen' });
      for (const id of a.screens) {
        const sc = s.screens[id];
        if (sc.blank !== a.value) {
          sc.blank = a.value;
          sc.blankChangedAt = now;
        }
      }
      return;
    case 'panic':
      if (s.panic !== a.value) {
        s.panic = a.value;
        s.panicChangedAt = now;
      }
      return;
    case 'monitorFlash':
      s.screens.monitor.flashAt = now;
      return;
    case 'play':
    case 'pause': {
      const src = video(s, a.id);
      const playing = a.type === 'play';
      const ended = sourceEnded(src, now);
      if (src.kind.playback.playing === playing && !(playing && ended)) return;
      src.kind.playback = { playing, posS: playing && ended ? 0 : sourcePosition(src, now), at: now };
      return;
    }
    case 'seek': {
      const src = video(s, a.id);
      const d = src.kind.durationS;
      const pos = Math.max(0, Math.min(d > 0 ? d : Infinity, finite(a.posS, 'posS')));
      src.kind.playback = { playing: src.kind.playback.playing, posS: pos, at: now };
      return;
    }
    case 'setDuration': {
      const d = finite(a.durationS, 'durationS');
      if (d <= 0) throw new Refused({ code: 'invalidValue', field: 'durationS', reason: 'must be more than zero' });
      video(s, a.id).kind.durationS = d;
      return;
    }
    case 'setMasterMuted':
      s.audio.masterMuted = a.value;
      return;
    case 'updateBus': {
      const b = s.audio[a.bus];
      if (a.patch.name !== undefined) b.name = oneLine(a.patch.name, 24);
      if (a.patch.volume !== undefined) b.volume = clamp01(finite(a.patch.volume, 'volume'));
      if (a.patch.muted !== undefined) b.muted = a.patch.muted;
      return;
    }
    case 'setSolo':
      if (a.sourceId !== null) {
        const k = find(s, a.sourceId).kind.type;
        if (k !== 'video' && k !== 'microphone') throw new Refused({ code: 'invalidValue', field: 'sourceId', reason: 'that input has no sound' });
      }
      s.audio.solo = a.sourceId;
      return;
    case 'setAudioOutput':
      s.settings.audioOutputs[a.output] = a.deviceId ?? null;
      return;
    case 'setMasterVolume':
      s.masterVolume = clamp01(finite(a.value, 'value'));
      return;
    case 'setDisplay':
      s.settings.displays[a.screen] = a.displayId ?? null;
      return;
    case 'setBackFollowsLive':
      s.backFollowsLive = a.value;
      return;
    case 'setAutoPlayOnTake':
      s.settings.autoPlayOnTake = a.value;
      return;
    case 'updateMonitor': {
      const p = a.patch;
      const m = s.monitor;
      if (p.message !== undefined) m.message = oneLine(p.message, 200);
      if (p.messageOn !== undefined) m.messageOn = p.messageOn;
      if (p.layout !== undefined) m.layout = p.layout;
      if (p.showClock !== undefined) m.showClock = p.showClock;
      if (p.showTimer !== undefined) m.showTimer = p.showTimer;
      if (p.textSize !== undefined) m.textSize = p.textSize;
      if (p.clock24h !== undefined) m.clock24h = p.clock24h;
      return;
    }
    case 'setQuickMessage':
      if (a.index < 0 || a.index >= 8)
        throw new Refused({ code: 'invalidValue', field: 'index', reason: 'there are 8 quick messages (0 – 7)' });
      s.monitor.quick[a.index] = oneLine(a.text, 60);
      return;
    case 'updateCountdown': {
      const p = a.patch;
      const c = s.countdown;
      if (p.atZero?.type === 'cutTo') picture(s, p.atZero.sourceId);
      if (p.label !== undefined) c.label = oneLine(p.label, 60);
      if (p.endText !== undefined) c.endText = oneLine(p.endText, 60);
      if (p.onLive !== undefined) c.onLive = p.onLive;
      if (p.onBack !== undefined) c.onBack = p.onBack;
      if (p.format !== undefined) c.format = p.format;
      if (p.atZero !== undefined) c.atZero = p.atZero;
      return;
    }
    case 'setCountdownLength': {
      const c = s.countdown;
      c.lengthMs = countdownMs(a.lengthMs, 'lengthMs');
      c.endsAt = null;
      c.remainingMs = c.lengthMs;
      c.fired = false;
      return;
    }
    case 'startCountdown': {
      const c = s.countdown;
      if (c.endsAt !== null) return;
      if (c.remainingMs === 0) c.remainingMs = c.lengthMs;
      c.endsAt = now + c.remainingMs;
      c.fired = false;
      return;
    }
    case 'pauseCountdown':
      s.countdown.remainingMs = countdownRemaining(s.countdown, now);
      s.countdown.endsAt = null;
      return;
    case 'resetCountdown':
      s.countdown.endsAt = null;
      s.countdown.remainingMs = s.countdown.lengthMs;
      s.countdown.fired = false;
      return;
    case 'addCountdownTime':
      if (Math.abs(a.ms) > MAX_COUNTDOWN_MS) throw new Refused({ code: 'invalidValue', field: 'ms', reason: 'at most 24 hours at a time' });
      setRemaining(s.countdown, countdownRemaining(s.countdown, now) + a.ms, now);
      return;
    case 'setCountdownRemaining':
      setRemaining(s.countdown, a.ms, now);
      return;
    case 'countdownTo': {
      if (a.at <= now) throw new Refused({ code: 'invalidValue', field: 'at', reason: 'that time has already passed' });
      const left = countdownMs(a.at - now, 'at');
      Object.assign(s.countdown, { lengthMs: left, remainingMs: left, endsAt: a.at, fired: false });
      return;
    }
  }
}

/** Let time pass (mirrors Engine::tick): runs the countdown's at-zero action once. */
export function demoTick(show: Show, now: number): Show | null {
  const c = show.countdown;
  if (c.fired || !countdownFinished(c, now)) return null;
  const next = structuredClone(show);
  const liveBefore = structuredClone(show.screens.live);
  next.countdown.fired = true;
  const z = next.countdown.atZero;
  if (z.type === 'blank') {
    const screens: ('live' | 'back')[] = [];
    if (c.onLive) screens.push('live');
    if (c.onBack) screens.push('back');
    for (const id of screens.length ? screens : (['live', 'back'] as const)) {
      if (!next.screens[id].blank) {
        next.screens[id].blank = true;
        next.screens[id].blankChangedAt = now;
      }
    }
  } else if (z.type === 'cutTo' && next.sources.some((x) => x.id === z.sourceId)) {
    try {
      apply(next, { type: 'cutTo', screen: 'live', sourceId: z.sourceId }, now);
    } catch {
      // Nothing to do: the countdown still counts as finished.
    }
  }
  followLive(next, liveBefore, show.backFollowsLive, now);
  return next;
}

/** Apply an action to a copy of the show. Returns the new show, or throws the engine's refusal. */
export function demoApply(show: Show, action: Action, now: number): Show {
  const next = structuredClone(show);
  const liveBefore = structuredClone(show.screens.live);
  const wasFollowing = show.backFollowsLive;
  // Switching the Back Screen by hand means the operator wants it back.
  if ((action.type === 'take' || action.type === 'cutTo' || action.type === 'setTbar') && action.screen === 'back') {
    next.backFollowsLive = false;
  }
  try {
    apply(next, action, now);
  } catch (e) {
    if (e instanceof Refused) throw e.detail;
    throw e;
  }
  followLive(next, liveBefore, wasFollowing, now);
  return next;
}
