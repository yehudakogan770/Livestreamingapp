import { useEffect, useState, type FormEvent } from 'react';
import { invite, people, removePerson, setRole, type Person } from './api';
import type { Plan, Role } from './model';
import { db } from './session';

/** Who is on the plan; the owner adds people by email as editors or viewers. */
export function ShareDialog({ plan, role, me, onClose, onChanged }: { plan: Plan; role: Role | null; me: string; onClose: () => void; onChanged: () => void }) {
  const [list, setList] = useState<Person[] | null>(null);
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<'editor' | 'viewer'>('editor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const owner = role === 'owner';

  const refresh = () =>
    people(db(), plan.id)
      .then(setList)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    void refresh();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [plan.id]);

  const run = (p: Promise<void>) => {
    setBusy(true);
    setError('');
    p.then(() => refresh())
      .then(onChanged)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    run(invite(db(), plan.id, email, newRole).then(() => setEmail('')));
  };

  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-label="Share plan" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog__box">
        <header className="dialog__head">
          <h2>Share “{plan.name}”</h2>
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="dialog__body">
          {owner ? (
            <form className="row" onSubmit={add}>
              <input
                className="input grow"
                type="email"
                placeholder="Teammate’s email (their Lumora account)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Email"
              />
              <select className="input" value={newRole} onChange={(e) => setNewRole(e.target.value as 'editor' | 'viewer')} aria-label="Role">
                <option value="editor">Can edit</option>
                <option value="viewer">Can view</option>
              </select>
              <button type="submit" className="btn btn--primary" disabled={busy || !email.trim()}>
                Share
              </button>
            </form>
          ) : (
            <p className="muted small">Only the owner of the plan can share it with more people.</p>
          )}
          {error && <p className="warn">{error}</p>}
          <table className="people">
            <tbody>
              {list === null && (
                <tr>
                  <td className="muted">Loading…</td>
                </tr>
              )}
              {list?.map((p) => (
                <tr key={p.userId}>
                  <td>
                    <b>{p.name || p.email}</b>
                    {p.userId === me && <span className="muted"> (you)</span>}
                    <div className="muted small">{p.email}</div>
                  </td>
                  <td className="nowrap">
                    {p.role === 'owner' ? (
                      'Owner'
                    ) : owner ? (
                      <select
                        className="input"
                        value={p.role}
                        disabled={busy}
                        onChange={(e) => run(setRole(db(), plan.id, p.userId, e.target.value as 'editor' | 'viewer'))}
                        aria-label={`Role for ${p.email}`}
                      >
                        <option value="editor">Can edit</option>
                        <option value="viewer">Can view</option>
                      </select>
                    ) : p.role === 'editor' ? (
                      'Can edit'
                    ) : (
                      'Can view'
                    )}
                  </td>
                  <td className="nowrap">
                    {p.role !== 'owner' && (owner || p.userId === me) && (
                      <button type="button" className="link" disabled={busy} onClick={() => run(removePerson(db(), plan.id, p.userId))}>
                        {p.userId === me ? 'Leave' : 'Remove'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            Editors change the plan and its cues; viewers read, print and comment. Everyone on the plan can load it into Lumora. Teammates need an approved
            Lumora account.
          </p>
        </div>
      </div>
    </div>
  );
}
