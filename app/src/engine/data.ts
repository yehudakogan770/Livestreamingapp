// The data file titles take their words from: reading CSV and JSON, and
// putting {Column} values into text.

import type { DataFeed } from './types/DataFeed';
import type { TextInput } from './types/TextInput';

const MAX_ROWS = 1000;
const MAX_COLUMNS = 40;

/** Split CSV text (commas, semicolons or tabs; "quoted, fields" and "" inside quotes). */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = first.includes('\t') ? '\t' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) {
      row.push(cell.trim());
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

/** Headers and rows from a data file's text (CSV, or JSON: an object, a list of objects, or a list of lists). */
export function parseData(text: string, path: string): { headers: string[]; rows: string[][] } {
  const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  let headers: string[] = [];
  let rows: string[][] = [];
  if (/\.json$/i.test(path) || /^\s*[[{]/.test(text)) {
    const v: unknown = JSON.parse(text);
    const list = Array.isArray(v) ? v : [v];
    if (list.length && Array.isArray(list[0])) {
      headers = (list[0] as unknown[]).map(str);
      rows = list.slice(1).map((r) => (Array.isArray(r) ? r.map(str) : [str(r)]));
    } else {
      for (const o of list) if (o && typeof o === 'object') for (const k of Object.keys(o)) if (!headers.includes(k)) headers.push(k);
      rows = list.map((o) => headers.map((h) => str((o as Record<string, unknown>)?.[h])));
    }
  } else {
    const all = parseCsv(text);
    headers = all[0] ?? [];
    rows = all.slice(1);
  }
  return { headers: headers.slice(0, MAX_COLUMNS), rows: rows.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLUMNS)) };
}

/** The chosen row's values by column name. */
export function dataValues(d: DataFeed | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!d) return out;
  const row = d.rows[d.row];
  d.headers.forEach((h, i) => (out[h] = row?.[i] ?? ''));
  return out;
}

/** Put the data's values into `{Column}` (any case); unknown names stay as they are. */
export function fill(text: string, values: Record<string, string> | undefined): string {
  if (!values || !text.includes('{')) return text;
  const lower = new Map(Object.entries(values).map(([k, v]) => [k.trim().toLowerCase(), v]));
  return text.replace(/\{([^{}]{1,60})\}/g, (m, name: string) => lower.get(name.trim().toLowerCase()) ?? m);
}

/** A title with its `{Column}`s filled in. */
export const withData = (t: TextInput, values: Record<string, string> | undefined): TextInput =>
  values && Object.keys(values).length ? { ...t, text: fill(t.text, values), sub: fill(t.sub, values) } : t;
