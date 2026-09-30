import { defaultFilters } from './audio';
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
import { stingerSlot } from './timing';
import { repairScoreboard, runClock, setClock } from './score';
import { lyricsGo, sections } from './lyrics';
import { applyBrand } from './brand';
import { repairPoll, resetPoll } from './poll';
import { pledgeTo, raffleDraw, raffleEnter, withCelebration } from './audience';
import { wallPost, wallRemove } from './wall';
import { placeBid, removeItem, setItem } from './auction';
import { nextIndex, playlistDue, playlistGo, repairPlaylist } from './playlist';
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
import { cleanStreamUrl } from './stream';
import { triggersDue } from './triggers';

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

/** A stinger runs for the length of its video; one not set up is a fade. */
export function resolveStinger(s: Show, t: { kind: Show['transition']['kind']; durationMs: number }) {
  const i = stingerSlot(t.kind);
  if (i === null) return t;
  const st = s.settings.stingers?.[i];
  return st?.path ? { kind: t.kind, durationMs: Math.max(MIN_TRANSITION_MS, st.durationMs) } : { kind: 'fade' as const, durationMs: t.durationMs };
}

function raffleIn(s: Show, id: string) {
  const src = find(s, id);
  if (src.kind.type !== 'raffle') throw new Refused({ code: 'invalidValue', field: 'id', reason: 'that input is not a raffle' });
  return src.kind;
}

function auctionIn(s: Show, id: string) {
  const src = find(s, id);
  if (src.kind.type !== 'auction') throw new Refused({ code: 'invalidValue', field: 'id', reason: 'that input is not an auction' });
  return src.kind;
}

function wallIn(s: Show, id: string) {
  const src = find(s, id);
  if (src.kind.type !== 'wall') throw new Refused({ code: 'invalidValue', field: 'id', reason: 'that input is not a messages wall' });
  return src.kind;
}

function fundIn(s: Show, id: string) {
  const src = find(s, id);
  if (src.kind.type !== 'fundraiser') throw new Refused({ code: 'invalidValue', field: 'id', reason: 'that input is not a fundraiser' });
  return src.kind;
}

/** The audience questions (an older saved show has none yet). */
function qnaOf(s: Show) {
  s.qna ??= { open: false, questions: [], nextId: 0 };
  return s.qna;
}

function commentIn(s: Show, id: string) {
  const src = find(s, id);
  if (src.kind.type !== 'comment') throw new Refused({ code: 'invalidValue', field: 'id', reason: 'that input is not for chat comments' });
  return src.kind;
}

function pollIn(s: Show, id: string) {
  const src = find(s, id);
  if (src.kind.type !== 'poll') throw new Refused({ code: 'invalidValue', field: 'id', reason: 'that input is not a poll' });
  return src.kind;
}

function song(s: Show, id: string) {
  const src = find(s, id);
  if (src.kind.type !== 'lyrics') throw new Refused({ code: 'invalidValue', field: 'id', reason: 'that input is not a song' });
  return src.kind;
}

function scoreboard(s: Show, id: string) {
  const src = find(s, id);
  if (src.kind.type !== 'scoreboard') throw new Refused({ code: 'invalidValue', field: 'id', reason: 'that input is not a scoreboard' });
  return src.kind;
}

