// A small stand-in for the Rust engine, used only when the screens are opened
// in a plain browser (design work, automated UI tests). It follows the same
// rules as crates/engine for the actions the screens use. Inside Lumora the
// real engine is always used; nothing here runs at an event.

import { defaultAdjust, defaultKey } from './chroma';
import { cueDue, nextCueIndex } from './cues';
import { nextSlideIndex, slideDue } from './slideshow';
import type { Slideshow } from './types/Slideshow';
import { applyLayout } from './split';
import { creditsPosition } from './credits';
import type { Credits } from './types/Credits';
import { repairOverlay, setOverlayOn } from './overlays';
import type { Overlay } from './types/Overlay';
import { backWord, goTo, nextWord, repairPesukim, wordDue, type PesukimData } from './pesukim';
import type { Action } from './types/Action';
import type { ActionError } from './types/ActionError';
import type { ScreenId } from './types/ScreenId';
import type { ScreenState } from './types/ScreenState';
import type { Show } from './types/Show';
import type { Source } from './types/Source';
import { countdownDue, countdownRemaining, sourceEnded, sourcePosition } from './timing';
import type { Countdown } from './types/Countdown';
import type { Preset } from './types/Preset';
import type { Step } from './types/Step';
import { mainCountdown } from './countdowns';
import * as vis from './visuals';
import { cleanUrl } from './browser';

const MIN_TRANSITION_MS = 100;
const MAX_COUNTDOWN_MS = 24 * 60 * 60 * 1000;
const oneLine = (t: string, max: number) => t.split(/\s+/).filter(Boolean).join(' ').slice(0, max);

function setRemaining(c: Countdown, ms: number, now: number) {
  const v = Math.min(MAX_COUNTDOWN_MS, Math.max(0, ms));
  if (c.endsAt !== null) c.endsAt = now + v;
  else c.remainingMs = v;
  if (v > 0) c.fired = false;
}

/** A countdown input's own timer. */
function timer(s: Show, id: string): Countdown {
  const src = find(s, id);
  if (src.kind.type !== 'countdown') throw new Refused({ code: 'invalidValue', field: 'id', reason: 'that input is not a countdown' });
  return src.kind.timer;
}

function startTimer(c: Countdown, now: number) {
  if (c.remainingMs === 0) c.remainingMs = c.lengthMs;
  c.endsAt = now + c.remainingMs;
  c.fired = false;
}

