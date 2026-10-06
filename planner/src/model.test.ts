import { describe, expect, it } from 'vitest';
import {
  STEP,
  blankCue,
  clock12,
  clock24,
  cueAt,
  cueFromRow,
  cueToRow,
  eventSeconds,
  formatDuration,
  isoDate,
  mergeCue,
  moveCue,
  parseClock,
  parseDuration,
  positionAfter,
  positionBetween,
  renumber,
  schedule,
  showClock,
  sortCues,
  type PlanCue,
} from './model';

const cue = (id: string, position: number, more: Partial<PlanCue> = {}): PlanCue => ({ ...blankCue('plan', id, position), ...more });
const ids = (cs: { id: string }[]) => cs.map((c) => c.id);

/** Apply moveCue's changes and sort, as the app does. */
function applyMove(cs: PlanCue[], from: number, to: number): PlanCue[] {
  const changed = new Map(moveCue(cs, from, to).map((c) => [c.id, c.position]));
  return sortCues(cs.map((c) => (changed.has(c.id) ? { ...c, position: changed.get(c.id)! } : c)));
}

describe('order', () => {
  const list = [cue('a', 1024), cue('b', 2048), cue('c', 3072), cue('d', 4096)];

  it('sorts by position, then id', () => {
    expect(ids(sortCues([cue('z', 5), cue('y', 1), cue('x', 5)]))).toEqual(['y', 'x', 'z']);
  });

  it('puts positions between neighbors', () => {
    expect(positionBetween(null, null)).toBe(STEP);
    expect(positionBetween(null, 100)).toBe(100 - STEP);
    expect(positionBetween(100, null)).toBe(100 + STEP);
    expect(positionBetween(100, 200)).toBe(150);
  });

  it('moves a cue down, up, to the top and to the end, changing only that cue', () => {
    expect(ids(applyMove(list, 0, 2))).toEqual(['b', 'c', 'a', 'd']);
    expect(ids(applyMove(list, 3, 1))).toEqual(['a', 'd', 'b', 'c']);
    expect(ids(applyMove(list, 2, 0))).toEqual(['c', 'a', 'b', 'd']);
    expect(ids(applyMove(list, 0, 3))).toEqual(['b', 'c', 'd', 'a']);
    expect(moveCue(list, 1, 2)).toHaveLength(1);
  });

  it('does nothing for a move to the same place or out of range', () => {
    expect(moveCue(list, 1, 1)).toEqual([]);
    expect(moveCue(list, -1, 2)).toEqual([]);
    expect(moveCue(list, 0, 9)).toEqual([]);
  });

  it('numbers every cue afresh when the gap has run out', () => {
    const tight = [cue('a', 1), cue('b', 1 + 1e-9), cue('c', 1 + 2e-9), cue('d', 5)];
    const changed = moveCue(tight, 3, 1);
    expect(changed.length).toBeGreaterThan(1);
    const after = applyMove(tight, 3, 1);
    expect(ids(after)).toEqual(['a', 'd', 'b', 'c']);
    expect(new Set(after.map((c) => c.position)).size).toBe(4);
  });

  it('survives many moves to the same spot', () => {
    let cs = [cue('a', 1024), cue('b', 2048), cue('c', 3072)];
    for (let i = 0; i < 80; i++) cs = applyMove(cs, 2, 1);
    expect(cs).toHaveLength(3);
    expect(new Set(cs.map((c) => c.position)).size).toBe(3);
  });

  it('renumbers in order', () => {
    expect(renumber([cue('x', 9), cue('y', 3)]).map((c) => c.position)).toEqual([STEP, 2 * STEP]);
  });

  it('places a new cue after a given cue or at the end', () => {
    expect(positionAfter(list, 'b')).toBe(2560);
    expect(positionAfter(list, null)).toBe(4096 + STEP);
    expect(positionAfter([], null)).toBe(STEP);
  });
});

describe('clock times', () => {
  it('reads 24-hour and American times', () => {
    expect(parseClock('19:30')).toBe(19 * 3600 + 30 * 60);
    expect(parseClock('7:30 PM')).toBe(19 * 3600 + 30 * 60);
    expect(parseClock('7:30pm')).toBe(19 * 3600 + 30 * 60);
    expect(parseClock('7 pm')).toBe(19 * 3600);
    expect(parseClock('12:15 AM')).toBe(15 * 60);
    expect(parseClock('12:00 PM')).toBe(12 * 3600);
    expect(parseClock('9:05:30')).toBe(9 * 3600 + 5 * 60 + 30);
    expect(parseClock('7:30 p.m.')).toBe(19 * 3600 + 30 * 60);
  });

  it('refuses what is not a time', () => {
    for (const t of ['', '7', '25:00', '13:00 PM', '7:75', 'soon', '0:00 AM']) expect(parseClock(t)).toBeNull();
  });

  it('writes times', () => {
    expect(clock24(19 * 3600 + 30 * 60)).toBe('19:30');
    expect(clock24(9 * 3600 + 5)).toBe('09:00:05');
    expect(clock24(86_400 + 60)).toBe('00:01');
    expect(clock12(19 * 3600 + 30 * 60)).toBe('7:30 PM');
    expect(clock12(0)).toBe('12:00 AM');
    expect(clock12(12 * 3600)).toBe('12:00 PM');
    expect(clock12(86_400 + 1800)).toBe('12:30 AM');
    expect(showClock('19:30')).toBe('7:30 PM');
    expect(showClock('')).toBe('');
  });
});

