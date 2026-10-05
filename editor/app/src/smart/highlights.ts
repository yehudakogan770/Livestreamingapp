// Highlight reel: score every moment of a long sequence (key words in the
// transcript, the room reacting: applause and laughter heard as loud stretches
// with nobody talking, Lumora's REPLAY and highlight markers, someone new
// starting to talk), pick the best moments that fit a length, and lay them in
// a new sequence with dissolves between them and, if wanted, a title.
import { end, rate, trimLeft, trimRight } from '../model/seq';
import { DEFAULT_TEXT, newClip, uid, type Clip, type Project, type Sequence } from '../model/types';
import { FLOOR_DB, percentile } from './envelope';

export interface HighlightInput {
  /** Seconds per step of `levels`. */
  hop: number;
  /** The sequence's loudness, step by step (dB). */
  levels: Float32Array;
  /** What is said (seconds into the sequence). */
  words: { w: string; from: number; to: number }[];
  /** Markers (seconds) and their names. */
  markers: { at: number; name: string }[];
  /** When someone else starts talking or the camera changes (seconds). */
  changes: number[];
  keywords: string[];
}

/** Markers Lumora (or the editor) puts on great moments. */
export const HIGHLIGHT_MARKER = /replay|highlight|best|★|⭐|goal|score|wow|great|clip/i;

export const DEFAULT_KEYWORDS = [
  'amazing',
  'incredible',
  'congratulations',
  'mazel tov',
  'thank you',
  'welcome',
  'important',
  'remember',
  'love',
  'story',
  'funny',
];

const clean = (w: string): string =>
  w
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, '')
    .trim();

export interface Scores {
  /** The total, step by step. */
  total: Float32Array;
  /** Steps where the room reacts (applause, laughter). */
  reaction: Uint8Array;
}

/** How good each step is. */
export function scoreMoments(inp: HighlightInput): Scores {
  const n = inp.levels.length;
  const hop = inp.hop;
  const total = new Float32Array(n);
  const reaction = new Uint8Array(n);
  const stepOf = (sec: number) => Math.min(n - 1, Math.max(0, Math.floor(sec / hop)));
  const add = (fromSec: number, toSec: number, v: number) => {
    for (let i = stepOf(fromSec); i <= stepOf(toSec); i++) total[i] = (total[i] as number) + v;
  };
  // Talking: words per step.
  const talk = new Float32Array(n);
  for (const w of inp.words) for (let i = stepOf(w.from); i <= stepOf(Math.max(w.from, w.to - 1e-6)); i++) talk[i] = (talk[i] as number) + 1;
  // Loudness against the usual level: a little credit for energy.
  const heard = inp.levels.filter((v) => v > FLOOR_DB);
  const median = percentile(heard, 0.5);
  const loud = percentile(heard, 0.9);
  const span = Math.max(6, loud - median);
  for (let i = 0; i < n; i++) total[i] = (total[i] as number) + Math.max(0, Math.min(1, ((inp.levels[i] as number) - median) / span)) * 0.6;
  // Speech that is lively (many words) is better than silence.
  for (let i = 0; i < n; i++) total[i] = (total[i] as number) + Math.min(1, (talk[i] as number) / (3 * hop)) * 0.4;
  // The room reacting: loud for a while with nobody's words heard. What came just before it gets the credit.
  const reactLevel = median + span * 0.5;
  const minRun = Math.max(1, Math.round(1.2 / hop));
  for (let i = 0; i < n; ) {
    if ((inp.levels[i] as number) >= reactLevel && (talk[i] as number) === 0) {
      let j = i;
      const keep = Math.max(reactLevel - 3, median + span * 0.3);
      while (j < n && (inp.levels[j] as number) >= keep && (talk[j] as number) === 0) j++;
      if (j - i >= minRun) {
        reaction.fill(1, i, j);
        const strength = Math.min(3, ((j - i) * hop) / 2);
        add(Math.max(0, i * hop - 12), j * hop, 1.5 + strength);
      }
      i = j + 1;
    } else i++;
  }
  // Key words.
  const keys = inp.keywords.map(clean).filter(Boolean);
  if (keys.length) {
    const plain = inp.words.map((w) => clean(w.w));
    inp.words.forEach((w, i) => {
      for (const k of keys) {
        const parts = k.split(/\s+/);
        if (parts.every((p, j) => plain[i + j] === p)) add(w.from - 2, w.to + 2, 2.5);
      }
    });
  }
  // Markers: a replay or highlight comes just after the moment.
  for (const m of inp.markers) if (HIGHLIGHT_MARKER.test(m.name)) add(m.at - 12, m.at + 2, 6);
  // Someone new talking.
  for (const c of inp.changes) add(c - 1.5, c + 1.5, 0.5);
  return { total, reaction };
}

