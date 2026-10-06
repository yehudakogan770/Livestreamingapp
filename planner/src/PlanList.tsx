import { useState, type FormEvent } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { Mark } from './Mark';
import { isoDate, shortDate, showClock, type PlanSummary } from './model';

const ROLE_NAME = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' } as const;

function ago(ms: number): string {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** A page's title, with the List / Calendar switch on the plans pages (and the mark on phones). */
export function PageHead({
  title,
  sub,
  mode,
  phone = false,
  children,
}: {
  title: string;
  sub?: string;
  mode?: 'list' | 'calendar';
  phone?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="page__head">
      <div className="page__title">
        {phone && <Mark size={22} className="page__mark" />}
        <div>
          <h1>{title}</h1>
          {sub && <p className="muted">{sub}</p>}
        </div>
      </div>
      <div className="page__acts">
        {mode && (
          <div className="seg" role="group" aria-label="Show plans as">
            <a className={`seg__btn${mode === 'list' ? ' is-on' : ''}`} href="#/" aria-current={mode === 'list' ? 'page' : undefined}>
              List
            </a>
            <a className={`seg__btn${mode === 'calendar' ? ' is-on' : ''}`} href="#/calendar" aria-current={mode === 'calendar' ? 'page' : undefined}>
              Calendar
            </a>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** The plans you own or that were shared with you (making new ones needs Lumora access: `canPlan`). */
export function PlanList({
  plans,
  error,
  onRefresh,
  email,
  canPlan,
  onOpen,
  onCreate,
  phone = false,
}: {
  plans: PlanSummary[] | null;
  error: string;
  onRefresh: () => void;
  email: string;
  canPlan: boolean;
  onOpen: (id: string) => void;
  onCreate: (name: string, date: string) => Promise<void>;
  phone?: boolean;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [makeError, setMakeError] = useState('');

  const make = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMakeError('');
    onCreate(name || 'Untitled plan', '')
      .catch((err: unknown) => setMakeError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const today = isoDate(new Date());
  const upcoming = (plans ?? []).filter((p) => !p.eventDate || p.eventDate >= today);
  const past = (plans ?? []).filter((p) => p.eventDate && p.eventDate < today);

  const access = (p: PlanSummary) => (p.role === 'owner' ? 'Owner' : `${ROLE_NAME[p.role]} · ${p.ownerName}’s`);

  // Phones: one row per plan, the whole row a link.
  const cards = (list: PlanSummary[]) => (
    <ul className="plancards">
      {list.map((p) => (
        <li key={p.id}>
          <a className="plancard" href={`#/plan/${p.id}`}>
            <span className="plancard__date" aria-hidden="true">
              <span>{p.eventDate ? new Date(`${p.eventDate}T12:00`).toLocaleDateString('en-US', { month: 'short' }) : '—'}</span>
              <b>{p.eventDate ? Number(p.eventDate.slice(8)) : ''}</b>
            </span>
            <span className="plancard__main">
              <span className="plancard__name">{p.name}</span>
              <span className="plancard__when">{[shortDate(p.eventDate) || 'No date yet', showClock(p.startTime), p.venue].filter(Boolean).join(' · ')}</span>
              <span className="plancard__meta muted">
                {p.cueCount} cue{p.cueCount === 1 ? '' : 's'} · {access(p)}
                {p.updatedAt ? ` · ${ago(p.updatedAt)}` : ''}
              </span>
            </span>
            <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" className="plancard__go" />
          </a>
        </li>
      ))}
    </ul>
  );

  const table = (list: PlanSummary[]) =>
    phone ? (
      cards(list)
    ) : (
      <table className="plans">
        <thead>
          <tr>
            <th className="plans__event">Event</th>
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
              <td className="plans__event">
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
              <td className="muted">{p.venue || '—'}</td>
              <td className="num">{p.cueCount}</td>
              <td className="nowrap muted">{access(p)}</td>
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
      <PageHead
        title="Plans"
        sub={plans && plans.length > 0 ? `${plans.length} plan${plans.length === 1 ? '' : 's'} · ${upcoming.length} upcoming` : undefined}
        mode="list"
        phone={phone}
      />
      {canPlan && (
        <form className="row page__new" onSubmit={make}>
          <input
            className="input grow"
            placeholder="New event name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            aria-label="New event name"
          />
          <button type="submit" className="btn btn--primary" disabled={busy}>
            <Plus size={15} strokeWidth={2} aria-hidden="true" />
            New plan
          </button>
        </form>
      )}
      {(error || makeError) && (
        <p className="warn">
          {error || makeError}{' '}
          {error && (
            <button type="button" className="btn btn--quiet" onClick={onRefresh}>
              Try again
            </button>
          )}
        </p>
      )}
      {plans === null && !error && <p className="muted">Loading plans…</p>}
      {plans?.length === 0 && !canPlan && (
        <div className="empty empty--center">
          <Mark size={32} />
          <p>No plans shared with you yet.</p>
          <p className="muted">Ask the person planning the event to invite {email}.</p>
        </div>
      )}
      {plans?.length === 0 && canPlan && (
        <div className="empty empty--center">
          <Mark size={32} />
          <p>No plans yet.</p>
          <p className="muted">
            A plan is one event: its date, venue and start time, the cues in order (who does what, for how long, and which input, title and transition Lumora
            uses), the crew’s schedule and a chat for the team. In Lumora, Run of show → Load from Planner… turns it into cues.
          </p>
        </div>
      )}
      {upcoming.length > 0 && (
        <>
          {(phone || past.length > 0) && <h2 className="page__sub page__sub--first">Upcoming</h2>}
          {table(upcoming)}
        </>
      )}
      {past.length > 0 && (
        <>
          <h2 className="page__sub">Past events</h2>
          {table(past)}
        </>
      )}
    </main>
  );
}
