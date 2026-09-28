// Credits (mirrors crates/engine/src/credits.rs): defaults, where it is,
// and the layout the screens and the recorder both use (in px of a
// 1920 × 1080 frame).

import type { Credits } from './types/Credits';

export function defaultCredits(): Credits {
  return {
    title: 'Thank you',
    names: [],
    mode: 'roll',
    speed: 60,
    pageMs: 6000,
    background: '#0b1020',
    color: '#ffffff',
    font: 'Segoe UI',
    size: 48,
    playing: false,
    posMs: 0,
    at: 0,
  };
}

export function creditsPosition(c: Credits, now: number): number {
  return c.playing ? c.posMs + Math.max(0, now - c.at) : c.posMs;
}

/** "Name — role" (or a tab, from a spreadsheet) splits into the name and a smaller role. */
export function splitName(line: string): { name: string; role: string } {
  const m = /^(.*?)\s*(?:\t+|\s[—–-]\s)\s*(.+)$/.exec(line);
  return m ? { name: m[1]!, role: m[2]! } : { name: line, role: '' };
}

/** Names pasted from a spreadsheet or typed, one per line; columns become "Name — role". */
export function parseNames(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) =>
      l
        .split('\t')
        .map((c) => c.trim())
        .filter(Boolean)
        .join(' — '),
    )
    .filter(Boolean);
}

export const FRAME_H = 1080;

/** Heights of the parts, px of a 1080 frame. */
export function creditsMetrics(c: Credits) {
  const lineH = c.size * 1.5;
  const titleH = c.title ? c.size * 1.8 * 1.3 : 0;
  const gap = c.title ? c.size : 0;
  return { lineH, titleH, gap, total: titleH + gap + c.names.length * lineH };
}

/** Roll: how far the column has moved up (px), looping once it has all gone by. */
export function rollOffset(c: Credits, now: number): number {
  const { total } = creditsMetrics(c);
  const travelled = (creditsPosition(c, now) / 1000) * c.speed;
  return travelled % (FRAME_H + total);
}

/** Pages: names per page, how many pages, and the page showing now. */
export function creditsPage(c: Credits, now: number): { perPage: number; pages: number; page: number } {
  const { lineH, titleH, gap } = creditsMetrics(c);
  const perPage = Math.max(1, Math.floor((FRAME_H * 0.8 - titleH - gap) / lineH));
  const pages = Math.max(1, Math.ceil(c.names.length / perPage));
  const page = Math.floor(creditsPosition(c, now) / c.pageMs) % pages;
  return { perPage, pages, page };
}

/** Wall: columns and name size so every name fits on one screen. */
export function wallLayout(c: Credits): { cols: number; size: number } {
  const n = Math.max(1, c.names.length);
  const { titleH, gap } = creditsMetrics(c);
  const height = FRAME_H * 0.86 - titleH - gap;
  let best = { cols: 1, size: 0 };
  for (let cols = 1; cols <= 6; cols++) {
    const rows = Math.ceil(n / cols);
    // Each row 1.4 × the size high; each column fits about 14 characters.
    const size = Math.min(c.size, height / (rows * 1.4), (1920 * 0.9) / cols / 14 / 0.55);
    if (size > best.size) best = { cols, size };
  }
  return best;
}