export interface Moment {
  id: string;
  /** Seconds into the sequence. */
  from: number;
  to: number;
  /** The average score (how good it is). */
  score: number;
  /** Why it was chosen (for the preview). */
  why: string;
  /** What is said in it (start). */
  text: string;
}

export interface PickOptions {
  /** The reel's length (seconds). */
  target: number;
  /** A moment's usual length (seconds), and the shortest one kept. */
  length: number;
  minLength: number;
}

/** Pauses in talking (seconds), where a moment can start or end cleanly. */
function pauses(words: { from: number; to: number }[], min = 0.35): number[] {
  const out: number[] = [];
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1] as { to: number };
    const b = words[i] as { from: number };
    if (b.from - a.to >= min) out.push((a.to + b.from) / 2);
  }
  return out;
}

/** A time moved to the nearest pause within `reach` seconds (or left as it is). */
function snap(t: number, cuts: number[], reach: number): number {
  let best = t;
  let d = reach;
  for (const c of cuts) {
    if (Math.abs(c - t) <= d) {
      d = Math.abs(c - t);
      best = c;
    }
  }
  return best;
}

/** The best moments that fit the target length, in the order they happened. */
export function pickMoments(inp: HighlightInput, scores: Scores, o: PickOptions, duration: number): Moment[] {
  const n = scores.total.length;
  const hop = inp.hop;
  const used = new Uint8Array(n);
  const cuts = pauses(inp.words);
  const picked: Moment[] = [];
  let total = 0;
  // Peaks of a smoothed score: one moment around each.
  const win = Math.max(1, Math.round(o.length / 2 / hop));
  const smooth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let k = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++, k++) sum += scores.total[j] as number;
    smooth[i] = sum / Math.max(1, k);
  }
  const order = Array.from(smooth.keys()).sort((a, b) => (smooth[b] as number) - (smooth[a] as number));
  for (const peak of order) {
    if (total >= o.target - o.minLength / 2) break;
    if (used[peak] || (smooth[peak] as number) <= 0) continue;
    const room = o.target - total;
    const len = Math.min(o.length, room);
    if (len < o.minLength) break;
    const center = peak * hop + hop / 2;
    let from = Math.max(0, center - len * 0.6);
    let to = Math.min(duration, from + len);
    from = Math.max(0, Math.min(from, to - len));
    from = snap(from, cuts, 2);
    to = Math.min(duration, snap(to, cuts, 2));
    if (to - from > room) to = from + room;
    if (to - from < o.minLength) continue;
    const a = Math.floor(from / hop);
    const b = Math.min(n, Math.ceil(to / hop));
    // Not over (or right next to) one already chosen.
    let clash = false;
    for (let i = Math.max(0, a - 1); i < Math.min(n, b + 1); i++) if (used[i]) clash = true;
    if (clash) continue;
    used.fill(1, a, b);
    let sum = 0;
    for (let i = a; i < b; i++) sum += scores.total[i] as number;
    const said = inp.words.filter((w) => w.from >= from && w.from < to).map((w) => w.w);
    const reacted = scores.reaction.slice(a, Math.min(n, b + Math.round(4 / hop))).some((x) => x === 1);
    const marked = inp.markers.find((m) => HIGHLIGHT_MARKER.test(m.name) && m.at >= from - 2 && m.at <= to + 12);
    const keyed = inp.keywords.some((k) => said.join(' ').toLowerCase().includes(clean(k)));
    const why = [marked ? `marker “${marked.name}”` : '', reacted ? 'the room reacts' : '', keyed ? 'key words' : ''].filter(Boolean).join(', ') || 'lively';
    picked.push({ id: uid('h'), from, to, score: sum / Math.max(1, b - a), why, text: said.slice(0, 14).join(' ') });
    total += to - from;
  }
  return picked.sort((x, y) => x.from - y.from);
}

