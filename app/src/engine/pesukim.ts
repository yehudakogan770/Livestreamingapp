// The 12 Pesukim (mirrors crates/engine/src/pesukim.rs): words, moving
// through them, and which Pesukim input the controls are about.

import type { Pesukim } from './types/Pesukim';
import type { PesukimLook } from './types/PesukimLook';
import type { ScreenId } from './types/ScreenId';
import type { Show } from './types/Show';
import type { Pasuk } from './types/Pasuk';
import type { Action } from './types/Action';
import { TWELVE_PESUKIM } from './pesukimText';

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
    mode: 'bar',
    keepSaid: false,
    showName: true,
    showTranslit: true,
    showEnglish: true,
    design: 'gold',
    barImage: '',
    barWords: 'one',
    outlineColor: '#000000',
    plain: false,
    barIn: 'rise',
    showNumber: false,
    background: '#15213a',
    behind: null,
    textColor: '#ffe39e',
    size: 22,
    font: 'Frank Ruhl Libre',
    wordChange: 'fade',
    autoMs: null,
  };
}

/** The twelve, filled in (Hebrew, how it sounds, what it means); `children` keeps names already typed. */
export function standardPesukim(children: string[] = []): Pasuk[] {
  return TWELVE_PESUKIM.map((t, i) => ({ child: children[i] ?? '', ...t }));
}

export function defaultPesukim(): PesukimData {
  return {
    pesukim: standardPesukim(),
    look: defaultLook(),
    place: { pasuk: 0, word: 0, whole: false, blank: false, intro: false, changedAt: 0 },
  };
}

const count = (p: PesukimData, n: number) => wordsOf(p.pesukim[n]?.text ?? '').length;

/** This pasuk starts with the child's name. */
const introFor = (p: PesukimData, n: number) => p.look.showName && !!p.pesukim[n]?.child.trim();

/** What each word means, in step with the Hebrew ("_": none, shown as nothing). */
export const glossesOf = (english: string) => wordsOf(english).map((w) => (w === '_' ? '' : w));

/** Hebrew letters only (no vowels or marks), to judge how wide words are. */
const letters = (w: string) => w.replace(/[\u0591-\u05C7]/g, '').length;

/**
 * The words in the bar at once: the stretch of the pasuk (in step across the
 * three lines) that holds the word being said, short enough to fit.
 */
export function barChunks(pasuk: Pasuk | undefined): [number, number][] {
  const he = wordsOf(pasuk?.text ?? '');
  const tr = wordsOf(pasuk?.translit ?? '');
  const en = glossesOf(pasuk?.english ?? '');
  const chunks: [number, number][] = [];
  let from = 0;
  let size = [0, 0, 0];
  he.forEach((w, i) => {
    const add = [letters(w) + 1, (tr[i]?.length ?? 0) + 1, (en[i]?.length ?? 0) + 1];
    const next = size.map((n, j) => n + add[j]!);
    // The Hebrew and how it sounds share one line.
    if (i > from && (next[0]! + next[1]! * 0.65 > 44 || next[2]! > 64)) {
      chunks.push([from, i]);
      from = i;
      size = add;
    } else size = next;
  });
  if (he.length) chunks.push([from, he.length]);
  return chunks;
}

/**
 * The words the bar shows: just the word being said (one at a time), or a
 * line of the pasuk around it (chosen per event, and always for "whole pasuk").
 */
export function barRange(p: PesukimData): [number, number] {
  const { place } = p;
  if (!place.whole && p.look.barWords !== 'line') return [place.word, place.word + 1];
  const chunks = barChunks(p.pesukim[place.pasuk]);
  return chunks.find(([, b]) => place.word < b) ?? chunks[0] ?? [0, 0];
}

