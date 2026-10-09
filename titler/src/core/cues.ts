// Audio cues: cue markers with a sound play it when the graphic reaches them.
// The same timing rules as the picture (timeline.ts): the IN plays once from
// the take, cues in a loop come round every time the loop does, and the OUT's
// cues play from the moment the graphic is taken off. Times here are seconds
// on whatever clock the caller uses (Lumora: wall-clock seconds; Studio: the
// clip's seconds; the designer: the composition's own).

import { cueTime } from './timeline';
import type { Asset, Composition, CueMarker, CueMix, TitleProject } from './types';

export const CUE_MIXES: CueMix[] = ['stream', 'hall', 'recording'];
export const CUE_MIX_NAMES: Record<CueMix, string> = { stream: 'Stream', hall: 'Hall', recording: 'Recording' };

/** The mixes a cue plays on (the Stream mix when none is chosen). */
export function cueMixes(q: Pick<CueMarker, 'mixes'>): CueMix[] {
  if (!Array.isArray(q.mixes)) return ['stream'];
  return CUE_MIXES.filter((m) => q.mixes!.includes(m));
}

/** A cue's loudness as a gain (its `gain` is decibels, 0 when left out). */
export const cueGain = (q: Pick<CueMarker, 'gain'>) => 10 ** (Math.max(-60, Math.min(12, q.gain ?? 0)) / 20);

export interface CueEvent {
  cue: CueMarker;
  /** The sound asset it plays. */
  sound: Asset;
  /** When it plays, on the caller's clock (seconds). */
  at: number;
}

const EPS = 1e-6;

/** Cues with a sound that exists in the project. */
function sounding(p: TitleProject, c: Composition): { cue: CueMarker; sound: Asset }[] {
  const out: { cue: CueMarker; sound: Asset }[] = [];
  for (const cue of c.cues) {
    if (!cue.sound || !Number.isFinite(cue.t)) continue;
    const sound = p.assets.find((a) => a.id === cue.sound && a.kind === 'audio');
    if (sound) out.push({ cue, sound });
  }
  return out;
}

/**
 * The cues that play in [from, to) for a graphic taken at `inAt` (and taken
 * off at `outAt`, or still on air when null), in time order. A cue whose
 * place is cut short (taken off during the IN) does not play.
 */
export function cueEvents(p: TitleProject, c: Composition, inAt: number, outAt: number | null, from: number, to: number): CueEvent[] {
  const out: CueEvent[] = [];
  const { outStart, loop } = c.markers;
  const len = loop ? loop.end - loop.start : 0;
  const onAirUntil = outAt ?? Infinity;
  for (const { cue, sound } of sounding(p, c)) {
    const t = cue.t;
    if (t < outStart - EPS) {
      // IN and HOLD: where the composition shows t, once (and every time round a loop).
      const add = (s: number) => {
        const at = inAt + s;
        if (at < from - EPS || at >= to - EPS || at >= onAirUntil - EPS) return;
        if (Math.abs(cueTime(c, s, null).t - t) > 1e-4) return;
        out.push({ cue, sound, at });
      };
      add(t);
      if (loop && len > 1e-3 && t >= loop.start - EPS && t < loop.end - EPS) {
        const first = Math.max(1, Math.ceil((from - inAt - t) / len - EPS));
        const last = Math.floor((Math.min(to, onAirUntil) - inAt - t) / len + EPS);
        for (let n = first; n <= last && n - first < 10_000; n++) add(t + n * len);
      }
    } else if (outAt !== null && t <= c.duration + EPS) {
      const at = outAt + (t - outStart);
      if (at >= from - EPS && at < to - EPS) out.push({ cue, sound, at });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * A title clip in an edit `length` seconds long: its cues, in clip seconds
 * (the IN from the clip's start, the OUT ending with the clip).
 */
export function clipCueEvents(p: TitleProject, c: Composition, length: number): CueEvent[] {
  const outLen = Math.max(0, c.duration - c.markers.outStart);
  const outAt = Math.max(Math.min(c.markers.inEnd, length), length - outLen);
  // The same split as the picture's (timeline.ts clipTime).
  return cueEvents(p, c, 0, outAt, 0, length);
}

/** The composition played straight through from `from` to `to` (the designer's render): cue times from `from`. */
export function straightCueEvents(p: TitleProject, c: Composition, from: number, to: number): CueEvent[] {
  return sounding(p, c)
    .filter(({ cue }) => cue.t >= from - EPS && cue.t < to - EPS)
    .map(({ cue, sound }) => ({ cue, sound, at: cue.t - from }))
    .sort((a, b) => a.at - b.at);
}