/** A clip cut down to [from, to) frames, or null when it is all outside. */
function within(c: Clip, from: number, to: number, fps: number): Clip | null {
  if (end(c) <= from || c.start >= to) return null;
  let out = c;
  if (out.start < from) out = trimLeft(out, from - out.start, fps);
  if (end(out) > to) out = trimRight(out, end(out) - to, fps);
  return out.length > 0 ? out : null;
}

export interface ReelOptions {
  /** Frames of dissolve between moments (0: straight cuts). */
  fade: number;
  title: string | null;
  name: string;
}

/** A new sequence of the moments, one after another (same tracks as the source). */
export function buildReel(s: Sequence, moments: Moment[], o: ReelOptions): Sequence {
  const fps = rate(s);
  const trackIds = new Map(s.tracks.map((t) => [t.id, uid(t.kind === 'video' ? 'v' : 'a')]));
  const clips: Clip[] = [];
  let at = 0;
  moments.forEach((m, k) => {
    const from = Math.round(m.from * fps);
    const to = Math.round(m.to * fps);
    if (to <= from) return;
    const links = new Map<string, string>();
    for (const c of s.clips) {
      const part = within(c, from, to, fps);
      if (!part) continue;
      const kind = s.tracks.find((t) => t.id === c.track)?.kind;
      const fadeIn = k > 0 && o.fade > 0 && part.start === from;
      const len = Math.min(o.fade, Math.floor(part.length / 2));
      const link = c.link ? (links.get(c.link) ?? links.set(c.link, uid('l')).get(c.link) ?? null) : null;
      clips.push({
        ...part,
        id: uid(),
        track: trackIds.get(c.track) ?? c.track,
        start: part.start - from + at,
        link,
        tIn:
          fadeIn && len > 1 && c.source.kind !== 'caption'
            ? { type: kind === 'audio' ? 'crossfade' : 'dissolve', length: len }
            : part.start === from
              ? null
              : part.tIn,
        tOut: part.start + part.length === to ? null : part.tOut,
      });
    }
    at += to - from;
  });
  const tracks = s.tracks.map((t) => ({ ...t, id: trackIds.get(t.id) as string }));
  if (o.title) {
    const video = tracks.filter((t) => t.kind === 'video' && !t.captions);
    const top = video[video.length - 1];
    if (top) {
      const length = Math.min(at || Math.round(3 * fps), Math.round(3.5 * fps));
      const title = newClip(
        top.id,
        0,
        length,
        { kind: 'text', text: { ...DEFAULT_TEXT, text: o.title, size: 110, py: 0.42, box: true, boxOpacity: 45 } },
        o.title,
      );
      // Over whatever is on the top track at the start.
      const clear = clips.filter((c) => !(c.track === top.id && c.start < length));
      clips.length = 0;
      clips.push(...clear, title);
    }
  }
  return {
    ...s,
    id: uid('s'),
    name: o.name,
    tracks,
    clips,
    markers: [],
    inPoint: null,
    outPoint: null,
    playhead: 0,
  };
}

/** The project with the reel added and opened. */
export function addReel(p: Project, reel: Sequence): Project {
  return { ...p, sequences: [...p.sequences, reel], open: reel.id };
}
