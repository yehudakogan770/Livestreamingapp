// A Titler graphic's own data sources on air: the CSV file, Google Sheet or
// JSON address its template names is read by the control window (again every
// few seconds, as the designer set), what it holds goes to the engine with
// the graphic (so every window draws the same), and the row shown is the
// operator's choice (the card's row buttons, Shift+[ / Shift+]).
//
// Which value a field shows, last wins: its sample, the title's own data
// (the row chosen), what the operator typed, and Lumora's own bindings
// (scoreboard, countdown, clock, the event's data file).

import { useEffect, useRef } from 'react';
import { readSource, valuesFromRow } from '../../../titler/src/core/data';
import type { DataSource, TitleProject, Values } from '../../../titler/src/core/types';
import type { EngineClient } from '../engine/client';
import { MIN_URL_EVERY_MS } from '../engine/data';
import type { Show } from '../engine/types/Show';
import type { TitlerGraphic } from '../engine/types/TitlerGraphic';
import type { TitlerTable } from '../engine/types/TitlerTable';
import { projectOf } from './titlerSource';

/** The last row of the longest table (0 with none). */
export function titlerLastRow(k: Pick<TitlerGraphic, 'data'>): number {
  return Math.max(0, ...k.data.map((t) => t.rows.length - 1));
}

/** The row after stepping `delta` from the chosen one (or the first); null when there are no rows. */
export function titlerStepRow(k: Pick<TitlerGraphic, 'data' | 'dataRow'>, delta: number): number | null {
  if (!k.data.some((t) => t.rows.length)) return k.dataRow;
  const now = k.dataRow ?? 0;
  return Math.max(0, Math.min(titlerLastRow(k), now + Math.sign(delta) * Math.max(1, Math.abs(Math.trunc(delta)))));
}

/** The row each source shows: the operator's choice, else its own. */
export const rowOf = (src: DataSource, k: Pick<TitlerGraphic, 'dataRow'>) => k.dataRow ?? src.row;

/** The fields the title's own data fills now (the row chosen of each source). */
export function dataValuesOf(p: TitleProject, k: Pick<TitlerGraphic, 'data' | 'dataRow'>): Values {
  const out: Values = {};
  const keys = p.variables.map((v) => v.key);
  for (const src of p.data ?? []) {
    const t = k.data.find((x) => x.source === src.id);
    if (!t || !t.rows.length) continue;
    Object.assign(out, valuesFromRow({ ...src, row: rowOf(src, k) }, t, keys));
  }
  return out;
}

/** A short name for a row (its first cell, or "Row 3"). */
export function rowLabel(k: Pick<TitlerGraphic, 'data'>, row: number): string {
  for (const t of k.data) {
    const r = t.rows[row];
    const first = r?.find((c) => c.trim());
    if (first) return `${row + 1}. ${first.slice(0, 40)}`;
  }
  return `Row ${row + 1}`;
}

/** Sources worth reading: with an address. */
const readable = (p: TitleProject | null) => (p?.data ?? []).filter((d) => d.url.trim());

/**
 * Read every Titler graphic's own data sources and send what they hold.
 * `read` gets a file or web address as text (the app's reader: no CORS limits).
 */
export class TitlerDataReader {
  private next = new Map<string, number>();
  private busy = new Set<string>();
  private tables = new Map<string, TitlerTable>();
  /** What was last sent for each graphic. */
  private sent = new Map<string, string>();

  constructor(
    private readonly send: (id: string, data: TitlerTable[]) => Promise<unknown>,
    private readonly read: (url: string) => Promise<string>,
  ) {}

  /** Call often (every second): reads what is due. */
  tick(show: Show, now: number): Promise<void>[] {
    const work: Promise<void>[] = [];
    for (const s of show.sources) {
      if (s.kind.type !== 'titler') continue;
      const k = s.kind;
      const p = projectOf(k);
      for (const d of readable(p)) {
        const key = `${s.id}|${d.id}|${d.kind}|${d.url}`;
        if (this.busy.has(key) || (this.next.get(key) ?? 0) > now) continue;
        // Read once (refresh 0), or every `refresh` seconds (web addresses no more often than every few seconds).
        const every = d.refresh > 0 ? Math.max(/^https?:/i.test(d.url) ? MIN_URL_EVERY_MS : 1000, d.refresh * 1000) : Infinity;
        this.next.set(key, now + every);
        this.busy.add(key);
        work.push(
          readSource(d, this.read)
            .then(
              (t) => ({ source: d.id, headers: t.headers, rows: t.rows, error: '' }),
              (e: unknown) => ({ ...(this.tables.get(key) ?? { headers: [], rows: [] }), source: d.id, error: e instanceof Error ? e.message : String(e) }),
            )
            .then((t) => {
              this.tables.set(key, t);
              return this.push(s.id, p!, k);
            })
            .finally(() => this.busy.delete(key)),
        );
      }
    }
    return work;
  }

  private async push(id: string, p: TitleProject, k: TitlerGraphic) {
    const data = readable(p)
      .map((d) => this.tables.get(`${id}|${d.id}|${d.kind}|${d.url}`))
      .filter((t): t is TitlerTable => !!t);
    const text = JSON.stringify(data);
    if (text === this.sent.get(id) || text === JSON.stringify(k.data)) return;
    this.sent.set(id, text);
    await this.send(id, data).catch(() => this.sent.delete(id));
  }
}

/** In the control window: keeps every Titler graphic's own data up to date. */
export function TitlerDataWatcher({ show, client }: { show: Show; client: EngineClient }) {
  const showRef = useRef(show);
  showRef.current = show;
  useEffect(() => {
    const reader = new TitlerDataReader(
      (id, data) => client.dispatch({ type: 'setTitlerData', id, data }),
      (url) => client.readDataFile(url),
    );
    const go = () => void reader.tick(showRef.current, Date.now());
    go();
    const timer = setInterval(go, 1000);
    return () => clearInterval(timer);
  }, [client]);
  return null;
}
