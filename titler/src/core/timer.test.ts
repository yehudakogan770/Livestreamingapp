// Timer fields: clocks and countdowns that run inside the title, the same
// on every screen; the operator's buttons; tables from spreadsheet columns.

import { describe, expect, it } from 'vitest';
import { formatClock, parseClock, parseTimer, timerCommand, timerSeconds, timerText } from './timer';
import { fill, setRenderClock } from './binding';
import { valuesFromRow } from './data';
import type { DataSource, Variable } from './types';

const down: Variable = { key: 'left', label: 'Left', type: 'timer', value: '10:00', timer: { dir: 'down', format: 'mm:ss' } };
const up: Variable = { key: 'clock', label: 'Clock', type: 'timer', value: '0:00', timer: { dir: 'up', format: 'm:ss' } };

describe('timers', () => {
  it('reads times as people write them', () => {
    expect(parseClock('10:00')).toBe(600);
    expect(parseClock('1:02:03')).toBe(3723);
    expect(parseClock('45.5')).toBe(45.5);
    expect(parseClock('0:09.5')).toBe(9.5);
    expect(parseClock('soon')).toBeNaN();
    expect(parseTimer('600@1000')).toEqual({ secs: 600, since: 1000 });
    expect(parseTimer('7:30')).toEqual({ secs: 450, since: null });
  });

  it('shows them in the chosen form (a countdown shows 10:00 until a whole second has gone)', () => {
    expect(formatClock(599.4, 'mm:ss')).toBe('10:00');
    expect(formatClock(65, 'm:ss', false)).toBe('1:05');
    expect(formatClock(3723, 'h:mm:ss')).toBe('1:02:03');
    expect(formatClock(23.46, 'ss.t')).toBe('23.4');
    expect(formatClock(9, 'mm:ss')).toBe('00:09');
  });

  it('runs from when it was started, by the clock on the wall, and stops at its end', () => {
    const started = timerCommand(down, '10:00', 'start', 1_000_000);
    expect(started).toBe('600@1000000');
    expect(timerText(down, started, 1_000_000 + 61_000, null)).toBe('08:59');
    expect(timerSeconds(down, started, 1_000_000 + 700_000, null)).toBe(0);
    const stopped = timerCommand(down, started, 'stop', 1_000_000 + 30_000);
    expect(stopped).toBe('570');
    expect(timerText(down, stopped, 9e12, null)).toBe('09:30');
    expect(timerCommand(down, stopped, 'add', 0, 60)).toBe('630');
    expect(timerCommand(down, stopped, 'reset', 0)).toBe('600');
    expect(timerCommand(up, '0', 'toggle', 5000)).toBe('0@5000');
  });

  it('counts up, and starts when the graphic is taken when asked', () => {
    expect(timerText(up, '0@0', 125_000, null)).toBe('2:05');
    const auto = { ...up, timer: { ...up.timer!, auto: true } };
    expect(timerText(auto, '0', 0, 42)).toBe('0:42');
    expect(timerText(up, '0', 0, 42)).toBe('0:00');
  });

  it('fills {{field}} with the running time while drawing', () => {
    const auto = { ...down, timer: { ...down.timer!, auto: true } };
    const before = setRenderClock(5);
    try {
      expect(fill('Left: {{left}}', { left: '1:00' }, [auto])).toBe('Left: 00:55');
    } finally {
      setRenderClock(before);
    }
  });
});

describe('tables from a spreadsheet', () => {
  it('a list field takes its whole column from the chosen row; others take the row', () => {
    const src: DataSource = { id: 'd', name: 'Results', kind: 'csv', url: 'x', refresh: 0, row: 1, map: { names: 'Candidate' } };
    const t = {
      headers: ['Candidate', 'Votes', 'Title'],
      rows: [
        ['Header row', '0', 'Ignored'],
        ['Avery', '10', 'Results'],
        ['Jordan', '8', ''],
        ['Sam\nPatel', '3', ''],
      ],
    };
    const vars: Variable[] = [
      { key: 'names', label: 'Names', type: 'list', value: '' },
      { key: 'title', label: 'Title', type: 'text', value: '' },
    ];
    expect(valuesFromRow(src, t, ['names', 'title'], vars)).toEqual({ names: 'Avery\nJordan\nSam Patel', title: 'Results' });
  });
});
