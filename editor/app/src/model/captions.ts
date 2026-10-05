// Captions and the transcript: the words heard in each file, placed on the
// sequence; caption blocks made from them on a captions track; splitting and
// joining blocks; and .srt / .vtt files for players and websites.
import { wrap } from '../../../../app/src/captions/lines';
import { extractRange } from './edit';
import { current, editSeq, end, rate, trackOf } from './seq';
import {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_TEXT,
  newClip,
  newTrack,
  uid,
  type CaptionStyle,
  type Clip,
  type Project,
  type Sequence,
  type TextData,
  type Track,
} from './types';

export const isCaptionTrack = (t: Track | undefined): boolean => !!t?.captions;
export const isCaptionClip = (c: Clip): boolean => c.source.kind === 'caption';
export const captionTracks = (s: Sequence): Track[] => s.tracks.filter((t) => t.captions);

// ---------------------------------------------------------------------------
// The words on the sequence.

/** A word as it is heard in the sequence (frames). */
export interface SeqWord {
  w: string;
  from: number;
  to: number;
  /** The clip it is heard in, and which word of its file's transcript it is. */
  clip: string;
  media: string;
  index: number;
}

const plain = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Every transcribed word heard in the sequence, in order. Sound clips are
 * read from their files' transcripts (speech tracks first); the same word
 * picked up by two microphones at once is kept once.
 */
export function sequenceWords(p: Project, s: Sequence): SeqWord[] {
  const fps = rate(s);
  const tracks = s.tracks.filter((t) => t.kind === 'audio' && !t.off);
  // Speech tracks first: when two microphones hear the same word, theirs is kept.
  tracks.sort((a, b) => (b.role === 'dialogue' ? 1 : 0) - (a.role === 'dialogue' ? 1 : 0));
  const all: SeqWord[] = [];
  for (const t of tracks) {
    for (const c of s.clips) {
      if (c.track !== t.id || !c.enabled || c.reverse || c.source.kind !== 'media') continue;
      const src = c.source;
      const m = p.media.find((x) => x.id === src.media);
      const words = m?.transcript?.words;
      if (!m || !words) continue;
      const outSec = src.in + (c.length * c.speed) / fps;
      words.forEach((w, index) => {
        const mid = (w.s + w.e) / 2;
        if (mid < src.in || mid >= outSec) return;
        const from = Math.max(c.start, c.start + Math.round(((w.s - src.in) * fps) / c.speed));
        const to = Math.min(end(c), Math.max(from + 1, c.start + Math.round(((w.e - src.in) * fps) / c.speed)));
        all.push({ w: w.w, from, to, clip: c.id, media: m.id, index });
      });
    }
  }
  // Sorted by time; a word already kept from another clip at the same time is a copy.
  const kept: SeqWord[] = [];
  const order = all.map((w, i) => [w, i] as const).sort((a, b) => a[0].from - b[0].from || a[1] - b[1]);
  for (const [w] of order) {
    let copy = false;
    for (let j = kept.length - 1; j >= 0 && j >= kept.length - 12; j--) {
      const k = kept[j] as SeqWord;
      if (k.clip === w.clip) continue;
      const overlap = Math.min(k.to, w.to) - Math.max(k.from, w.from);
      if (overlap > 0.5 * Math.min(k.to - k.from, w.to - w.from) && plain(k.w) === plain(w.w)) {
        copy = true;
        break;
      }
    }
    if (!copy) kept.push(w);
  }
  return kept;
}

/** The sequence ranges ([from, to) frames) that a set of chosen words cover, one per run of neighboring words. */
export function wordRanges(words: SeqWord[], chosen: number[]): [number, number][] {
  const idx = [...new Set(chosen)].filter((i) => i >= 0 && i < words.length).sort((a, b) => a - b);
  const out: [number, number][] = [];
  let run: number[] = [];
  const flush = () => {
    if (!run.length) return;
    const first = words[run[0] as number] as SeqWord;
    const last = words[run[run.length - 1] as number] as SeqWord;
    const r: [number, number] = [first.from, Math.max(first.from + 1, last.to)];
    const prev = out[out.length - 1];
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]);
    else out.push(r);
    run = [];
  };
  for (const i of idx) {
    if (run.length && i !== (run[run.length - 1] as number) + 1) flush();
    run.push(i);
  }
  flush();
  return out;
}

/** Take the chosen words out of the sequence: each range is cut out of every unlocked track and the rest closes up. */
export function deleteWords(p: Project, words: SeqWord[], chosen: number[]): Project {
  const ranges = wordRanges(words, chosen);
  let out = p;
  // Latest first, so earlier ranges stay where they were.
  for (const [from, to] of [...ranges].reverse()) out = extractRange(out, from, to);
  return out;
}

// ---------------------------------------------------------------------------
// Caption blocks.

