import { describe, expect, it } from 'vitest';
import { fill, isDataUrl, parseCsv, parseData, sheetCsvUrl } from './data';

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

describe('Google Sheet links', () => {
  it('turns a sheet’s own link into its CSV export, keeping the tab', () => {
    expect(sheetCsvUrl('https://docs.google.com/spreadsheets/d/1AbC_d-9/edit#gid=123')).toBe(
      'https://docs.google.com/spreadsheets/d/1AbC_d-9/export?format=csv&gid=123',
    );
    expect(sheetCsvUrl(' https://docs.google.com/spreadsheets/d/1AbC/edit?usp=sharing ')).toBe('https://docs.google.com/spreadsheets/d/1AbC/export?format=csv');
  });

  it('keeps a published link, asking for CSV', () => {
    expect(sheetCsvUrl('https://docs.google.com/spreadsheets/d/e/2PACX-1v/pub?gid=0&single=true&output=csv')).toBe(
      'https://docs.google.com/spreadsheets/d/e/2PACX-1v/pub?gid=0&single=true&output=csv',
    );
    expect(sheetCsvUrl('https://docs.google.com/spreadsheets/d/e/2PACX-1v/pubhtml')).toBe('https://docs.google.com/spreadsheets/d/e/2PACX-1v/pub?output=csv');
  });

  it('uses any other web link as it is, and refuses what is not one', () => {
    expect(sheetCsvUrl('https://example.com/scores.csv')).toBe('https://example.com/scores.csv');
    expect(sheetCsvUrl('C:\\Scores\\scores.csv')).toBeNull();
    expect(sheetCsvUrl('ftp://example.com/a.csv')).toBeNull();
    expect(isDataUrl('https://x')).toBe(true);
    expect(isDataUrl('C:\\a.csv')).toBe(false);
  });
});
