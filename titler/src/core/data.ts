// Data sources: a CSV file, a Google Sheet or a JSON address whose rows fill
// a template's fields, read again every few seconds.

import type { DataSource, Values } from './types';

export interface Table {
  headers: string[];
  rows: string[][];
}

/** Split CSV text (commas, semicolons or tabs; "quoted, fields" with "" inside). */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = first.includes('\t') ? '\t' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** A table from a file's text: CSV, or JSON (an object, a list of objects, a list of lists, or { rows: [...] }). */
export function parseTable(text: string, kind: DataSource['kind']): Table {
  if (kind === 'json' || /^\s*[[{]/.test(text)) {
    let v: unknown = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      const list = Object.values(o).find((x) => Array.isArray(x));
      v = list ?? [o];
    }
    const list = v as unknown[];
    if (list.length && Array.isArray(list[0]))
      return { headers: (list[0] as unknown[]).map(str), rows: list.slice(1).map((r) => (Array.isArray(r) ? r.map(str) : [str(r)])) };
    const headers: string[] = [];
    for (const o of list) if (o && typeof o === 'object') for (const k of Object.keys(o)) if (!headers.includes(k)) headers.push(k);
    return { headers, rows: list.map((o) => headers.map((h) => str((o as Record<string, unknown>)?.[h]))) };
  }
  const all = parseCsv(text);
  return { headers: all[0] ?? [], rows: all.slice(1) };
}

/**
 * A Google Sheets link as the address of its CSV: a sheet shared with
 * "anyone with the link" or published to the web.
 */
export function sheetCsvUrl(url: string): string {
  const m = /docs\.google\.com\/spreadsheets\/d\/([\w-]+)/.exec(url);
  if (!m) return url;
  if (/\/pub\?|output=csv|format=csv/.test(url)) return url;
  const gid = /[#&?]gid=(\d+)/.exec(url)?.[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}

/** The fields one row fills (a field named like a column takes it unless mapped otherwise). */
export function valuesFromRow(src: DataSource, t: Table, keys: string[]): Values {
  const row = t.rows[Math.min(Math.max(0, src.row), Math.max(0, t.rows.length - 1))];
  if (!row) return {};
  const out: Values = {};
  const col = (name: string) => t.headers.findIndex((h) => h.trim().toLowerCase() === name.trim().toLowerCase());
  for (const k of keys) {
    const name = src.map[k] ?? k;
    const i = col(name);
    if (i >= 0) out[k] = row[i] ?? '';
  }
  return out;
}

/** Read a data source (the browser's fetch; the desktop and Lumora pass their own). */
export async function readSource(
  src: DataSource,
  get: (url: string) => Promise<string> = (u) =>
    fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`The address answered ${r.status}`)))),
): Promise<Table> {
  const url = src.kind === 'sheet' ? sheetCsvUrl(src.url) : src.url;
  return parseTable(await get(url), src.kind === 'sheet' ? 'csv' : src.kind);
}
