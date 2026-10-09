// The mix (the Audio page): each sound track's own processing, buses that
// group tracks (all the dialogue, all the music) with their own processing
// and level, and the whole mix's processing and level. Clips' own effects
// come first, then the track's, then its bus's, then the mix's — the same
// order while editing and in the film.
import { newEffect } from './effects';
import { editSeq } from './seq';
import { uid, type Bus, type Effect, type Mix, type Project, type Sequence, type Track } from './types';

/** The processing a track, a bus or the mix can have, in the order it is applied. */
export const STRIP_FX = ['eq', 'compressor', 'limiter'] as const;
export type StripFxType = (typeof STRIP_FX)[number];

export const STRIP_FX_NAMES: Record<StripFxType, string> = { eq: 'EQ', compressor: 'Dynamics', limiter: 'Limiter' };

/** Where a strip is: a track's id, a bus's id, or the whole mix. */
export type StripId = string;
export const MASTER = 'master';

export const EMPTY_MIX: Mix = { buses: [], fx: [], volume: 0 };
export const mixOf = (s: Sequence): Mix => s.mix ?? EMPTY_MIX;

/** Effects that are switched on, in the order they are applied. */
export const activeFx = (fx: Effect[] | undefined): Effect[] =>
  (fx ?? []).filter((e) => e.on && (STRIP_FX as readonly string[]).includes(e.type)).sort((a, b) => order(a.type) - order(b.type));
const order = (t: string): number => (STRIP_FX as readonly string[]).indexOf(t);

/** Does the mix need its stages (otherwise every track goes straight into one mix, as before buses existed)? */
export function staged(s: Sequence): boolean {
  const m = s.mix;
  if (m && (m.buses.length > 0 || activeFx(m.fx).length > 0 || Math.abs(m.volume) > 1e-6)) return true;
  return s.tracks.some((t) => t.kind === 'audio' && (activeFx(t.fx).length > 0 || !!t.volumeLine?.length));
}

// ---------------------------------------------------------------------------
// Fader moves over time (automation).

/** A track's level (dB) at a frame: its recorded fader moves, or its fader. */
export function volumeAt(t: Track, frame: number): number {
  const line = t.volumeLine;
  if (!line?.length) return t.volume;
  const first = line[0] as [number, number];
  if (frame <= first[0]) return first[1];
  for (let i = 1; i < line.length; i++) {
    const [f1, v1] = line[i] as [number, number];
    if (frame <= f1) {
      const [f0, v0] = line[i - 1] as [number, number];
      return f1 === f0 ? v1 : v0 + ((v1 - v0) * (frame - f0)) / (f1 - f0);
    }
  }
  return (line[line.length - 1] as [number, number])[1];
}

