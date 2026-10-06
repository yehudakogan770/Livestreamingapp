import { Users, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Profile } from './access';
import { listPeople, resetTwoStep, setPerson, supabase, twoStepPeople, twoStepStatus, type PersonChange } from './auth';
import type { TwoStepState } from './mfa';
import { CodeForm, TwoStepSetup } from './TwoStep';
import { ReportsAdmin } from '../reports/ReportsAdmin';

type Filter = 'waiting' | 'approved' | 'blocked' | 'all' | 'problems';
const stateOf = (p: Profile) => (p.blocked ? 'blocked' : p.approved ? 'approved' : 'pending');
type App = 'lumora' | 'studio';
// Accounts from before apps could be chosen have both.
const has = (p: Profile, app: App) => p.is_admin || p[app] !== false;
const noApps = (p: Profile) => !has(p, 'lumora') && !has(p, 'studio');
// Made in the Planner to work on a plan: not asking for Lumora or Studio.
const plannerOnly = (p: Profile) => p.planner_only === true && stateOf(p) === 'pending';
const appsOf = (p: Profile) =>
  has(p, 'lumora') && has(p, 'studio') ? 'Lumora and Studio' : has(p, 'lumora') ? 'Lumora only' : has(p, 'studio') ? 'Studio only' : 'No apps';

/**
 * For the Lumora team: approve new accounts, choose which apps each one may
 * use, or turn access off. Only with two-step sign-in (the server insists):
 * the first time, it is set up here.
 */
export function PeopleDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<TwoStepState | null>(null);
  const [stepError, setStepError] = useState('');
  const checkStep = useCallback(() => {
    twoStepStatus()
      .then((st) => {
        setStep(st);
        setStepError('');
      })
      .catch((e: unknown) => setStepError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(checkStep, [checkStep]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="People and approvals" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box people">
        <header className="modal__head">
          <h2>
            <Users className="modal__icon" aria-hidden="true" />
            People and approvals
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        {step?.aal2 ? (
          <People />
        ) : (
          <div className="people__body people__twostep">
            {stepError && <p className="field__note">{stepError}</p>}
            {step === null && !stepError && <p className="people__empty">Checking your sign-in…</p>}
            {step && !step.on && (
              <>
                <p>
                  <b>First, turn on two-step sign-in.</b> Approving people and reading problem reports needs it: then a stolen password alone can’t change who
                  uses Lumora.
                </p>
                <TwoStepSetup db={supabase()} onDone={checkStep} />
              </>
            )}
            {step?.on && !step.aal2 && <CodeForm db={supabase()} onDone={checkStep} />}
          </div>
        )}
      </div>
    </div>
  );
}

function People() {
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [twoStep, setTwoStep] = useState<Set<string>>(new Set());
  const [resetting, setResetting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('waiting');
  const load = useCallback(() => {
    listPeople()
      .then((p) => {
        setPeople(p);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    twoStepPeople()
      .then(setTwoStep)
      .catch(() => {});
  }, []);
  const reset = (p: Profile) => {
    if (resetting !== p.id) {
      setResetting(p.id);
      return;
    }
    setResetting(null);
    setError(null);
    resetTwoStep(p.id)
      .then(load)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);
  const change = (p: Profile, c: PersonChange) => {
    // Shown at once; put back (with the reason) if it could not be saved.
    setPeople((list) => list?.map((x) => (x.id === p.id ? { ...x, ...c } : x)) ?? list);
    setError(null);
    void setPerson(p.id, c)
      .then(load)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        // Back to what is really saved (keeping the reason on screen).
        listPeople()
          .then(setPeople)
          .catch(() => {});
      });
  };
  const toggle = (p: Profile, app: App, on: boolean) => {
    const other: App = app === 'lumora' ? 'studio' : 'lumora';
    if (!on && stateOf(p) === 'approved' && !has(p, other)) {
      setError(`${p.name || p.email} needs at least one app. To stop them using both, block the account instead.`);
      return;
    }
    change(p, { [app]: on });
  };
  const waiting = people?.filter((p) => stateOf(p) === 'pending' && !plannerOnly(p)).length ?? 0;
  const shown = (people ?? []).filter((p) => filter === 'all' || (filter === 'waiting' ? stateOf(p) === 'pending' && !plannerOnly(p) : stateOf(p) === filter));
  // Planner teammates: kept apart, folded away (they did not ask for Lumora or Studio).
  const teammates = filter === 'waiting' ? (people ?? []).filter(plannerOnly) : [];
  const row = (p: Profile) => {
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
            {twoStep.has(p.id) ? ' · two-step sign-in' : ''}
          </span>
        </div>
        {p.is_admin || st === 'blocked' ? (
          <span className="people__apps people__apps--text">{p.is_admin ? 'Lumora and Studio' : appsOf(p)}</span>
        ) : (
          <div className="people__apps" role="group" aria-label={`Apps for ${p.name || p.email}`}>
            {(['lumora', 'studio'] as const).map((app) => (
              <label key={app} className="check">
                <input type="checkbox" checked={has(p, app)} onChange={(e) => toggle(p, app, e.target.checked)} />
                {app === 'lumora' ? 'Lumora' : 'Studio'}
              </label>
            ))}
          </div>
        )}
        <span className={`people__tag people__tag--${st}`}>{st === 'pending' ? 'Waiting' : st === 'approved' ? 'Approved' : 'Blocked'}</span>
        <div className="people__acts">
          {st === 'pending' && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={noApps(p)}
              title={noApps(p) ? 'Tick Lumora and/or Studio first' : undefined}
              onClick={() => change(p, { approved: true })}
            >
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
          {twoStep.has(p.id) && (
            <button
              type="button"
              className="btn"
              title="They lost their phone: they sign in with the password alone, then turn two-step sign-in on again"
              onClick={() => reset(p)}
            >
              {resetting === p.id ? 'Sure? Reset' : 'Reset two-step'}
            </button>
          )}
        </div>
        {st === 'pending' && noApps(p) && <p className="people__hint">Tick Lumora and/or Studio, then approve.</p>}
        {st === 'approved' && noApps(p) && <p className="people__hint">No apps are on, so this account can't open Lumora or Studio.</p>}
      </div>
    );
  };
  return (
    <>
      <div className="people__tabs" role="tablist">
        {(['waiting', 'approved', 'blocked', 'all'] as const).map((f) => (
          <button key={f} type="button" className="seg" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === 'waiting' ? `Waiting (${waiting})` : f === 'approved' ? 'Approved' : f === 'blocked' ? 'Blocked' : 'Everyone'}
          </button>
        ))}
        <button type="button" className="seg" aria-pressed={filter === 'problems'} onClick={() => setFilter('problems')}>
          Problems reported
        </button>
      </div>
      {filter === 'problems' && (
        <div className="people__body">
          <ReportsAdmin />
        </div>
      )}
      <div className="people__body" hidden={filter === 'problems'}>
        {error && <p className="field__note">{error}</p>}
        {people === null && !error && <p className="people__empty">Loading…</p>}
        {people !== null && shown.length === 0 && <p className="people__empty">{filter === 'waiting' ? 'Nobody is waiting for approval.' : 'Nobody here.'}</p>}
        {shown.map(row)}
        {teammates.length > 0 && (
          <details className="people__group">
            <summary>Planner-only accounts ({teammates.length}) — made to work on a plan; they did not ask for Lumora or Studio</summary>
            {teammates.map(row)}
          </details>
        )}
      </div>
    </>
  );
}