function countdownMs(ms: number, field: string): number {
  if (!(ms > 0 && ms <= MAX_COUNTDOWN_MS)) throw new Refused({ code: 'invalidValue', field, reason: 'must be between 1 second and 24 hours' });
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

function channelOf(s: Show, channel: number): Overlay {
  const o = s.overlays[channel];
  if (!o) throw new Refused({ code: 'invalidValue', field: 'channel', reason: 'overlay channels are 1 to 4' });
  return o;
}

function pesukimIn(s: Show, id: string): PesukimData {
  const src = find(s, id);
  if (src.kind.type !== 'pesukim') throw new Refused({ code: 'invalidValue', field: 'pesukim', reason: 'that input is not a 12 Pesukim input' });
  return src.kind;
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
  sc.preview = outgoing; // nothing was on air: Next is left empty
  sc.transition = { kind, durationMs, startedAt: now };
  sc.tbar = 0;
  startIfVideo(s, incoming, now);
  // A countdown waits in Next and starts counting when it goes on air.
  const k = s.sources.find((x) => x.id === incoming)?.kind;
  if (k?.type === 'countdown' && k.timer.endsAt === null) startTimer(k.timer, now);
  // Credits roll from the top when they go on air.
  if (k?.type === 'credits' && !k.playing) Object.assign(k, { playing: true, posMs: 0, at: now });
}

/** Run a cue: its steps start now, and the show carries on from it. */
function fireCue(s: Show, index: number, now: number) {
  const cue = s.run.cues[index];
  if (!cue) throw new Refused({ code: 'invalidValue', field: 'cue', reason: 'there is no such cue' });
  s.run.current = index;
  s.run.cueStartedAt = now;
  apply(s, { type: 'runSteps', name: cue.name, steps: cue.steps }, now);
}

function slideshowIn(s: Show, id: string): Slideshow {
  const src = find(s, id);
  if (src.kind.type !== 'slideshow') throw new Refused({ code: 'invalidValue', field: 'slideshow', reason: 'that input is not a slideshow' });
  return src.kind;
}

function checkSlideInput(s: Show, id: string) {
  if (picture(s, id).kind.type === 'slideshow')
    throw new Refused({ code: 'invalidValue', field: 'slideshow', reason: 'a slideshow can’t show another slideshow' });
}

/** Go to a slide; a video on the new slide starts. */
function goToSlide(s: Show, id: string, index: number, now: number) {
  const sh = slideshowIn(s, id);
  const i = Math.min(Math.max(0, index), Math.max(0, sh.slides.length - 1));
  if (i !== sh.current) {
    sh.current = i;
    sh.changedAt = now;
  }
  const slide = sh.slides[sh.current];
  if (slide?.type === 'input') startIfVideo(s, slide.sourceId, now);
}

function creditsIn(s: Show, id: string): Credits {
  const src = find(s, id);
  if (src.kind.type !== 'credits') throw new Refused({ code: 'invalidValue', field: 'credits', reason: 'that input is not a credits input' });
  return src.kind;
}

/** Keep where it is when playing, stopping or changing speed (no jump). */
function creditsAt(c: Credits, now: number) {
  c.posMs = creditsPosition(c, now);
  c.at = now;
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
      const kind =
        a.source.kind.type === 'video'
          ? { ...a.source.kind, playback: { playing: false, posS: 0, at: 0 } }
          : a.source.kind.type === 'pesukim'
            ? {
                ...structuredClone(a.source.kind),
                look: { ...a.source.kind.look, behind: null },
                place: { pasuk: 0, word: 0, whole: false, blank: false, changedAt: 0 },
              }
            : a.source.kind;
      if (kind.type === 'pesukim') repairPesukim(kind);
      s.sources.push({
        id,
        name: a.source.name.trim() || 'Untitled',
        kind,
        key: { ...defaultKey(), ...a.source.key },
        adjust: defaultAdjust(),
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
      if (p.logo !== undefined) {
        if (src.kind.type !== 'countdown') throw new Refused({ code: 'invalidValue', field: 'logo', reason: 'only countdown inputs have an event logo' });
        src.kind.logo = p.logo.trim() ? p.logo : undefined;
      }
      if (p.key !== undefined) {
        if (!['camera', 'video', 'image'].includes(src.kind.type))
          throw new Refused({ code: 'invalidValue', field: 'key', reason: 'green screen works on cameras, videos and pictures' });
        src.key = { ...p.key };
      }
      if (p.adjust !== undefined) {
        if (!['camera', 'video', 'image'].includes(src.kind.type))
          throw new Refused({ code: 'invalidValue', field: 'adjust', reason: 'adjustments work on cameras, videos and pictures' });
        src.adjust = structuredClone(p.adjust);
      }
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
        if (src.kind.type === 'color') src.kind.color = p.color;
        else if (src.kind.type === 'countdown') src.kind.background = p.color;
        else throw new Refused({ code: 'invalidValue', field: 'color', reason: 'only colour sources have a colour' });
      }
      return;
    }
    case 'removeSource': {
      find(s, a.id);
      s.sources = s.sources.filter((x) => x.id !== a.id);
      if (s.audio.solo === a.id) s.audio.solo = null;
      for (const p of s.presets) p.sources = p.sources.filter((x) => x !== a.id);
      for (const src of s.sources) {
        if (src.kind.type === 'countdown' && src.kind.timer.atZero.type === 'cutTo' && src.kind.timer.atZero.sourceId === a.id)
          src.kind.timer.atZero = { type: 'hide' };
        if (src.kind.type === 'pesukim' && src.kind.look.behind === a.id) src.kind.look.behind = null;
        if (src.kind.type === 'split') for (const b of src.kind.boxes) if (b.sourceId === a.id) b.sourceId = null;
        if (src.kind.type === 'slideshow') {
          const sh = src.kind;
          sh.slides = sh.slides.filter((sl) => !(sl.type === 'input' && sl.sourceId === a.id));
          if (sh.behind === a.id) sh.behind = null;
          sh.current = Math.min(sh.current, Math.max(0, sh.slides.length - 1));
        }
      }
      for (const o of s.overlays) {
        if (o.sourceId === a.id) {
          o.sourceId = null;
          repairOverlay(o);
        }
      }
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
          sc.blankFadeMs = a.fadeMs ? Math.min(10_000, Math.max(100, a.fadeMs)) : 0;
        }
      }
      return;
    case 'fadeToBlack': {
      notMonitor(a.screen);
      const sc = s.screens[a.screen];
      sc.blank = !sc.blank;
      sc.blankChangedAt = now;
      sc.blankFadeMs = s.settings.fadeToBlackMs;
      return;
    }
    case 'setFadeToBlackLength':
      s.settings.fadeToBlackMs = Math.min(10_000, Math.max(100, a.ms));
      return;
    case 'setFavouriteTransition':
      if (a.index < 0 || a.index > 3) throw new Refused({ code: 'invalidValue', field: 'index', reason: 'there are 4 favourite transitions' });
      s.settings.favouriteTransitions[a.index] = {
        kind: a.transition.kind,
        durationMs: Math.min(MAX_TRANSITION_MS, Math.max(MIN_TRANSITION_MS, a.transition.durationMs)),
      };
      return;
    case 'playNow': {
      notMonitor(a.screen);
      picture(s, a.sourceId);
      const keep = s.screens[a.screen].preview;
      s.screens[a.screen].preview = a.sourceId;
      take(s, a.screen, a.transition.kind, Math.min(MAX_TRANSITION_MS, Math.max(MIN_TRANSITION_MS, a.transition.durationMs)), now);
      if (keep !== null) s.screens[a.screen].preview = keep;
      return;
    }
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
    case 'addPreset': {
      const p = cleanPreset(s, a.preset);
      if (!p.id) {
        let n = s.presets.length + 1;
        while (s.presets.some((x) => x.id === `preset-${n}`)) n++;
        p.id = `preset-${n}`;
      } else if (s.presets.some((x) => x.id === p.id)) throw new Refused({ code: 'invalidValue', field: 'id', reason: 'a preset with that id already exists' });
      s.presets.push(p);
      return;
    }
    case 'updatePreset': {
      const i = presetIndex(s, a.preset.id);
      s.presets[i] = cleanPreset(s, a.preset);
      return;
    }
    case 'removePreset': {
      s.presets.splice(presetIndex(s, a.id), 1);
      if (s.activePreset === a.id) s.activePreset = null;
      return;
    }
    case 'movePreset': {
      const [p] = s.presets.splice(presetIndex(s, a.id), 1);
      s.presets.splice(Math.min(a.index, s.presets.length), 0, p!);
      return;
    }
    case 'pickPreset':
      pickPreset(s, a.id ?? null);
      return;
    case 'nextPreset':
    case 'previousPreset': {
      if (!s.presets.length) return;
      const at = s.presets.findIndex((p) => p.id === s.activePreset);
      const last = s.presets.length - 1;
      const to = a.type === 'nextPreset' ? (at < 0 ? 0 : Math.min(at + 1, last)) : at < 0 ? last : Math.max(at - 1, 0);
      pickPreset(s, s.presets[to]!.id);
      return;
    }
    case 'runSteps': {
      if (a.steps.length > 50) throw new Refused({ code: 'invalidValue', field: 'steps', reason: 'at most 50 steps in one button' });
      if (!a.steps.length) return;
      s.running.push({ name: oneLine(a.name, 40), steps: structuredClone(a.steps), next: 0, resumeAt: now });
      runSteps(s, now);
      return;
    }
    case 'stopSteps':
      s.running = [];
      return;
    case 'updateEvent': {
      const p = a.patch;
      const ev = s.event;
      if (p.name !== undefined) ev.name = oneLine(p.name, 80);
      if (p.logo !== undefined) ev.logo = p.logo.trim() ? p.logo : null;
      if (p.onFailure !== undefined) ev.onFailure = p.onFailure;
      if (p.panicShows !== undefined) ev.panicShows = p.panicShows;
      if (p.setUp !== undefined) ev.setUp = p.setUp;
      return;
    }
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
      if (a.index < 0 || a.index >= 8) throw new Refused({ code: 'invalidValue', field: 'index', reason: 'there are 8 quick messages (0 – 7)' });
      s.monitor.quick[a.index] = oneLine(a.text, 60);
      return;
    case 'updateCountdown': {
      const p = a.patch;
      if (p.atZero?.type === 'cutTo') picture(s, p.atZero.sourceId);
      const c = timer(s, a.id);
      if (p.label !== undefined) c.label = oneLine(p.label, 60);
      if (p.endText !== undefined) c.endText = oneLine(p.endText, 60);
      if (p.format !== undefined) c.format = p.format;
      if (p.atZero !== undefined) c.atZero = p.atZero;
      return;
    }
    case 'setCountdownLength': {
      const len = countdownMs(a.lengthMs, 'lengthMs');
      const c = timer(s, a.id);
      c.lengthMs = len;
      c.endsAt = null;
      c.remainingMs = c.lengthMs;
      c.fired = false;
      return;
    }
    case 'startCountdown': {
      const c = timer(s, a.id);
      if (c.endsAt === null) startTimer(c, now);
      return;
    }
    case 'pauseCountdown': {
      const c = timer(s, a.id);
      c.remainingMs = countdownRemaining(c, now);
      c.endsAt = null;
      return;
    }
    case 'resetCountdown': {
      const c = timer(s, a.id);
      c.endsAt = null;
      c.remainingMs = c.lengthMs;
      c.fired = false;
      return;
    }
    case 'addCountdownTime': {
      if (Math.abs(a.ms) > MAX_COUNTDOWN_MS) throw new Refused({ code: 'invalidValue', field: 'ms', reason: 'at most 24 hours at a time' });
      const c = timer(s, a.id);
      setRemaining(c, countdownRemaining(c, now) + a.ms, now);
      return;
    }
    case 'setCountdownRemaining':
      setRemaining(timer(s, a.id), a.ms, now);
      return;
    case 'slideNext': {
      const i = nextSlideIndex(slideshowIn(s, a.id));
      if (i !== null) goToSlide(s, a.id, i, now);
      return;
    }
    case 'slidePrevious':
      goToSlide(s, a.id, Math.max(0, slideshowIn(s, a.id).current - 1), now);
      return;
    case 'slideGo':
      goToSlide(s, a.id, a.index, now);
      return;
    case 'updateSlideshow': {
      for (const sl of a.slideshow.slides) if (sl.type === 'input') checkSlideInput(s, sl.sourceId);
      if (a.slideshow.behind) checkSlideInput(s, a.slideshow.behind);
      const sh = slideshowIn(s, a.id);
      const { current, changedAt } = sh;
      Object.assign(sh, structuredClone(a.slideshow), { changedAt });
      sh.current = Math.min(current, Math.max(0, sh.slides.length - 1));
      return;
    }
    case 'updateSplit': {
      for (const b of a.split.boxes) {
        if (b.sourceId === null) continue;
        const inner = picture(s, b.sourceId);
        if (inner.kind.type === 'split')
          throw new Refused({ code: 'invalidValue', field: 'split', reason: 'a split screen can’t be inside another split screen' });
      }
      const src = find(s, a.id);
      if (src.kind.type !== 'split') throw new Refused({ code: 'invalidValue', field: 'split', reason: 'that input is not a split screen' });
      src.kind = { type: 'split', ...applyLayout(structuredClone(a.split)) };
      return;
    }
    case 'updateCredits': {
      const c = creditsIn(s, a.id);
      const { playing, posMs, at } = c;
      Object.assign(c, structuredClone(a.credits), { playing, posMs, at });
      c.names = c.names.map((n) => n.trim()).filter(Boolean);
      c.speed = Math.min(600, Math.max(5, c.speed));
      c.pageMs = Math.min(120_000, Math.max(1000, c.pageMs));
      return;
    }
    case 'creditsPlay': {
      const c = creditsIn(s, a.id);
      if (c.playing === a.value) return;
      creditsAt(c, now);
      c.playing = a.value;
      return;
    }
    case 'creditsRestart': {
      const c = creditsIn(s, a.id);
      c.posMs = 0;
      c.at = now;
      return;
    }
    case 'creditsSpeed': {
      const c = creditsIn(s, a.id);
      creditsAt(c, now);
      c.speed = Math.min(600, Math.max(5, a.speed));
      return;
    }
    case 'setCues': {
      const keep = s.run.current !== null ? s.run.cues[s.run.current]?.id : undefined;
      s.run.cues = structuredClone(a.cues);
      const at = s.run.cues.findIndex((c) => c.id === keep);
      s.run.current = at >= 0 ? at : null;
      return;
    }
    case 'startShow':
      Object.assign(s.run, { running: true, paused: false, current: null, startedAt: now, cueStartedAt: now, utcOffsetMin: a.utcOffsetMin });
      return;
    case 'stopShow':
      Object.assign(s.run, { running: false, paused: false });
      return;
    case 'pauseShow':
      s.run.paused = a.value && s.run.running;
      return;
    case 'nextCue': {
      const i = nextCueIndex(s.run);
      if (i === null) return;
      if (!s.run.running) Object.assign(s.run, { running: true, startedAt: now });
      fireCue(s, i, now);
      return;
    }
    case 'goCue':
      fireCue(s, a.index, now);
      return;
    case 'updateLogo3d': {
      const src = find(s, a.id);
      if (src.kind.type !== 'logo3d') throw new Refused({ code: 'invalidValue', field: 'logo', reason: 'that input is not a 3D logo' });
      src.kind = { type: 'logo3d', ...structuredClone(a.logo) };
      return;
    }
    case 'relinkMedia':
      return;
    case 'updateBrowser': {
      const src = find(s, a.id);
      if (src.kind.type !== 'browser') throw new Refused({ code: 'invalidValue', field: 'browser', reason: 'that input is not a web page' });
      const url = cleanUrl(a.browser.url);
      if (!url) throw new Refused({ code: 'invalidValue', field: 'url', reason: 'that is not a web address' });
      src.kind = { type: 'browser', ...structuredClone(a.browser), url, zoom: Math.min(400, Math.max(25, a.browser.zoom)) };
      return;
    }
    case 'updateText': {
      const src = find(s, a.id);
      if (src.kind.type !== 'text') throw new Refused({ code: 'invalidValue', field: 'text', reason: 'that input is not a text input' });
      src.kind = { type: 'text', ...structuredClone(a.text) };
      return;
    }
    case 'setOverlaySource': {
      if (a.sourceId !== null) picture(s, a.sourceId);
      const o = channelOf(s, a.channel);
      if (o.sourceId !== a.sourceId) {
        o.sourceId = a.sourceId;
        o.on = false;
        o.changedAt = now;
      }
      repairOverlay(o);
      return;
    }
    case 'updateOverlay': {
      const o = channelOf(s, a.channel);
      const p = a.patch;
      if (p.frame !== undefined) o.frame = p.frame;
      if (p.opacity !== undefined) o.opacity = finite(p.opacity, 'opacity');
      if (p.animIn !== undefined) o.animIn = p.animIn;
      if (p.animOut !== undefined) o.animOut = p.animOut;
      if (p.animMs !== undefined) o.animMs = p.animMs;
      if (p.autoHideMs !== undefined) o.autoHideMs = p.autoHideMs > 0 ? p.autoHideMs : null;
      if (p.screens !== undefined) o.screens = p.screens;
      repairOverlay(o);
      return;
    }
    case 'setOverlayOn': {
      const o = channelOf(s, a.channel);
      if (a.value && o.sourceId === null) throw new Refused({ code: 'invalidValue', field: 'overlay', reason: 'choose an input for this overlay first' });
      setOverlayOn(o, a.value, now);
      if (a.value) {
        o.inNext = false;
        if (o.sourceId) startIfVideo(s, o.sourceId, now);
      }
      return;
    }
    case 'setOverlayInNext': {
      const o = channelOf(s, a.channel);
      if (a.value && o.sourceId === null) throw new Refused({ code: 'invalidValue', field: 'overlay', reason: 'choose an input for this overlay first' });
      o.inNext = a.value;
      return;
    }
    case 'overlaysOff':
      for (const o of s.overlays) {
        setOverlayOn(o, false, now);
        o.inNext = false;
      }
      return;
    case 'pesukimNext':
      nextWord(pesukimIn(s, a.id), now);
      return;
    case 'pesukimBack':
      backWord(pesukimIn(s, a.id), now);
      return;
    case 'pesukimGo':
      goTo(pesukimIn(s, a.id), a.pasuk, a.word, now);
      return;
    case 'pesukimWhole': {
      const pl = pesukimIn(s, a.id).place;
      pl.whole = a.value;
      if (a.value) pl.blank = false;
      pl.changedAt = now;
      return;
    }
    case 'pesukimBlank': {
      const pl = pesukimIn(s, a.id).place;
      pl.blank = a.value;
      pl.changedAt = now;
      return;
    }
    case 'updatePesukim': {
      const p = pesukimIn(s, a.id);
      if (a.look) {
        const b = a.look.behind;
        if (b !== null) {
          const src = s.sources.find((x) => x.id === b);
          if (!src) throw new Refused({ code: 'unknownSource', id: b });
          if (b === a.id || !['camera', 'video', 'image', 'color', 'pattern', 'visuals'].includes(src.kind.type))
            throw new Refused({
              code: 'invalidValue',
              field: 'behind',
              reason: 'only a camera, video, picture, colour or test pattern can go behind the words',
            });
        }
        p.look = structuredClone(a.look);
      }
      if (a.pesukim) p.pesukim = structuredClone(a.pesukim);
      repairPesukim(p);
      return;
    }
    case 'visualsScene':
      if (!vis.sceneExists(a.scene)) throw new Refused({ code: 'invalidValue', field: 'scene', reason: 'there is no such scene' });
      vis.launch(s.visuals, a.scene, now);
      return;
    case 'visualsStep':
      vis.step(s.visuals, a.step, now);
      return;
    case 'visualsTempo':
      if (!Number.isFinite(a.bpm)) throw new Refused({ code: 'invalidValue', field: 'bpm', reason: 'must be a number' });
      vis.setBpm(s.visuals, a.bpm, now);
      return;
    case 'visualsSync':
      vis.syncToOne(s.visuals, now);
      return;
    case 'visualsFlash':
      s.visuals.flashAt = now;
      return;
    case 'updateVisuals':
      vis.applyPatch(s.visuals, a.patch, now);
      return;
    case 'visualsLook':
      try {
        vis.look(s.visuals, a.slot, a.store, now);
      } catch (e) {
        throw new Refused({ code: 'invalidValue', field: 'slot', reason: e instanceof Error ? e.message : String(e) });
      }
      return;
    case 'countdownTo': {
      if (a.at <= now) throw new Refused({ code: 'invalidValue', field: 'at', reason: 'that time has already passed' });
      const left = countdownMs(a.at - now, 'at');
      Object.assign(timer(s, a.id), { lengthMs: left, remainingMs: left, endsAt: a.at, fired: false });
      return;
    }
  }
}

