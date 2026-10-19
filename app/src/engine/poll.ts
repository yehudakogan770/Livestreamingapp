// Audience polls (mirrors crates/engine/src/poll.rs): a choice of answers,
// a word cloud, or a rating from one to five stars.

import type { Poll } from './types/Poll';
import type { PollKind } from './types/PollKind';

export const MAX_WORDS = 400;
export const MAX_WORD_CHARS = 32;
export const MAX_COMMENTS = 500;
export const STARS = 5;

export function defaultPoll(): Poll {
  return {
    question: 'What should we play next?',
    options: ['Song A', 'Song B', 'Song C'],
    votes: [0, 0, 0],
    open: false,
    showResults: true,
    round: 1,
    joinUrl: '',
    joinQr: '',
    showJoin: true,
    kind: 'choice',
    words: [],
    comments: [],
  };
}

/** A new poll of each kind, ready to run. */
export function newPoll(kind: PollKind, question: string, options: string[] = []): Poll {
  const p: Poll = { ...defaultPoll(), kind, question: question.trim() || POLL_QUESTION[kind], options };
  repairPoll(p);
  return p;
}

/** The question a new poll of each kind starts with. */
export const POLL_QUESTION: Record<PollKind, string> = {
  choice: 'What should we play next?',
  words: 'One word to describe today?',
  rating: 'How would you rate this session?',
};

/** What each kind is called in the control window. */
export const POLL_KIND_NAME: Record<PollKind, string> = {
  choice: 'Poll',
  words: 'Word cloud',
  rating: 'Rating',
};

/** A word as it is counted: spaces made single, at most three words and 32 characters ('' when nothing is left). */
export function cleanWord(text: string): string {
  const words = text
    .split(/[\s\p{Cc}]+/u)
    .filter(Boolean)
    .slice(0, 3);
  return [...words.join(' ')].slice(0, MAX_WORD_CHARS).join('').trim();
}

export function repairPoll(p: Poll): void {
  p.kind ??= 'choice';
  p.words ??= [];
  p.comments ??= [];
  p.question = [...p.question].slice(0, 200).join('');
  if (p.kind === 'rating') p.options = ['1', '2', '3', '4', '5'];
  else if (p.kind === 'words') p.options = [];
  else
    p.options = p.options
      .filter((o) => o.trim() !== '')
      .slice(0, 8)
      .map((o) => [...o.trim()].slice(0, 80).join(''));
  p.votes = p.options.map((_, i) => p.votes[i] ?? 0);
  p.words = p.words.filter((w) => cleanWord(w.text) !== '').slice(0, MAX_WORDS);
  if (p.comments.length > MAX_COMMENTS) p.comments = p.comments.slice(-MAX_COMMENTS);
  p.joinUrl = [...p.joinUrl].slice(0, 200).join('');
  if (p.joinQr.length > 200_000 || !p.joinQr.trimStart().startsWith('<svg')) p.joinQr = '';
}

export function resetPoll(p: Poll): void {
  p.votes = p.options.map(() => 0);
  p.words = [];
  p.comments = [];
  p.round = Math.max(1, (p.round + 1) >>> 0);
}

/** A word for the cloud; false if it doesn't count. */
export function pollWord(p: Poll, round: number, text: string): boolean {
  if (!p.open || round !== p.round || p.kind !== 'words') return false;
  const word = cleanWord(text);
  if (!word) return false;
  const known = p.words.find((w) => w.text.toLowerCase() === word.toLowerCase());
  if (known) {
    known.count += 1;
    return true;
  }
  if (p.words.length >= MAX_WORDS) return false;
  p.words.push({ text: word, count: 1 });
  return true;
}

export function removeWord(p: Poll, word: string): void {
  const key = word.toLowerCase();
  p.words = p.words.filter((w) => w.text.toLowerCase() !== key);
}

/** A rating's comment; false if it doesn't count. */
export function pollComment(p: Poll, round: number, stars: number, text: string, now: number): boolean {
  if (!p.open || round !== p.round || p.kind !== 'rating') return false;
  const t = [...text.trim()]
    .filter((c) => !/\p{Cc}/u.test(c))
    .slice(0, 280)
    .join('');
  if (!t || stars < 1 || stars > 5) return false;
  p.comments.push({ stars, text: t, at: now });
  if (p.comments.length > MAX_COMMENTS) p.comments.splice(0, p.comments.length - MAX_COMMENTS);
  return true;
}

/** Each answer's share of the votes, 0 – 1. */
export const shares = (p: Poll): number[] => {
  const total = p.votes.reduce((a, b) => a + b, 0);
  return p.votes.map((v) => (total ? v / total : 0));
};

/** How many answered: votes, or words sent. */
export const responses = (p: Poll): number => (p.kind === 'words' ? p.words.reduce((a, w) => a + w.count, 0) : p.votes.reduce((a, b) => a + b, 0));

/** The average number of stars (null before any rating). */
export function ratingAverage(p: Poll): number | null {
  const total = p.votes.reduce((a, b) => a + b, 0);
  if (!total) return null;
  return p.votes.reduce((a, v, i) => a + v * (i + 1), 0) / total;
}

/** "4.3" (one decimal; "–" before any rating). */
export const averageText = (avg: number | null): string => (avg === null ? '–' : (Math.round(avg * 10) / 10).toFixed(1));

/** "12 votes", "1 word", "3 ratings". */
export function countText(p: Poll): string {
  const n = responses(p);
  const unit = p.kind === 'words' ? 'word' : p.kind === 'rating' ? 'rating' : 'vote';
  return `${n.toLocaleString()} ${unit}${n === 1 ? '' : 's'}`;
}
