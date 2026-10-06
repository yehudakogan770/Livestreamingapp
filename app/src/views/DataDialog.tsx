import { Sheet, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Show } from '../engine/types/Show';
import type { ScoreLink } from '../engine/types/ScoreLink';
import { parseData } from '../engine/data';
import './StingerDialog.css';
import './DataDialog.css';
import './LyricsCard.css';
import './AudienceCards.css';

/** Reads the data file again and again (in the control window) and tells the engine when it changes. */
export function DataWatcher({ show, client }: { show: Show; client: EngineClient }) {
  const { path, everyMs } = show.data;
  const last = useRef<string | null>(null);
  useEffect(() => {
    last.current = null;
    if (!path) return;
    let stopped = false;
    const read = async () => {
      let next: { headers: string[]; rows: string[][]; error: string };
      let key: string;
      try {
        const text = await client.readDataFile(path);
        key = text;
        next = { ...parseData(text, path), error: '' };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        key = `error:${error}`;
        next = { headers: show.data.headers, rows: show.data.rows, error };
      }
      if (stopped || key === last.current) return;
      last.current = key;
      await client.dispatch({ type: 'dataRows', ...next }).catch(() => {});
    };
    void read();
    const id = setInterval(() => void read(), Math.max(250, everyMs));
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [client, path, everyMs]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

const LINKS: [keyof ScoreLink, string][] = [
  ['homeName', 'Home name'],
  ['homeScore', 'Home score'],
  ['awayName', 'Away name'],
  ['awayScore', 'Away score'],
  ['period', 'Period'],
];

/** Choose the data file, see what it holds, pick the row, link scoreboards. */
export function DataDialog({ show, client, onClose }: { show: Show; client: EngineClient; onClose: () => void }) {
  const d = show.data;
  const [copied, setCopied] = useState('');
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const act = (a: Parameters<EngineClient['dispatch']>[0]) => void client.dispatch(a).catch(() => {});
  const choose = async () => {
    const path = await client.pickDataFile();
    if (path) act({ type: 'setDataFile', path, everyMs: d.everyMs });
  };
  const copy = (h: string) => {
    void navigator.clipboard?.writeText(`{${h}}`).catch(() => {});
    setCopied(h);
  };
  const boards = show.sources.filter((s) => s.kind.type === 'scoreboard');
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Data file" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box stg dat">
        <header className="modal__head">
          <h2>
            <Sheet className="modal__icon" aria-hidden="true" />
            Data file
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="stg__body">
          <p className="field__note">
            Keep scores, names or anything else in a spreadsheet saved as CSV (or a JSON file). Lumora reads it again by itself, so what you change there shows
            on screen in a moment. The first row names the columns.
          </p>
          <div className="lyc__row dat__file">
            <b className="dat__path" title={d.path}>
              {d.path || 'No file chosen'}
            </b>
            <button type="button" className="btn btn--primary" onClick={() => void choose()}>
              {d.path ? 'Choose another…' : 'Choose a file…'}
            </button>
            {d.path && (
              <button type="button" className="btn" onClick={() => act({ type: 'setDataFile', path: '', everyMs: d.everyMs })}>
                Stop using it
              </button>
            )}
            <label className="field dat__every">
              <span className="field__label">Read every</span>
              <select className="text" value={d.everyMs} onChange={(e) => act({ type: 'setDataFile', path: d.path, everyMs: Number(e.target.value) })}>
                {[500, 1000, 2000, 5000, 10_000].map((ms) => (
                  <option key={ms} value={ms}>
                    {ms / 1000} s
                  </option>
                ))}
              </select>
            </label>
          </div>
          {d.error && <p className="field__note field__note--warn">Could not read it: {d.error}</p>}
          {d.path && !d.error && d.updatedAt > 0 && (
            <p className="field__note">
              {d.rows.length} rows · {d.headers.length} columns · changed {new Date(d.updatedAt).toLocaleTimeString()}
            </p>
          )}
          {d.headers.length > 0 && (
            <>
              <div className="dat__chips">
                <span className="field__label">In a title, type</span>
                {d.headers.map((h) => (
                  <button key={h} type="button" className="btn btn--small" title="Copy" onClick={() => copy(h)}>
                    {`{${h}}`}
                  </button>
                ))}
                {copied && <span className="field__note">Copied {`{${copied}}`} — paste it into a title.</span>}
              </div>
              <div className="lyc__bar">
                <button type="button" className="btn" disabled={d.row <= 0} onClick={() => act({ type: 'dataStep', delta: -1 })}>
                  ◀ Previous row
                </button>
                <button type="button" className="btn btn--primary" disabled={d.row >= d.rows.length - 1} onClick={() => act({ type: 'dataStep', delta: 1 })}>
                  Next row ▶
                </button>
                <span className="field__note">Titles show row {d.row + 1}. Click a row to use it.</span>
              </div>
              <div className="dat__table">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      {d.headers.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.slice(0, 300).map((r, i) => (
                      <tr key={i} className={i === d.row ? 'is-on' : ''} onClick={() => act({ type: 'dataRow', row: i })}>
                        <td>{i + 1}</td>
                        {d.headers.map((_, c) => (
                          <td key={c} dir="auto">
                            {r[c] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {boards.map((b) => {
                if (b.kind.type !== 'scoreboard') return null;
                const sb = b.kind;
                const set = (k: keyof ScoreLink, v: string) => act({ type: 'updateScoreboard', id: b.id, scoreboard: { ...sb, link: { ...sb.link, [k]: v } } });
                return (
                  <fieldset key={b.id} className="auc-card__form">
                    <legend>Scoreboard “{b.name}” follows these columns</legend>
                    <div className="lyc__row">
                      {LINKS.map(([k, label]) => (
                        <label key={k} className="field">
                          <span className="field__label">{label}</span>
                          <select className="text" value={sb.link[k]} onChange={(e) => set(k, e.target.value)}>
                            <option value="">— not linked —</option>
                            {d.headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
