// Media search: find moments in every file by what is said in them (their
// transcripts), how many people or faces can be seen, what is in the picture
// (objects and scene labels from the AI models), and the kind of shot (wide,
// medium, close, from the size of the biggest face). The picture side is
// worked out once per file (frames every couple of seconds) and kept.
import { newClip, newSequence, uid, type Clip, type MediaItem, type Project } from '../model/types';
import { current } from '../model/seq';

export type ShotType = 'wide' | 'medium' | 'close';

/** What was seen in one frame of a file. */
export interface Look {
  /** Seconds into the file. */
  t: number;
  faces: number;
  people: number;
  /** The biggest face's height, as a part of the picture's height (0: none). */
  face: number;
  /** Objects found (COCO names) and scene labels (ImageNet names), with how sure the models were. */
  labels: [string, number][];
}

export interface LookIndex {
  version: 1;
  /** Seconds between frames looked at. */
  every: number;
  looks: Look[];
}

export function shotType(l: Look): ShotType | null {
  if (l.face >= 0.3) return 'close';
  if (l.face >= 0.12) return 'medium';
  if (l.face > 0 || l.people > 0) return 'wide';
  return null;
}

export interface Hit {
  media: string;
  /** Seconds into the file. */
  from: number;
  to: number;
  kind: 'speech' | 'picture';
  /** What matched, for the list. */
  text: string;
  score: number;
}

export interface Query {
  words: string[];
  people: { op: '=' | '>='; n: number } | null;
  faces: { op: '=' | '>='; n: number } | null;
  shot: ShotType | null;
  /** A phrase in quotes: the words in this order only. */
  exact: boolean;
}

const NUMBERS: Record<string, number> = { no: 0, zero: 0, one: 1, a: 1, single: 1, two: 2, both: 2, three: 3, four: 4, five: 5, six: 6 };

export const norm = (w: string): string =>
  w
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');

/**
 * What a search means. Plain words are looked for in what is said and in
 * what is seen; "2 people", "no faces", "3+ people", "people:2", "close-up",
 * "medium shot", "wide shot", "shot:close" filter by the picture.
 */
export function parseQuery(text: string): Query {
  const q: Query = { words: [], people: null, faces: null, shot: null, exact: /^\s*".*"\s*$/.test(text) };
  let rest = ` ${text.toLowerCase().replace(/"/g, ' ')} `;
  const take = (re: RegExp, f: (m: RegExpMatchArray) => void) => {
    let m: RegExpMatchArray | null;
    while ((m = rest.match(re))) {
      f(m);
      rest = rest.replace(m[0], ' ');
    }
  };
  take(/\b(?:shot|type):(wide|medium|close)\b/, (m) => (q.shot = m[1] as ShotType));
  take(/\b(close[- ]?ups?|close shots?|closeups?)\b/, () => (q.shot = 'close'));
  take(/\b(medium(?: shots?)?|mid[- ]shots?)\b/, () => (q.shot = 'medium'));
  take(/\b(wide(?: shots?)?|establishing(?: shots?)?|long shots?)\b/, () => (q.shot = 'wide'));
  const setCount = (word: string, n: number, plus: boolean) => {
    const value = { op: (plus ? '>=' : '=') as '=' | '>=', n };
    if (word.startsWith('face')) q.faces = value;
    else q.people = value;
  };
  const num = (w: string) => (/^\d+$/.test(w) ? Number(w) : (NUMBERS[w] ?? 1));
  take(/\b(people|persons?|faces?):(\d+)(\+?)/, (m) => setCount(m[1] as string, Number(m[2]), m[3] === '+'));
  take(/\b(\d+|no|zero|one|a|single|two|both|three|four|five|six)(\+?)\s+(people|persons?|faces?|men|women|speakers?)\b/, (m) =>
    setCount(m[3] as string, num(m[1] as string), m[2] === '+'),
  );
  take(/\b(nobody|no one|empty)\b/, () => (q.people = { op: '=', n: 0 }));
  take(/\b(crowd|group)\b/, () => (q.people = { op: '>=', n: 4 }));
  take(/\b(people|person|someone)\b/, () => (q.people = q.people ?? { op: '>=', n: 1 }));
  take(/\b(faces?)\b/, () => (q.faces = q.faces ?? { op: '>=', n: 1 }));
  q.words = rest.split(/\s+/).map(norm).filter(Boolean);
  return q;
}

/** A word heard matches a word looked for: the same, or (for longer words) one starts with the other. */
const wordMatches = (heard: string, want: string): boolean => heard === want || (want.length >= 4 && heard.startsWith(want));

