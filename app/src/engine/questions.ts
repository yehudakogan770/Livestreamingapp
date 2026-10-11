// Audience questions in the control window (mirrors crates/engine/src/qna.rs).

import type { Question } from './types/Question';

export type QuestionOrder = 'votes' | 'newest';

/**
 * The questions in the order the operator wants them: waiting for approval
 * first, then by votes (or newest first), answered ones last.
 */
export function sortQuestions(list: Question[], order: QuestionOrder): Question[] {
  const rank = (q: Question) => (!q.approved ? 0 : q.shown ? 2 : 1);
  return [...list].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    if (order === 'votes' && b.votes !== a.votes) return b.votes - a.votes;
    return order === 'votes' ? a.at - b.at : b.at - a.at;
  });
}