describe('lengths', () => {
  it('reads the ways people write them', () => {
    expect(parseDuration('5:00')).toBe(300);
    expect(parseDuration('1:02:30')).toBe(3750);
    expect(parseDuration('90')).toBe(5400);
    expect(parseDuration('20')).toBe(1200);
    expect(parseDuration('1.5')).toBe(90);
    expect(parseDuration('5m')).toBe(300);
    expect(parseDuration('5 min')).toBe(300);
    expect(parseDuration('1h 30m')).toBe(5400);
    expect(parseDuration('45s')).toBe(45);
    expect(parseDuration('1.5h')).toBe(5400);
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('5:75')).toBeNull();
    expect(parseDuration('a while')).toBeNull();
  });

  it('writes them', () => {
    expect(formatDuration(300)).toBe('5:00');
    expect(formatDuration(3750)).toBe('1:02:30');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(-65)).toBe('-1:05');
    expect(formatDuration(null)).toBe('');
  });
});

describe('schedule', () => {
  it('runs cues one after another from the start time, with totals', () => {
    const cs = [
      cue('a', 1, { durationSec: 300, segment: 'countdown' }),
      cue('b', 2, { durationSec: 600, segment: 'speaker' }),
      cue('c', 3, { durationSec: 120, segment: 'speaker' }),
    ];
    const s = schedule(cs, '19:00');
    expect(s.rows.map((r) => r.start)).toEqual([68_400, 68_700, 69_300]);
    expect(s.rows.map((r) => r.elapsed)).toEqual([0, 300, 900]);
    expect(s.totalSec).toBe(1020);
    expect(s.endSec).toBe(69_420);
    expect(s.bySegment).toEqual({ countdown: 300, speaker: 720 });
    expect(s.untimed).toBe(0);
  });

  it('follows fixed starts and shows gaps and overruns', () => {
    const cs = [cue('a', 1, { durationSec: 600 }), cue('b', 2, { startTime: '19:15', durationSec: 600 }), cue('c', 3, { startTime: '19:20', durationSec: 60 })];
    const s = schedule(cs, '19:00');
    expect(s.rows[1]).toMatchObject({ start: 69_300, fixed: true, drift: 300 });
    expect(s.rows[2]).toMatchObject({ start: 69_600, fixed: true, drift: -300 });
    expect(s.endSec).toBe(69_660);
  });

  it('does not know a start after a cue with no length (unless fixed)', () => {
    const cs = [cue('a', 1), cue('b', 2, { durationSec: 60 }), cue('c', 3, { startTime: '20:00' })];
    const s = schedule(cs, '19:00');
    expect(s.rows.map((r) => r.start)).toEqual([68_400, null, 72_000]);
    expect(s.untimed).toBe(2);
    expect(s.endSec).toBeNull();
  });

  it('works without a start time, and keeps counting past midnight', () => {
    expect(schedule([cue('a', 1, { durationSec: 60 })], '').rows[0]!.start).toBeNull();
    const late = schedule([cue('a', 1, { durationSec: 1800 }), cue('b', 2, { startTime: '00:30', durationSec: 600 })], '23:50');
    expect(late.rows[1]!.start).toBe(86_400 + 1800);
    expect(late.rows[1]!.drift).toBe(1800 - 1200);
  });

  it('finds the cue planned for now', () => {
    const s = schedule([cue('a', 1, { durationSec: 300 }), cue('b', 2, { durationSec: 300 })], '19:00');
    expect(cueAt(s, 68_399)).toBeNull();
    expect(cueAt(s, 68_400)).toBe(0);
    expect(cueAt(s, 68_750)).toBe(1);
    expect(cueAt(s, 69_000)).toBeNull();
  });

  it('counts seconds from the event day’s midnight', () => {
    expect(eventSeconds('2026-10-06', new Date(2026, 9, 6, 19, 30, 5))).toBe(19 * 3600 + 30 * 60 + 5);
    expect(eventSeconds('2026-10-06', new Date(2026, 9, 7, 0, 30))).toBe(86_400 + 1800);
    expect(eventSeconds('2026-10-06', new Date(2026, 9, 5, 23, 0))).toBeNull();
    expect(eventSeconds('', new Date())).toBeNull();
    expect(isoDate(new Date(2026, 0, 9))).toBe('2026-01-09');
  });
});

describe('live edits', () => {
  const mine = cue('a', 1, { title: 'Mine', updatedAt: 1000 });

  it('takes a newer cue from someone else', () => {
    const next = mergeCue([mine], { ...mine, title: 'Theirs', updatedAt: 2000 }, new Set());
    expect(next[0]!.title).toBe('Theirs');
  });

  it('keeps ours when it is newer, or has changes not saved yet', () => {
    expect(mergeCue([mine], { ...mine, title: 'Old', updatedAt: 500 }, new Set())[0]!.title).toBe('Mine');
    expect(mergeCue([mine], { ...mine, title: 'Theirs', updatedAt: 2000 }, new Set(['a']))[0]!.title).toBe('Mine');
  });

  it('adds a cue it has not seen', () => {
    expect(ids(mergeCue([mine], cue('b', 2), new Set()))).toEqual(['a', 'b']);
  });

  it('round-trips a cue through its row', () => {
    const c = cue('a', 3.5, { title: 'Welcome', segment: 'speaker', who: 'Rabbi', durationSec: 120, input: 'Cam 1', overlay: 'Name', transition: 'Fade' });
    const back = cueFromRow({ ...cueToRow(c), updated_at: '2026-10-06T19:00:00Z', updated_by_name: 'Dana' });
    expect(back).toEqual({ ...c, updatedAt: Date.parse('2026-10-06T19:00:00Z'), updatedBy: 'Dana' });
    expect(cueFromRow({ ...cueToRow(c), segment: 'nonsense' }).segment).toBe('custom');
  });
});
