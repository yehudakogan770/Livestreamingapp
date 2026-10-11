// Results to keep after the event: polls, word clouds, ratings, questions and
// trivia scores as CSV files that open in Excel, Numbers or Google Sheets.

import { ratingAverage } from './poll';
import type { Poll } from './types/Poll';
import type { Qna } from './types/Qna';
import type { Trivia } from './types/Trivia';

type Cell = string | number | boolean | null | undefined;

/**
 * One cell. Quoted when it holds a comma, quote or line break; text that a
 * spreadsheet would run as a formula (= + - @ at the start) is kept as text.
 */
export function cell(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows as CSV, with a byte order mark so Excel reads accents and other alphabets right. */
export const toCsv = (rows: Cell[][]): string => `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;

/** "2026-10-11 19:42:05" in this computer's time. */
export function when(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 1000) / 10}%` : '0%');

/** A poll's results: the answers and their votes, a cloud's words, or a rating's stars and comments. */
export function pollRows(p: Poll): Cell[][] {
  const kind = p.kind ?? 'choice';
  const rows: Cell[][] = [['Question', p.question]];
  if (kind === 'words') {
    rows.push([], ['Word', 'Times sent']);
    for (const w of [...p.words].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))) rows.push([w.text, w.count]);
    return rows;
  }
  const total = p.votes.reduce((a, b) => a + b, 0);
  if (kind === 'rating') {
    const avg = ratingAverage(p);
    rows.push(['Average', avg === null ? '' : Math.round(avg * 100) / 100], ['Ratings', total], [], ['Stars', 'Ratings', 'Share']);
    for (let i = 4; i >= 0; i--) rows.push([i + 1, p.votes[i] ?? 0, pct(p.votes[i] ?? 0, total)]);
    if (p.comments.length) {
      rows.push([], ['Stars', 'Comment', 'Time']);
      for (const c of p.comments) rows.push([c.stars, c.text, when(c.at)]);
    }
    return rows;
  }
  rows.push(['Votes', total], [], ['Answer', 'Votes', 'Share']);
  p.options.forEach((o, i) => rows.push([o, p.votes[i] ?? 0, pct(p.votes[i] ?? 0, total)]));
  return rows;
}

/** Every question, most votes first. */
export function questionRows(q: Qna): Cell[][] {
  const rows: Cell[][] = [['Question', 'Name', 'Votes', 'Approved', 'Answered', 'Time']];
  const list = [...q.questions].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0) || a.at - b.at);
  for (const x of list) rows.push([x.text, x.author, x.votes ?? 0, x.approved ?? true, x.shown, when(x.at)]);
  return rows;
}

/** The players and their scores, best first. */
export function triviaRows(t: Trivia): Cell[][] {
  const rows: Cell[][] = [['Place', 'Name', 'Score']];
  [...t.players].sort((a, b) => b.score - a.score).forEach((p, i) => rows.push([i + 1, p.name, p.score]));
  return rows;
}

/** A file name from an input's name and today's date: "Session rating 2026-10-11.csv". */
export function csvName(name: string, at = new Date()): string {
  const safe =
    name
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Results';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${safe} ${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}.csv`;
}
