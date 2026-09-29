// Song lyrics (mirrors crates/engine/src/lyrics.rs).

import type { Lyrics } from './types/Lyrics';
import { defaultTextStyle } from './text';

/** The slides of a song: blocks of lines separated by blank lines. */
export function sections(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') {
      if (cur.length) out.push(cur.join('\n'));
      cur = [];
    } else cur.push(line.trimEnd());
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

export function defaultLyrics(): Lyrics {
  return {
    title: '',
    text: '',
    current: 0,
    blank: false,
    changedAt: 0,
    place: 'middle',
    style: { ...defaultTextStyle(), size: 64, weight: 700, align: 'center', boxOn: false, shadow: true, lineHeight: 1.3 },
  };
}

export function lyricsGo(l: Lyrics, index: number, now: number): void {
  const i = Math.min(Math.max(0, index), Math.max(0, sections(l.text).length - 1));
  if (i !== l.current || l.blank) {
    l.current = i;
    l.blank = false;
    l.changedAt = now;
  }
}

/** How long a slide fades in, ms. */
export const LYRICS_FADE_MS = 250;
