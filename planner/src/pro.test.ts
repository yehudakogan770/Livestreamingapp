import { describe, expect, it } from 'vitest';
import { blankCue, blankPlan, cueFromRow, cueToRow, eventSeconds, planFromRow, schedule, zonedMoment, zoneOffset, type PlanCue, type PlanRow } from './model';
import {
  OFF,
  actualSec,
  crewLine,
  lengthsFromRun,
  nextIndex,
  overUnderWords,
  prevIndex,
  runs,
  timerText,
  timerTone,
  whereNow,
  type Live,
  type LogEntry,
} from './live';
import { blankItem, budgetTotals, callGroups, listOf, parseMoney, taskCount } from './items';
import { cuesToRows, headerField, itemsToCsv, parseCsv, planToIcs, readXlsx, rowsToCues, segmentFrom, toCsv, toXlsx, unzip } from './csv';
import { insertMention, matchPeople, mentionsIn, splitMentions, typingMention } from './mentions';
import { canEditSection, safeName } from './apiPro';

const cue = (id: string, position: number, more: Partial<PlanCue> = {}): PlanCue => ({ ...blankCue('p', id, position), ...more });

describe('cues and plans from the server (update 10)', () => {
  it('reads the new columns, and knows when the server does not have them', () => {
    const base: PlanRow = { id: 'p', owner: 'o', name: 'Gala', event_date: null, venue: '', start_time: '', notes: '', updated_at: '', updated_by_name: '' };
    expect(planFromRow(base).pro).toBe(false);
    const p = planFromRow({
      ...base,
      time_zone: 'America/Chicago',
      end_by: '21:00',
      columns: [{ id: 'a', name: 'Audio' }, { bad: 1 }],
      is_template: true,
      share_token: 't',
      share_scope: 'crew',
    });
    expect(p).toMatchObject({
      pro: true,
      timeZone: 'America/Chicago',
      endBy: '21:00',
      columns: [{ id: 'a', name: 'Audio' }],
      isTemplate: true,
      shareToken: 't',
      shareScope: 'crew',
    });
  });

  it('sends the new cue columns only to a server that has them', () => {
    const c = cue('a', 1, { script: 'Hello', color: 'blue', skip: true, custom: { a: 'Mic 2' } });
    expect(cueToRow(c, true)).toMatchObject({ script: 'Hello', color: 'blue', skip: true, custom: { a: 'Mic 2' } });
    expect(cueToRow(c, false)).not.toHaveProperty('script');
    const back = cueFromRow({ ...cueToRow(c), color: 'pink' });
    expect(back.color).toBe('');
    expect(back.script).toBe('Hello');
  });

  it('leaves floated cues out of the timing', () => {
    const s = schedule([cue('a', 1, { durationSec: 60 }), cue('b', 2, { durationSec: 600, skip: true }), cue('c', 3, { durationSec: 120 })], '19:00');
    expect(s.totalSec).toBe(180);
    expect(s.rows[1]).toMatchObject({ skipped: true, start: 19 * 3600 + 60, end: null });
    expect(s.rows[2]!.start).toBe(19 * 3600 + 60);
    expect(s.endSec).toBe(19 * 3600 + 180);
  });
});

describe('time zones', () => {
  it('finds the moment a wall-clock time happens in a zone', () => {
    // 7:30 PM in New York on Nov 14, 2026 (EST, UTC−5) is 00:30 UTC the next day.
    expect(zonedMoment('2026-11-14', 19.5 * 3600, 'America/New_York')!.toISOString()).toBe('2026-11-15T00:30:00.000Z');
    // In summer (EDT, UTC−4).
    expect(zonedMoment('2026-07-04', 21 * 3600, 'America/New_York')!.toISOString()).toBe('2026-07-05T01:00:00.000Z');
    expect(zoneOffset(new Date('2026-07-04T12:00:00Z'), 'Asia/Tokyo')).toBe(540);
  });

  it('counts the event day in the plan’s zone', () => {
    const at = new Date('2026-11-15T00:30:00Z');
    expect(eventSeconds('2026-11-14', at, 'America/New_York')).toBe(19.5 * 3600);
    expect(eventSeconds('2026-11-14', at, 'Asia/Tokyo')).toBe(86_400 + 9.5 * 3600);
  });
});