/** Where the words of a search are said in a transcript (all of them, close together; or in order for an exact phrase). */
export function speechHits(m: MediaItem, q: Query, span = 12): Hit[] {
  const words = m.transcript?.words ?? [];
  if (!q.words.length || !words.length) return [];
  const plain = words.map((w) => norm(w.w));
  const hits: Hit[] = [];
  let i = 0;
  while (i < plain.length) {
    if (!wordMatches(plain[i] as string, q.words[0] as string) && !(!q.exact && q.words.some((w) => wordMatches(plain[i] as string, w)))) {
      i++;
      continue;
    }
    // Every word looked for, within `span` words from here.
    let last = i;
    let ok = true;
    let inOrder = true;
    let k = i;
    for (const [j, want] of q.words.entries()) {
      let found = -1;
      const from = q.exact ? (j === 0 ? i : k + 1) : i;
      const to = q.exact ? (j === 0 ? i : k + 1) : Math.min(plain.length - 1, i + span);
      for (let x = from; x <= to; x++)
        if (wordMatches(plain[x] as string, want)) {
          found = x;
          break;
        }
      if (found < 0) {
        ok = false;
        break;
      }
      if (found < k) inOrder = false;
      k = found;
      last = Math.max(last, found);
    }
    if (!ok) {
      i++;
      continue;
    }
    const a = Math.max(0, i - 3);
    const b = Math.min(words.length - 1, last + 3);
    const exactWords = q.words.every((w, j) => plain[i + j] === w);
    hits.push({
      media: m.id,
      from: (words[i] as { s: number }).s,
      to: (words[last] as { e: number }).e,
      kind: 'speech',
      text: `${a > 0 ? '…' : ''}${words
        .slice(a, b + 1)
        .map((w) => w.w)
        .join(' ')}${b < words.length - 1 ? '…' : ''}`,
      score: 2 + (exactWords ? 2 : inOrder ? 1 : 0) - (last - i) / (span * 2),
    });
    i = last + 1;
  }
  return hits;
}

const cmp = (have: number, want: { op: '=' | '>='; n: number } | null) => !want || (want.op === '=' ? have === want.n : have >= want.n);

/** Words that mean the same thing as the models' labels. */
const ALIASES: Record<string, string[]> = {
  person: ['man', 'woman', 'human', 'guy', 'girl', 'boy', 'kid', 'child'],
  car: ['vehicle', 'auto', 'automobile'],
  dog: ['puppy'],
  cat: ['kitten'],
  'dining table': ['table'],
  tvmonitor: ['tv', 'television', 'screen', 'monitor'],
  tv: ['television', 'screen', 'monitor'],
  laptop: ['computer'],
  'cell phone': ['phone', 'mobile', 'smartphone'],
  bicycle: ['bike'],
  motorcycle: ['motorbike'],
  seashore: ['beach', 'sea', 'ocean', 'coast'],
  lakeside: ['lake'],
  alp: ['mountain', 'mountains'],
  valley: ['landscape'],
  volcano: ['mountain'],
  cup: ['coffee', 'mug'],
  'coffee mug': ['coffee', 'mug', 'cup'],
  microphone: ['mic'],
  stage: ['concert'],
};

/** A label (several words, maybe) matches a word looked for. */
export function labelMatches(label: string, want: string): boolean {
  const l = label.toLowerCase();
  const parts = l.split(/[\s,_-]+/).map(norm);
  if (parts.some((p) => wordMatches(p, want) || (p.length >= 4 && want.startsWith(p)))) return true;
  const alias = ALIASES[l] ?? [];
  return alias.some((a) => wordMatches(norm(a), want));
}