function presetIndex(s: Show, id: string): number {
  const i = s.presets.findIndex((p) => p.id === id);
  if (i < 0) throw new Refused({ code: 'invalidValue', field: 'id', reason: 'there is no such preset' });
  return i;
}

function cleanPreset(s: Show, p: Preset): Preset {
  if (p.screen === 'monitor') throw new Refused({ code: 'monitorIsTextOnly' });
  for (const id of p.sources) find(s, id);
  for (const b of p.buttons) {
    if (b.steps.length > 50) throw new Refused({ code: 'invalidValue', field: 'steps', reason: 'at most 50 steps in one button' });
    if (b.steps.some((st) => st.type === 'wait' && st.ms > 600_000))
      throw new Refused({ code: 'invalidValue', field: 'steps', reason: 'a wait can be at most 10 minutes' });
  }
  return {
    ...structuredClone(p),
    id: p.id.trim(),
    name: oneLine(p.name, 40) || 'Preset',
    category: oneLine(p.category, 40),
    sources: [...new Set(p.sources)],
    buttons: p.buttons.map((b) => ({ name: oneLine(b.name, 40) || 'Button', steps: structuredClone(b.steps) })),
  };
}

function pickPreset(s: Show, id: string | null) {
  if (id === null) {
    s.activePreset = null;
    return;
  }
  const p = s.presets[presetIndex(s, id)]!;
  s.activePreset = id;
  if (p.transition) s.transition = { kind: p.transition.kind, durationMs: clampMs(p.transition.durationMs) };
  if (p.loadFirst) {
    const first = p.sources.find((x) => s.sources.find((src) => src.id === x)?.kind.type !== 'microphone');
    const sc = s.screens[p.screen];
    if (first && sc.program !== first) {
      sc.preview = first;
      sc.tbar = 0;
    }
  }
}

