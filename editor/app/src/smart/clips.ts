// Clips for social: the strongest stand-alone moments of a long sequence
// (like Opus Clip, Vizard or Riverside's Magic Clips), each starting and
// ending on whole sentences, ranked, and each made into its own short
// sequence: vertical or square, with captions that light up as words are
// said. Moments are scored as the highlight reel scores them (key words, the
// room reacting, highlight markers, energy, someone new talking) and a moment
// that opens with a question or a strong line, and ends on a finished
// sentence, ranks higher.
import { addCaptionTrack, CAPTION_LOOKS, captionBlocks, placeCaptions, rulesFor, sequenceWords } from '../model/captions';
import { current, editSeq, rate } from '../model/seq';
import { DEFAULT_CAPTION_STYLE, DEFAULT_TEXT, newClip, uid, type CaptionStyle, type Clip, type Project, type Sequence } from '../model/types';
import { buildReel, type HighlightInput, type Scores } from './highlights';
import { aspectSize, reframedSequence, type Aspect } from './reframe';

export interface Sentence {
  /** Seconds. */
  from: number;
  to: number;
  text: string;
}

/** The transcript as sentences: a new one after . ? ! or a pause of `gap` seconds. */
export function sentences(words: { w: string; from: number; to: number }[], gap = 0.8): Sentence[] {
  const out: Sentence[] = [];
  let cur: { from: number; to: number; words: string[] } | null = null;
  for (const w of words) {
    const t = w.w.trim();
    if (!t) continue;
    if (cur && w.from - cur.to >= gap) {
      out.push({ from: cur.from, to: cur.to, text: cur.words.join(' ') });
      cur = null;
    }
    if (!cur) cur = { from: w.from, to: w.to, words: [t] };
    else {
      cur.words.push(t);
      cur.to = Math.max(cur.to, w.to);
    }
    if (/[.?!…]["”’)]?$/.test(t)) {
      out.push({ from: cur.from, to: cur.to, text: cur.words.join(' ') });
      cur = null;
    }
  }
  if (cur) out.push({ from: cur.from, to: cur.to, text: cur.words.join(' ') });
  return out;
}

export interface FinderOptions {
  /** How many clips (most). */
  count: number;
  /** Shortest and longest clip (seconds). */
  min: number;
  max: number;
}

export const FINDER_DEFAULTS: FinderOptions = { count: 5, min: 20, max: 60 };

export interface SocialClip {
  id: string;
  /** Seconds into the sequence. */
  from: number;
  to: number;
  /** 1–99: how strong it is against the other candidates. */
  strength: number;
  /** Its first line (a title for it). */
  title: string;
  why: string;
}

const clean = (w: string): string =>
  w
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, '')
    .trim();