describe('show day', () => {
  const cues = [
    cue('a', 1, { title: 'Doors', durationSec: 300, who: 'Dana' }),
    cue('b', 2, { durationSec: 600, skip: true }),
    cue('c', 3, { title: 'Welcome', durationSec: 120 }),
  ];
  const t0 = Date.UTC(2026, 10, 14, 19);
  const live = (more: Partial<Live>): Live => ({ ...OFF, planId: 'p', runId: 'r', state: 'running', cueId: 'a', cueStartedAt: t0, showStartedAt: t0, ...more });

  it('passes over floated cues', () => {
    expect(nextIndex(cues, 0)).toBe(2);
    expect(prevIndex(cues, 2)).toBe(0);
    expect(nextIndex(cues, 2)).toBe(-1);
  });

  it('counts down the cue on now and says what is next', () => {
    const n = whereNow(live({}), cues, t0 + 60_000);
    expect(n).toMatchObject({ index: 0, next: 2, elapsed: 60, remaining: 240, running: true, overUnder: 0 });
    expect(n.projectedEnd).toBe(t0 + 60_000 + (240 + 120) * 1000);
    expect(crewLine(cues, n)).toBe('On now: Doors (Dana) · 4:00 left');
  });

  it('runs over, and the show runs over with it', () => {
    const n = whereNow(live({}), cues, t0 + 330_000);
    expect(n.remaining).toBe(-30);
    expect(n.overUnder).toBe(30);
    expect(overUnderWords(n.overUnder)).toBe('0:30 over');
  });

  it('knows when a later cue started late or early', () => {
    const log: LogEntry[] = [
      { id: '1', runId: 'r', mode: 'show', cueId: 'a', cueTitle: 'Doors', plannedSec: 300, startedAt: t0, endedAt: t0 + 240_000, pausedSec: 0 },
    ];
    const n = whereNow(live({ cueId: 'c', cueStartedAt: t0 + 240_000 }), cues, t0 + 250_000, log);
    expect(n.overUnder).toBe(-60);
    expect(overUnderWords(-60)).toBe('1:00 under');
  });

  it('freezes while paused', () => {
    const n = whereNow(live({ state: 'paused', pausedAt: t0 + 10_000 }), cues, t0 + 99_000);
    expect(n.elapsed).toBe(10);
    expect(n.paused).toBe(true);
  });

  it('before the show: the first cue is next', () => {
    expect(whereNow(null, cues, t0)).toMatchObject({ index: -1, next: 0 });
    expect(whereNow(live({ state: 'ended' }), cues, t0).next).toBe(-1);
  });

  it('timer words and colors', () => {
    expect(timerText(299)).toBe('4:59');
    expect(timerText(-80)).toBe('−1:20');
    expect(timerText(3720)).toBe('1:02:00');
    expect(timerTone(200, 300)).toBe('ok');
    expect(timerTone(30, 300)).toBe('wrap');
    expect(timerTone(55, 1200)).toBe('wrap');
    expect(timerTone(-1, 300)).toBe('over');
    expect(overUnderWords(3)).toBe('On time');
  });

  it('turns a rehearsal into lengths', () => {
    const log: LogEntry[] = [
      { id: '1', runId: 'r', mode: 'rehearsal', cueId: 'a', cueTitle: '', plannedSec: 300, startedAt: 0, endedAt: 283_000, pausedSec: 20 },
      { id: '2', runId: 'r', mode: 'rehearsal', cueId: 'c', cueTitle: '', plannedSec: 120, startedAt: 283_000, endedAt: null, pausedSec: 0 },
      { id: '3', runId: 'q', mode: 'show', cueId: 'a', cueTitle: '', plannedSec: 300, startedAt: 900_000, endedAt: 990_000, pausedSec: 0 },
    ];
    expect(actualSec(log[0]!)).toBe(263);
    expect([...lengthsFromRun(log.slice(0, 2))]).toEqual([['a', 265]]);
    expect(runs(log).map((r) => r.runId)).toEqual(['q', 'r']);
  });
});

