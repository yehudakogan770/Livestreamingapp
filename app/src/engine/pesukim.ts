// The 12 Pesukim (mirrors crates/engine/src/pesukim.rs): words, moving
// through them, and which Pesukim input the controls are about.

import type { Pesukim } from './types/Pesukim';
import type { PesukimLook } from './types/PesukimLook';
import type { ScreenId } from './types/ScreenId';
import type { Show } from './types/Show';

export const PESUKIM = 12;

/** A Pesukim input's data (the input kind without its `type`). */
export type PesukimData = Pesukim;

/** The words shown one step at a time; a plain hyphen joins words shown together. */
export function wordsOf(text: string): string[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/-/g, ' '));
}

export function defaultLook(): PesukimLook {
  return {
    mode: 'word',
    keepSaid: false,
    showName: true,
    background: '#15213a',
    behind: null,
    textColor: '#ffe39e',
    size: 22,
    font: 'Frank Ruhl Libre',
    wordChange: 'fade',
    autoMs: null,
  };
}

export function defaultPesukim(): PesukimData {
  return {
    pesukim: Array.from({ length: PESUKIM }, () => ({ child: '', text: '' })),
    look: defaultLook(),
    place: { pasuk: 0, word: 0, whole: false, blank: false, changedAt: 0 },
  };
}

const count = (p: PesukimData, n: number) => wordsOf(p.pesukim[n]?.text ?? '').length;

/** Next word, then the next pasuk. Returns false at the very end. */
export function nextWord(p: PesukimData, now: number): boolean {
  const pl = p.place;
  let moved = true;
  if (pl.word + 1 < count(p, pl.pasuk)) pl.word++;
  else if (pl.pasuk + 1 < PESUKIM) {
    pl.pasuk++;
    pl.word = 0;
  } else moved = false;
  if (moved || pl.whole || pl.blank) {
    pl.whole = false;
    pl.blank = false;
    pl.changedAt = now;
  }
  return moved;
}

export function backWord(p: PesukimData, now: number): void {
  const pl = p.place;
  if (pl.word > 0) pl.word--;
  else if (pl.pasuk > 0) {
    pl.pasuk--;
    pl.word = Math.max(0, count(p, pl.pasuk) - 1);
  } else if (!pl.whole && !pl.blank) return;
  pl.whole = false;
  pl.blank = false;
  pl.changedAt = now;
}

export function goTo(p: PesukimData, pasuk: number, word: number, now: number): void {
  const n = Math.min(PESUKIM - 1, Math.max(0, pasuk));
  p.place = { pasuk: n, word: Math.min(Math.max(0, word), Math.max(0, count(p, n) - 1)), whole: false, blank: false, changedAt: now };
}

/** Time to move on by itself (auto-advance). */
export function wordDue(p: PesukimData, now: number): boolean {
  const ms = p.look.autoMs;
  if (ms === null || p.place.whole || p.place.blank) return false;
  const atEnd = p.place.pasuk + 1 >= PESUKIM && p.place.word + 1 >= count(p, p.place.pasuk);
  return now >= p.place.changedAt + ms && !atEnd;
}

/** Keep everything in range after editing. */
export function repairPesukim(p: PesukimData): void {
  while (p.pesukim.length < PESUKIM) p.pesukim.push({ child: '', text: '' });
  p.pesukim.length = PESUKIM;
  for (const x of p.pesukim) {
    x.child = x.child.split(/\s+/).filter(Boolean).join(' ').slice(0, 60);
    x.text = x.text.trim().slice(0, 1000);
  }
  p.look.size = Math.min(60, Math.max(4, p.look.size));
  if (p.look.autoMs !== null) p.look.autoMs = Math.min(60_000, Math.max(500, p.look.autoMs));
  if (!p.look.font.trim()) p.look.font = defaultLook().font;
  p.place.pasuk = Math.min(PESUKIM - 1, p.place.pasuk);
  p.place.word = Math.min(p.place.word, Math.max(0, count(p, p.place.pasuk) - 1));
}

/** A Pesukim input's data, or null if `id` is not one. */
export function pesukimOf(show: Show, id: string | null): PesukimData | null {
  const k = show.sources.find((s) => s.id === id)?.kind;
  return k?.type === 'pesukim' ? k : null;
}

/**
 * The Pesukim input the controls work on for a screen: on air, else in
 * Next. Null when neither is a Pesukim input (the card is not shown).
 */
export function pesukimTarget(show: Show, screen: ScreenId): { id: string; where: 'onAir' | 'next' } | null {
  if (screen === 'monitor') return null;
  const sc = show.screens[screen];
  if (pesukimOf(show, sc.program)) return { id: sc.program!, where: 'onAir' };
  if (pesukimOf(show, sc.preview)) return { id: sc.preview!, where: 'next' };
  return null;
}

/** What the big text shows now. */
export function shownText(p: PesukimData): { text: string; whole: boolean } {
  const words = wordsOf(p.pesukim[p.place.pasuk]?.text ?? '');
  if (p.place.blank || words.length === 0) return { text: '', whole: false };
  if (p.place.whole || p.look.mode === 'pasuk') return { text: words.join(' '), whole: true };
  if (p.look.keepSaid) return { text: words.slice(0, p.place.word + 1).join(' '), whole: true };
  return { text: words[p.place.word] ?? '', whole: false };
}

/** Parse a paste of all the pesukim: one per line; "Name: text" sets the child's name. */
export function parsePaste(text: string): { child: string; text: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, PESUKIM)
    .map((line) => {
      const m = /^([^:：]{1,40})[:：]\s*(.+)$/.exec(line);
      // Only Latin-letter names count as a name (Hebrew text may contain ':').
      if (m && /^[A-Za-z .'-]+$/.test(m[1]!.trim())) return { child: m[1]!.trim(), text: m[2]! };
      return { child: '', text: line.replace(/^\d+[.)]\s*/, '') };
    });
}
