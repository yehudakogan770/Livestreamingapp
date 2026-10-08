import { Lock, LockOpen, UserMinus, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { operatorsApi, type OperatorsApi, type PendingSeat, type SeatInfo, type SeatsStatus } from './api';
import { GROUPS, ROLES, makeRole, roleGroups, type Group, type Role, type RoleKind } from './roles';
import './seats.css';

/** Choose a seat's role (Custom: tick the groups). */
export function RolePicker({ value, onChange, disabled, label }: { value: Role; onChange: (r: Role) => void; disabled?: boolean; label: string }) {
  const groups = value.kind === 'custom' ? value.groups : roleGroups(value);
  const hint = ROLES.find((r) => r.kind === value.kind)?.hint;
  return (
    <div className="seats__role">
      <select aria-label={label} value={value.kind} disabled={disabled} onChange={(e) => onChange(makeRole(e.target.value as RoleKind, groups))} title={hint}>
        {ROLES.map((r) => (
          <option key={r.kind} value={r.kind}>
            {r.name}
          </option>
        ))}
      </select>
      {value.kind === 'custom' && (
        <fieldset className="seats__groups" disabled={disabled}>
          <legend>This seat may:</legend>
          {GROUPS.map((g) => (
            <label key={g.id} className="check" title={g.hint}>
              <input
                type="checkbox"
                checked={value.groups.includes(g.id)}
                onChange={(e) => {
                  const next: Group[] = e.target.checked ? [...value.groups, g.id] : value.groups.filter((x) => x !== g.id);
                  onChange({ kind: 'custom', groups: next });
                }}
              />{' '}
              {g.name}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}

function since(ms: number | null): string {
  if (!ms) return '';
  const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return min < 1 ? 'just now' : min === 1 ? '1 minute' : `${min} minutes`;
}

function Request({ p, busy, run, api }: { p: PendingSeat; busy: boolean; run: (p: Promise<SeatsStatus>) => void; api: OperatorsApi }) {
  const [role, setRole] = useState<Role>({ kind: 'graphics' });
  return (
    <div className="seats__request" data-testid="seat-request">
      <div className="seats__who">
        <strong>{p.name}</strong> <span className="seats__dim">({p.address}) wants to join this show</span>
      </div>
      <div className="seats__code">
        <span className="seats__dim">Code for that computer:</span>
        <span className="seats__digits" data-testid="seat-code">
          {p.code.slice(0, 3)} {p.code.slice(3)}
        </span>
        <span className={`seats__typed${p.codeTyped ? ' is-on' : ''}`}>{p.codeTyped ? 'Typed correctly' : 'Waiting for them to type it'}</span>
      </div>
      <div className="seats__row">
        <span className="seats__dim">Seat:</span>
        <RolePicker value={role} onChange={setRole} disabled={busy || p.approved} label={`Seat for ${p.name}`} />
        <span className="seats__spacer" />
        {p.approved ? (
          <span className="seats__dim">Let in — joins as soon as the code is typed</span>
        ) : (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => run(api.deny(p.id))}>
              Say no
            </button>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(api.approve(p.id, role))}>
              Let in
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SeatRow({ s, busy, run, api }: { s: SeatInfo; busy: boolean; run: (p: Promise<SeatsStatus>) => void; api: OperatorsApi }) {
  return (
    <tr data-testid="seat-row">
      <td>
        <span className={`remote__dot${s.connected ? ' remote__dot--on' : ''}`} />
      </td>
      <td>
        <div className="seats__name">{s.name}</div>
        <div className="seats__dim">
          {s.connected ? `${s.address ?? ''} · connected ${since(s.since)}` : 'Not connected now'}
          {s.locked && ' · locked'}
        </div>
      </td>
      <td>
        <RolePicker value={s.role} onChange={(r) => run(api.setRole(s.id, r))} disabled={busy} label={`Role of ${s.name}`} />
      </td>
      <td className="seats__latency" title="Round trip between the two computers">
        {s.connected && s.latencyMs !== null ? `${s.latencyMs} ms` : '—'}
      </td>
      <td className="seats__actions">
        <button
          type="button"
          className={`btn${s.locked ? ' is-on' : ''}`}
          aria-pressed={s.locked}
          disabled={busy}
          title={s.locked ? 'Let this seat change things again' : 'This seat keeps watching but can’t change anything'}
          onClick={() => run(api.setLocked(s.id, !s.locked))}
        >
          {s.locked ? <LockOpen aria-hidden="true" /> : <Lock aria-hidden="true" />}
          {s.locked ? 'Unlock' : 'Lock'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          title="Disconnect this computer. To come back it has to join again with a new code."
          onClick={() => run(api.remove(s.id))}
        >
          <UserMinus aria-hidden="true" />
          Remove
        </button>
      </td>
    </tr>
  );
}

/**
 * Settings → Operators…: other computers on this network run parts of this
 * show (Graphics, Audio, Replay, Cameras…). This computer stays in charge:
 * it checks every request against the seat's role, and nothing that happens
 * to a seat affects the show.
 */
export function OperatorsDialog({ onClose, api = operatorsApi }: { onClose: () => void; api?: OperatorsApi }) {
  const [status, setStatus] = useState<SeatsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api.status().then(
      (s) => live && setStatus(s),
      (e: unknown) => live && setProblem(String(e)),
    );
    const stop = api.watch((s) => setStatus(s));
    return () => {
      live = false;
      stop();
    };
  }, [api]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const run = (p: Promise<SeatsStatus>) => {
    setBusy(true);
    setProblem(null);
    void p
      .then(setStatus)
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const st = status;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Operators" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box remote seats">
        <header className="modal__head">
          <h2>
            <Users className="modal__icon" aria-hidden="true" />
            Operators
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="remote__body">
          <p className="remote__intro">
            More people can run this show from other computers with Lumora on this network: one on graphics, one on the mixer, one on replay. On their computer:
            Settings → Join a show on this network…. You choose what each seat can do, and this computer stays in charge — if a seat drops, nothing happens to
            the show.
          </p>
          {!st ? (
            <p className="field__note">Loading…</p>
          ) : (
            <>
              <label className="check seats__enable">
                <input type="checkbox" checked={st.enabled} disabled={busy} onChange={(e) => run(api.setEnabled(e.target.checked))} /> Let other computers join
                this show
              </label>
              {st.enabled && st.error && (
                <p className="field__note field__note--warn" role="alert">
                  {st.error}
                </p>
              )}
              {st.running && (
                <p className="field__note">
                  They find “{st.show}” by itself. If they can’t, they type this computer’s address:{' '}
                  {st.addresses.length ? (
                    st.addresses.map((a, i) => (
                      <span key={a}>
                        {i > 0 && ' or '}
                        <code className="seats__addr">{a.replace(/:8097$/, '')}</code>
                      </span>
                    ))
                  ) : (
                    <em>this computer isn’t on a network</em>
                  )}
                </p>
              )}

              {st.pending.length > 0 && (
                <section className="seats__section" aria-label="Waiting to join">
                  <h3>Waiting to join</h3>
                  {st.pending.map((p) => (
                    <Request key={p.id} p={p} busy={busy} run={run} api={api} />
                  ))}
                </section>
              )}

              <section className="seats__section" aria-label="Seats">
                <h3>Seats</h3>
                {st.seats.length === 0 ? (
                  <p className="field__note">No other computers yet.</p>
                ) : (
                  <table className="seats__table">
                    <thead>
                      <tr>
                        <th aria-label="Connected" />
                        <th>Computer</th>
                        <th>Seat</th>
                        <th>Delay</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {st.seats.map((s) => (
                        <SeatRow key={s.id} s={s} busy={busy} run={run} api={api} />
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
          {problem && (
            <p className="field__note field__note--warn" role="alert">
              {problem}
            </p>
          )}
        </div>
        <footer className="modal__foot">
          <span className="remote__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * On the show computer, always: a small note when another computer asks to
 * join while the Operators window is closed.
 */
export function JoinRequestNote({ onOpen, api = operatorsApi }: { onOpen: () => void; api?: OperatorsApi }) {
  const [waiting, setWaiting] = useState<PendingSeat[]>([]);
  useEffect(() => api.watch((s) => setWaiting(s.pending.filter((p) => !p.approved))), [api]);
  if (!waiting.length) return null;
  const first = waiting[0]!;
  return (
    <div className="seats__note" role="status">
      <Users aria-hidden="true" />
      <span>
        <strong>{first.name}</strong> wants to join this show{waiting.length > 1 ? ` (and ${waiting.length - 1} more)` : ''}.
      </span>
      <button type="button" className="btn btn--primary" onClick={onOpen}>
        Operators…
      </button>
    </div>
  );
}