/** Frames that match the picture side of a search, joined into stretches. */
export function pictureHits(m: MediaItem, index: LookIndex | undefined, q: Query): Hit[] {
  if (!index?.looks.length) return [];
  const picture = q.people || q.faces || q.shot;
  const labelWords = q.words;
  if (!picture && !labelWords.length) return [];
  const hits: Hit[] = [];
  let cur: Hit | null = null;
  for (const l of index.looks) {
    let score = 0;
    let text = '';
    let ok = cmp(l.people, q.people) && cmp(l.faces, q.faces) && (!q.shot || shotType(l) === q.shot);
    if (ok && labelWords.length) {
      // Every word must be a label seen in this frame.
      const found = labelWords.map((w) => l.labels.find(([name]) => labelMatches(name, w)));
      ok = found.every(Boolean);
      if (ok) {
        score = found.reduce((a, f) => a + (f?.[1] ?? 0), 0) / found.length;
        text = [...new Set(found.map((f) => f?.[0]))].join(', ');
      }
    } else if (ok) score = 1;
    if (ok) {
      const what = [
        text,
        q.people ? `${l.people} ${l.people === 1 ? 'person' : 'people'}` : '',
        q.faces ? `${l.faces} face${l.faces === 1 ? '' : 's'}` : '',
        q.shot ? `${shotType(l)} shot` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (cur && l.t - cur.to <= index.every * 1.5) {
        cur.to = l.t + index.every / 2;
        cur.score = Math.max(cur.score, score);
      } else {
        cur = { media: m.id, from: Math.max(0, l.t - index.every / 2), to: l.t + index.every / 2, kind: 'picture', text: what, score };
        hits.push(cur);
      }
    } else cur = null;
  }
  return hits.map((h) => ({ ...h, to: Math.min(h.to, m.duration || h.to) }));
}

/** Everything a search finds, best first (speech ahead of pictures when equally good; then by file and time). */
export function search(media: MediaItem[], looks: Map<string, LookIndex>, text: string, most = 200): Hit[] {
  const q = parseQuery(text);
  const picture = !!(q.people || q.faces || q.shot);
  const out: Hit[] = [];
  for (const m of media) {
    const visual = pictureHits(m, looks.get(m.id), q);
    // Picture filters with words: the words may be said or seen.
    if (picture && q.words.length) {
      const said = speechHits(m, q);
      const filtered = pictureHits(m, looks.get(m.id), { ...q, words: [] });
      for (const s of said) if (filtered.some((f) => f.from <= s.to && f.to >= s.from)) out.push({ ...s, score: s.score + 1 });
      out.push(...visual);
    } else {
      if (!picture) out.push(...speechHits(m, q));
      out.push(...visual);
    }
  }
  const order = new Map(media.map((m, i) => [m.id, i]));
  return out
    .sort(
      (a, b) =>
        b.score - a.score || (a.kind === b.kind ? 0 : a.kind === 'speech' ? -1 : 1) || (order.get(a.media) ?? 0) - (order.get(b.media) ?? 0) || a.from - b.from,
    )
    .slice(0, most);
}

/** The times to look at in a file (every `every` seconds, the middle of each step). */
export function lookTimes(duration: number, every: number): number[] {
  if (!(duration > 0)) return [0];
  const n = Math.max(1, Math.floor(duration / every));
  return Array.from({ length: n }, (_, i) => Math.min(duration - 0.05, (i + 0.5) * every));
}

export function encodeLooks(x: LookIndex): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(x));
}
export function decodeLooks(bytes: Uint8Array): LookIndex | null {
  if (!bytes.length) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes)) as LookIndex;
    return v?.version === 1 && Array.isArray(v.looks) ? v : null;
  } catch {
    return null;
  }
}

/**
 * A selects sequence: each hit as a clip (a second either side), one after
 * another, picture and sound linked. It is opened, and Undo takes it away.
 */
export function selectsSequence(p: Project, hits: Hit[], name: string, pad = 1): { project: Project; seq: string; count: number } {
  const base = current(p);
  const seq = newSequence(name, base.width, base.height, base.fps, 1, 1);
  const fps = seq.fps;
  const v = seq.tracks.find((t) => t.kind === 'video')?.id as string;
  const a = seq.tracks.find((t) => t.kind === 'audio')?.id as string;
  const clips: Clip[] = [];
  let at = 0;
  for (const h of hits) {
    const m = p.media.find((x) => x.id === h.media);
    if (!m) continue;
    const from = Math.max(0, h.from - pad);
    const to = m.duration > 0 ? Math.min(m.duration, h.to + pad) : h.to + pad;
    const length = Math.max(1, Math.round((to - from) * fps));
    const link = m.hasVideo && m.hasAudio ? uid('l') : null;
    const source = { kind: 'media' as const, media: m.id, in: from };
    if (m.hasVideo) clips.push({ ...newClip(v, at, length, source, m.name), link });
    if (m.hasAudio) clips.push({ ...newClip(a, at, length, source, m.name), link });
    at += length;
  }
  const made = { ...seq, clips };
  return { project: { ...p, sequences: [...p.sequences, made], open: made.id }, seq: made.id, count: hits.length };
}

/** The files with hits, put in a new bin named for the search. */
export function hitsToBin(p: Project, hits: Hit[], name: string): { project: Project; bin: string; count: number } {
  const ids = new Set(hits.map((h) => h.media));
  const bin = uid('b');
  return {
    project: { ...p, bins: [...p.bins, { id: bin, name, parent: null }], media: p.media.map((m) => (ids.has(m.id) ? { ...m, bin } : m)) },
    bin,
    count: ids.size,
  };
}