export interface Block {
  /** Frames. */
  from: number;
  to: number;
  text: string;
}

export interface BlockRules {
  /** Letters in a block (all its lines). */
  maxChars: number;
  /** Longest a block stays up, and shortest (seconds). */
  maxSeconds: number;
  minSeconds: number;
  /** A pause this long starts a new block (seconds). */
  gap: number;
}

export const rulesFor = (style: CaptionStyle): BlockRules => ({ maxChars: style.lineChars * style.lines, maxSeconds: 6, minSeconds: 0.8, gap: 0.7 });

/** Words grouped into caption blocks: a new one at a pause, after a sentence, or when it would be too long. */
export function captionBlocks(words: { w: string; from: number; to: number }[], fps: number, rules: BlockRules): Block[] {
  const blocks: { from: number; to: number; words: string[] }[] = [];
  let cur: { from: number; to: number; words: string[] } | null = null;
  for (const w of words) {
    const text = w.w.trim();
    if (!text) continue;
    if (cur) {
      const chars = cur.words.join(' ').length + 1 + text.length;
      const last = cur.words[cur.words.length - 1] ?? '';
      const pause = (w.from - cur.to) / fps >= rules.gap;
      const sentence = /[.?!…。？！]["”’)]?$/.test(last);
      const long = (w.to - cur.from) / fps > rules.maxSeconds;
      if (pause || sentence || long || chars > rules.maxChars) {
        blocks.push(cur);
        cur = null;
      }
    }
    if (!cur) cur = { from: w.from, to: w.to, words: [text] };
    else {
      cur.words.push(text);
      cur.to = Math.max(cur.to, w.to);
    }
  }
  if (cur) blocks.push(cur);
  // Short blocks stay up a little longer (never into the next one).
  const min = Math.round(rules.minSeconds * fps);
  return blocks.map((b, i) => {
    const next = blocks[i + 1];
    const to = Math.max(b.to, Math.min(b.from + min, next ? next.from : Infinity));
    return { from: b.from, to: Math.max(b.from + 1, to), text: b.words.join(' ') };
  });
}

/** A new captions track above the pictures. */
export function addCaptionTrack(p: Project, style: CaptionStyle = DEFAULT_CAPTION_STYLE): { project: Project; id: string } {
  let id = '';
  const project = editSeq(p, (s) => {
    const video = s.tracks.filter((t) => t.kind === 'video');
    const n = captionTracks(s).length;
    const t: Track = { ...newTrack('video', video.length + 1), id: uid('cc'), name: n ? `Captions ${n + 1}` : 'Captions', captions: { ...style }, height: 36 };
    id = t.id;
    return { ...s, tracks: [...video, t, ...s.tracks.filter((x) => x.kind !== 'video')] };
  });
  return { project, id };
}

/** Put caption blocks on a captions track (made if there is none), replacing what was there in their time. */
export function placeCaptions(p: Project, blocks: Block[], track?: string): { project: Project; track: string } {
  let q = p;
  let id = track && isCaptionTrack(trackOf(current(p), track)) ? track : captionTracks(current(p))[0]?.id;
  if (!id) {
    const made = addCaptionTrack(q);
    q = made.project;
    id = made.id;
  }
  const tid = id;
  q = editSeq(q, (s) => {
    if (!blocks.length) return s;
    const from = Math.min(...blocks.map((b) => b.from));
    const to = Math.max(...blocks.map((b) => b.to));
    const kept = s.clips.filter((c) => c.track !== tid || end(c) <= from || c.start >= to);
    const made = blocks.map((b) => newClip(tid, b.from, b.to - b.from, { kind: 'caption', text: b.text }, b.text));
    return { ...s, clips: [...kept, ...made] };
  });
  return { project: q, track: tid };
}

/** Change a caption's words (its name on the timeline follows). */
export function setCaptionText(c: Clip, text: string): Clip {
  return c.source.kind === 'caption' ? { ...c, name: text.replace(/\s+/g, ' ').trim() || 'Caption', source: { kind: 'caption', text } } : c;
}

/** Cut a caption block in two at a frame; its words are shared out by time. */
export function splitCaption(p: Project, id: string, frame: number): Project {
  return editSeq(p, (s) => {
    const c = s.clips.find((x) => x.id === id);
    if (!c || c.source.kind !== 'caption' || frame <= c.start || frame >= end(c)) return s;
    const words = c.source.text.split(/\s+/).filter(Boolean);
    const k = words.length < 2 ? words.length : Math.max(1, Math.min(words.length - 1, Math.round((words.length * (frame - c.start)) / c.length)));
    const left = setCaptionText({ ...c, length: frame - c.start }, words.slice(0, k).join(' '));
    const right = setCaptionText({ ...c, id: uid(), start: frame, length: end(c) - frame }, words.slice(k).join(' '));
    return { ...s, clips: s.clips.flatMap((x) => (x.id === id ? [left, right] : [x])) };
  });
}

/** Join caption blocks on one track into one, from the first one's start to the last one's end. */
export function mergeCaptions(p: Project, ids: string[]): Project {
  return editSeq(p, (s) => {
    const list = s.clips.filter((c) => ids.includes(c.id) && c.source.kind === 'caption').sort((a, b) => a.start - b.start);
    const first = list[0];
    if (!first || list.length < 2 || list.some((c) => c.track !== first.track)) return s;
    const text = list.map((c) => (c.source.kind === 'caption' ? c.source.text.trim() : '')).join(' ');
    const merged = setCaptionText({ ...first, length: Math.max(...list.map(end)) - first.start }, text);
    const gone = new Set(list.map((c) => c.id));
    // Anything else on the track in between is covered by the joined block.
    const clips = s.clips.filter((c) => !gone.has(c.id) && !(c.track === first.track && c.start < end(merged) && end(c) > merged.start));
    return { ...s, clips: [...clips, merged] };
  });
}

/** Change how a captions track looks. */
export function setCaptionStyle(p: Project, track: string, change: Partial<CaptionStyle>): Project {
  return editSeq(p, (s) => ({ ...s, tracks: s.tracks.map((t) => (t.id === track && t.captions ? { ...t, captions: { ...t.captions, ...change } } : t)) }));
}

/** A caption's words wrapped into its lines. */
export function captionLines(text: string, style: CaptionStyle): string[] {
  return text
    .split('\n')
    .flatMap((part) => wrap(part, Math.max(8, style.lineChars)))
    .filter(Boolean);
}

/** A caption drawn like a title: the track's look, its lines, and its place in the frame. */
export function captionText(text: string, style: CaptionStyle): TextData {
  const lines = captionLines(text, style);
  const lineHeight = 1.2;
  const half = (style.size * lineHeight * Math.max(1, lines.length)) / 2 / 1080;
  const margin = style.margin / 100;
  const py = style.position === 'top' ? margin + half : style.position === 'middle' ? 0.5 : 1 - margin - half;
  return {
    ...DEFAULT_TEXT,
    text: lines.join('\n'),
    font: style.font,
    size: style.size,
    weight: style.weight,
    italic: false,
    color: style.color,
    align: 'center',
    px: 0.5,
    py,
    lineHeight,
    tracking: 0,
    stroke: style.stroke,
    strokeColor: style.strokeColor,
    shadow: style.shadow,
    shadowColor: '#000000',
    box: style.box,
    boxColor: style.boxColor,
    boxOpacity: style.boxOpacity,
    boxPad: Math.round(style.size * 0.28),
    animIn: 'none',
    animOut: 'none',
    animLength: 0,
    even: true,
  };
}

// ---------------------------------------------------------------------------
// Caption files.

export interface Cue {
  /** Seconds. */
  from: number;
  to: number;
  lines: string[];
}

/** The captions of a track as timed lines, from a frame on (the start of what is exported is 0). */
export function captionCues(s: Sequence, track?: string, range?: { from: number; to: number }): Cue[] {
  const fps = rate(s);
  const t = track ? trackOf(s, track) : captionTracks(s)[0];
  if (!t?.captions) return [];
  const style = t.captions;
  const from = range?.from ?? 0;
  const to = range?.to ?? Infinity;
  return s.clips
    .filter((c) => c.track === t.id && c.enabled && c.source.kind === 'caption' && end(c) > from && c.start < to)
    .sort((a, b) => a.start - b.start)
    .map((c) => ({
      from: (Math.max(from, c.start) - from) / fps,
      to: (Math.min(to, end(c)) - from) / fps,
      lines: captionLines(c.source.kind === 'caption' ? c.source.text : '', style),
    }))
    .filter((c) => c.lines.length > 0);
}

function stamp(seconds: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

/** "-->" only ever separates the times. */
const noArrow = (l: string): string => l.replace(/-->/g, '->');

/** SubRip (.srt): numbered blocks, times with a comma. */
export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.from, ',')} --> ${stamp(c.to, ',')}\n${c.lines.map(noArrow).join('\n')}\n`).join('\n');
}

/** WebVTT (.vtt): for websites and players; times with a dot. */
export function toVtt(cues: Cue[]): string {
  const safe = (l: string) => noArrow(l).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `WEBVTT\n\n${cues.map((c) => `${stamp(c.from, '.')} --> ${stamp(c.to, '.')}\n${c.lines.map(safe).join('\n')}\n`).join('\n')}`;
}

/** A sequence without its captions showing (for a film made without them burned in). */
export function withoutCaptions(p: Project): Project {
  return { ...p, sequences: p.sequences.map((s) => ({ ...s, tracks: s.tracks.map((t) => (t.captions ? { ...t, off: true } : t)) })) };
}
