import { describe, expect, it } from 'vitest';
import { blankBlock, blockFromRow, blockMinutes, blockTime, blockToRow, byDay, hhmm, isMine, layoutDay, sortBlocks, typicalDay, type Block } from './blocks';

const b = (id: string, day: string, starts: string, ends: string, extra: Partial<Block> = {}): Block => ({
  ...blankBlock('p', id, day, 0),
  starts,
  ends,
  ...extra,
});

describe('schedule blocks', () => {
  it('reads and writes rows (Postgres times have seconds)', () => {
    const x = blockFromRow({
      id: 'a',
      plan_id: 'p',
      day: '2026-10-06',
      starts: '15:00:00',
      ends: null,
      title: 'Load-in',
      location: 'Dock',
      who: 'Crew',
      notes: '',
      sort: 3,
    });
    expect(x).toMatchObject({ day: '2026-10-06', starts: '15:00', ends: '', title: 'Load-in', sort: 3 });
    expect(blockToRow({ ...x, day: '' })).toMatchObject({ day: null, starts: '15:00', ends: null });
    expect(hhmm('9:00')).toBe('');
  });

  it('orders by day, then time (untimed first), and groups by day', () => {
    const list = [
      b('c', '2026-10-07', '09:00', ''),
      b('a', '2026-10-06', '15:00', ''),
      b('n', '', '', ''),
      b('u', '2026-10-06', '', ''),
      b('e', '2026-10-06', '08:00', ''),
    ];
    expect(sortBlocks(list).map((x) => x.id)).toEqual(['u', 'e', 'a', 'c', 'n']);
    expect(byDay(list).map((d) => [d.day, d.blocks.length])).toEqual([
      ['2026-10-06', 3],
      ['2026-10-07', 1],
      ['', 1],
    ]);
  });

  it('says the time span plainly', () => {
    expect(blockTime({ starts: '15:00', ends: '17:00' })).toBe('3:00 – 5:00 PM');
    expect(blockTime({ starts: '11:30', ends: '13:00' })).toBe('11:30 AM – 1:00 PM');
    expect(blockTime({ starts: '19:00', ends: '' })).toBe('7:00 PM');
    expect(blockTime({ starts: '', ends: '' })).toBe('');
    expect(blockMinutes({ starts: '23:00', ends: '01:00' })).toBe(120);
  });

  it('puts overlapping blocks side by side on the timeline', () => {
    const { placed, from, to } = layoutDay([b('a', 'd', '15:00', '17:00'), b('b', 'd', '16:00', '16:30'), b('c', 'd', '17:00', '18:00'), b('x', 'd', '', '')]);
    expect(placed.map((p) => [p.block.id, p.lane, p.lanes])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 1],
    ]);
    expect(placed[0]!.top).toBe(900);
    expect(from).toBe(14 * 60);
    expect(to).toBe(19 * 60);
  });

  it('finds my blocks by name, first name, role or everyone', () => {
    expect(isMine({ who: 'Sam, Audio' }, 'Sam Lee', [])).toBe(true);
    expect(isMine({ who: 'Sam Lee and Ana' }, 'Sam Lee', [])).toBe(true);
    expect(isMine({ who: 'Audio / Lights' }, 'Pat', ['lights'])).toBe(true);
    expect(isMine({ who: 'All crew' }, 'Pat', [])).toBe(true);
    expect(isMine({ who: 'Samantha' }, 'Sam Lee', [])).toBe(false);
    expect(isMine({ who: '' }, 'Sam', [])).toBe(false);
  });

  it('builds a typical show day around the start time', () => {
    const day = typicalDay('19:30');
    expect(day.map((x) => x.title)).toEqual(['Crew call', 'Load-in', 'Sound check', 'Rehearsal', 'Doors', 'Show', 'Strike']);
    expect(day.find((x) => x.title === 'Doors')).toMatchObject({ starts: '19:00', ends: '19:30' });
    expect(day[0]!.starts).toBe('14:00');
  });
});