describe('lists', () => {
  const it1 = (more: Parameters<typeof blankItem>[4]) => blankItem('p', String(Math.random()), more?.kind ?? 'task', 0, more);
  it('orders the crew by call time and tasks open first', () => {
    const crew = [
      it1({ kind: 'crew', title: 'B', callTime: '16:00' }),
      it1({ kind: 'crew', title: 'A', callTime: '15:00' }),
      it1({ kind: 'crew', title: 'C', callTime: '15:00' }),
    ];
    expect(listOf(crew, 'crew').map((c) => c.title)).toEqual(['A', 'C', 'B']);
    expect(callGroups(crew).map((g) => [g.time, g.people.length])).toEqual([
      ['3:00 PM', 2],
      ['4:00 PM', 1],
    ]);
    const tasks = [it1({ title: 'x', done: true }), it1({ title: 'y' })];
    expect(listOf(tasks, 'task').map((t) => t.title)).toEqual(['y', 'x']);
    expect(taskCount(tasks)).toEqual({ done: 1, all: 2 });
  });

  it('adds up the budget', () => {
    const b = [it1({ kind: 'budget', amount: 100, qty: 3, actual: 320 }), it1({ kind: 'budget', amount: 50.5 })];
    expect(budgetTotals(b)).toEqual({ estimate: 350.5, actual: 320, diff: -30.5 });
    expect(parseMoney('$1,250.50')).toBe(1250.5);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeUndefined();
  });
});

describe('spreadsheets', () => {
  it('reads CSV with quotes, commas, line breaks and tabs', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,"two\nlines",3\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', 'two\nlines', '3'],
    ]);
    expect(parseCsv('Cue\tLength\nWelcome\t5:00')).toEqual([
      ['Cue', 'Length'],
      ['Welcome', '5:00'],
    ]);
  });

  it('writes CSV that spreadsheets read safely', () => {
    expect(toCsv([['=SUM(A1)', 'a,b', '-5']])).toBe('﻿\'=SUM(A1),"a,b",-5\r\n');
  });

  it('knows other tools’ column names', () => {
    expect(headerField('Duration')).toBe('length');
    expect(headerField('Talent')).toBe('who');
    expect(headerField('Story slug')).toBeNull();
    expect(headerField('GFX')).toBe('overlay');
    expect(segmentFrom('VT')).toBe('video');
    expect(segmentFrom('Keynote speaker')).toBe('speaker');
  });

  it('round-trips the run of show', () => {
    const cues = [
      cue('a', 1, { section: 'Opening', title: 'Welcome', durationSec: 300, who: 'Dana', segment: 'speaker', script: 'Hi, all', custom: { cam: 'Wide' } }),
      cue('b', 2, { title: 'Video', durationSec: 90, segment: 'video', startTime: '19:10' }),
    ];
    const rows = cuesToRows(cues, '19:00', [{ id: 'cam', name: 'Camera' }]);
    const back = rowsToCues(parseCsv(toCsv(rows)), [{ id: 'cam', name: 'Camera' }]);
    expect(back.cues).toHaveLength(2);
    expect(back.cues[0]).toMatchObject({
      section: 'Opening',
      title: 'Welcome',
      durationSec: 300,
      who: 'Dana',
      segment: 'speaker',
      script: 'Hi, all',
      custom: { cam: 'Wide' },
    });
    expect(back.cues[1]).toMatchObject({ title: 'Video', segment: 'video', startTime: '19:10', section: 'Opening' });
    expect(back.extra).toEqual(['Camera']);
  });

  it('works out lengths from a sheet of start times', () => {
    const r = rowsToCues([
      ['Time', 'Item'],
      ['7:00 PM', 'Doors'],
      ['7:30 PM', 'Welcome'],
      ['7:45 PM', 'Dinner'],
    ]);
    expect(r.cues.map((c) => c.durationSec)).toEqual([1800, 900, null]);
  });

  it('takes a sheet without a header as Cue, Length, Who, Notes', () => {
    const r = rowsToCues([['Welcome', '5', 'Dana', 'Mic 1']]);
    expect(r.cues[0]).toMatchObject({ title: 'Welcome', durationSec: 300, who: 'Dana', notes: 'Mic 1' });
  });

  it('writes and reads back an Excel file', async () => {
    const x = toXlsx([
      {
        name: 'Run of show',
        rows: [
          ['Cue', 'Length'],
          ['Welcome & intro', '5:00'],
          ['Count', '42'],
        ],
      },
    ]);
    const files = await unzip(x);
    expect([...files.keys()]).toContain('xl/worksheets/sheet1.xml');
    const rows = await readXlsx(x);
    expect(rows).toEqual([
      ['Cue', 'Length'],
      ['Welcome & intro', '5:00'],
      ['Count', '42'],
    ]);
  });

  it('exports lists', () => {
    const csv = itemsToCsv('crew', [blankItem('p', 'i', 'crew', 0, { title: 'Dana', role: 'Camera 1', callTime: '15:00' })]);
    expect(csv).toContain('Dana,Camera 1,,3:00 PM');
  });

  it('makes a calendar file', () => {
    const plan = blankPlan('p', { name: 'Gala, night', eventDate: '2026-11-14', startTime: '19:30', venue: 'Main hall', timeZone: 'America/New_York' });
    const ics = planToIcs(
      plan,
      [cue('a', 1, { title: 'Welcome', durationSec: 3600 })],
      [
        {
          id: 'b',
          planId: 'p',
          day: '2026-11-14',
          starts: '15:00',
          ends: '17:00',
          title: 'Load-in',
          location: 'Dock',
          who: 'Crew',
          notes: '',
          sort: 0,
          updatedAt: 0,
          updatedBy: '',
        },
      ],
      new Date('2026-10-01T00:00:00Z'),
    );
    expect(ics).toContain('SUMMARY:Gala\\, night');
    expect(ics).toContain('DTSTART;TZID=America/New_York:20261114T193000');
    expect(ics).toContain('DTEND;TZID=America/New_York:20261114T203000');
    expect(ics).toContain('UID:block-b@lumora-planner');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});

