// How loud each source is at a moment: the one rule every part of the sound
// system uses (the mixer's meters and the audio engine). Mirrors the engine's
// model in crates/engine/src/audio.rs.

import type { Show } from './types/Show';
import type { Source } from './types/Source';
import type { AudioFilters } from './types/AudioFilters';
import { fadeAmount, mixAt, transitionProgress } from './timing';

export type Mix = 'master' | 'a' | 'b';

/** No filters: the sound as it comes in. */
export function defaultFilters(): AudioFilters {
  return { lowCut: false, bassDb: 0, midDb: 0, trebleDb: 0, gate: false, gateDb: -50, compressor: false, noiseSuppression: false };
}

/**
 * How much a source is on air on the Live Screen (the stream): 1 on air,
 * 0 off, and in between while a transition or the T-bar moves, so sound
 * fades with the picture.
 */
export function onAirAmount(show: Show, id: string, now: number): number {
  const sc = show.screens.live;
  const p = transitionProgress(sc, now);
  if (p < 1 && sc.transition && sc.previous !== null) {
    // Dip goes through silence, like it goes through black.
    const k = sc.transition.kind === 'dip' ? mixAt('dip', p) : null;
    if (id === sc.program) return k ? (p < 0.5 ? 0 : 1 - k.black) : p;
    if (id === sc.previous) return k ? (p < 0.5 ? 1 - k.black : 0) : 1 - p;
    return 0;
  }
  if (sc.tbar > 0 && sc.preview !== null && sc.preview !== sc.program) {
    if (id === sc.preview) return sc.tbar;
    if (id === sc.program) return 1 - sc.tbar;
  }
  return id === sc.program ? 1 : 0;
}

/** A channel's level after its fader, mute and audio-follows-video (before the mixes). */
export function channelLevel(show: Show, src: Source, now: number): number {
  if (src.muted) return 0;
  let level = faderToGain(src.volume);
  if (src.audio.follow) {
    level *= onAirAmount(show, src.id, now);
    // Blank and PANIC take the picture's sound down with it.
    const live = show.screens.live;
    level *= 1 - Math.max(fadeAmount(live.blank, live.blankChangedAt, now, live.blankFadeMs), fadeAmount(show.panic, show.panicChangedAt, now));
  }
  return level;
}

/** How much of a channel goes into one mix (0 if not sent or the mix is muted). */
export function mixSend(show: Show, src: Source, mix: Mix): number {
  switch (mix) {
    case 'master':
      return src.audio.toMaster && !show.audio.masterMuted ? faderToGain(show.masterVolume) : 0;
    case 'a':
      return src.audio.toA && !show.audio.a.muted ? faderToGain(show.audio.a.volume) : 0;
    case 'b':
      return src.audio.toB && !show.audio.b.muted ? faderToGain(show.audio.b.volume) : 0;
  }
}

/** Sources that make sound, in mixer order. */
export function soundSources(show: Show): Source[] {
  return show.sources.filter((s) => s.kind.type === 'video' || s.kind.type === 'microphone' || s.kind.type === 'stream');
}

/** True while levels are changing on their own (transitions, T-bar, fades). */
export function levelsMoving(show: Show, now: number): boolean {
  const live = show.screens.live;
  return transitionProgress(live, now) < 1 || now - live.blankChangedAt < 400 || now - show.panicChangedAt < 400;
}

/**
 * Fader position (0–1, as stored) → loudness, on a curve that feels like a
 * real desk: most of the travel is the useful range. Top = full level.
 */
export function faderToGain(x: number): number {
  return x <= 0 ? 0 : x * x;
}

/** Loudness as decibels for the meters (−60 dB floor). */
export function toDb(level: number): number {
  return level <= 0.001 ? -60 : Math.max(-60, 20 * Math.log10(level));
}
