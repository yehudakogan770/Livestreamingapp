// Text animators: letters, words or lines that move one after another. A
// range selector says how much of an animator's properties each unit gets;
// the properties are the look at full selection (e.g. opacity 0 = hidden).
import { valueAt } from './anim';
import { uid, type Param, type TextAnimator } from './types';

/** One character's place in the text: its line, and which letter, word and line unit it belongs to. */
export interface Unit {
  ch: string;
  line: number;
  /** Index in its line. */
  col: number;
  char: number;
  word: number;
  lineUnit: number;
  space: boolean;
}

/** Every character of the lines with its units (letters skip spaces; a space belongs to the word before it). */
export function textUnits(lines: string[]): { units: Unit[]; chars: number; words: number; lines: number } {
  const units: Unit[] = [];
  let char = 0;
  let word = -1;
  lines.forEach((line, li) => {
    let inWord = false;
    [...line].forEach((ch, col) => {
      const space = /\s/.test(ch);
      if (!space && !inWord) word++;
      inWord = !space;
      units.push({ ch, line: li, col, char: space ? Math.max(0, char - 1) : char, word: Math.max(0, word), lineUnit: li, space });
      if (!space) char++;
    });
  });
  return { units, chars: Math.max(1, char), words: Math.max(1, word + 1), lines: Math.max(1, lines.length) };
}

export interface RangeNow {
  start: number;
  end: number;
  offset: number;
  shape: TextAnimator['shape'];
  hard?: boolean;
  reverse?: boolean;
  amount: number;
}

/** How selected unit `i` of `n` is (0–1) by a range (percent start, end and offset). */
export function rangeAmount(i: number, n: number, r: RangeNow): number {
  const idx = r.reverse ? n - 1 - i : i;
  const a = Math.min(r.start, r.end) + r.offset;
  const b = Math.max(r.start, r.end) + r.offset;
  const u0 = (100 * idx) / n;
  const u1 = (100 * (idx + 1)) / n;
  let k: number;
  if (r.shape === 'square') {
    const cover = Math.max(0, Math.min(b, u1) - Math.max(a, u0)) / (u1 - u0);
    k = r.hard ? (cover >= 0.5 ? 1 : 0) : cover;
  } else {
    const c = (u0 + u1) / 2;
    if (b <= a || c < a || c > b) k = 0;
    else {
      const u = (c - a) / (b - a);
      if (r.shape === 'rampUp') k = u;
      else if (r.shape === 'rampDown') k = 1 - u;
      else if (r.shape === 'triangle') k = 1 - Math.abs(2 * u - 1);
      else if (r.shape === 'round') k = Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2));
      else k = 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
    }
  }
  return Math.max(0, Math.min(1, k)) * Math.max(0, Math.min(1, r.amount / 100));
}

/** What a character looks like after every animator: opacity and scale (1 = as set), offsets (px at 1080), turn, blur, extra space after it. */
export interface CharLook {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  blur: number;
  tracking: number;
}

const NONE: CharLook = { opacity: 1, x: 0, y: 0, scale: 1, rotation: 0, blur: 0, tracking: 0 };

/** Each character's look at a frame of the clip. */
export function charLooks(animators: TextAnimator[] | undefined, units: ReturnType<typeof textUnits>, local: number): CharLook[] {
  const out = units.units.map(() => ({ ...NONE }));
  for (const an of animators ?? []) {
    if (!an.on) continue;
    const v = (p: Param | undefined, d: number) => valueAt(p, local, d);
    const range: RangeNow = {
      start: v(an.start, 0),
      end: v(an.end, 100),
      offset: v(an.offset, 0),
      shape: an.shape,
      hard: an.hard,
      reverse: an.reverse,
      amount: v(an.amount, 100),
    };
    const n = an.by === 'char' ? units.chars : an.by === 'word' ? units.words : units.lines;
    const props = {
      opacity: v(an.opacity, 100) / 100,
      x: v(an.x, 0),
      y: v(an.y, 0),
      scale: v(an.scale, 100) / 100,
      rotation: v(an.rotation, 0),
      blur: v(an.blur, 0),
      tracking: v(an.tracking, 0),
    };
    const cache = new Map<number, number>();
    units.units.forEach((u, i) => {
      const idx = an.by === 'char' ? u.char : an.by === 'word' ? u.word : u.lineUnit;
      let k = cache.get(idx);
      if (k === undefined) {
        k = rangeAmount(idx, n, range);
        cache.set(idx, k);
      }
      if (k === 0) return;
      const o = out[i] as CharLook;
      o.opacity *= 1 + (props.opacity - 1) * k;
      o.x += props.x * k;
      o.y += props.y * k;
      o.scale *= 1 + (props.scale - 1) * k;
      o.rotation += props.rotation * k;
      o.blur += props.blur * k;
      o.tracking += props.tracking * k;
    });
  }
  return out;
}

export const TEXT_ANIMATOR_PRESETS: [string, string][] = [
  ['typewriter', 'Typewriter'],
  ['fadeUpWord', 'Fade up by word'],
  ['popLetter', 'Pop by letter'],
  ['kineticSlide', 'Kinetic slide'],
  ['tracking', 'Tracking in'],
];

/** An animator for a preset: it plays over the first `frames` frames of the clip. */
export function textAnimatorPreset(preset: string, frames: number): TextAnimator {
  const n = Math.max(2, Math.round(frames));
  const sweep = (e: 'linear' | 'easeOut' = 'linear'): Param => ({
    k: [
      { t: 0, v: 0, e },
      { t: n, v: 100, e: 'linear' },
    ],
  });
  const base = { id: uid('ta'), on: true, start: 0 as Param, end: 100 as Param, offset: 0 as Param, amount: 100 as Param };
  switch (preset) {
    case 'typewriter':
      return { ...base, name: 'Typewriter', by: 'char', start: sweep(), shape: 'square', hard: true, opacity: 0 };
    case 'fadeUpWord':
      return { ...base, name: 'Fade up by word', by: 'word', start: sweep('easeOut'), shape: 'rampUp', opacity: 0, y: 40 };
    case 'popLetter':
      return { ...base, name: 'Pop by letter', by: 'char', start: sweep(), shape: 'rampUp', opacity: 0, scale: 0 };
    case 'kineticSlide':
      return { ...base, name: 'Kinetic slide', by: 'line', start: sweep('easeOut'), shape: 'rampUp', opacity: 0, x: -240, blur: 12 };
    default:
      return {
        ...base,
        name: 'Tracking in',
        by: 'char',
        amount: {
          k: [
            { t: 0, v: 100, e: 'easeOut' },
            { t: n, v: 0, e: 'linear' },
          ],
        },
        shape: 'square',
        tracking: 30,
        opacity: 0,
      };
  }
}
