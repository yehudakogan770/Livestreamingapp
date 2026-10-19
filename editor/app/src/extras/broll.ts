// Automatic B-roll from your own media: while someone talks about a thing,
// a shot that shows it goes over them. The transcript says what is talked
// about; the picture index (media search's objects and scenes, worked out on
// this computer) says which shots show it. Each shot is put on a track of its
// own above the edit, as ordinary clips to keep, move or delete.
import { sequenceWords, type SeqWord } from '../model/captions';
import { end, rate } from '../model/seq';
import { newClip, newTrack, type Clip, type MediaItem, type Project, type Sequence } from '../model/types';
import { labelMatches, norm, type LookIndex } from './search';

/** One shot to put over the talking. */
export interface BrollPick {
  /** Sequence frames it covers. */
  from: number;
  to: number;
  media: string;
  /** Seconds into the file. */
  in: number;
  /** The word heard, and what the shot shows. */
  word: string;
  label: string;
  /** The sentence it goes over (for the list). */
  said: string;
  score: number;
}

export interface BrollOptions {
  /** The longest a shot stays up (seconds). */
  longest: number;
  /** The shortest worth showing (seconds). */
  shortest: number;
  /** At least this long between shots (seconds). */
  gap: number;
  /** How sure the picture models must be (0–1). */
  sure: number;
}

export const BROLL_DEFAULTS: BrollOptions = { longest: 5, shortest: 2, gap: 4, sure: 0.35 };

/** Words that never ask for a picture. */
const STOP = new Set(
  (
    'the a an and or but if then so of to in on at by for with from up down out over under again about into onto off than too very can will just ' +
    'is are was were be been being am do does did have has had having i me my we our you your he him his she her it its they them their this that ' +
    'these those there here what which who whom whose when where why how all any both each few more most other some such no nor not only own same ' +
    'yes yeah okay ok right well now today tonight time thing things something anything everything one two three going get got make made like know ' +
    'think want really good great thank thanks please people person man woman way lot much many us let say said see look come go'
  ).split(' '),
);

/** The words of a phrase that could be pictured (nouns, mostly): not too short, not small talk. */
export function pictureWords(words: string[]): string[] {
  const out: string[] = [];
  for (const w of words) {
    const n = norm(w);
    if (n.length < 3 || STOP.has(n) || /^\d+$/.test(n)) continue;
    // Plurals as the models name things ("dogs" → "dog").
    const one = n.length > 3 && n.endsWith('s') && !n.endsWith('ss') ? n.slice(0, -1) : n;
    if (!out.includes(one)) out.push(one);
  }
  return out;
}

/** The transcript in phrases: [first word, last word], split at pauses and at the end of sentences. */
export function phrases(words: SeqWord[], fps: number): [number, number][] {
  const out: [number, number][] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const last = out[out.length - 1];
    const split = !prev || !last || w.from - prev.to > fps * 0.6 || /[.!?]$/.test(prev.w) || w.to - (words[last[0]] as SeqWord).from > fps * 10;
    if (split) out.push([i, i]);
    else last[1] = i;
  });
  return out;
}

/** Stretches of a file (seconds) whose frames show a word, with how sure the models were. */
export function shotsShowing(index: LookIndex, word: string, sure: number): { from: number; to: number; label: string; score: number }[] {
  const out: { from: number; to: number; label: string; score: number }[] = [];
  let cur: { from: number; to: number; label: string; score: number } | null = null;
  for (const l of index.looks) {
    const hit = l.labels.find(([name, p]) => p >= sure && labelMatches(name, word));
    if (hit) {
      if (cur && l.t - cur.to <= index.every * 1.5) {
        cur.to = l.t + index.every / 2;
        cur.score = Math.max(cur.score, hit[1]);
      } else {
        cur = { from: Math.max(0, l.t - index.every / 2), to: l.t + index.every / 2, label: hit[0], score: hit[1] };
        out.push(cur);
      }
    } else cur = null;
  }
  return out;
}

