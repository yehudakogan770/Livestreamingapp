import { describe, expect, it } from 'vitest';
import { parseCsv, parseTable, sheetCsvUrl, valuesFromRow, readSource } from './data';
import { crc32, zip } from './zip';
import type { DataSource } from './types';

const src = (over: Partial<DataSource> = {}): DataSource => ({ id: 'd', name: 'Scores', kind: 'csv', url: 'x', refresh: 0, row: 0, map: {}, ...over });

describe('data sources', () => {
  it('reads CSV with quotes, semicolons and tabs', () => {
    expect(parseCsv('a,b\n"1, 2","say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['1, 2', 'say "hi"'],
    ]);
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a\tb\r\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads JSON lists of objects, lists of lists and wrapped lists', () => {
    expect(parseTable('[{"name":"A","score":3},{"name":"B"}]', 'json')).toEqual({
      headers: ['name', 'score'],
      rows: [
        ['A', '3'],
        ['B', ''],
      ],
    });
    expect(parseTable('[["x","y"],[1,2]]', 'json')).toEqual({ headers: ['x', 'y'], rows: [['1', '2']] });
    expect(parseTable('{"rows":[{"a":1}]}', 'json')).toEqual({ headers: ['a'], rows: [['1']] });
  });

  it('turns a Google Sheet link into its CSV address', () => {
    expect(sheetCsvUrl('https://docs.google.com/spreadsheets/d/ABC_123/edit#gid=42')).toBe('https://docs.google.com/spreadsheets/d/ABC_123/export?format=csv&gid=42');
    expect(sheetCsvUrl('https://docs.google.com/spreadsheets/d/ABC/pub?output=csv')).toBe('https://docs.google.com/spreadsheets/d/ABC/pub?output=csv');
    expect(sheetCsvUrl('https://example.com/a.csv')).toBe('https://example.com/a.csv');
  });

  it('fills fields from a row: same-named columns, or mapped ones', () => {
    const t = parseTable('Name,Team,Score\nJordan,Blue,3\nSam,Red,5', 'csv');
    expect(valuesFromRow(src({ row: 1 }), t, ['name', 'score', 'missing'])).toEqual({ name: 'Sam', score: '5' });
    expect(valuesFromRow(src({ map: { team_name: 'Team' } }), t, ['team_name'])).toEqual({ team_name: 'Blue' });
    // A row past the end shows the last one.
    expect(valuesFromRow(src({ row: 9 }), t, ['name'])).toEqual({ name: 'Sam' });
  });

  it('reads a source through the given fetch', async () => {
    const t = await readSource(src({ kind: 'sheet', url: 'https://docs.google.com/spreadsheets/d/K/edit' }), async (u) => {
      expect(u).toContain('/export?format=csv');
      return 'a\n1';
    });
    expect(t.rows).toEqual([['1']]);
  });
});

describe('zip (PNG sequences)', () => {
  it('has the standard CRC-32 and a readable layout', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
    const z = zip([
      { name: 'a.txt', data: new TextEncoder().encode('hello') },
      { name: 'b.txt', data: new Uint8Array([1, 2, 3]) },
    ]);
    const dv = new DataView(z.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    // End of central directory: two entries.
    const end = z.length - 22;
    expect(dv.getUint32(end, true)).toBe(0x06054b50);
    expect(dv.getUint16(end + 10, true)).toBe(2);
    expect(new TextDecoder().decode(z.slice(30, 35))).toBe('a.txt');
  });
});
