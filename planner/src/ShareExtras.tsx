import { useEffect, useState } from 'react';
import { Copy, Link2, Lock, Unlock } from 'lucide-react';
import * as pro from './apiPro';
import type { Person } from './api';
import type { Plan, PlanCue } from './model';
import { AUTH_KEY, AUTH_URL } from '../../app/src/auth/config';
import { db } from './session';
import { usePlannerFeatures } from './features';

/** The address of a public page of the Planner ("#/view/<token>", or one of its screens). */
export function publicUrl(token: string, screen: '' | 'timer' | 'prompter' | 'now' = ''): string {
  const base = typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}`;
  return `${base}#/view/${token}${screen ? `/${screen}` : ''}`;
}

function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [done, setDone] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <span className="row">
        <input className="input grow mono small" value={value} readOnly onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className="btn"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            });
          }}
        >
          <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
          {done ? 'Copied' : 'Copy'}
        </button>
      </span>
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

/**
 * The public read-only link (the owner turns it on): the agenda for guests,
 * or the crew view (Now/Next, run of show with notes, call times, stage
 * timer and prompter), without signing in. Plus the plan's calendar feed.
 */
export function PublicLink({ plan, isOwner, onChanged }: { plan: Plan; isOwner: boolean; onChanged: (token: string | null, scope: 'agenda' | 'crew') => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { sharing } = usePlannerFeatures();
  if (!plan.pro) return null;
  const set = (on: boolean, scope: 'agenda' | 'crew') => {
    setBusy(true);
    setError('');
    pro
      .setShare(db(), plan.id, on, scope)
      .then((t) => onChanged(t, scope))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const token = plan.shareToken;
  return (
    <section className="share-x" aria-label="Public link">
      <h3>
        <Link2 size={15} strokeWidth={1.75} aria-hidden="true" /> Public link
      </h3>
      {!token ? (
        <>
          <p className="muted small">
            A read-only page anyone with the link can open, without an account: the agenda for guests, or the crew view with what is on now and next.
          </p>
          {isOwner ? (
            <div className="row row--wrap">
              <button type="button" className="btn" disabled={busy || !sharing} onClick={() => set(true, 'agenda')}>
                Make an agenda link
              </button>
              <button type="button" className="btn" disabled={busy || !sharing} onClick={() => set(true, 'crew')}>
                Make a crew link
              </button>
              {!sharing && <span className="muted small">Sharing is turned off by the Lumora team.</span>}
            </div>
          ) : (
            <p className="muted small">Only the owner makes a public link.</p>
          )}
        </>
      ) : (
        <>
          <div className="seg" role="group" aria-label="What the link shows">
            {(['agenda', 'crew'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`seg__btn${plan.shareScope === s ? ' is-on' : ''}`}
                aria-pressed={plan.shareScope === s}
                disabled={!isOwner || busy}
                onClick={() => set(true, s)}
              >
                {s === 'agenda' ? 'Agenda: times and titles' : 'Crew: notes, scripts, call times'}
              </button>
            ))}
          </div>
          <CopyField label="Link" value={publicUrl(token)} hint="Never phone numbers, emails, the budget, files, comments or chat." />
          {plan.shareScope === 'crew' && (
            <>
              <CopyField label="Stage timer (for a screen on stage)" value={publicUrl(token, 'timer')} />
              <CopyField label="Prompter" value={publicUrl(token, 'prompter')} />
            </>
          )}
          <CopyField
            label="Calendar feed (subscribe in Google Calendar, Outlook or Apple Calendar)"
            value={pro.feedUrl(AUTH_URL, AUTH_KEY, 'planner_ical', token)}
            hint="The event and its schedule blocks, kept up to date by the calendar app."
          />
          {isOwner && (
            <div className="row">
              <button type="button" className="btn btn--quiet btn--danger" disabled={busy} onClick={() => confirm('Turn the public link off? Anyone with it can no longer open the plan.') && set(false, plan.shareScope)}>
                Turn the link off
              </button>
              <span className="muted small">Turning it on again makes a new link.</span>
            </div>
          )}
        </>
      )}
      {error && <p className="warn small">{error}</p>}
    </section>
  );
}

/** The owner locks sections of the run of show to some editors (the rest can only read them). */
export function SectionLocks({ plan, cues, people, isOwner }: { plan: Plan; cues: PlanCue[]; people: Person[]; isOwner: boolean }) {
  const [locks, setLocks] = useState<pro.SectionLock[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!plan.pro) return;
    void pro.loadLocks(db(), plan.id).then(setLocks);
  }, [plan.id, plan.pro]);
  if (!plan.pro) return null;
  const sections = [...new Set(cues.map((c) => c.section.trim()).filter(Boolean))];
  const editors = people.filter((p) => p.role === 'editor');
  if (!sections.length) return null;
  const save = (section: string, list: string[] | null) => {
    setError('');
    const before = locks;
    setLocks(list === null ? locks.filter((l) => l.section !== section) : [...locks.filter((l) => l.section !== section), { section, editors: list }]);
    pro.setLock(db(), plan.id, section, list).catch((e: unknown) => {
      setLocks(before);
      setError(e instanceof Error ? e.message : String(e));
    });
  };
  return (
    <section className="share-x" aria-label="Section locks">
      <h3>
        <Lock size={15} strokeWidth={1.75} aria-hidden="true" /> Who edits each section
      </h3>
      <p className="muted small">Lock a section so only you and the editors you tick can change its cues; everyone else still sees them.</p>
      <table className="people">
        <tbody>
          {sections.map((s) => {
            const l = locks.find((x) => x.section === s);
            return (
              <tr key={s}>
                <td>
                  <b>{s}</b>
                  {l && (
                    <div className="muted small">
                      {l.editors.length
                        ? `You and ${editors.filter((p) => l.editors.includes(p.userId)).map((p) => p.name || p.email).join(', ') || 'nobody else'}`
                        : 'Only you'}
                    </div>
                  )}
                </td>
                <td className="nowrap">
                  {isOwner ? (
                    l ? (
                      <span className="row row--wrap share-x__eds">
                        {editors.map((p) => (
                          <label key={p.userId} className="row small">
                            <input
                              type="checkbox"
                              checked={l.editors.includes(p.userId)}
                              onChange={(e) => save(s, e.target.checked ? [...l.editors, p.userId] : l.editors.filter((x) => x !== p.userId))}
                            />
                            {p.name || p.email}
                          </label>
                        ))}
                      </span>
                    ) : null
                  ) : (
                    <span className="muted small">{l ? 'Locked' : 'Open to editors'}</span>
                  )}
                </td>
                <td className="nowrap">
                  {isOwner && (
                    <button type="button" className="btn btn--quiet" onClick={() => save(s, l ? null : [])}>
                      {l ? <Unlock size={14} strokeWidth={1.75} aria-hidden="true" /> : <Lock size={14} strokeWidth={1.75} aria-hidden="true" />}
                      {l ? 'Unlock' : 'Lock'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <p className="warn small">{error}</p>}
    </section>
  );
}
