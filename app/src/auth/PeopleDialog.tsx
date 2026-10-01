import { useCallback, useEffect, useState } from 'react';
import type { Profile } from './access';
import { listPeople, setPerson } from './auth';

type Filter = 'waiting' | 'approved' | 'blocked' | 'all';
const stateOf = (p: Profile) => (p.blocked ? 'blocked' : p.approved ? 'approved' : 'pending');

/** For the Lumora team: approve new accounts, or turn access off. */
export function PeopleDialog({ onClose }: { onClose: () => void }) {
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('waiting');
  const load = useCallback(() => {
    listPeople()
      .then((p) => {
        setPeople(p);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', esc);
    };
  }, [load, onClose]);
  const change = (p: Profile, c: Partial<Pick<Profile, 'approved' | 'blocked'>>) =>
    void setPerson(p.id, c)
      .then(load)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  const waiting = people?.filter((p) => stateOf(p) === 'pending').length ?? 0;
  const shown = (people ?? []).filter((p) => filter === 'all' || (filter === 'waiting' ? stateOf(p) === 'pending' : stateOf(p) === filter));
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="People and approvals" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box people">
        <header className="modal__head">
          <h2>People and approvals</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="people__tabs" role="tablist">
          {(['waiting', 'approved', 'blocked', 'all'] as const).map((f) => (
            <button key={f} type="button" className="seg" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'waiting' ? `Waiting (${waiting})` : f === 'approved' ? 'Approved' : f === 'blocked' ? 'Blocked' : 'Everyone'}
            </button>
          ))}
        </div>
        <div className="people__body">
          {error && <p className="field__note">{error}</p>}
          {people === null && !error && <p className="people__empty">Loading…</p>}
          {people !== null && shown.length === 0 && (
            <p className="people__empty">{filter === 'waiting' ? 'Nobody is waiting for approval.' : 'Nobody here.'}</p>
          )}
          {shown.map((p) => {
            const st = stateOf(p);
            return (
              <div key={p.id} className="people__row">
                <div className="people__who">
                  <b>
                    {p.name || '(no name)'}
                    {p.is_admin ? ' · Lumora team' : ''}
                  </b>
                  <span>
                    {p.email}
                    {p.created_at ? ` · joined ${new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                  </span>
                </div>
                <span className={`people__tag people__tag--${st}`}>{st === 'pending' ? 'Waiting' : st === 'approved' ? 'Approved' : 'Blocked'}</span>
                <div className="people__acts">
                  {st === 'pending' && (
                    <button type="button" className="btn btn--primary" onClick={() => change(p, { approved: true })}>
                      Approve
                    </button>
                  )}
                  {st !== 'blocked' && !p.is_admin && (
                    <button type="button" className="btn" onClick={() => change(p, { blocked: true })}>
                      {st === 'pending' ? 'Decline' : 'Block'}
                    </button>
                  )}
                  {st === 'blocked' && (
                    <button type="button" className="btn" onClick={() => change(p, { blocked: false, approved: true })}>
                      Unblock
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
