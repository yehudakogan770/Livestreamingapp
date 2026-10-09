// Clip > Match loudness: the chosen sound clips made equally loud, like
// Premiere's auto-match and Resolve's dialogue level matching. Each clip's
// loudness is measured on the part of its file it uses, the way loudness
// meters gate it (quiet gaps and silence don't count), and its volume is moved
// to the middle clip's.
import { isAnim, valueAt } from '../model/anim';
import { current, rate, trackOf } from '../model/seq';
import type { Clip, Param, Project, Sequence } from '../model/types';
import { selectedIds, type Doc } from '../doc';
import { peaksOf } from './analysis';
import { levelAt } from './envelope';

/** The quietest a measured window can be to count (dB). */
const ABSOLUTE_GATE = -60;
/** Windows this far below the loud ones don't count either (dB, like EBU R128's relative gate). */
const RELATIVE_GATE = -20;
const WINDOW = 0.4;

/** A sound's gated loudness (dB) from its waveform, over [from, to) seconds of the file; null when it is silent. */
export function gatedLoudness(peaks: Uint8Array, from: number, to: number): number | null {
  const levels: number[] = [];
  for (let t = from; t + WINDOW / 2 < to; t += WINDOW / 2) {
    const db = levelAt(peaks, t, Math.min(WINDOW, to - t));
    if (db > ABSOLUTE_GATE) levels.push(db);
  }
  if (!levels.length) return null;
  const power = (list: number[]) => 10 * Math.log10(list.reduce((a, d) => a + 10 ** (d / 10), 0) / list.length);
  const first = power(levels);
  const kept = levels.filter((d) => d > first + RELATIVE_GATE);
  return power(kept.length ? kept : levels);
}

/** The seconds of its file a clip plays (forward or backward). */
export function clipRange(c: Clip, s: Sequence): [number, number] | null {
  if (c.source.kind !== 'media') return null;
  const fps = rate(s);
  const a = c.source.in;
  return [a, a + (c.length * c.speed) / fps];
}

/** The change (dB) that brings each loudness to the target; a silent one stays as it is. Kept within ±24 dB. */
export function matchChanges(loudness: (number | null)[], target: number): number[] {
  return loudness.map((l) => (l === null ? 0 : Math.max(-24, Math.min(24, target - l))));
}

/** The middle of the measured loudnesses (what the others are matched to unless one is chosen). */
export function middle(loudness: (number | null)[]): number | null {
  const v = loudness.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? (v[m] as number) : ((v[m - 1] as number) + (v[m] as number)) / 2;
}

/** A volume (dB, maybe a volume line) moved by `by` dB everywhere. */
export function shiftGain(g: Param, by: number): Param {
  if (isAnim(g)) return { k: g.k.map((k) => ({ ...k, v: k.v + by })) };
  return Math.round((g + by) * 10) / 10;
}

/** Apply the changes to the clips (by id). */
export function applyMatch(p: Project, s: Sequence, changes: Map<string, number>): Project {
  return {
    ...p,
    sequences: p.sequences.map((q) =>
      q.id !== s.id ? q : { ...q, clips: q.clips.map((c) => (changes.has(c.id) ? { ...c, gain: shiftGain(c.gain, changes.get(c.id) as number) } : c)) },
    ),
  };
}

/** The selected sound clips that can be measured (on sound tracks, from files with sound). */
export function soundClips(p: Project): Clip[] {
  const s = current(p);
  return s.clips.filter(
    (c) => c.source.kind === 'media' && trackOf(s, c.track)?.kind === 'audio' && p.media.find((m) => m.id === (c.source as { media: string }).media)?.hasAudio,
  );
}

/**
 * Match the selected sound clips' loudness to the middle one's. Says what it
 * did (or why it could not).
 */
export async function matchLoudness(doc: Doc): Promise<string> {
  const p = doc.project;
  const s = current(p);
  const sel = new Set(selectedIds(doc.state.selection));
  const clips = soundClips(p).filter((c) => sel.has(c.id));
  if (clips.length < 2) return 'Select two or more sound clips to match.';
  const measured: (number | null)[] = [];
  for (const c of clips) {
    const m = p.media.find((x) => x.id === (c.source as { media: string }).media);
    const range = clipRange(c, s);
    if (!m || !range) {
      measured.push(null);
      continue;
    }
    const raw = gatedLoudness(await peaksOf(m), range[0], range[1]);
    // What is heard: the file's loudness plus the clip's volume now.
    measured.push(raw === null ? null : raw + valueAt(c.gain, Math.floor(c.length / 2)));
  }
  const target = middle(measured);
  if (target === null) return 'The selected clips are silent.';
  const changes = matchChanges(measured, target);
  const map = new Map(clips.map((c, i) => [c.id, changes[i] as number]));
  const moved = changes.filter((d) => Math.abs(d) >= 0.1).length;
  if (!moved) return 'The selected clips are already equally loud.';
  doc.edit((q) => applyMatch(q, current(q), map), 'Match loudness');
  return `Matched ${clips.length} clips (${moved} changed, up to ${Math.max(...changes.map(Math.abs)).toFixed(1)} dB).`;
}
