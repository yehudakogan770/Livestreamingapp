// Smart > Rough cut from a script: paste the script (or the order of what
// should be said), and Studio finds each line in what was recorded (the
// transcripts of every file), takes the best take of each, in the script's
// order, onto a new sequence. Other good takes of a line go on tracks above,
// hidden and muted, ready to swap in; lines that were never said get a
// marker. Like Resolve's IntelliScript and Avid's ScriptSync.
import { newClip, newSequence, uid, type Clip, type MediaItem, type Project, type Sequence, type Track } from '../model/types';

/** A word as matched: lower case, letters and digits only. */
export const token = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** The script's lines: a new one at each sentence end or line break (empty ones left out). */
export function scriptLines(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((para) => para.split(/(?<=[.?!])\s+/))
    .map((l) => l.trim())
    .filter((l) => l.split(/\s+/).map(token).filter(Boolean).length > 0);
}

/** One take of a line: where in which file, and how closely it matches (0–1). */
export interface Take {
  media: string;
  /** Seconds in the file. */
  from: number;
  to: number;
  score: number;
}

export interface LineMatch {
  line: string;
  best: Take | null;
  others: Take[];
}

/** The words of every transcribed file, in order, as tokens with their times. */
interface Corpus {
  media: string;
  words: { t: string; s: number; e: number }[];
  /** Where each token is said. */
  at: Map<string, number[]>;
}

function corpus(media: MediaItem[]): Corpus[] {
  return media
    .filter((m) => m.hasAudio && m.transcript?.words.length)
    .map((m) => {
      const words = (m.transcript?.words ?? []).map((w) => ({ t: token(w.w), s: w.s, e: w.e })).filter((w) => w.t);
      const at = new Map<string, number[]>();
      words.forEach((w, i) => at.set(w.t, [...(at.get(w.t) ?? []), i]));
      return { media: m.id, words, at };
    });
}

/** How many of the line's words are said, in order, in a stretch of the file; and the first and last of them. */
function lcs(line: string[], words: { t: string }[], from: number, to: number): { n: number; first: number; last: number } {
  const m = to - from;
  const L = line.length;
  // Lengths, and for each cell the first matched word of the best chain ending there.
  const len: number[][] = Array.from({ length: L + 1 }, () => new Array<number>(m + 1).fill(0));
  const start: number[][] = Array.from({ length: L + 1 }, () => new Array<number>(m + 1).fill(-1));
  for (let i = 1; i <= L; i++) {
    for (let j = 1; j <= m; j++) {
      if (line[i - 1] === (words[from + j - 1] as { t: string }).t) {
        len[i]![j] = len[i - 1]![j - 1]! + 1;
        start[i]![j] = start[i - 1]![j - 1]! >= 0 ? start[i - 1]![j - 1]! : from + j - 1;
      } else if (len[i - 1]![j]! >= len[i]![j - 1]!) {
        len[i]![j] = len[i - 1]![j]!;
        start[i]![j] = start[i - 1]![j]!;
      } else {
        len[i]![j] = len[i]![j - 1]!;
        start[i]![j] = start[i]![j - 1]!;
      }
    }
  }
  const n = len[L]![m]!;
  if (!n) return { n: 0, first: -1, last: -1 };
  // The last matched word: the first column where the full length is reached.
  let lastJ = m;
  while (lastJ > 1 && len[L]![lastJ - 1] === n) lastJ--;
  return { n, first: start[L]![lastJ]!, last: from + lastJ - 1 };
}

/** The lowest share of a line's words a take must have, in order, to count. */
export const ENOUGH = 0.6;