/** The bar's built-in designs. Mirrored in PesukimView.css and the recorder. */
export const BAR_DESIGNS = [
  { id: 'gold', name: 'Gold frame', top: '#2a1d06', bottom: '#120c02', edge: '#e8c877', frame: true, radius: 1.8, badge: '#e8c877', badgeText: '#241802' },
  { id: 'royal', name: 'Royal blue', top: '#1d3f8f', bottom: '#0b1d4a', edge: '#ffffff', frame: false, radius: 0, badge: '#ffffff', badgeText: '#0b1d4a' },
  {
    id: 'glass',
    name: 'Glass',
    top: 'rgba(255,255,255,0.22)',
    bottom: 'rgba(255,255,255,0.08)',
    edge: 'rgba(255,255,255,0.6)',
    frame: true,
    radius: 3,
    badge: 'rgba(255,255,255,0.9)',
    badgeText: '#15213a',
  },
  { id: 'night', name: 'Night sky', top: '#2a1552', bottom: '#0b0620', edge: '#b894ff', frame: false, radius: 1.2, badge: '#b894ff', badgeText: '#140a2c' },
  {
    id: 'none',
    name: 'No background',
    top: 'transparent',
    bottom: 'transparent',
    edge: 'transparent',
    frame: false,
    radius: 0,
    badge: 'transparent',
    badgeText: 'transparent',
  },
  {
    id: 'simple',
    name: 'Simple dark',
    top: 'rgba(8,12,20,0.9)',
    bottom: 'rgba(8,12,20,0.9)',
    edge: '#c9a24a',
    frame: false,
    radius: 1.2,
    badge: '#c9a24a',
    badgeText: '#0a0f1c',
  },
] as const;

export type BarDesign = (typeof BAR_DESIGNS)[number];
export const barDesign = (id: string): BarDesign => BAR_DESIGNS.find((d) => d.id === id) ?? BAR_DESIGNS[0];

/** Where the bar sits, in % of the frame height (the frame is 177.8 wide). */
export function barLayout(look: PesukimLook) {
  const en = look.showEnglish;
  // The Hebrew and how it sounds share the first line; the English is under them.
  const he = 7.4;
  const h = 3.2 + he * 1.3 + (en ? 4.4 * 1.3 : 0) + 1.6;
  return { left: 7, right: 7, bottom: 4.5, h, he, tr: 5.2, en: 4.4, badge: 9 };
}

