// A trivia game (mirrors crates/engine/src/trivia.rs), and what it shows.

import type { Trivia } from './types/Trivia';
import type { TriviaAnswer } from './types/TriviaAnswer';
import type { Player } from './types/Player';

export const POINTS = 1000;
/** Each answer's color and shape (on screen and on the phones). */
export const ANSWER_LOOK = [
  { color: '#e0473b', shape: '▲' },
  { color: '#2f80ed', shape: '◆' },
  { color: '#d9a21b', shape: '●' },
  { color: '#27ae60', shape: '■' },
];

export function defaultTrivia(): Trivia {
  return {
    title: 'Trivia',
    questions: [],
    current: 0,
    phase: 'join',
    askedAt: 0,
    players: [],
    answers: [],
    joinUrl: '',
    joinQr: '',
    showJoin: true,
  };
}

export const taking = (t: Trivia, now: number) => {
  const q = t.questions[t.current];
  return t.phase === 'asking' && !!q && now < t.askedAt + q.seconds * 1000;
};

export function points(t: Trivia, a: TriviaAnswer): number {
  const q = t.questions[t.current];
  if (!q || a.option !== q.correct) return 0;
  const limit = Math.max(1, q.seconds) * 1000;
  const quick = limit - Math.min(limit, a.afterMs);
  return POINTS / 2 + Math.floor(((POINTS / 2) * quick) / limit);
}

/** Players, best first. */
export const ranked = (t: Trivia): Player[] => [...t.players].sort((a, b) => b.score - a.score);

/** How many chose each answer. */
export function counts(t: Trivia): number[] {
  const q = t.questions[t.current];
  const out = (q?.options ?? []).map(() => 0);
  for (const a of t.answers) if (a.option < out.length) out[a.option]! += 1;
  return out;
}

// ---- the same rules as the engine, for the browser demo ----

export function answerIn(t: Trivia, key: string, name: string, question: number, option: number, now: number): boolean {
  const q = t.questions[t.current];
  if (!key || question !== t.current || !taking(t, now) || !q || option >= q.options.length || t.answers.some((a) => a.key === key)) return false;
  const p = t.players.find((x) => x.key === key);
  const n = name.trim().slice(0, 30);
  if (p) {
    if (n) p.name = n;
  } else t.players.push({ key, name: n || 'Player', score: 0 });
  t.answers.push({ key, option, afterMs: now - t.askedAt });
  return true;
}

export function reveal(t: Trivia): void {
  if (t.phase !== 'asking') return;
  for (const a of t.answers) {
    const p = t.players.find((x) => x.key === a.key);
    if (p) p.score += points(t, a);
  }
  t.phase = 'reveal';
}
