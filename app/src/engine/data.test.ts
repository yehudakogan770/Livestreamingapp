import { describe, expect, it } from 'vitest';
import { fill, parseCsv, parseData } from './data';

describe('data file', () => {
  it('reads CSV the way spreadsheets save it', () => {
    expect(parseCsv('Name,Role\r\n"Levi, Sarah","Head ""of"" school"\n\nDavid;x,Rabbi\n')).toEqual([
      ['Name', 'Role'],
      ['Levi, Sarah', 'Head "of" school'],
      ['David;x', 'Rabbi'],
    ]);
    expect(parseCsv('A;B\n1;2')).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
  });
  it('reads JSON', () => {
    expect(parseData('{"Home":"Lions","Home Score":3}', 'x.json')).toEqual({ headers: ['Home', 'Home Score'], rows: [['Lions', '3']] });
    expect(parseData('[{"a":1},{"b":2}]', 'x.json')).toEqual({
      headers: ['a', 'b'],
      rows: [
        ['1', ''],
        ['', '2'],
      ],
    });
  });
  it('fills titles', () => {
    expect(fill('{Name} · {role} {nope}', { Name: 'Sarah', Role: 'Rabbi' })).toBe('Sarah · Rabbi {nope}');
  });
});