/** Next word, then the next pasuk. Returns false at the very end. */
export function nextWord(p: PesukimData, now: number): boolean {
  const pl = p.place;
  if (pl.intro) {
    pl.intro = false;
    pl.whole = false;
    pl.blank = false;
    pl.changedAt = now;
    return true;
  }
  let moved = true;
  if (pl.word + 1 < count(p, pl.pasuk)) pl.word++;
  else if (pl.pasuk + 1 < PESUKIM) {
    pl.pasuk++;
    pl.word = 0;
    pl.intro = introFor(p, pl.pasuk);
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
  if (pl.intro) {
    pl.intro = false;
    if (pl.pasuk === 0) {
      pl.changedAt = now;
      return;
    }
    pl.pasuk--;
    pl.word = Math.max(0, count(p, pl.pasuk) - 1);
  } else if (pl.word === 0 && introFor(p, pl.pasuk)) pl.intro = true;
  else if (pl.word > 0) pl.word--;
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
  const w = Math.min(Math.max(0, word), Math.max(0, count(p, n) - 1));
  p.place = { pasuk: n, word: w, whole: false, blank: false, intro: w === 0 && n !== p.place.pasuk && introFor(p, n), changedAt: now };
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
  while (p.pesukim.length < PESUKIM) p.pesukim.push({ child: '', text: '', translit: '', english: '', translation: '' });
  p.pesukim.length = PESUKIM;
  for (const x of p.pesukim) {
    x.child = x.child.split(/\s+/).filter(Boolean).join(' ').slice(0, 60);
    x.text = x.text.trim().slice(0, 1000);
    x.translit = (x.translit ?? '').trim().slice(0, 1000);
    x.english = (x.english ?? '').trim().slice(0, 1000);
    x.translation = (x.translation ?? '').trim().slice(0, 1000);
  }
  // Always a bar over the picture.
  p.look.mode = 'bar';
  p.look.behind = null;
  p.look.size = Math.min(60, Math.max(4, p.look.size));
  if (p.look.autoMs !== null) p.look.autoMs = Math.min(60_000, Math.max(500, p.look.autoMs));
  if (!p.look.font.trim()) p.look.font = defaultLook().font;
  p.look.design = p.look.design.trim().slice(0, 20) || defaultLook().design;
  if (!/^#[0-9a-fA-F]{6}$/.test(p.look.outlineColor ?? '')) p.look.outlineColor = '#000000';
  p.place.pasuk = Math.min(PESUKIM - 1, p.place.pasuk);
  p.place.word = Math.min(p.place.word, Math.max(0, count(p, p.place.pasuk) - 1));
}

/** A Pesukim input's data, or null if `id` is not one. */
export function pesukimOf(show: Show, id: string | null): PesukimData | null {
  const k = show.sources.find((s) => s.id === id)?.kind;
  return k?.type === 'pesukim' ? k : null;
}

/**
 * The Pesukim input the controls work on for a screen: in Next, else on
 * air. Null when neither is a Pesukim input (the card is not shown).
 */
export function pesukimTarget(show: Show, screen: ScreenId): { id: string; where: 'onAir' | 'next'; channel?: number } | null {
  if (screen === 'monitor') return null;
  const sc = show.screens[screen];
  if (sc.preview !== sc.program && pesukimOf(show, sc.preview)) return { id: sc.preview!, where: 'next' };
  if (pesukimOf(show, sc.program)) return { id: sc.program!, where: 'onAir' };
  const bar = pesukimBar(show, screen);
  if (bar) return { id: bar.id, where: bar.on ? 'onAir' : 'next', channel: bar.channel };
  return null;
}

/**
 * The Pesukim bar over this screen: an overlay channel holding a Pesukim
 * input, on air or shown in Next.
 */
export function pesukimBar(show: Show, screen: ScreenId): { channel: number; id: string; on: boolean } | null {
  const i = show.overlays.findIndex((o) => o.sourceId && pesukimOf(show, o.sourceId) && o.screens.includes(screen) && (o.on || o.inNext));
  const o = show.overlays[i];
  return o?.sourceId ? { channel: i, id: o.sourceId, on: o.on } : null;
}

/** The overlay channel for a Pesukim bar: the one it is in, else the first empty one (else the last). */
export function barChannel(show: Show, id: string): number {
  const mine = show.overlays.findIndex((o) => o.sourceId === id);
  if (mine >= 0) return mine;
  const empty = show.overlays.findIndex((o) => !o.sourceId);
  return empty >= 0 ? empty : show.overlays.length - 1;
}

/**
 * The steps to put a Pesukim input over the screen as a bar (the whole
 * frame, see-through except the bar), shown in Next or straight on air.
 */
export function barActions(show: Show, id: string, screen: ScreenId, onAir: boolean): Action[] {
  const channel = barChannel(show, id);
  const p = pesukimOf(show, id);
  const acts: Action[] = [];
  if (p && p.look.mode !== 'bar') acts.push({ type: 'updatePesukim', id, look: { ...p.look, mode: 'bar', behind: null } });
  if (show.overlays[channel]?.sourceId !== id) acts.push({ type: 'setOverlaySource', channel, sourceId: id });
  acts.push({
    type: 'updateOverlay',
    channel,
    patch: { frame: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, screens: [screen === 'monitor' ? 'live' : screen] },
  });
  acts.push(onAir ? { type: 'setOverlayOn', channel, value: true } : { type: 'setOverlayInNext', channel, value: true });
  return acts;
}

/** What the big text shows now. */
export function shownText(p: PesukimData): { text: string; whole: boolean } {
  const words = wordsOf(p.pesukim[p.place.pasuk]?.text ?? '');
  if (p.place.blank || words.length === 0) return { text: '', whole: false };
  if (p.place.whole || p.look.mode === 'pasuk') return { text: words.join(' '), whole: true };
  if (p.look.keepSaid) return { text: words.slice(0, p.place.word + 1).join(' '), whole: true };
  return { text: words[p.place.word] ?? '', whole: false };
}

/**
 * How the words sound and what they mean, for what is shown: the word being
 * said, or with the whole pasuk all of it (its translation, else the words'
 * meanings joined).
 */
export function soundAndMeaning(p: PesukimData, whole: boolean): { sound: string; meaning: string } {
  const pasuk = p.pesukim[p.place.pasuk];
  if (!pasuk) return { sound: '', meaning: '' };
  const tr = wordsOf(pasuk.translit);
  const en = glossesOf(pasuk.english);
  if (whole) return { sound: tr.join(' '), meaning: pasuk.translation?.trim() || en.filter(Boolean).join(' ') };
  return { sound: tr[p.place.word] ?? '', meaning: en[p.place.word] ?? '' };
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