/** Fewer points, the line kept within `tolerance` dB (Ramer-Douglas-Peucker). */
export function thinLine(points: [number, number][], tolerance = 0.25): [number, number][] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const [fa, va] = points[a] as [number, number];
    const [fb, vb] = points[b] as [number, number];
    let worst = -1;
    let far = tolerance;
    for (let i = a + 1; i < b; i++) {
      const [f, v] = points[i] as [number, number];
      const on = fb === fa ? va : va + ((vb - va) * (f - fa)) / (fb - fa);
      if (Math.abs(v - on) > far) {
        far = Math.abs(v - on);
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Fader moves recorded over part of the sequence put into a track's line:
 * what was there between the first and last recorded frame is replaced; the
 * line before and after is kept (as it was at the edges). At most 400 points.
 */
export function writeLine(old: [number, number][] | undefined, recorded: [number, number][], fader: number): [number, number][] {
  // In time order, the last move at each frame.
  const rec = [...recorded].sort((a, b) => a[0] - b[0]).filter((p, i, all) => i === all.length - 1 || (all[i + 1] as [number, number])[0] !== p[0]);
  if (!rec.length) return old ?? [];
  const from = (rec[0] as [number, number])[0];
  const to = (rec[rec.length - 1] as [number, number])[0];
  const base: Track = { volume: fader, volumeLine: old } as Track;
  const before = (old ?? []).filter(([f]) => f < from);
  const after = (old ?? []).filter(([f]) => f > to);
  // Where the old line was at the edges, so it doesn't jump.
  const edges: [number, number][] = [];
  if (old?.length && from > (old[0] as [number, number])[0]) edges.push([from - 1, volumeAt(base, from - 1)]);
  const tail: [number, number][] = old?.length && to < (old[old.length - 1] as [number, number])[0] ? [[to + 1, volumeAt(base, to + 1)]] : [];
  let tolerance = 0.25;
  let line = thinLine([...before, ...edges, ...rec, ...tail, ...after], tolerance);
  while (line.length > 400) {
    tolerance *= 2;
    line = thinLine(line, tolerance);
  }
  return line.map(([f, v]) => [Math.round(f), Math.round(v * 100) / 100]);
}

/** The whole line moved up or down (moving the fader when not recording). */
export const trimLine = (line: [number, number][], by: number): [number, number][] =>
  line.map(([f, v]) => [f, Math.max(-60, Math.min(12, Math.round((v + by) * 100) / 100))]);

/** The bus a track plays through (null: straight into the mix; a bus that is gone counts as none). */
export function busOf(s: Sequence, t: Track): Bus | null {
  return t.bus ? (mixOf(s).buses.find((b) => b.id === t.bus) ?? null) : null;
}

function editMix(p: Project, f: (m: Mix, s: Sequence) => Mix): Project {
  return editSeq(p, (s) => ({ ...s, mix: f(mixOf(s), s) }));
}

/** A new bus at 0 dB, named after how many there are. */
export function addBus(p: Project, name?: string): { project: Project; id: string } {
  const id = uid('b');
  const project = editMix(p, (m) => ({ ...m, buses: [...m.buses, { id, name: name ?? `Bus ${m.buses.length + 1}`, volume: 0, pan: 0, off: false, fx: [] }] }));
  return { project, id };
}

/** A bus taken away: its tracks go straight into the mix. */
export function removeBus(p: Project, id: string): Project {
  return editSeq(p, (s) => ({
    ...s,
    mix: { ...mixOf(s), buses: mixOf(s).buses.filter((b) => b.id !== id) },
    tracks: s.tracks.map((t) => (t.bus === id ? { ...t, bus: null } : t)),
  }));
}

export function updateBus(p: Project, id: string, change: Partial<Omit<Bus, 'id'>>): Project {
  return editMix(p, (m) => ({ ...m, buses: m.buses.map((b) => (b.id === id ? { ...b, ...change } : b)) }));
}

/** Send a track to a bus (null: straight into the mix). */
export function routeTrack(p: Project, track: string, bus: string | null): Project {
  return editSeq(p, (s) => ({ ...s, tracks: s.tracks.map((t) => (t.id === track ? { ...t, bus } : t)) }));
}

/** The whole mix's level (dB), heard and in the film. */
export function setMixVolume(p: Project, volume: number): Project {
  return editMix(p, (m) => ({ ...m, volume }));
}

/** A strip's effects. */
export function stripFx(s: Sequence, strip: StripId): Effect[] {
  if (strip === MASTER) return mixOf(s).fx;
  const bus = mixOf(s).buses.find((b) => b.id === strip);
  if (bus) return bus.fx;
  return s.tracks.find((t) => t.id === strip)?.fx ?? [];
}

/** Change a strip's effects. */
export function setStripFx(p: Project, strip: StripId, f: (fx: Effect[]) => Effect[]): Project {
  return editSeq(p, (s) => {
    if (strip === MASTER) return { ...s, mix: { ...mixOf(s), fx: f(mixOf(s).fx) } };
    if (mixOf(s).buses.some((b) => b.id === strip))
      return { ...s, mix: { ...mixOf(s), buses: mixOf(s).buses.map((b) => (b.id === strip ? { ...b, fx: f(b.fx) } : b)) } };
    return { ...s, tracks: s.tracks.map((t) => (t.id === strip ? { ...t, fx: f(t.fx ?? []) } : t)) };
  });
}

/** A strip's effect of a kind, made (switched on, at its defaults) if it has none. */
export function ensureFx(p: Project, strip: StripId, type: StripFxType): Project {
  return setStripFx(p, strip, (fx) => (fx.some((e) => e.type === type) ? fx.map((e) => (e.type === type ? { ...e, on: true } : e)) : [...fx, newEffect(type)]));
}

/** Change one setting of a strip's effect (made if needed). */
export function setFxParam(p: Project, strip: StripId, type: StripFxType, key: string, value: number): Project {
  return setStripFx(p, strip, (fx) => {
    const have = fx.find((e) => e.type === type) ?? newEffect(type);
    const next = { ...have, p: { ...have.p, [key]: value } };
    return fx.some((e) => e.type === type) ? fx.map((e) => (e.type === type ? next : e)) : [...fx, next];
  });
}

export function toggleFx(p: Project, strip: StripId, type: StripFxType, on: boolean): Project {
  return on ? ensureFx(p, strip, type) : setStripFx(p, strip, (fx) => fx.map((e) => (e.type === type ? { ...e, on: false } : e)));
}

/** A setting's number (fixed for strips: they have no keyframes). */
export function fxNumber(e: Effect | undefined, key: string, fallback: number): number {
  const v = e?.p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * The equalizer's response at a frequency (dB), drawn on the strip's curve:
 * the same low shelf (100 Hz), two bells (400 Hz, 2.5 kHz), high shelf (8 kHz)
 * and low cut that are heard and exported.
 */
export function eqResponse(e: Effect | undefined, f: number): number {
  if (!e) return 0;
  const g = (k: string) => fxNumber(e, k, 0);
  const shelf = (fc: number, gain: number, high: boolean) => {
    const x = Math.log2(f / fc);
    const s = 1 / (1 + Math.exp((high ? -1 : 1) * x * 3));
    return gain * s;
  };
  const bell = (fc: number, gain: number) => {
    const x = Math.log2(f / fc) / 1.1;
    return gain * Math.exp(-x * x * 2);
  };
  let db = shelf(100, g('low'), false) + bell(400, g('lowMid')) + bell(2500, g('highMid')) + shelf(8000, g('high'), true);
  const cut = g('lowCut');
  if (cut > 10) {
    // A 12 dB-a-octave high-pass.
    const r = f / cut;
    db += -10 * Math.log10(1 + 1 / r ** 4);
  }
  return db;
}

/** How much a compressor turns a level down (dB), for the strip's curve. */
export function compressorGainReduction(e: Effect | undefined, inputDb: number): number {
  if (!e) return 0;
  const t = fxNumber(e, 'threshold', -20);
  const r = Math.max(1, fxNumber(e, 'ratio', 4));
  return inputDb <= t ? 0 : (inputDb - t) * (1 - 1 / r);
}
