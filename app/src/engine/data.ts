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

/** The data comes from a web address (a Google Sheet or a CSV link), not a file. */
export const isDataUrl = (path: string): boolean => /^https?:\/\//i.test(path.trim());

/** Read a web address no more often than this (Google refreshes published sheets every few minutes anyway). */
export const MIN_URL_EVERY_MS = 5000;

/**
 * The CSV address for a Google Sheet link, or the link itself for any other
 * web address. A sheet's own link (…/edit#gid=…) becomes its CSV export (it
 * must be shared with “Anyone with the link”); a link from File → Share →
 * Publish to web (…/pub?…output=csv) is used as it is. `null`: not a web address.
 */
export function sheetCsvUrl(link: string): string | null {
  const t = link.trim();
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.hostname !== 'docs.google.com' || !u.pathname.startsWith('/spreadsheets/')) return t;
  // Published to the web: ask for CSV if it said otherwise (output=html).
  if (/\/pub(html)?$/.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\/pubhtml$/, '/pub');
    u.searchParams.set('output', 'csv');
    return u.toString();
  }
  const id = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(u.pathname)?.[1];
  if (!id || id === 'e') return t;
  const gid = /gid=(\d+)/.exec(u.hash)?.[1] ?? u.searchParams.get('gid');
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}
