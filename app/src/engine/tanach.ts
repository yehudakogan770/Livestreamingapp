// The Tanach, kept with the app (public domain: the Westminster Leningrad
// Codex with nikkud, and the JPS 1917 English), read when first needed.

import { useEffect, useState } from 'react';
import { gematria } from './hebcal';
import type { Scripture } from './types/Scripture';

export function defaultScripture(): Scripture {
  return { book: 26, chapter: 23, from: 1, to: 6, current: 1, whole: false, lang: 'both', look: 'full', showRef: true, blank: false };
}

export interface Book {
  /** English (Sefaria) title. */
  name: string;
  /** Hebrew name. */
  he: string;
  part: 'Torah' | 'Neviim' | 'Ketuvim';
  file: string;
  /** Verses in each chapter. */
  chapters: number[];
}

export interface BookText {
  he: string[][];
  en: string[][];
}

/** The names people use (Bereishis, Tehillim…), in the library's order. */
export const BOOK_NAMES = [
  'Bereishis',
  'Shemos',
  'Vayikra',
  'Bamidbar',
  'Devarim',
  'Yehoshua',
  'Shoftim',
  'Shmuel I',
  'Shmuel II',
  'Melachim I',
  'Melachim II',
  'Yeshayahu',
  'Yirmiyahu',
  'Yechezkel',
  'Hoshea',
  'Yoel',
  'Amos',
  'Ovadiah',
  'Yonah',
  'Michah',
  'Nachum',
  'Chavakuk',
  'Tzefaniah',
  'Chaggai',
  'Zechariah',
  'Malachi',
  'Tehillim',
  'Mishlei',
  'Iyov',
  'Shir Hashirim',
  'Rus',
  'Eichah',
  'Koheles',
  'Esther',
  'Daniel',
  'Ezra',
  'Nechemiah',
  'Divrei Hayamim I',
  'Divrei Hayamim II',
];
export const TEHILLIM = 26;

const base = () => (typeof location !== 'undefined' && location.protocol.startsWith('http') ? '' : '.');

let index: Book[] | null = null;
let indexLoading: Promise<Book[]> | null = null;
const books = new Map<number, BookText>();
const loading = new Map<number, Promise<BookText>>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

export function loadIndex(): Promise<Book[]> {
  if (index) return Promise.resolve(index);
  indexLoading ??= fetch(`${base()}/tanach/index.json`)
    .then((r) => r.json() as Promise<Book[]>)
    .then((b) => {
      index = b;
      changed();
      return b;
    });
  return indexLoading;
}

export function loadBook(i: number): Promise<BookText> {
  const have = books.get(i);
  if (have) return Promise.resolve(have);
  let p = loading.get(i);
  if (!p) {
    p = fetch(`${base()}/tanach/${String(i).padStart(2, '0')}.json`)
      .then((r) => r.json() as Promise<BookText>)
      .then((t) => {
        books.set(i, t);
        changed();
        return t;
      });
    p.catch(() => loading.delete(i));
    loading.set(i, p);
  }
  return p;
}

/** The book's text if it is already read (and starts reading it if not). */
export function bookNow(i: number): BookText | null {
  const t = books.get(i);
  if (!t) void loadBook(i).catch(() => {});
  return t ?? null;
}

export function indexNow(): Book[] | null {
  if (!index) void loadIndex().catch(() => {});
  return index;
}

/** Re-render when books arrive. */
export function useTanach(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const f = () => setN((x) => x + 1);
    listeners.add(f);
    return () => void listeners.delete(f);
  }, []);
  return n;
}

/** Call when a book arrives (the recorder). */
export function onTanach(f: () => void): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** The verses on screen now: [verse number, Hebrew, English]. */
export function shownVerses(s: Scripture, t: BookText | null): [number, string, string][] {
  if (!t || s.blank) return [];
  const he = t.he[s.chapter - 1] ?? [];
  const en = t.en[s.chapter - 1] ?? [];
  const nums = s.whole ? Array.from({ length: s.to - s.from + 1 }, (_, i) => s.from + i) : [s.current];
  return nums.filter((n) => n <= he.length).map((n) => [n, he[n - 1] ?? '', en[n - 1] ?? '']);
}

/** "Tehillim 23:1–6" and "תהילים כ״ג:א׳–ו׳" */
export function reference(s: Scripture, bookHe: string | undefined): { en: string; he: string } {
  const one = !s.whole || s.from === s.to;
  const v = one ? `${s.whole ? s.from : s.current}` : `${s.from}–${s.to}`;
  const vh = one ? gematria(s.whole ? s.from : s.current) : `${gematria(s.from)}–${gematria(s.to)}`;
  return { en: `${BOOK_NAMES[s.book] ?? ''} ${s.chapter}:${v}`, he: `${bookHe ?? ''} ${gematria(s.chapter)}:${vh}` };
}

/**
 * Text size (in % of the frame height) so `chars` characters fit in a box
 * `w` × `h` (also in % of the frame height), at most `max`.
 */
export function fitSize(chars: number, w: number, h: number, max: number): number {
  if (chars <= 0) return max;
  return Math.min(max, Math.sqrt((w * h) / (chars * 0.52 * 1.4)));
}

/** Remove nikkud and cantillation (for searching). */
export const plain = (s: string) => s.replace(/[֑-ׇ]/g, '').replace(/־/g, ' ');

/** Tehillim for each day of the Hebrew month (the 30-day cycle): [chapter, from verse?, to verse?][]. */
export function tehillimForDay(day: number): number[] {
  const starts = [1, 10, 18, 23, 29, 35, 39, 44, 49, 55, 60, 66, 69, 72, 77, 79, 83, 88, 90, 97, 104, 106, 108, 113, 119, 119, 120, 135, 140, 145, 151];
  const d = Math.min(30, Math.max(1, day));
  if (d === 25 || d === 26) return [119];
  const from = starts[d - 1]!;
  const to = starts[d]! - 1;
  return Array.from({ length: Math.max(1, to - from + 1) }, (_, i) => from + i);
}

/** Tehillim for each day of the week (Sunday = 0). */
export function tehillimForWeekday(w: number): number[] {
  const starts = [1, 30, 51, 73, 90, 107, 120, 151];
  return Array.from({ length: starts[w + 1]! - starts[w]! }, (_, i) => starts[w]! + i);
}