function take(s: Show, screen: ScreenId, kind0: Show['transition']['kind'], durationMs0: number, now: number) {
  const { kind, durationMs } = resolveStinger(s, { kind: kind0, durationMs: durationMs0 });
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
      back.transition = { ...resolveStinger(s, s.transition), startedAt: now };
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
          ...(a.source.audio ?? { follow: kind.type !== 'microphone', toMaster: true, toA: true, toB: true, delayMs: 0, filters: defaultFilters() }),
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
        if (q.filters !== undefined) {
          const c = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
          au.filters = {
            ...q.filters,
            bassDb: c(q.filters.bassDb, -12, 12),
            midDb: c(q.filters.midDb, -12, 12),
            trebleDb: c(q.filters.trebleDb, -12, 12),
            gateDb: c(q.filters.gateDb, -80, 0),
          };
        }
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
    case 'setMultiview':
      s.settings.multiview = structuredClone(a.multiview);
      return;
    case 'setSpeed': {
      const v = video(s, a.id);
      const pos = sourcePosition(v, now);
      v.kind.playback = { ...v.kind.playback, posS: pos, at: now };
      const speed = Math.min(2, Math.max(0.25, finite(a.speed, 'speed')));
      v.speed = Math.abs(speed - 1) > 0.001 ? speed : null;
      return;
    }
    case 'updateRaffle': {
      const r = raffleIn(s, a.id);
      const n = a.raffle;
      Object.assign(r, {
        title: n.title.slice(0, 80),
        prize: n.prize.slice(0, 120),
        repeatWinners: n.repeatWinners,
        joinUrl: n.joinUrl,
        joinQr: n.joinQr,
        showJoin: n.showJoin,
      });
      return;
    }
    case 'raffleOpen':
      raffleIn(s, a.id).open = a.value;
      return;
    case 'raffleJoin': {
      const r = raffleIn(s, a.id);
      if (!r.open || !raffleEnter(r, a.name)) throw new Refused({ code: 'invalidValue', field: 'raffle', reason: 'this raffle is not taking names' });
      return;
    }
    case 'raffleAdd': {
      const r = raffleIn(s, a.id);
      for (const n of a.names) raffleEnter(r, n);
      return;
    }
    case 'raffleRemove': {
      const r = raffleIn(s, a.id);
      if (a.entry === undefined) Object.assign(r, { entries: [], winners: [], draw: null });
      else r.entries = r.entries.filter((e) => e.id !== a.entry);
      return;
    }
    case 'raffleDraw':
      if (!raffleDraw(raffleIn(s, a.id), now)) throw new Refused({ code: 'invalidValue', field: 'raffle', reason: 'nobody left to draw' });
      return;
    case 'raffleReset':
      Object.assign(raffleIn(s, a.id), { winners: [], draw: null });
      return;
    case 'updateZmanim': {
      const src = find(s, a.id);
      if (src.kind.type !== 'zmanim') throw new Refused({ code: 'invalidValue', field: 'id', reason: 'that input is not zmanim' });
      src.kind.style = a.zmanim.style;
      return;
    }
    case 'updateAuction': {
      const n = a.auction;
      Object.assign(auctionIn(s, a.id), {
        title: n.title.slice(0, 80),
        currency: n.currency.slice(0, 4),
        joinUrl: n.joinUrl,
        joinQr: n.joinQr,
        showJoin: n.showJoin,
      });
      return;
    }
    case 'auctionSetItem':
      if (!setItem(auctionIn(s, a.id), a.item))
        throw new Refused({ code: 'invalidValue', field: 'item', reason: 'that item is not in this auction (or the list is full)' });
      return;
    case 'auctionRemoveItem':
      removeItem(auctionIn(s, a.id), a.item);
      return;
    case 'auctionGo': {
      const au = auctionIn(s, a.id);
      if (a.index >= au.items.length) throw new Refused({ code: 'invalidValue', field: 'index', reason: 'there is no such item' });
      Object.assign(au, { current: a.index, endsAt: null, soldAt: 0 });
      return;
    }
    case 'auctionOpen':
      auctionIn(s, a.id).open = a.value;
      return;
    case 'auctionTimer':
      auctionIn(s, a.id).endsAt = a.seconds === undefined ? null : now + Math.min(3600, Math.max(5, a.seconds)) * 1000;
      return;
    case 'auctionBid':
    case 'auctionRoomBid': {
      const au = auctionIn(s, a.id);
      const item = a.type === 'auctionBid' ? a.item : (au.items[au.current]?.id ?? -1);
      const why = placeBid(au, item, a.name, a.amount, a.type === 'auctionBid', now);
      if (why) throw new Refused({ code: 'invalidValue', field: 'amount', reason: why });
      return;
    }
    case 'auctionSold': {
      const au = auctionIn(s, a.id);
      const it = au.items[au.current];
      if (!it || (a.value && !it.bids.length)) throw new Refused({ code: 'invalidValue', field: 'item', reason: 'nobody has bid on this item yet' });
      it.sold = a.value;
      au.soldAt = a.value ? now : 0;
      au.endsAt = null;
      return;
    }
    case 'auctionRemoveBid': {
      const it = auctionIn(s, a.id).items.find((x) => x.id === a.item);
      if (it) {
        it.bids = it.bids.filter((b) => b.id !== a.bid);
        if (!it.bids.length) it.sold = false;
      }
      return;
    }
    case 'updateWall': {
      const n = a.wall;
      Object.assign(wallIn(s, a.id), {
        title: n.title.slice(0, 80),
        prompt: n.prompt.slice(0, 120),
        photos: n.photos,
        autoApprove: n.autoApprove,
        style: n.style,
        seconds: Math.min(60, Math.max(3, Math.round(n.seconds))),
        joinUrl: n.joinUrl,
        joinQr: n.joinQr,
        showJoin: n.showJoin,
      });
      return;
    }
    case 'wallOpen':
      wallIn(s, a.id).open = a.value;
      return;
    case 'wallPost': {
      const w = wallIn(s, a.id);
      if (!w.open) throw new Refused({ code: 'invalidValue', field: 'wall', reason: 'this wall is not taking messages' });
      if (!wallPost(w, a.name, a.text, w.photos ? (a.photo ?? '') : '', w.autoApprove, now))
        throw new Refused({ code: 'invalidValue', field: 'text', reason: 'a message needs some words or a photo' });
      return;
    }
    case 'wallAdd':
      if (!wallPost(wallIn(s, a.id), a.name, a.text, '', true, now))
        throw new Refused({ code: 'invalidValue', field: 'text', reason: 'a message needs some words or a photo' });
      return;
    case 'wallApprove': {
      const w = wallIn(s, a.id);
      const m = w.messages.find((x) => x.id === a.message);
      if (m) m.approved = a.value;
      if (!a.value && w.pinned === a.message) w.pinned = null;
      return;
    }
    case 'wallPin': {
      const w = wallIn(s, a.id);
      if (a.message !== undefined) {
        const m = w.messages.find((x) => x.id === a.message);
        if (!m) throw new Refused({ code: 'invalidValue', field: 'message', reason: 'that message is not on this wall' });
        m.approved = true;
      }
      w.pinned = a.message ?? null;
      return;
    }
    case 'wallRemove':
      wallRemove(wallIn(s, a.id), a.message);
      return;
    case 'updateFundraiser': {
      const f = fundIn(s, a.id);
      const n = a.fundraiser;
      withCelebration(f, now, () =>
        Object.assign(f, {
          title: n.title.slice(0, 80),
          currency: n.currency.slice(0, 4),
          goal: Math.max(1, Math.floor(n.goal)),
          starting: Math.max(0, Math.floor(n.starting)),
          autoApprove: n.autoApprove,
          showDonors: n.showDonors,
          joinUrl: n.joinUrl,
          joinQr: n.joinQr,
          showJoin: n.showJoin,
        }),
      );
      return;
    }
    case 'fundraiserOpen':
      fundIn(s, a.id).open = a.value;
      return;
    case 'pledge': {
      const f = fundIn(s, a.id);
      if (!f.open || !pledgeTo(f, a.name, a.amount, a.message, f.autoApprove, now))
        throw new Refused({ code: 'invalidValue', field: 'fundraiser', reason: 'this fundraiser is not taking pledges' });
      return;
    }
    case 'addDonation':
      if (!pledgeTo(fundIn(s, a.id), a.name, a.amount, a.message, true, now))
        throw new Refused({ code: 'invalidValue', field: 'amount', reason: 'the amount must be more than 0 and not huge' });
      return;
    case 'pledgeApprove': {
      const f = fundIn(s, a.id);
      withCelebration(f, now, () => {
        const p = f.pledges.find((x) => x.id === a.pledge);
        if (p) p.approved = a.value;
      });
      return;
    }
    case 'pledgeRemove': {
      const f = fundIn(s, a.id);
      f.pledges = f.pledges.filter((p) => p.id !== a.pledge);
      return;
    }
    case 'qnaOpen':
      qnaOf(s).open = a.value;
      return;
    case 'qnaAsk': {
      const text = [...a.text.trim()].slice(0, 300).join('');
      if (!qnaOf(s).open || !text) throw new Refused({ code: 'invalidValue', field: 'question', reason: 'questions are closed' });
      s.qna.nextId += 1;
      s.qna.questions.push({ id: s.qna.nextId, author: [...a.author.trim()].slice(0, 40).join(''), text, at: now, shown: false });
      if (s.qna.questions.length > 300) s.qna.questions.splice(0, s.qna.questions.length - 300);
      return;
    }
    case 'qnaShow': {
      const q = s.qna.questions.find((x) => x.id === a.question);
      if (!q) throw new Refused({ code: 'invalidValue', field: 'question', reason: 'there is no such question' });
      const c = commentIn(s, a.id);
      q.shown = true;
      c.comment = { author: q.author || 'Question', text: q.text, platform: 'other' };
      c.changedAt = now;
      return;
    }
    case 'qnaRemove':
      s.qna.questions = a.question === undefined ? [] : s.qna.questions.filter((x) => x.id !== a.question);
      return;
    case 'reloadGuest': {
      const src = find(s, a.id);
      if (src.kind.type !== 'guest') throw new Refused({ code: 'invalidValue', field: 'id', reason: 'that input is not a guest' });
      src.kind.reload += 1;
      return;
    }
    case 'showComment': {
      const c = commentIn(s, a.id);
      c.comment = a.comment ? { ...a.comment, author: [...a.comment.author].slice(0, 60).join(''), text: [...a.comment.text].slice(0, 400).join('') } : null;
      c.changedAt = now;
      return;
    }
    case 'updateCommentCard': {
      const c = commentIn(s, a.id);
      c.place = a.place;
      c.accent = /^#[0-9a-fA-F]{6}$/.test(a.accent) ? a.accent : '#2f80ed';
      return;
    }
    case 'setPtz': {
      const src = find(s, a.id);
      if (src.kind.type !== 'camera') throw new Refused({ code: 'invalidValue', field: 'id', reason: 'only cameras can be PTZ cameras' });
      src.ptz = a.ptz ? structuredClone(a.ptz) : null;
      return;
    }
    case 'updatePoll': {
      const p = pollIn(s, a.id);
      const next = structuredClone(a.poll);
      repairPoll(next);
      const same = JSON.stringify(next.options) === JSON.stringify(p.options);
      Object.assign(p, { ...next, votes: p.votes, round: p.round, open: p.open });
      if (!same) resetPoll(p);
      return;
    }
    case 'pollOpen':
      pollIn(s, a.id).open = a.value;
      return;
    case 'pollShowResults':
      pollIn(s, a.id).showResults = a.value;
      return;
    case 'pollReset':
      resetPoll(pollIn(s, a.id));
      return;
    case 'pollVote': {
      const p = pollIn(s, a.id);
      if (!p.open || a.round !== p.round || a.option >= p.votes.length)
        throw new Refused({ code: 'invalidValue', field: 'poll', reason: 'this poll is not taking votes' });
      if (a.previous !== undefined && a.previous < p.votes.length) p.votes[a.previous] = Math.max(0, p.votes[a.previous]! - 1);
      p.votes[a.option]! += 1;
      return;
    }
    case 'applyBrand':
      applyBrand(s, a.brand);
      return;
    case 'updateLyrics': {
      const l = song(s, a.id);
      const next = structuredClone(a.lyrics);
      Object.assign(l, { ...next, current: Math.min(l.current, Math.max(0, sections(next.text).length - 1)), blank: l.blank, changedAt: l.changedAt });
      return;
    }
    case 'lyricsGo':
      lyricsGo(song(s, a.id), a.index, now);
      return;
    case 'lyricsNext': {
      const l = song(s, a.id);
      lyricsGo(l, l.current + 1, now);
      return;
    }
    case 'lyricsPrevious': {
      const l = song(s, a.id);
      lyricsGo(l, l.current - 1, now);
      return;
    }
    case 'lyricsBlank': {
      const l = song(s, a.id);
      if (l.blank !== a.value) {
        l.blank = a.value;
        l.changedAt = now;
      }
      return;
    }
    case 'updateScreenCapture': {
      const src = find(s, a.id);
      if (src.kind.type !== 'screen') throw new Refused({ code: 'invalidValue', field: 'id', reason: 'that input is not a screen capture' });
      src.kind = { type: 'screen', ...structuredClone(a.capture) };
      return;
    }
    case 'updateScoreboard': {
      const sb = scoreboard(s, a.id);
      const next = structuredClone(a.scoreboard);
      repairScoreboard(next);
      next.home.score = sb.home.score;
      next.away.score = sb.away.score;
      next.clock.since = sb.clock.since;
      next.clock.runMs = sb.clock.runMs;
      Object.assign(sb, next);
      return;
    }
    case 'score': {
      const t = scoreboard(s, a.id)[a.side];
      t.score = Math.min(9999, Math.max(-999, t.score + a.delta));
      return;
    }
    case 'scoreReset': {
      const sb = scoreboard(s, a.id);
      sb.home.score = 0;
      sb.away.score = 0;
      return;
    }
    case 'scoreClock':
      runClock(scoreboard(s, a.id).clock, a.run, now);
      return;
    case 'scoreClockSet':
      setClock(scoreboard(s, a.id).clock, Math.min(24 * 3_600_000, a.ms), now);
      return;
    case 'setStinger': {
      if (a.index < 0 || a.index > 1) throw new Refused({ code: 'invalidValue', field: 'index', reason: 'there are 2 stingers' });
      const durationMs = Math.min(30_000, Math.max(MIN_TRANSITION_MS, a.stinger.durationMs));
      s.settings.stingers ??= [0, 1].map(() => ({ path: '', durationMs: 0, cutMs: 0 }));
      s.settings.stingers[a.index] = { path: a.stinger.path, durationMs, cutMs: Math.min(durationMs, a.stinger.cutMs) };
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
      const v = video(s, a.id);
      v.kind.durationS = d;
      for (const item of v.playlist?.items ?? []) if (item.path === v.kind.path) item.durationS = d;
      return;
    }
    case 'setPlaylist': {
      const v = video(s, a.id);
      if (!a.playlist) {
        v.playlist = null;
        return;
      }
      const p = structuredClone(a.playlist);
      repairPlaylist(p);
      if (p.items.length === 0) throw new Refused({ code: 'invalidValue', field: 'playlist', reason: 'add at least one video' });
      const keep = p.items.findIndex((i) => i.path === v.kind.path);
      p.current = keep >= 0 ? keep : p.current;
      v.playlist = p;
      if (keep < 0) playlistGo(v, p.current, false, now);
      return;
    }
    case 'playlistGo': {
      const v = video(s, a.id);
      if (a.index < 0 || a.index >= (v.playlist?.items.length ?? 0))
        throw new Refused({ code: 'invalidValue', field: 'index', reason: 'there is no such video in the list' });
      playlistGo(v, a.index, v.kind.playback.playing, now);
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
      if (p.place !== undefined) {
        const q = p.place;
        ev.place = {
          ...q,
          name: q.name.slice(0, 60),
          latMicro: Math.max(-90e6, Math.min(90e6, Math.round(q.latMicro))),
          lonMicro: Math.max(-180e6, Math.min(180e6, Math.round(q.lonMicro))),
          candleMinutes: Math.min(90, Math.max(0, Math.round(q.candleMinutes))),
          stopMinutes: Math.min(120, Math.max(0, Math.round(q.stopMinutes))),
        };
      }
      if (p.wifi !== undefined) {
        const w = p.wifi;
        const name = [...w.name]
          .filter((c) => c >= ' ')
          .slice(0, 32)
          .join('');
        ev.wifi = {
          name,
          password: [...w.password]
            .filter((c) => c >= ' ')
            .slice(0, 63)
            .join(''),
          qr: name.trim() && w.qr.trim().startsWith('<svg') ? w.qr : '',
          show: w.show,
        };
      }
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
      if (p.showLyrics !== undefined) m.showLyrics = p.showLyrics;
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
    case 'setTriggers':
      if (a.triggers.length > 100) throw new Refused({ code: 'invalidValue', field: 'triggers', reason: 'at most 100 triggers' });
      s.triggers = structuredClone(a.triggers);
      return;
    case 'fireTrigger': {
      const t = s.triggers.find((x) => x.id === a.id);
      if (!t) throw new Refused({ code: 'invalidValue', field: 'id', reason: 'there is no such trigger' });
      if (t.steps.length) apply(s, { type: 'runSteps', name: t.name, steps: structuredClone(t.steps) }, now);
      return;
    }
    case 'updateStream': {
      const src = find(s, a.id);
      if (src.kind.type !== 'stream') throw new Refused({ code: 'invalidValue', field: 'stream', reason: 'that input is not a stream' });
      const url = cleanStreamUrl(a.stream.url);
      if (!url) throw new Refused({ code: 'invalidValue', field: 'url', reason: 'that is not a stream address' });
      src.kind = { type: 'stream', url, bufferMs: Math.min(10_000, Math.max(0, a.stream.bufferMs)) };
      return;
    }
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
  const listsDue = show.sources.filter((x) => playlistDue(x, now)).map((x) => x.id);
  const clockTriggers = triggersDue(show, show, now).length > 0;
  if (
    due.length === 0 &&
    cue === null &&
    !stepsDue &&
    wordsDue.length === 0 &&
    overlaysDue.length === 0 &&
    slidesDue.length === 0 &&
    listsDue.length === 0 &&
    !visualsDue &&
    !clockTriggers
  )
    return null;
  const next = structuredClone(show);
  const liveBefore = structuredClone(show.screens.live);
  for (const id of due) atZero(next, id, now);
  if (cue !== null) fireCue(next, cue, now);
  if (stepsDue) runSteps(next, now);
  for (const id of wordsDue) nextWord(pesukimIn(next, id), now);
  if (visualsDue) vis.autoChange(next.visuals, now);
  for (const id of listsDue) {
    const src = next.sources.find((x) => x.id === id);
    const i = src?.playlist ? nextIndex(src.playlist) : null;
    if (src && i !== null) playlistGo(src, i, true, now);
  }
  for (const i of overlaysDue) setOverlayOn(next.overlays[i]!, false, now);
  for (const id of slidesDue) {
    const i = nextSlideIndex(slideshowIn(next, id));
    if (i !== null) goToSlide(next, id, i, now);
  }
  followLive(next, liveBefore, show.backFollowsLive, now);
  fireTriggers(show, next, now);
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
  fireTriggers(show, next, now);
  return next;
}

/** Run the triggers set off by the change from `before` to `next` (mirrors fire_triggers). */
function fireTriggers(before: Show, next: Show, now: number) {
  for (const i of triggersDue(before, next, now)) {
    const t = next.triggers[i]!;
    t.lastFired = now;
    if (t.steps.length) {
      try {
        apply(next, { type: 'runSteps', name: t.name, steps: structuredClone(t.steps) }, now);
      } catch {
        // A step that no longer fits (an input was removed): skipped.
      }
    }
  }
}
