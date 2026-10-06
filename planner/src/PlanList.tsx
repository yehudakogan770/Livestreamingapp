import { useEffect, useState, type FormEvent } from 'react';
import { createPlan, listPlans } from './api';
import { isoDate, shortDate, showClock, type PlanSummary } from './model';
import { db } from './session';

const ROLE_NAME = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' } as const;

function ago(ms: number): string {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The plans you own or that were shared with you. */
export function PlanList({ userId, onOpen }: { userId: string; onOpen: (id: string) => void }) {
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    setError('');
    listPlans(db())
      .then(setPlans)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(refresh, []);

  const make = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    createPlan(db(), name || 'Untitled plan', userId)
      .then((p) => onOpen(p.id))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const today = isoDate(new Date());
  const upcoming = (plans ?? []).filter((p) => !p.eventDate || p.eventDate >= today);
  const past = (plans ?? []).filter((p) => p.eventDate && p.eventDate < today);

  const table = (list: PlanSummary[]) => (
    <table className="plans">
      <thead>
        <tr>
          <th>Event</th>
          <th>Date</th>
          <th>Starts</th>
          <th>Venue</th>
          <th className="num">Cues</th>
          <th>Access</th>
          <th>Last change</th>
        </tr>
      </thead>
      <tbody>
        {list.map((p) => (
          <tr key={p.id} onClick={() => onOpen(p.id)}>
            <td>
              <a
                href={`#/plan/${p.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                {p.name}
              </a>
            </td>
            <td className="nowrap">{shortDate(p.eventDate) || '—'}</td>
            <td className="nowrap">{showClock(p.startTime) || '—'}</td>
            <td>{p.venue || '—'}</td>
            <td className="num">{p.cueCount}</td>
            <td className="nowrap">{p.role === 'owner' ? 'Owner' : `${ROLE_NAME[p.role]} · ${p.ownerName}’s`}</td>
            <td className="nowrap muted">
              {ago(p.updatedAt)}
              {p.updatedBy && ` · ${p.updatedBy}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <main className="page">
      <div className="page__head">
        <h1>Plans</h1>
        <form className="row" onSubmit={make}>
          <input
            className="input"
            placeholder="New event name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            aria-label="New event name"
          />
          <button type="submit" className="btn btn--primary" disabled={busy}>
            New plan
          </button>
        </form>
      </div>
      {error && (
        <p className="warn">
          {error}{' '}
          <button type="button" className="btn btn--quiet" onClick={refresh}>
            Try again
          </button>
        </p>
      )}
      {plans === null && !error && <p className="muted">Loading plans…</p>}
      {plans?.length === 0 && (
        <div className="empty">
          <p>No plans yet.</p>
          <p className="muted">
            A plan is one event: its date, venue and start time, and the cues in order — who does what, for how long, and which input, title and transition
            Lumora uses. Share it with your team to plan together; in Lumora, Run of show → Load from Planner… turns it into cues.
          </p>
        </div>
      )}
      {upcoming.length > 0 && table(upcoming)}
      {past.length > 0 && (
        <>
          <h2 className="page__sub">Past events</h2>
          {table(past)}
        </>
      )}
    </main>
  );
}