/** Every take of a line found in the files, best first (they don't overlap). */
export function findTakes(line: string, files: Corpus[]): Take[] {
  const want = line.split(/\s+/).map(token).filter(Boolean);
  if (!want.length) return [];
  const takes: Take[] = [];
  const span = Math.ceil(want.length * 1.5) + 2;
  for (const f of files) {
    // Places to look: around where the line's two rarest words are said (common words like "the" would mean looking everywhere).
    const anchors = new Set<number>();
    const rarest = [...new Set(want)].filter((w) => f.at.has(w)).sort((a, b) => (f.at.get(a)?.length ?? 0) - (f.at.get(b)?.length ?? 0));
    for (const w of rarest.slice(0, 2)) for (const i of f.at.get(w) ?? []) anchors.add(Math.max(0, i - want.indexOf(w)));
    const found: Take[] = [];
    for (const a of [...anchors].sort((x, y) => x - y).slice(0, 200)) {
      // Some slack before (words added when it was said) and after.
      const slack = Math.ceil(want.length * 0.25) + 1;
      const from = Math.max(0, a - slack);
      const to = Math.min(f.words.length, a + span);
      const m = lcs(want, f.words, from, to);
      if (m.n === 0) continue;
      // Matched words, less a little for extra words said in between.
      const extra = m.last - m.first + 1 - m.n;
      const score = m.n / want.length - 0.02 * Math.max(0, extra);
      if (score < ENOUGH) continue;
      const first = f.words[m.first] as { s: number };
      const last = f.words[m.last] as { e: number };
      found.push({ media: f.media, from: first.s, to: last.e, score: Math.min(1, score) });
    }
    takes.push(...found);
  }
  // Best first; a take overlapping a better one of the same file is the same take.
  takes.sort((a, b) => b.score - a.score || b.from - a.from);
  const kept: Take[] = [];
  for (const t of takes) if (!kept.some((k) => k.media === t.media && t.from < k.to && t.to > k.from)) kept.push(t);
  return kept;
}

/** The script matched line by line. When two takes are as good, the later one wins (the last take is usually the keeper). */
export function matchScript(lines: string[], media: MediaItem[]): LineMatch[] {
  const files = corpus(media);
  return lines.map((line) => {
    const takes = findTakes(line, files);
    return { line, best: takes[0] ?? null, others: takes.slice(1, 4) };
  });
}

export interface CutOptions {
  /** Silence kept before and after each line (seconds). */
  pad: number;
  /** Other takes on tracks above, hidden and muted. */
  alternates: boolean;
  name: string;
}

/** The rough cut: a new sequence of the best takes in the script's order, opened. */
export function buildRoughCut(p: Project, matches: LineMatch[], o: CutOptions): { project: Project; sequence: string; placed: number } {
  const used = matches.filter((m) => m.best);
  const firstMedia = p.media.find((m) => m.id === used[0]?.best?.media && m.hasVideo);
  const fps = firstMedia
    ? [23.976, 24, 25, 29.97, 30, 50, 59.94, 60].reduce((a, b) => (Math.abs(b - firstMedia.fps) < Math.abs(a - firstMedia.fps) ? b : a), 30)
    : 30;
  const alts = o.alternates ? Math.max(0, ...used.map((m) => m.others.length)) : 0;
  const seq: Sequence = newSequence(
    o.name,
    firstMedia ? Math.round(firstMedia.width / 2) * 2 || 1920 : 1920,
    firstMedia ? Math.round(firstMedia.height / 2) * 2 || 1080 : 1080,
    fps,
    1 + alts,
    1 + alts,
  );
  const video = seq.tracks.filter((t) => t.kind === 'video');
  const audio = seq.tracks.filter((t) => t.kind === 'audio');
  // Alternate takes' tracks: named, hidden and muted.
  video.slice(1).forEach((t, i) => Object.assign(t, { name: `Alt ${i + 1}`, off: true }));
  audio.slice(1).forEach((t, i) => Object.assign(t, { name: `Alt ${i + 1}`, off: true }));
  const clips: Clip[] = [];
  const markers: Sequence['markers'] = [];
  let at = 0;
  const place = (take: Take, start: number, v: Track | undefined, a: Track | undefined, most = Infinity): number => {
    const m = p.media.find((x) => x.id === take.media);
    if (!m) return 0;
    const from = Math.max(0, take.from - o.pad);
    const to = Math.min(m.duration || take.to + o.pad, take.to + o.pad);
    const length = Math.max(1, Math.min(most, Math.round((to - from) * fps)));
    const link = m.hasVideo ? uid('l') : null;
    if (m.hasVideo && v) clips.push({ ...newClip(v.id, start, length, { kind: 'media', media: m.id, in: from }, m.name), link });
    if (a) clips.push({ ...newClip(a.id, start, length, { kind: 'media', media: m.id, in: from }, m.name), link });
    return length;
  };
  for (const m of matches) {
    if (!m.best) {
      markers.push({ id: uid('k'), at, length: 0, name: `Not found: ${m.line.slice(0, 80)}`, color: '#a9443c' });
      continue;
    }
    const length = place(m.best, at, video[0], audio[0]);
    // Other takes sit over this one, no longer than it (so they never run into the next line's).
    if (o.alternates) m.others.forEach((t, i) => place(t, at, video[i + 1], audio[i + 1], length));
    at += length;
  }
  const out: Sequence = { ...seq, clips, markers };
  return { project: { ...p, sequences: [...p.sequences, out], open: out.id }, sequence: out.id, placed: used.length };
}
