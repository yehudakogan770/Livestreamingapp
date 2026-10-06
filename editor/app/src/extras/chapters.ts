// Chapter markers from what is said: the transcript is cut into short
// stretches, neighboring stretches are compared by the words they use
// (TextTiling), and a new chapter starts where the talk moves to another
// topic. Each chapter is named after the words that set it apart from the
// rest. Chapters go on the timeline as markers, and out as YouTube chapters.
import { uid, type Marker, type Project } from '../model/types';
import { editSeq } from '../model/seq';

export interface TimedWord {
  w: string;
  /** Seconds. */
  from: number;
  to: number;
}

export interface Chapter {
  /** Seconds. */
  at: number;
  title: string;
}

export interface ChapterRules {
  /** Shortest chapter (seconds; YouTube needs at least 10). */
  minLength: number;
  /** About how many words in a stretch that is compared. */
  blockWords: number;
  /** Stretches on each side that are compared. */
  window: number;
  /** How sharp a change must be to start a chapter (0–1; higher: fewer chapters). */
  sensitivity: number;
  /** At most this many chapters. */
  most: number;
}

export const CHAPTER_DEFAULTS: ChapterRules = { minLength: 30, blockWords: 25, window: 3, sensitivity: 0.5, most: 20 };

const STOP = new Set(
  (
    'a an the and or but if then so because as of at by for with about against between into through during before after above below to from up down in out on off over under ' +
    'again further once here there when where why how all any both each few more most other some such no nor not only own same than too very can will just should now ' +
    'i me my myself we our ours you your yours he him his she her hers it its they them their what which who whom this that these those am is are was were be been being ' +
    'have has had having do does did doing would could ought im youre hes shes its were theyre ive youve weve theyve id youd hed shed wed theyd ill youll hell shell well ' +
    'theyll isnt arent wasnt werent hasnt havent hadnt doesnt dont didnt wont wouldnt shant shouldnt cant cannot couldnt mustnt lets thats whos whats heres theres whens ' +
    'wheres whys hows yeah yes okay ok oh um uh like really know think going get got go gonna wanna kind sort thing things lot actually just right mean also one two ' +
    'something anything everything way want see say said make made let us well much many even still back good great nice pretty little bit'
  ).split(' '),
);

/** A word for comparing: lower case, letters and digits only, a light stem (plurals, -ing, -ed). */
export function term(w: string): string {
  let t = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (t.length > 5 && t.endsWith('ing')) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith('ed')) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith('ies')) t = `${t.slice(0, -3)}y`;
  else if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
  return t;
}

const useful = (w: string): boolean => {
  const plain = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return plain.length > 2 && !STOP.has(plain) && !/^\d+$/.test(plain);
};

type Bag = Map<string, number>;

function bag(words: TimedWord[]): Bag {
  const b: Bag = new Map();
  for (const w of words) if (useful(w.w)) b.set(term(w.w), (b.get(term(w.w)) ?? 0) + 1);
  return b;
}

function cosine(a: Bag, b: Bag): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    dot += v * (b.get(k) ?? 0);
  }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function merge(list: Bag[]): Bag {
  const out: Bag = new Map();
  for (const b of list) for (const [k, v] of b) out.set(k, (out.get(k) ?? 0) + v);
  return out;
}

/** Stretches of about `size` words, ended at a sentence end or a pause when there is one nearby. */
export function blocks(words: TimedWord[], size: number): TimedWord[][] {
  const out: TimedWord[][] = [];
  let cur: TimedWord[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    const sentence = /[.?!…]["”’)]?$/.test(w.w);
    const pause = next ? next.from - w.to > 0.8 : true;
    if (cur.length >= size * 1.5 || (cur.length >= size * 0.6 && (sentence || pause))) {
      out.push(cur);
      cur = [];
    }
  });
  if (cur.length) {
    if (out.length && cur.length < size * 0.4) (out[out.length - 1] as TimedWord[]).push(...cur);
    else out.push(cur);
  }
  return out;
}

/** How much the talk changes at each gap between stretches (depth of the similarity valley, 0–2). */
export function changeScores(bl: TimedWord[][], window: number): number[] {
  const bags = bl.map(bag);
  const sims: number[] = [];
  for (let g = 1; g < bl.length; g++) {
    const left = merge(bags.slice(Math.max(0, g - window), g));
    const right = merge(bags.slice(g, g + window));
    sims.push(cosine(left, right));
  }
  // Depth: how far the similarity falls below the highest point on each side.
  return sims.map((s, i) => {
    let l = s;
    for (let k = i; k >= 0 && (sims[k] as number) >= l; k--) l = sims[k] as number;
    let r = s;
    for (let k = i; k < sims.length && (sims[k] as number) >= r; k++) r = sims[k] as number;
    return l - s + (r - s);
  });
}

