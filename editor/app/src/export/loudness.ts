// Loudness delivery: the targets each destination asks for, a plain report of
// how a finished file measured against its target, and stems (dialogue,
// music and effects, each on its own) from the sequence's sound tracks.
import type { Project, Sequence, Track } from '../model/types';
import type { Loudness } from '../manage/native';

export interface LoudnessStandard {
  id: string;
  name: string;
  /** Integrated loudness (LUFS). */
  lufs: number;
  /** The highest true peak allowed (dBTP). */
  truePeak: number;
}

/** What each place asks for. */
export const STANDARDS: LoudnessStandard[] = [
  { id: 'youtube', name: 'YouTube, Spotify, streaming', lufs: -14, truePeak: -1 },
  { id: 'podcast', name: 'Podcasts (Apple, Spotify)', lufs: -16, truePeak: -1 },
  { id: 'ebu', name: 'Broadcast, EBU R128', lufs: -23, truePeak: -1 },
  { id: 'atsc', name: 'US broadcast, ATSC A/85', lufs: -24, truePeak: -2 },
];

/** The standard a target matches (by its loudness). */
export const standardFor = (lufs: number): LoudnessStandard | undefined => STANDARDS.find((s) => Math.abs(s.lufs - lufs) < 0.05);

export interface LoudnessReport {
  /** Within ±1 LU of the target and under the peak ceiling (or no target). */
  ok: boolean;
  /** One line for the render queue. */
  line: string;
  /** What to do, when it is off. */
  advice: string | null;
}

const fmt = (v: number, unit: string) => `${v <= -100 ? '−∞' : (Math.round(v * 10) / 10).toFixed(1).replace('-', '−')} ${unit}`;

/** How a finished file measured, against its target (null: no target was set). */
export function loudnessReport(m: Loudness, target: { lufs: number; truePeak: number } | null): LoudnessReport {
  const measured = `${fmt(m.integrated, 'LUFS')} integrated, ${fmt(m.truePeak, 'dBTP')} true peak, ${fmt(m.range, 'LU')} range`;
  if (!target) return { ok: true, line: `Loudness: ${measured}.`, advice: null };
  const std = standardFor(target.lufs);
  const name = std ? `${std.name} ${fmt(target.lufs, 'LUFS')}` : fmt(target.lufs, 'LUFS');
  const off = m.integrated - target.lufs;
  const peakOver = m.truePeak > target.truePeak + 0.1;
  const ok = Math.abs(off) <= 1 && !peakOver;
  let advice: string | null = null;
  if (m.integrated < -60) advice = 'It is nearly silent: check that the sound tracks are not muted.';
  else if (Math.abs(off) > 1)
    advice = `It is ${fmt(Math.abs(off), 'LU').replace('−', '')} ${off > 0 ? 'louder' : 'quieter'} than the target. Very quiet or very dynamic mixes can miss it: compress the dialogue a little, or raise the mix, and export again.`;
  else if (peakOver) advice = `Peaks reach ${fmt(m.truePeak, 'dBTP')}, over the ${fmt(target.truePeak, 'dBTP')} ceiling: add a limiter to the mix.`;
  return { ok, line: `Loudness: ${measured} (target ${name}: ${ok ? 'on target' : 'off target'}).`, advice };
}

// ---------------------------------------------------------------- stems

export type StemKind = 'dialogue' | 'music' | 'effects';

export const STEM_NAMES: Record<StemKind, string> = { dialogue: 'Dialogue', music: 'Music', effects: 'Effects' };

/** Which stem a sound track feeds (tracks without a role are effects and everything else). */
export const stemOf = (t: Track): StemKind => (t.role === 'dialogue' ? 'dialogue' : t.role === 'music' ? 'music' : 'effects');

/** The stems this sequence has sound for (in range), in order. */
export function stemsIn(s: Sequence, range: { from: number; to: number }): StemKind[] {
  const have = new Set<StemKind>();
  for (const t of s.tracks) {
    if (t.kind !== 'audio' || t.off) continue;
    if (s.clips.some((c) => c.track === t.id && c.enabled && c.start < range.to && c.start + c.length > range.from)) have.add(stemOf(t));
  }
  return (['dialogue', 'music', 'effects'] as StemKind[]).filter((k) => have.has(k));
}

/** The project with only one stem's tracks heard in the sequence (the others muted, solos cleared). */
export function stemProject(p: Project, seq: string, stem: StemKind): Project {
  return {
    ...p,
    sequences: p.sequences.map((s) =>
      s.id !== seq ? s : { ...s, tracks: s.tracks.map((t) => (t.kind !== 'audio' ? t : { ...t, solo: false, off: t.off || stemOf(t) !== stem })) },
    ),
  };
}

/** Where a stem goes: next to the film, named after it ("Film - Dialogue.wav"). */
export const stemPath = (out: string, stem: StemKind): string => `${out.replace(/(_%0\dd)?\.[^.\\/]+$/, '')} - ${STEM_NAMES[stem]}.wav`;