function stepAction(st: Step, main: string | null): Action | null {
  switch (st.type) {
    case 'preview':
      return { type: 'setPreview', screen: st.screen, sourceId: st.sourceId };
    case 'take':
      return st.transition ? { type: 'take', screen: st.screen, transition: st.transition } : { type: 'take', screen: st.screen };
    case 'cutTo':
      return { type: 'cutTo', screen: st.screen, sourceId: st.sourceId };
    case 'blank':
      return { type: 'setBlank', screens: st.screens, value: st.value };
    case 'monitorMessage':
      return { type: 'updateMonitor', patch: { message: st.text, messageOn: true } };
    case 'clearMonitorMessage':
      return { type: 'updateMonitor', patch: { messageOn: false } };
    case 'startCountdown': {
      const id = st.sourceId ?? main;
      return id ? { type: 'startCountdown', id } : null;
    }
    case 'pauseCountdown': {
      const id = st.sourceId ?? main;
      return id ? { type: 'pauseCountdown', id } : null;
    }
    case 'resetCountdown': {
      const id = st.sourceId ?? main;
      return id ? { type: 'resetCountdown', id } : null;
    }
    case 'setCountdownLength': {
      const id = st.sourceId ?? main;
      return id ? { type: 'setCountdownLength', id, lengthMs: st.lengthMs } : null;
    }
    case 'play':
      return { type: 'play', id: st.sourceId };
    case 'pause':
      return { type: 'pause', id: st.sourceId };
    case 'backFollowsLive':
      return { type: 'setBackFollowsLive', value: st.value };
    case 'overlay':
      return { type: 'setOverlayOn', channel: st.channel, value: st.value };
    case 'preset':
      return { type: 'pickPreset', id: st.presetId };
    case 'wait':
      return null;
  }
}