/** A line that makes people stay: a question, a number, "you", a strong opener, or a key word (and one that starts mid-thought doesn't). */
export function hookScore(line: string, keywords: string[]): number {
  const l = line.toLowerCase();
  let s = 0;
  if (/\?\s*$/.test(line)) s += 1;
  if (/\b\d+\b/.test(l)) s += 0.4;
  if (/^(so|here'?s|this is|the (secret|truth|reason)|what|why|how|never|nobody|everyone|imagine|listen)\b/.test(clean(l))) s += 0.6;
  if (/\byou\b/.test(l)) s += 0.3;
  if (keywords.some((k) => k && l.includes(clean(k)))) s += 0.8;
  // Starting mid-thought ("and then…", "but…") loses people.
  if (/^(and|but|because|or|then|also|which)\b/.test(clean(l))) s -= 0.5;
  return s;
}

/**
 * The best stand-alone moments: every run of whole sentences between `min`
 * and `max` seconds is a candidate, scored by the moment scores over it (dead
 * air counts against it), its opening line and whether it ends cleanly; the
 * best that don't overlap are kept, in order of strength.
 */
export function findClips(inp: HighlightInput, scores: Scores, o: FinderOptions, duration: number): SocialClip[] {
  const hop = inp.hop;
  const n = scores.total.length;
  // Running sums for averages over any range.
  const sum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sum[i + 1] = (sum[i] as number) + (scores.total[i] as number);
  const talk = new Uint8Array(n);
  for (const w of inp.words) for (let i = Math.max(0, Math.floor(w.from / hop)); i <= Math.min(n - 1, Math.floor(w.to / hop)); i++) talk[i] = 1;
  const busy = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) busy[i + 1] = (busy[i] as number) + ((talk[i] as number) || (scores.reaction[i] as number) ? 1 : 0);
  const avg = (a: number, b: number, arr: Float64Array) => {
    const i = Math.max(0, Math.min(n, Math.floor(a / hop)));
    const j = Math.max(i + 1, Math.min(n, Math.ceil(b / hop)));
    return ((arr[j] as number) - (arr[i] as number)) / (j - i);
  };
  const said = sentences(inp.words);
  const candidates: { from: number; to: number; score: number; title: string; why: string }[] = [];
  const consider = (from: number, to: number, title: string, ended: boolean) => {
    // Room after the last word for the room's reaction (up to 3 seconds).
    let end = to;
    while (end - from < o.max && end < duration && end < to + 3 && (scores.reaction[Math.min(n - 1, Math.floor(end / hop))] as number)) end += hop;
    const base = avg(from, end, sum);
    const alive = avg(from, end, busy);
    const hook = hookScore(title, inp.keywords);
    const reacted = scores.reaction.slice(Math.floor(from / hop), Math.ceil(end / hop)).some((x) => x === 1);
    const marked = inp.markers.some((m) => m.at >= from - 2 && m.at <= end + 12 && /replay|highlight|best|goal|score|wow|great|clip/i.test(m.name));
    const score = Math.max(0, base) * (0.5 + 0.5 * alive) * (1 + 0.35 * hook + (ended ? 0.1 : 0));
    const why = [marked ? 'marked' : '', reacted ? 'the room reacts' : '', hook >= 0.8 ? 'strong opening' : ''].filter(Boolean).join(', ') || 'lively';
    candidates.push({ from: Math.max(0, from - 0.15), to: Math.min(duration, end + 0.25), score, title, why });
  };
  if (said.length) {
    for (let i = 0; i < said.length; i++) {
      const first = said[i] as Sentence;
      for (let j = i; j < said.length; j++) {
        const last = said[j] as Sentence;
        const len = last.to - first.from;
        if (len > o.max) break;
        if (len < o.min) continue;
        consider(first.from, last.to, first.text, /[.?!…]["”’)]?$/.test(last.text));
      }
    }
  }
  if (!candidates.length) {
    // No transcript: even windows.
    const len = Math.min(o.max, Math.max(o.min, (o.min + o.max) / 2));
    for (let t = 0; t + len <= duration; t += 1) consider(t, t + len, '', false);
  }
  if (!candidates.length) return [];
  // Strength: how far above the typical candidate.
  const values = candidates.map((c) => c.score);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) || 1;
  candidates.sort((a, b) => b.score - a.score);
  const picked: SocialClip[] = [];
  for (const c of candidates) {
    if (picked.length >= o.count) break;
    if (picked.some((p) => c.from < p.to + 2 && c.to > p.from - 2)) continue;
    picked.push({
      id: uid('sc'),
      from: c.from,
      to: c.to,
      strength: Math.max(1, Math.min(99, Math.round(60 + 15 * ((c.score - mean) / sd)))),
      title: c.title.length > 70 ? `${c.title.slice(0, 67).trimEnd()}…` : c.title,
      why: c.why,
    });
  }
  return picked;
}

export interface MakeOptions {
  aspect: Aspect | 'same';
  /** A caption look's name (CAPTION_LOOKS), or null for no captions. */
  captions: string | null;
  /** The clip's first line as a title over its first seconds. */
  title: boolean;
}

/**
 * A clip's own sequence, opened: the moment cut out of the sequence (its
 * picture filling a vertical or square frame when asked), captions in a
 * social look made from the transcript, and its first line as a title.
 */
export function makeClipSequence(p: Project, source: Sequence, clip: SocialClip, index: number, o: MakeOptions): { project: Project; sequence: string } {
  let seq = buildReel(source, [{ id: clip.id, from: clip.from, to: clip.to, score: 0, why: '', text: '' }], {
    fade: 0,
    title: null,
    name: `${source.name} clip ${index + 1}`,
  });
  // The source's own captions are made again in the clip's look and shape.
  if (o.captions) seq = { ...seq, tracks: seq.tracks.filter((t) => !t.captions), clips: seq.clips.filter((c) => c.source.kind !== 'caption') };
  if (o.aspect !== 'same') seq = reframedSequence(seq, o.aspect, new Map(), seq.name);
  let q: Project = { ...p, sequences: [...p.sequences, seq], open: seq.id };
  if (o.captions) {
    const look = CAPTION_LOOKS.find((l) => l.name === o.captions);
    const style: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, ...(look?.style ?? {}) };
    const made = addCaptionTrack(q, style);
    q = made.project;
    const s = current(q);
    const words = sequenceWords(q, s);
    if (words.length) q = placeCaptions(q, captionBlocks(words, rate(s), rulesFor(style)), made.id).project;
  }
  if (o.title && clip.title) {
    const fps = rate(seq);
    q = editSeq(q, (s) => {
      const top = s.tracks.filter((t) => t.kind === 'video' && !t.captions).at(-1);
      if (!top) return s;
      const length = Math.min(Math.round(3.5 * fps), Math.max(1, ...s.clips.map((c) => c.start + c.length)));
      const tall = s.height > s.width;
      const text = newClip(
        top.id,
        0,
        length,
        {
          kind: 'text',
          text: { ...DEFAULT_TEXT, text: clip.title, size: tall ? 64 : 72, py: tall ? 0.18 : 0.14, box: true, boxOpacity: 70, boxRadius: 12, shadow: 0 },
        },
        clip.title,
      );
      return { ...s, clips: [...s.clips.filter((c) => !(c.track === top.id && c.start < length)), text] };
    });
  }
  return { project: q, sequence: seq.id };
}

/** The size a clip's sequence will be. */
export const clipSize = (s: Sequence, aspect: Aspect | 'same'): { width: number; height: number } =>
  aspect === 'same' ? { width: s.width, height: s.height } : aspectSize(s, aspect);

/** Picture clips of a sequence given followed framing (by clip id). */
export function withMotions(p: Project, seqId: string, motions: Map<string, Clip['motion']>): Project {
  if (!motions.size) return p;
  return {
    ...p,
    sequences: p.sequences.map((s) =>
      s.id !== seqId ? s : { ...s, clips: s.clips.map((c) => (motions.has(c.id) ? { ...c, motion: motions.get(c.id) as Clip['motion'] } : c)) },
    ),
  };
}
