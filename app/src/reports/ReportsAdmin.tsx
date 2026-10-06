// People and approvals → Problems reported (the Lumora team only; the server
// lets nobody else read reports, see supabase/update-3-reports.sql).

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../auth/auth';
import { groupReports, versionsText, type ReportGroup, type StoredReport } from './group';
import './reports.css';

const COLUMNS = 'id, created_at, kind, app, version, os, message, stack, logs, description, fingerprint, has_screenshot, resolved';

async function listReports(): Promise<StoredReport[]> {
  const { data, error } = await supabase().from('problem_reports').select(COLUMNS).order('created_at', { ascending: false }).limit(1000);
  if (error)
    throw new Error(/problem_reports/.test(error.message) ? 'Problem reports are not switched on yet: run supabase/update-3-reports.sql.' : error.message);
  return data as StoredReport[];
}

async function setResolved(ids: string[], resolved: boolean): Promise<void> {
  const { error } = await supabase().from('problem_reports').update({ resolved }).in('id', ids);
  if (error) throw new Error(error.message);
}

async function screenshotOf(id: string): Promise<string | null> {
  const { data, error } = await supabase().from('problem_reports').select('screenshot').eq('id', id).single<{ screenshot: string | null }>();
  if (error) throw new Error(error.message);
  return data.screenshot;
}

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const KIND = { error: 'Error', crash: 'Crash', report: 'Reported by a person' } as const;
const APP = { lumora: 'Lumora', studio: 'Lumora Studio' } as const;

/** The list, grouped by problem, newest first; each group can be marked resolved. */
export function ReportsAdmin() {
  const [reports, setReports] = useState<StoredReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => {
    listReports()
      .then((r) => {
        setReports(r);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);
  const mark = (g: ReportGroup, resolved: boolean) =>
    void setResolved(
      g.items.map((r) => r.id),
      resolved,
    )
      .then(load)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  const groups = groupReports(reports ?? [], showResolved);
  return (
    <>
      <label className="rp__check">
        <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
        Show resolved problems too
      </label>
      {error && <p className="field__note">{error}</p>}
      {reports === null && !error && <p className="people__empty">Loading…</p>}
      {reports !== null && groups.length === 0 && <p className="people__empty">No problems reported.</p>}
      {groups.map((g) => (
        <div key={g.key} className="rpa__group">
          <div className="rpa__head">
            <span className={`rpa__count${g.resolved ? ' rpa__count--done' : ''}`} title={`${g.count} report${g.count === 1 ? '' : 's'}`}>
              {g.count}×
            </span>
            <button type="button" className="rpa__msg linkish" aria-expanded={open === g.key} onClick={() => setOpen(open === g.key ? null : g.key)}>
              <b>{g.message || '(no message)'}</b>
              <span>
                {APP[g.app] ?? g.app} · {KIND[g.kind] ?? g.kind} · {versionsText(g.versions)} · last {when(g.last)}
                {g.count > 1 ? ` · first ${when(g.first)}` : ''}
              </span>
            </button>
            <button type="button" className="btn" onClick={() => mark(g, !g.resolved)}>
              {g.resolved ? 'Open again' : 'Mark resolved'}
            </button>
          </div>
          {open === g.key && g.items.slice(0, 10).map((r) => <ReportItem key={r.id} r={r} />)}
        </div>
      ))}
    </>
  );
}

function ReportItem({ r }: { r: StoredReport }) {
  const [shot, setShot] = useState<string | null | 'loading'>(null);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="rpa__item">
      <span className="field__note">
        {when(r.created_at)} · version {r.version} · {r.os}
        {r.resolved ? ' · resolved' : ''}
      </span>
      {r.description && <p className="rpa__desc">{r.description}</p>}
      {r.stack && <pre className="rpa__pre">{r.stack}</pre>}
      {r.logs && (
        <details>
          <summary>Last log lines</summary>
          <pre className="rpa__pre">{r.logs}</pre>
        </details>
      )}
      {r.has_screenshot &&
        (shot && shot !== 'loading' ? (
          <img src={shot} alt="What the person saw" />
        ) : (
          <button
            type="button"
            className="btn"
            disabled={shot === 'loading'}
            onClick={() => {
              setShot('loading');
              void screenshotOf(r.id).then(setShot, (e: unknown) => {
                setShot(null);
                setProblem(e instanceof Error ? e.message : String(e));
              });
            }}
          >
            {shot === 'loading' ? 'Loading the picture…' : 'Show the picture'}
          </button>
        ))}
      {problem && <p className="field__note">{problem}</p>}
    </div>
  );
}