/** Run every step that is due; a step that cannot run is skipped (mirrors the engine). */
function runSteps(s: Show, now: number) {
  const running = s.running;
  s.running = [];
  for (const r of running) {
    while (r.resumeAt <= now && r.next < r.steps.length) {
      const st = r.steps[r.next]!;
      r.next++;
      if (st.type === 'wait') r.resumeAt += st.ms;
      else {
        const act = stepAction(st, mainCountdown(s));
        if (act) {
          try {
            apply(s, act, now);
          } catch {
            // Skipped: the rest still run.
          }
        }
      }
    }
  }
  s.running = running.filter((r) => r.next < r.steps.length);
}

/** Let time pass (mirrors Engine::tick): runs each countdown's at-zero action once, and button steps. */
export function demoTick(show: Show, now: number): Show | null {
  const due = show.sources.filter((x) => x.kind.type === 'countdown' && !x.kind.timer.fired && countdownDue(x.kind.timer, now)).map((x) => x.id);
  const stepsDue = show.running.some((r) => r.resumeAt <= now);
  // Pesukim on auto-advance move on by themselves, only while on air.
  const onAir = [show.screens.live.program, show.screens.back.program];
  const wordsDue = show.sources.filter((x) => onAir.includes(x.id) && x.kind.type === 'pesukim' && wordDue(x.kind, now)).map((x) => x.id);
  // Overlays go off by themselves: auto-hide, or a video that ended.
  const overlaysDue = show.overlays
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => {
      if (!o.on) return false;
      if (o.autoHideMs !== null && now >= o.changedAt + o.autoHideMs) return true;
      const src = show.sources.find((x) => x.id === o.sourceId);
      return !!src && src.kind.type === 'video' && sourceEnded(src, now);
    })
    .map(({ i }) => i);
  const slidesDue = show.sources.filter((x) => onAir.includes(x.id) && x.kind.type === 'slideshow' && slideDue(x.kind, now)).map((x) => x.id);
  const cue = cueDue(show.run, now);
  const visualsDue = vis.visualsDue(show.visuals, now);
  if (due.length === 0 && cue === null && !stepsDue && wordsDue.length === 0 && overlaysDue.length === 0 && slidesDue.length === 0 && !visualsDue) return null;
  const next = structuredClone(show);
  const liveBefore = structuredClone(show.screens.live);
  for (const id of due) atZero(next, id, now);
  if (cue !== null) fireCue(next, cue, now);
  if (stepsDue) runSteps(next, now);
  for (const id of wordsDue) nextWord(pesukimIn(next, id), now);
  if (visualsDue) vis.autoChange(next.visuals, now);
  for (const i of overlaysDue) setOverlayOn(next.overlays[i]!, false, now);
  for (const id of slidesDue) {
    const i = nextSlideIndex(slideshowIn(next, id));
    if (i !== null) goToSlide(next, id, i, now);
  }
  followLive(next, liveBefore, show.backFollowsLive, now);
  return next;
}

function atZero(next: Show, id: string, now: number) {
  const c = timer(next, id);
  c.fired = true;
  const z = c.atZero;
  // The screens showing this countdown right now.
  const showing = (['live', 'back'] as const).filter((sc) => next.screens[sc].program === id);
  if (z.type === 'blank') {
    for (const sc of showing) {
      if (!next.screens[sc].blank) {
        next.screens[sc].blank = true;
        next.screens[sc].blankChangedAt = now;
      }
    }
  } else if (z.type === 'cutTo') {
    for (const screen of showing.length ? showing : (['live'] as const)) {
      try {
        apply(next, { type: 'cutTo', screen, sourceId: z.sourceId }, now);
      } catch {
        // The input was removed: nothing to switch to.
      }
    }
  }
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
