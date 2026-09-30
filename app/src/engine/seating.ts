// The table finder (mirrors crates/engine/src/seating.rs): reading a pasted
// list, and which page of the list is on screen.

import type { Seat } from './types/Seat';
import type { Seating } from './types/Seating';

export const COLUMNS = 3;
export const ROWS = 13;
export const PER_PAGE = COLUMNS * ROWS;

export function defaultSeating(): Seating {
  return { title: 'Find your seat', guests: [], look: 'scan', seconds: 8, open: true, joinUrl: '', joinQr: '', showJoin: true };
}

/**
 * Guests from pasted text or a spreadsheet saved as CSV: one guest a line,
 * "Name, Table" (or name and table separated by a tab or semicolon; the table
 * is the last part). A first line of headings is skipped.
 */
export function parseGuests(text: string): Seat[] {
  const out: Seat[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    const parts = line.split(sep).map((p) => p.trim().replace(/^"|"$/g, ''));
    if (parts.length < 2) continue;
    const table = parts.pop()!;
    const name = parts.filter(Boolean).join(sep === ',' && parts.length > 1 ? ', ' : ' ');
    if (!name || !table) continue;
    if (!out.length && /^(name|guest)/i.test(name) && /table/i.test(table)) continue;
    out.push({ name, table });
  }
  return out;
}

export const pages = (s: Seating) => Math.max(1, Math.ceil(s.guests.length / PER_PAGE));

/** The page of the list on screen at `now`. */
export function pageAt(s: Seating, now: number): { page: number; guests: Seat[] } {
  const n = pages(s);
  const page = Math.floor(now / (Math.max(3, s.seconds) * 1000)) % n;
  return { page, guests: s.guests.slice(page * PER_PAGE, (page + 1) * PER_PAGE) };
}
