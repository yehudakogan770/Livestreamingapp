// The messages wall (mirrors crates/engine/src/wall.rs), and what it shows at
// a moment — the same in every window and the recording.

import type { Wall } from './types/Wall';
import type { WallMessage } from './types/WallMessage';

const MAX_MESSAGES = 2000;
const MAX_TEXT = 280;

const clean = (s: string, max: number) =>
  [...s.trim()]
    .filter((c) => c >= ' ' || c === '\n')
    .slice(0, max)
    .join('');

export function defaultWall(): Wall {
  return {
    title: 'Messages',
    prompt: 'Send a message',
    messages: [],
    open: false,
    photos: true,
    autoApprove: false,
    style: 'cards',
    seconds: 8,
    pinned: null,
    nextId: 0,
    joinUrl: '',
    joinQr: '',
    showJoin: true,
  };
}

export function wallPost(w: Wall, name: string, text: string, photo: string, approved: boolean, now: number): boolean {
  const t = clean(text, MAX_TEXT);
  const p = photo.trim();
  if (!t && !p) return false;
  w.nextId += 1;
  w.messages.push({ id: w.nextId, name: clean(name, 40), text: t, photo: p, at: now, approved });
  if (w.messages.length > MAX_MESSAGES) w.messages.splice(0, w.messages.length - MAX_MESSAGES);
  return true;
}

export function wallRemove(w: Wall, message: number | undefined): void {
  w.messages = message === undefined ? [] : w.messages.filter((m) => m.id !== message);
  if (w.pinned !== null && !w.messages.some((m) => m.id === w.pinned)) w.pinned = null;
}

/** Everything let through to the screen, oldest first. */
export const approved = (w: Wall) => w.messages.filter((m) => m.approved);

/** How long a message fades in and out, ms. */
export const WALL_FADE_MS = 500;

/**
 * The message on screen one-at-a-time at `now`, and how visible it is (0 – 1,
 * fading between messages). The pinned one stays.
 */
export function wallCard(w: Wall, now: number): { m: WallMessage; alpha: number } | null {
  const pinned = w.pinned !== null ? w.messages.find((m) => m.id === w.pinned) : undefined;
  if (pinned) return { m: pinned, alpha: 1 };
  const list = approved(w);
  if (!list.length) return null;
  if (list.length === 1) return { m: list[0]!, alpha: 1 };
  const slot = Math.max(3, w.seconds) * 1000;
  const i = Math.floor(now / slot);
  const into = now - i * slot;
  const alpha = Math.min(1, into / WALL_FADE_MS, (slot - into) / WALL_FADE_MS);
  return { m: list[i % list.length]!, alpha: Math.max(0, alpha) };
}

/** The newest few, newest first (the pinned one leads). */
export function wallGrid(w: Wall, count = 6): WallMessage[] {
  const list = approved(w).reverse();
  const pinned = w.pinned !== null ? w.messages.find((m) => m.id === w.pinned) : undefined;
  return (pinned ? [pinned, ...list.filter((m) => m.id !== pinned.id)] : list).slice(0, count);
}

/** The ticker's words: every message in turn. */
export function wallTicker(w: Wall): string {
  const list = w.pinned !== null ? w.messages.filter((m) => m.id === w.pinned) : approved(w);
  return list
    .filter((m) => m.text)
    .map((m) => (m.name ? `${m.text} — ${m.name}` : m.text))
    .join('     ✦     ');
}

/** Ticker speed, in frame heights per second. */
export const TICKER_SPEED = 0.12;

/** How far the ticker has run at `now`, in frame heights (it starts off the right edge). */
export function tickerShift(now: number, widthH: number, textH: number): number {
  const loop = widthH + textH;
  return loop > 0 ? ((now / 1000) * TICKER_SPEED) % loop : 0;
}

/** Text size (in % of the frame height) for a message of this length. */
export const cardSize = (text: string, photo: boolean) => {
  const n = text.length;
  const base = n < 50 ? 6.4 : n < 110 ? 5 : n < 180 ? 4 : 3.4;
  return photo ? base * 0.8 : base;
};
