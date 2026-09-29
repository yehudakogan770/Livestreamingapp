// Audience polls (mirrors crates/engine/src/poll.rs).

import type { Poll } from './types/Poll';

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
  };
}

export function repairPoll(p: Poll): void {
  p.question = [...p.question].slice(0, 200).join('');
  p.options = p.options
    .filter((o) => o.trim() !== '')
    .slice(0, 8)
    .map((o) => [...o.trim()].slice(0, 80).join(''));
  p.votes = p.options.map((_, i) => p.votes[i] ?? 0);
  p.joinUrl = [...p.joinUrl].slice(0, 200).join('');
  if (p.joinQr.length > 200_000 || !p.joinQr.trimStart().startsWith('<svg')) p.joinQr = '';
}

export function resetPoll(p: Poll): void {
  p.votes = p.options.map(() => 0);
  p.round = Math.max(1, (p.round + 1) >>> 0);
}

/** Each answer's share of the votes, 0 – 1. */
export const shares = (p: Poll): number[] => {
  const total = p.votes.reduce((a, b) => a + b, 0);
  return p.votes.map((v) => (total ? v / total : 0));
};
