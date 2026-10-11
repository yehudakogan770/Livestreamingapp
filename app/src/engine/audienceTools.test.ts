import { describe, expect, it } from 'vitest';
import { averageText, cleanWord, countText, newPoll, pollComment, pollWord, ratingAverage, removeWord, repairPoll, resetPoll } from './poll';
import { cloudLayout, roughMeasure, starFill } from './wordCloud';
import { cell, csvName, pollRows, questionRows, toCsv, triviaRows } from './audienceExport';
import { sortQuestions } from './questions';
import type { Question } from './types/Question';
import type { Trivia } from './types/Trivia';

describe('word clouds', () => {
  it('count words whatever their case, three words at most', () => {
    const p = newPoll('words', '');
    expect(p.question).toBe('One word to describe today?');
    expect(p.options).toEqual([]);
    p.open = true;
    expect(pollWord(p, p.round, '  Joy ')).toBe(true);
    expect(pollWord(p, p.round, 'JOY')).toBe(true);
    expect(pollWord(p, p.round, 'great music and more')).toBe(true);
    expect(pollWord(p, p.round, '   ')).toBe(false);
    expect(pollWord(p, p.round + 1, 'late')).toBe(false);
    expect(p.words).toEqual([
      { text: 'Joy', count: 2 },
      { text: 'great music and', count: 1 },
    ]);
    expect(countText(p)).toBe('3 words');
    removeWord(p, 'joy');
    expect(p.words).toHaveLength(1);
    resetPoll(p);
    expect(p.words).toEqual([]);
    expect(cleanWord('x'.repeat(50))).toHaveLength(32);
  });

  it('are laid out without overlaps, inside the box, the most sent biggest', () => {
    const words = Array.from({ length: 40 }, (_, i) => ({ text: `word${i}`, count: 40 - i }));
    const placed = cloudLayout(words, 160, 70, roughMeasure);
    expect(placed.length).toBeGreaterThan(20);
    expect(placed[0]!.text).toBe('word0');
    expect(placed[0]!.size).toBe(Math.max(...placed.map((w) => w.size)));
    const boxes = placed.map((w) => {
      const width = roughMeasure(w.text, w.size);
      return { x0: w.x - width / 2, x1: w.x + width / 2, y0: w.y - w.size / 2, y1: w.y + w.size / 2 };
    });
    for (const b of boxes) {
      expect(b.x0).toBeGreaterThanOrEqual(-0.001);
      expect(b.x1).toBeLessThanOrEqual(160.001);
      expect(b.y0).toBeGreaterThanOrEqual(-0.001);
      expect(b.y1).toBeLessThanOrEqual(70.001);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1, `${placed[i]!.text} / ${placed[j]!.text}`).toBe(false);
      }
    // The same words give the same picture.
    expect(cloudLayout(words, 160, 70, roughMeasure)).toEqual(placed);
    expect(cloudLayout([], 160, 70)).toEqual([]);
  });
});

describe('ratings', () => {
  it('have five stars, an average and comments', () => {
    const p = newPoll('rating', 'How was it?');
    expect(p.options).toEqual(['1', '2', '3', '4', '5']);
    expect(ratingAverage(p)).toBeNull();
    expect(averageText(null)).toBe('–');
    p.votes = [0, 0, 1, 2, 1];
    expect(ratingAverage(p)).toBe(4);
    expect(averageText(4.26)).toBe('4.3');
    expect(countText(p)).toBe('4 ratings');
    expect(starFill(4.3).map((f) => Math.round(f * 10) / 10)).toEqual([1, 1, 1, 1, 0.3]);
    p.open = true;
    expect(pollComment(p, p.round, 5, '  Very clear ', 9)).toBe(true);
    expect(pollComment(p, p.round, 6, 'no', 9)).toBe(false);
    expect(p.comments).toEqual([{ stars: 5, text: 'Very clear', at: 9 }]);
  });

  it('keep their kind when repaired, and old polls are choices', () => {
    const old = { ...newPoll('choice', 'Q', ['a', 'b']) } as Partial<ReturnType<typeof newPoll>>;
    delete old.kind;
    delete old.words;
    const p = old as ReturnType<typeof newPoll>;
    repairPoll(p);
    expect(p.kind).toBe('choice');
    expect(p.words).toEqual([]);
  });
});

describe('results export', () => {
  it('quotes cells and keeps formulas as text', () => {
    expect(cell('plain')).toBe('plain');
    expect(cell('a, b')).toBe('"a, b"');
    expect(cell('say "hi"')).toBe('"say ""hi"""');
    expect(cell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(cell('-2')).toBe("'-2");
    expect(cell(-2)).toBe('-2');
    expect(cell(true)).toBe('Yes');
    expect(cell(null)).toBe('');
    expect(toCsv([['a', 1]])).toBe('﻿a,1\r\n');
  });

  it('writes each kind of poll', () => {
    const choice = newPoll('choice', 'Next song?', ['A', 'B']);
    choice.votes = [3, 1];
    expect(pollRows(choice)).toEqual([['Question', 'Next song?'], ['Votes', 4], [], ['Answer', 'Votes', 'Share'], ['A', 3, '75%'], ['B', 1, '25%']]);
    const words = newPoll('words', 'One word?');
    words.words = [
      { text: 'b', count: 1 },
      { text: 'a', count: 5 },
    ];
    expect(pollRows(words).slice(2)).toEqual([
      ['Word', 'Times sent'],
      ['a', 5],
      ['b', 1],
    ]);
    const rating = newPoll('rating', 'Rate it');
    rating.votes = [0, 0, 0, 1, 1];
    rating.comments = [{ stars: 5, text: 'Great', at: 0 }];
    const rows = pollRows(rating);
    expect(rows[1]).toEqual(['Average', 4.5]);
    expect(rows).toContainEqual([5, 1, '50%']);
    expect(rows).toContainEqual([5, 'Great', '']);
  });

  it('writes questions most voted first, and trivia scores', () => {
    const q = (id: number, votes: number, at: number): Question => ({ id, author: 'Ana', text: `Q${id}`, at, shown: false, votes, approved: true });
    const rows = questionRows({ open: true, moderate: false, nextId: 3, questions: [q(1, 1, 1), q(2, 5, 2)] });
    expect(rows.map((r) => r[0])).toEqual(['Question', 'Q2', 'Q1']);
    const t = {
      players: [
        { key: 'a', name: 'Ana', score: 10 },
        { key: 'b', name: 'Ben', score: 30 },
      ],
    } as Trivia;
    expect(triviaRows(t)).toEqual([
      ['Place', 'Name', 'Score'],
      [1, 'Ben', 30],
      [2, 'Ana', 10],
    ]);
    expect(csvName('Rating: day 1', new Date(2026, 9, 11))).toBe('Rating day 1 2026-10-11.csv');
  });
});

describe('questions in the control window', () => {
  const q = (id: number, votes: number, at: number, approved = true, shown = false): Question => ({ id, author: '', text: '', at, shown, votes, approved });
  it('put those waiting first, then the most voted, answered last', () => {
    const list = [q(1, 0, 1), q(2, 3, 2), q(3, 0, 3, false), q(4, 9, 4, true, true), q(5, 3, 0)];
    expect(sortQuestions(list, 'votes').map((x) => x.id)).toEqual([3, 5, 2, 1, 4]);
    expect(sortQuestions(list, 'newest').map((x) => x.id)).toEqual([3, 2, 1, 5, 4]);
  });
});
