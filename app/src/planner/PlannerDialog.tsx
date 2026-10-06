import { invoke } from '@tauri-apps/api/core';
import { CalendarClock, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { listPlans, loadPlan, type Loaded } from '../../../planner/src/api';
import { formatDuration, schedule, shortDate, showClock, type PlanSummary } from '../../../planner/src/model';
import { supabase } from '../auth/auth';
import { authOn } from '../auth/config';
import { isInsideLumora } from '../engine/client';
import type { Cue } from '../engine/types/Cue';
import type { Show } from '../engine/types/Show';
import { combine, DEFAULT_OPTIONS, MAX_CUES, planToCues, type ConvertOptions } from './fromPlanner';
import './PlannerDialog.css';

/** Where the web Planner is (the same address Lumora opens in the browser). */
export const PLANNER_URL = 'https://yehudakogan770.github.io/Livestreamingapp/planner/';

/** Opens the web Planner in the browser. */
export function openPlanner(): void {
  if (isInsideLumora()) void invoke('open_planner').catch(() => window.open(PLANNER_URL, '_blank', 'noopener'));
  else window.open(PLANNER_URL, '_blank', 'noopener');
}

type State = { s: 'loading' } | { s: 'error'; message: string } | { s: 'list'; plans: PlanSummary[] };

/**
 * Run of show → Load from Planner…: pick a plan the team made in the web
 * Planner, see what Lumora will make of it, then replace the cues or add them
 * after the ones there are (into the run of show being edited: Save cues keeps them).
 */
export function PlannerDialog({ show, current, onLoad, onClose }: { show: Show; current: Cue[]; onLoad: (cues: Cue[]) => void; onClose: () => void }) {
  const [state, setState] = useState<State>({ s: 'loading' });
  const [picked, setPicked] = useState<string | null>(null);
  const [plan, setPlan] = useState<Loaded | null>(null);
  const [planError, setPlanError] = useState('');
  const [opts, setOpts] = useState<ConvertOptions>(DEFAULT_OPTIONS);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);

  const refresh = () => {
    if (!authOn()) {
      setState({ s: 'error', message: 'The Planner needs Lumora’s sign-in, which is not set up on this computer.' });
      return;
    }
    setState({ s: 'loading' });
    supabase()
      .auth.getSession()
      .then(({ data }) => {
        if (!data.session) throw new Error('Sign in to Lumora to load plans from the Planner.');
        return listPlans(supabase());
      })
      .then((plans) => setState({ s: 'list', plans }))
      .catch((e: unknown) => setState({ s: 'error', message: e instanceof Error ? e.message : String(e) }));
  };
  useEffect(refresh, []);

  useEffect(() => {
    if (!picked) return;
    let live = true;
    setPlan(null);
    setPlanError('');
    loadPlan(supabase(), picked)
      .then((p) => live && setPlan(p))
      .catch((e: unknown) => live && setPlanError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [picked]);

  const converted = useMemo(() => (plan ? planToCues(plan.plan, plan.cues, show, opts) : null), [plan, show, opts]);
  const sched = useMemo(() => (plan ? schedule(plan.cues, plan.plan.startTime) : null), [plan]);
  const unmatched = converted ? converted.report.reduce((n, r) => n + r.unmapped.length, 0) : 0;
  const tooMany = converted ? current.length + converted.cues.length > MAX_CUES : false;

  const load = (mode: 'replace' | 'append') => {
    if (!converted) return;
    onLoad(combine(current, converted.cues, mode));
    onClose();
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Load from Planner" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box pld">
        <header className="modal__head">
          <h2>
            <CalendarClock className="modal__icon" aria-hidden="true" />
            Load from Planner
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="pld__body">
          <section className="pld__plans" aria-label="Plans">
            {state.s === 'loading' && <p className="field__note">Looking for plans…</p>}
            {state.s === 'error' && (
              <>
                <p className="field__note field__note--warn">{state.message}</p>
                <button type="button" className="btn" onClick={refresh}>
                  Try again
                </button>
              </>
            )}
            {state.s === 'list' && state.plans.length === 0 && (
              <p className="field__note">No plans yet. Make one in the Planner (or ask the owner of one to share it with you), then come back here.</p>
            )}
            {state.s === 'list' &&
              state.plans.map((p) => (
                <button key={p.id} type="button" className={`pld__plan${picked === p.id ? ' is-sel' : ''}`} onClick={() => setPicked(p.id)}>
                  <b>{p.name}</b>
                  <em>
                    {[shortDate(p.eventDate), p.venue, `${p.cueCount} cue${p.cueCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                    {p.role !== 'owner' && ` · ${p.ownerName}’s`}
                  </em>
                </button>
              ))}
            <button type="button" className="btn pld__open" onClick={openPlanner}>
              Open Planner…
            </button>
          </section>
          <section className="pld__preview" aria-label="Preview">
            {!picked && <p className="field__note">Pick a plan to see its cues as Lumora will load them.</p>}
            {planError && <p className="field__note field__note--warn">{planError}</p>}
            {picked && !plan && !planError && <p className="field__note">Loading the plan…</p>}
            {plan && converted && sched && (
              <>
                <div className="pld__opts">
                  <span className="field__label">Cues start</span>
                  <div className="seg-group">
                    <button type="button" className="seg" aria-pressed={opts.timing === 'manual'} onClick={() => setOpts({ ...opts, timing: 'manual' })}>
                      By hand (NEXT CUE)
                    </button>
                    <button type="button" className="seg" aria-pressed={opts.timing === 'planned'} onClick={() => setOpts({ ...opts, timing: 'planned' })}>
                      As planned (clock times, then one after another)
                    </button>
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={opts.whoInName} onChange={(e) => setOpts({ ...opts, whoInName: e.target.checked })} /> Add who is
                    responsible to each cue’s name
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={opts.notesToMonitor} onChange={(e) => setOpts({ ...opts, notesToMonitor: e.target.checked })} /> Show each
                    cue’s notes on the Monitor when it runs
                  </label>
                </div>
                <div className="pld__sum">
                  {plan.cues.length} cue{plan.cues.length === 1 ? '' : 's'}
                  {plan.plan.startTime && ` · starts ${showClock(plan.plan.startTime)}`}
                  {sched.totalSec > 0 && ` · ${formatDuration(sched.totalSec)} planned`}
                  {unmatched > 0 && (
                    <span className="field__note--warn">
                      {' '}
                      · {unmatched} hint{unmatched === 1 ? '' : 's'} not found in this event
                    </span>
                  )}
                </div>
                <ol className="pld__cues">
                  {converted.cues.map((c, i) => {
                    const r = converted.report[i]!;
                    return (
                      <li key={c.id}>
                        <span className="pld__n">{i + 1}</span>
                        <span className="pld__when">
                          {c.trigger.type === 'clock' ? showClock(c.trigger.time) : c.trigger.type === 'afterPrevious' ? 'after previous' : 'by hand'}
                        </span>
                        <span className="pld__len">{c.lengthMs ? formatDuration(c.lengthMs / 1000) : '—'}</span>
                        <span className="pld__what">
                          <b>{c.name}</b>
                          <em>{r.mapped.length ? r.mapped.join(' · ') : 'a note cue: no steps (run by hand)'}</em>
                          {r.unmapped.length > 0 && <em className="field__note--warn">Not found: {r.unmapped.join(', ')}</em>}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
          </section>
        </div>
        <footer className="modal__foot">
          {tooMany && <span className="field__note field__note--warn">A run of show holds {MAX_CUES} cues; the rest are left out.</span>}
          <span className="remote__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={!converted || converted.cues.length === 0} onClick={() => load('append')}>
            Add after current cues
          </button>
          <button type="button" className="btn btn--primary" disabled={!converted || converted.cues.length === 0} onClick={() => load('replace')}>
            Replace cues
          </button>
        </footer>
      </div>
    </div>
  );
}