/** A short title for a stretch of talk: its most telling words (frequent here, rarer elsewhere), in the order first said. */
export function titleFor(words: TimedWord[], all: Bag, chapters: number, most = 3): string {
  const here = bag(words);
  const totalAll = [...all.values()].reduce((a, b) => a + b, 0) || 1;
  const totalHere = [...here.values()].reduce((a, b) => a + b, 0) || 1;
  const scored = [...here.entries()]
    .map(([k, v]) => {
      const share = (all.get(k) ?? v) / totalAll;
      // Said often here, and mostly here.
      return { k, s: (v / totalHere) * Math.log(1 + (v / totalHere / share) * Math.min(chapters, 8)) * Math.min(v, 4) };
    })
    .filter((x) => (here.get(x.k) ?? 0) >= 1)
    .sort((a, b) => b.s - a.s)
    .slice(0, most)
    .map((x) => x.k);
  if (!scored.length) return 'Chapter';
  // Shown as first said (the original spelling of the word).
  const firstSaid = new Map<string, { at: number; w: string }>();
  words.forEach((w, i) => {
    const t = term(w.w);
    if (scored.includes(t) && !firstSaid.has(t)) firstSaid.set(t, { at: i, w: w.w.replace(/[^\p{L}\p{N}'’-]/gu, '') });
  });
  const ordered = [...firstSaid.values()].sort((a, b) => a.at - b.at).map((x) => x.w);
  return ordered.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase())).join(', ');
}

/** Chapters from the words said (the first always starts at 0). */
export function findChapters(words: TimedWord[], rules: ChapterRules = CHAPTER_DEFAULTS): Chapter[] {
  const said = words.filter((w) => w.w.trim());
  if (said.length === 0) return [];
  const bl = blocks(said, rules.blockWords);
  const scores = changeScores(bl, rules.window);
  // Candidates: gaps with a deep valley; deepest first, kept apart by the shortest chapter.
  const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, scores.length));
  const cutoff = Math.max(0.1, mean + (2.5 - 3 * Math.max(0, Math.min(1, rules.sensitivity))) * sd);
  const startOf = (g: number) => (bl[g + 1]?.[0] as TimedWord).from;
  const start = said[0]?.from ?? 0;
  const last = said[said.length - 1]?.to ?? 0;
  const chosen: number[] = [];
  const order = scores.map((s, g) => [s, g] as const).sort((a, b) => b[0] - a[0]);
  for (const [s, g] of order) {
    if (s < cutoff || chosen.length >= rules.most - 1) break;
    const at = startOf(g);
    if (at - start < rules.minLength || last - at < rules.minLength) continue;
    if (chosen.some((c) => Math.abs(startOf(c) - at) < rules.minLength)) continue;
    chosen.push(g);
  }
  chosen.sort((a, b) => a - b);
  const all = bag(said);
  const cuts = [0, ...chosen.map((g) => g + 1), bl.length];
  const out: Chapter[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const part = bl.slice(cuts[i], cuts[i + 1]).flat();
    out.push({ at: i === 0 ? 0 : (part[0] as TimedWord).from, title: titleFor(part, all, cuts.length - 1) });
  }
  if (out[0] && cuts.length === 2) out[0].title = out[0].title || 'Intro';
  return out;
}

/** "1:05" or "1:02:03". */
export function chapterStamp(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** YouTube's chapter list for a video description (starts at 0:00, one chapter a line). */
export function youtubeChapters(chapters: Chapter[]): string {
  const sorted = [...chapters].sort((a, b) => a.at - b.at);
  if (sorted[0]) sorted[0] = { ...sorted[0], at: 0 };
  return sorted.map((c) => `${chapterStamp(c.at)} ${c.title.replace(/\s+/g, ' ').trim() || 'Chapter'}`).join('\n');
}

/** YouTube shows chapters only with at least three, the first at 0:00, each at least 10 seconds. */
export function youtubeProblems(chapters: Chapter[]): string | null {
  if (chapters.length < 3) return 'YouTube needs at least three chapters to show them.';
  const sorted = [...chapters].sort((a, b) => a.at - b.at);
  for (let i = 1; i < sorted.length; i++)
    if ((sorted[i] as Chapter).at - (sorted[i - 1] as Chapter).at < 10) return 'YouTube needs each chapter to be at least 10 seconds long.';
  return null;
}

export const CHAPTER_COLOR = '#7a5bb0';
export const isChapterMarker = (m: Marker): boolean => m.color === CHAPTER_COLOR && m.name.startsWith('Chapter: ');
export const chapterOfMarker = (m: Marker, fps: number): Chapter => ({ at: m.at / fps, title: m.name.replace(/^Chapter: /, '') });

/** Chapters as markers (earlier chapter markers are replaced). `offset` is the frame chapter time 0 is at. */
export function placeChapterMarkers(p: Project, chapters: Chapter[], fps: number, offset = 0): Project {
  return editSeq(p, (s) => ({
    ...s,
    markers: [
      ...s.markers.filter((m) => !isChapterMarker(m)),
      ...chapters.map((c) => ({ id: uid('m'), at: offset + Math.round(c.at * fps), length: 0, name: `Chapter: ${c.title}`, color: CHAPTER_COLOR })),
    ].sort((a, b) => a.at - b.at),
  }));
}