/** The files seen in the picture at a frame (they are what is being talked over, never B-roll for it). */
function onScreen(p: Project, s: Sequence, frame: number): Set<string> {
  const out = new Set<string>();
  for (const c of s.clips) {
    if (frame < c.start || frame >= end(c)) continue;
    if (c.source.kind === 'media') out.add(c.source.media);
    if (c.source.kind === 'multicam') {
      const src = c.source;
      for (const a of p.groups.find((g) => g.id === src.group)?.angles ?? []) out.add(a.media);
    }
  }
  return out;
}

/**
 * Shots to put over the talking: for each phrase, the best shot (from a file
 * not already in the picture there) that shows something it names; never
 * two too close together, and a stretch of a file is used once.
 */
export function planBroll(p: Project, s: Sequence, looks: Map<string, LookIndex>, o: BrollOptions = BROLL_DEFAULTS): BrollPick[] {
  const fps = rate(s);
  const words = sequenceWords(p, s);
  const media = new Map(p.media.map((m) => [m.id, m]));
  const used: { media: string; from: number; to: number }[] = [];
  const picks: BrollPick[] = [];
  let lastEnd = -Infinity;
  for (const [a, b] of phrases(words, fps)) {
    const first = words[a] as SeqWord;
    const last = words[b] as SeqWord;
    if (first.from < lastEnd + o.gap * fps) continue;
    const phraseWords = words.slice(a, b + 1).map((w) => w.w);
    const wanted = pictureWords(phraseWords);
    if (!wanted.length) continue;
    const busy = onScreen(p, s, first.from);
    let best: BrollPick | null = null;
    for (const [id, index] of looks) {
      const m = media.get(id) as MediaItem | undefined;
      if (!m || !m.hasVideo || m.missing || busy.has(id) || id === first.media) continue;
      for (const word of wanted) {
        for (const shot of shotsShowing(index, word, o.sure)) {
          const seconds = Math.min(o.longest, Math.max(o.shortest, (last.to - first.from) / fps), m.kind === 'image' ? o.longest : shot.to - shot.from);
          if (seconds < o.shortest - 1e-6) continue;
          // The middle of the stretch (where the models were surest it shows).
          const into = m.kind === 'image' ? 0 : Math.max(shot.from, Math.min(shot.to - seconds, (shot.from + shot.to) / 2 - seconds / 2));
          if (used.some((u) => u.media === id && into < u.to && into + seconds > u.from)) continue;
          const score = shot.score + (wanted.indexOf(word) === 0 ? 0.05 : 0);
          if (!best || score > best.score)
            best = {
              from: first.from,
              to: first.from + Math.round(seconds * fps),
              media: id,
              in: into,
              word,
              label: shot.label,
              said: phraseWords.join(' '),
              score,
            };
        }
      }
    }
    if (!best) continue;
    picks.push(best);
    used.push({ media: best.media, from: best.in, to: best.in + (best.to - best.from) / fps });
    lastEnd = best.to;
  }
  return picks;
}

/** The shots put on a new "B-roll" video track above every other picture track. */
export function placeBroll(p: Project, picks: BrollPick[]): { project: Project; track: string; count: number } {
  const s0 = p.sequences.find((x) => x.id === p.open);
  if (!s0 || !picks.length) return { project: p, track: '', count: 0 };
  const videos = s0.tracks.filter((t) => t.kind === 'video' && !t.captions);
  const track = { ...newTrack('video', videos.length + 1), name: 'B-roll' };
  // Above the last picture track (captions stay on top).
  const lastVideo = s0.tracks.reduce((at, t, i) => (t.kind === 'video' && !t.captions ? i : at), -1);
  const tracks = [...s0.tracks.slice(0, lastVideo + 1), track, ...s0.tracks.slice(lastVideo + 1)];
  const clips: Clip[] = picks.flatMap((k) => {
    const m = p.media.find((x) => x.id === k.media);
    if (!m) return [];
    const source = { kind: 'media' as const, media: m.id, in: k.in };
    return [{ ...newClip(track.id, k.from, Math.max(1, k.to - k.from), source, m.name), label: '#5d7a8c' }];
  });
  const s = { ...s0, tracks, clips: [...s0.clips, ...clips] };
  return { project: { ...p, sequences: p.sequences.map((x) => (x.id === s.id ? s : x)) }, track: track.id, count: clips.length };
}