describe('@mentions', () => {
  const people = [
    { userId: 'u1', name: 'Dana Levi', email: 'dana@x.org' },
    { userId: 'u2', name: 'Dan Cole', email: 'dan@x.org' },
    { userId: 'me', name: 'Sam', email: 's@x.org' },
  ];
  it('finds the people named', () => {
    expect(mentionsIn('@Dana Levi can you check?', people)).toEqual(['u1']);
    expect(mentionsIn('@dan and @Dana', people).sort()).toEqual(['u1', 'u2']);
    expect(mentionsIn('email dana@x.org', people)).toEqual([]);
    expect(mentionsIn('@Sam hi', people, 'me')).toEqual([]);
  });
  it('offers people while typing', () => {
    expect(typingMention('Hi @Da', 6)).toEqual({ start: 3, query: 'Da' });
    expect(typingMention('a@b', 3)).toBeNull();
    expect(matchPeople(people, 'da', 'me').map((p) => p.userId)).toEqual(['u1', 'u2']);
    expect(matchPeople(people, 'levi').map((p) => p.userId)).toEqual(['u1']);
    expect(insertMention('Hi @Da', 3, 6, people[0]!)).toEqual({ text: 'Hi @Dana Levi ', caret: 14 });
  });
  it('shows them bold', () => {
    expect(splitMentions('ok @Dana Levi thanks', people)).toEqual([
      { text: 'ok ', mention: false },
      { text: '@Dana Levi', mention: true },
      { text: ' thanks', mention: false },
    ]);
  });
});

describe('locks and files', () => {
  it('locked sections are for the owner and the editors named', () => {
    const locks = [{ section: 'Opening', editors: ['t'] }];
    expect(canEditSection('owner', 'x', 'Opening', locks)).toBe(true);
    expect(canEditSection('editor', 't', 'Opening', locks)).toBe(true);
    expect(canEditSection('editor', 'u', 'Opening', locks)).toBe(false);
    expect(canEditSection('editor', 'u', 'Awards', locks)).toBe(true);
    expect(canEditSection('viewer', 't', 'Awards', locks)).toBe(false);
  });
  it('makes file names safe to store', () => {
    expect(safeName('a/b\\c.pdf')).toBe('a-b-c.pdf');
    expect(safeName(`${'x'.repeat(200)}.mp4`)).toHaveLength(120);
    expect(safeName(`${'x'.repeat(200)}.mp4`).endsWith('.mp4')).toBe(true);
  });
});
