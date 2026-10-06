// One-click sound: "Enhance speech" puts a voice cleanup chain on dialogue
// clips (built from Lumora Studio's own effects, so each step can be tweaked
// or turned off), and ducking presets set how far music goes down under speech.
import { newEffect } from '../model/effects';
import { current, editSeq, trackOf } from '../model/seq';
import type { Clip, Effect, Project } from '../model/types';

/** The enhance-speech chain, in order: [effect, settings]. */
export const ENHANCE_CHAIN: [string, Record<string, number>][] = [
  ['eq', { lowCut: 80, lowMid: -1.5, highMid: 2, high: 1.5 }],
  ['denoise', { amount: 45 }],
  ['dehum', {}],
  ['deess', { amount: 40 }],
  ['compressor', { threshold: -24, ratio: 3, attack: 8, release: 120, makeup: 4 }],
  ['voice', { amount: 40 }],
  ['loudnorm', { target: -16, peak: -1.5 }],
];

const ENHANCE_TYPES = new Set(ENHANCE_CHAIN.map(([t]) => t));

/** A clip with the chain (its own earlier cleanup effects are replaced; other effects stay, before the chain). */
export function enhanceClip(c: Clip, mains: 50 | 60 = 60): Clip {
  const kept = c.effects.filter((e) => !ENHANCE_TYPES.has(e.type));
  const chain: Effect[] = ENHANCE_CHAIN.map(([type, set]) => {
    const e = newEffect(type);
    const p = { ...e.p, ...set };
    if (type === 'dehum') p.mains = mains === 50 ? 0 : 1;
    return { ...e, p };
  });
  return { ...c, effects: [...kept, ...chain] };
}

const isSound = (p: Project, c: Clip) => trackOf(current(p), c.track)?.kind === 'audio' && c.source.kind !== 'caption';

/** Enhance speech on the chosen sound clips. */
export function enhanceSpeech(p: Project, ids: string[], mains: 50 | 60 = 60): { project: Project; count: number } {
  let count = 0;
  const project = editSeq(p, (s) => ({
    ...s,
    clips: s.clips.map((c) => {
      if (!ids.includes(c.id) || !isSound(p, c)) return c;
      count++;
      return enhanceClip(c, mains);
    }),
  }));
  return { project, count };
}

export interface DuckPreset {
  id: string;
  name: string;
  about: string;
  p: Record<string, number>;
}

export const DUCK_PRESETS: DuckPreset[] = [
  {
    id: 'gentle',
    name: 'Gentle',
    about: 'Music dips a little under speech, and comes back slowly.',
    p: { threshold: -36, ratio: 3, attack: 60, release: 900 },
  },
  { id: 'podcast', name: 'Podcast', about: 'Music sits well under the voice; the usual choice.', p: { threshold: -32, ratio: 8, attack: 30, release: 500 } },
  {
    id: 'voiceover',
    name: 'Voice-over',
    about: 'Music drops right away for narration, and back up between lines.',
    p: { threshold: -34, ratio: 14, attack: 15, release: 350 },
  },
  { id: 'strong', name: 'Strong', about: 'Music nearly goes away while anyone talks.', p: { threshold: -30, ratio: 20, attack: 10, release: 600 } },
];

/**
 * Ducking on the chosen clips (their Duck effect is set to the preset, or
 * added). With no clips chosen, every clip on the sequence's Music tracks.
 * Speech tracks must be marked Speech for ducking to hear them.
 */
export function applyDuckPreset(p: Project, ids: string[], preset: DuckPreset): { project: Project; count: number } {
  let count = 0;
  const s = current(p);
  const music = new Set(s.tracks.filter((t) => t.kind === 'audio' && t.role === 'music').map((t) => t.id));
  const chosen = (c: Clip) => (ids.length ? ids.includes(c.id) : music.has(c.track)) && isSound(p, c) && trackOf(s, c.track)?.role !== 'dialogue';
  const project = editSeq(p, (seq) => ({
    ...seq,
    clips: seq.clips.map((c) => {
      if (!chosen(c)) return c;
      count++;
      const old = c.effects.find((e) => e.type === 'duck');
      if (old) return { ...c, effects: c.effects.map((e) => (e === old ? { ...e, on: true, p: { ...e.p, ...preset.p } } : e)) };
      const e = newEffect('duck');
      return { ...c, effects: [...c.effects, { ...e, p: { ...e.p, ...preset.p } }] };
    }),
  }));
  return { project, count };
}

/** No track is marked Speech: ducking has nothing to listen to. */
export const noSpeechTrack = (p: Project): boolean => !current(p).tracks.some((t) => t.kind === 'audio' && t.role === 'dialogue');
