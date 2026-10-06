// One plan on a phone: a compact header, what is on now and next (on the event
// day), the cues as a list of cards, and the actions in a bar at the bottom.
// Tapping a cue opens everything about it in a full-screen sheet.

import { useEffect, useRef, useState } from 'react';
import { TimeInput } from './fields';
import { Inspector, hintText, initials } from './Inspector';
import { clock12, formatDuration, segmentName, shortDate, showClock, type PlanCue, type Schedule } from './model';
import { useBackToClose, useReorder } from './touch';
import type { PlanStore } from './usePlan';

const ROLE_WORDS = { owner: 'You own this plan', editor: 'You can edit', viewer: 'View only' } as const;
const SAVE_WORDS = { saved: 'Saved', saving: 'Saving…', offline: 'Not saved — retrying' } as const;

export interface PhonePlanProps {
  store: PlanStore;
  sched: Schedule;
  sel: string | null;
  onSel: (id: string | null) => void;
  canEdit: boolean;
  onNow: number | null;
  nowSec: number | null;
  commentCount: Map<string, number>;
  me: { id: string; name: string };
  onBack: () => void;
  onShare: () => void;
  onLeaveOrDelete: () => void;
}

const cueName = (c: PlanCue) => c.title || segmentName(c.segment);

export function PhonePlan({ store, sched, sel, onSel, canEdit, onNow, nowSec, commentCount, me, onBack, onShare, onLeaveOrDelete }: PhonePlanProps) {
  const { plan, cues, comments, role, here, saving } = store;
  const [details, setDetails] = useState(false);
  const [menu, setMenu] = useState(false);
  const { listRef, handle, rowClass } = useReorder<HTMLOListElement>(cues.length, store.move, canEdit);
  const selIndex = cues.findIndex((c) => c.id === sel);
  const selected = selIndex >= 0 ? cues[selIndex]! : null;
  useBackToClose(selected !== null, () => onSel(null));

  // A cue just added or moved is scrolled into view when the sheet closes.
  const lastSel = useRef<string | null>(null);
  useEffect(() => {
    if (sel) lastSel.current = sel;
    else if (lastSel.current) {
      document.getElementById(`cue-${lastSel.current}`)?.scrollIntoView?.({ block: 'nearest' });
      lastSel.current = null;
    }
  }, [sel]);

  // On the event day, open the list at what is on now.
  const scrolledToNow = useRef(false);
  useEffect(() => {
    if (scrolledToNow.current || onNow === null || !cues[onNow]) return;
    scrolledToNow.current = true;
    document.getElementById(`cue-${cues[onNow]!.id}`)?.scrollIntoView?.({ block: 'center' });
  }, [onNow, cues]);

  if (!plan) return null;
  const when = [shortDate(plan.eventDate) || 'No date yet', showClock(plan.startTime), plan.venue].filter(Boolean).join(' · ');
  const add = () => {
    const id = store.addCue(sel);
    if (id) onSel(id);
  };

  return (
    <main className="phone no-print">
      <header className="phone__head">
        <div className="phone__top">
          <a className="phone__back" href="#/" onClick={onBack}>
            <span aria-hidden="true">‹</span> Plans
          </a>
          <span className="bar__spacer" />
          {here.length > 0 && (
            <span className="tools__here" title={here.join(', ')} aria-label={here.length === 1 ? `${here[0]} is here` : `${here.length} others here`}>
              {here.slice(0, 3).map((n) => (
                <span key={n} className="who-chip">
                  {initials(n)}
                </span>
              ))}
            </span>
          )}
          <span className={`phone__save tools__save--${saving}`} role="status">
            {SAVE_WORDS[saving]}
          </span>
        </div>
        <input
          className="phone__name"
          value={plan.name}
          maxLength={120}
          readOnly={!canEdit}
          enterKeyHint="done"
          onChange={(e) => store.editPlan({ name: e.target.value })}
          aria-label="Event name"
          placeholder="Event name"
        />
        <button type="button" className="phone__when" aria-expanded={details} onClick={() => setDetails(!details)}>
          <span className="phone__when-text">{when}</span>
          <span className="phone__when-act">{details ? 'Done' : canEdit ? 'Edit' : 'Details'}</span>
        </button>
        {details && (
          <div className="phone__meta">
            <label className="field">
              <span>Date</span>
              <input
                type="date"
                className="input"
                value={plan.eventDate}
                readOnly={!canEdit}
                onChange={(e) => canEdit && store.editPlan({ eventDate: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Show starts</span>
              <TimeInput value={plan.startTime} readOnly={!canEdit} label="Show starts" onChange={(v) => store.editPlan({ startTime: v })} />
            </label>
            <label className="field phone__wide">
              <span>Venue</span>
              <input
                className="input"
                value={plan.venue}
                maxLength={120}
                readOnly={!canEdit}
                placeholder="Where"
                onChange={(e) => store.editPlan({ venue: e.target.value })}
              />
            </label>
            <label className="field phone__wide">
              <span>Event notes</span>
              <textarea
                className="input"
                rows={4}
                maxLength={8000}
                value={plan.notes}
                readOnly={!canEdit}
                placeholder="Load-in, crew call, contacts, stream details…"
                onChange={(e) => store.editPlan({ notes: e.target.value })}
              />
            </label>
          </div>
        )}
      </header>

      {nowSec !== null && <NowNext sched={sched} cues={cues} nowSec={nowSec} onNow={onNow} onOpen={onSel} />}
      {store.error && <p className="warn plan__error">{store.error}</p>}

      <div className="phone__list">
        <ol className="cards" ref={listRef} aria-label="Cues">
          {cues.map((c, i) => {
            const t = sched.rows[i]!;
            const section = c.section && c.section !== cues[i - 1]?.section ? c.section : null;
            const sub = [c.who, hintText(c)].filter(Boolean).join(' · ') || c.notes.split('\n')[0];
            const n = commentCount.get(c.id);
            return [
              section ? (
                <li key={`s-${c.id}`} className="cards__section">
                  {section}
                </li>
              ) : null,
              <li key={c.id} id={`cue-${c.id}`} data-reorder className={`card${onNow === i ? ' is-now' : ''}${sel === c.id ? ' is-sel' : ''}${c.segment === 'break' ? ' is-break' : ''}${rowClass(i)}`}>
                <button type="button" className="card__open" onClick={() => onSel(c.id)} aria-label={`Cue ${i + 1}: ${cueName(c)}`}>
                  <span className="card__when">
                    <span className={`card__time${t.fixed ? ' is-fixed' : ''}`}>{t.start !== null ? clock12(t.start) : '—'}</span>
                    <span className="card__len">{formatDuration(c.durationSec) || 'no length'}</span>
                  </span>
                  <span className="card__main">
                    <span className="card__line">
                      <span className="card__type">{segmentName(c.segment)}</span>
                      {t.drift !== null && t.drift !== 0 && (
                        <span className={`drift drift--inline${t.drift < 0 ? ' drift--over' : ''}`}>
                          {t.drift < 0 ? `runs over ${formatDuration(-t.drift)}` : `gap ${formatDuration(t.drift)}`}
                        </span>
                      )}
                      {n ? (
                        <span className="com__n" aria-label={`${n} comment${n === 1 ? '' : 's'}`}>
                          {n}
                        </span>
                      ) : null}
                    </span>
                    <span className={`card__title${c.title ? '' : ' is-empty'}`}>{cueName(c)}</span>
                    {sub && <span className="card__sub">{sub}</span>}
                  </span>
                </button>
                {canEdit && (
                  <span className="card__grip" {...handle(i)} aria-hidden="true" title="Drag to reorder">
                    <span className="grip" />
                  </span>
                )}
              </li>,
            ];
          })}
        </ol>
        {cues.length === 0 ? (
          <div className="empty phone__empty">
            <p>No cues yet.</p>
            {canEdit && <p className="muted">Add cue starts the list: each cue is one moment of the show, in order.</p>}
          </div>
        ) : (
          <p className="phone__totals">
            {cues.length} cue{cues.length === 1 ? '' : 's'} · Total <b>{formatDuration(sched.totalSec) || '0:00'}</b>
            {plan.startTime && sched.endSec !== null && (
              <>
                {' '}
                · Ends <b>{clock12(sched.endSec)}</b>
              </>
            )}
            {sched.untimed > 0 && <span className="warn-text"> · {sched.untimed} without a length</span>}
          </p>
        )}
        <p className="phone__role muted small">{ROLE_WORDS[role ?? 'viewer']}</p>
      </div>

      <nav className="phone__bar" aria-label="Plan actions">
        {canEdit && (
          <button type="button" className="btn btn--primary phone__add" onClick={add}>
            Add cue
          </button>
        )}
        <button type="button" className="btn" onClick={onShare}>
          Share
        </button>
        <button type="button" className="btn" onClick={() => window.print()}>
          Print
        </button>
        <button type="button" className="btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          More
        </button>
      </nav>
      {menu && (
        <div className="menu-back" onPointerDown={(e) => e.target === e.currentTarget && setMenu(false)}>
          <div className="menu" role="menu" aria-label="More">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                setDetails(true);
              }}
            >
              Event details and notes
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu__danger"
              onClick={() => {
                setMenu(false);
                onLeaveOrDelete();
              }}
            >
              {role === 'owner' ? 'Delete plan…' : 'Leave plan…'}
            </button>
            <button type="button" role="menuitem" onClick={() => setMenu(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {selected && (
        <div className="cuesheet" role="dialog" aria-modal="true" aria-label={`Cue ${selIndex + 1}`}>
          <header className="cuesheet__head">
            <button type="button" className="btn btn--quiet cuesheet__back" onClick={() => onSel(null)}>
              <span aria-hidden="true">‹</span> Cues
            </button>
            <b className="cuesheet__title">
              Cue {selIndex + 1} <span className="muted">of {cues.length}</span>
            </b>
            {canEdit && (
              <span className="cuesheet__move">
                <button type="button" className="btn" disabled={selIndex === 0} aria-label="Move cue up" onClick={() => store.move(selIndex, selIndex - 1)}>
                  ↑
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={selIndex === cues.length - 1}
                  aria-label="Move cue down"
                  onClick={() => store.move(selIndex, selIndex + 1)}
                >
                  ↓
                </button>
              </span>
            )}
          </header>
          <div className="cuesheet__body">
            <Inspector
              key={selected.id}
              cue={selected}
              index={selIndex}
              count={cues.length}
              store={store}
              canEdit={canEdit}
              comments={comments.filter((c) => c.cueId === selected.id)}
              me={me.id}
              isOwner={role === 'owner'}
              timed={sched.rows[selIndex]}
              onSel={onSel}
              phone
            />
          </div>
          <footer className="cuesheet__foot">
            <span className={`phone__save tools__save--${saving}`}>{canEdit ? SAVE_WORDS[saving] : 'View only'}</span>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                // Commit a field still being typed in before closing.
                (document.activeElement as HTMLElement | null)?.blur?.();
                onSel(null);
              }}
            >
              Done
            </button>
          </footer>
        </div>
      )}
    </main>
  );
}

/** On the event day: what is on now and how long it has left, and what comes next. */
function NowNext({
  sched,
  cues,
  nowSec,
  onNow,
  onOpen,
}: {
  sched: Schedule;
  cues: PlanCue[];
  nowSec: number;
  onNow: number | null;
  onOpen: (id: string) => void;
}) {
  const next = sched.rows.findIndex((r) => r.start !== null && r.start > nowSec);
  const cur = onNow === null ? null : sched.rows[onNow]!;
  if (onNow === null && next < 0) return <div className="nownext nownext--over">Show over (as planned)</div>;
  return (
    <div className="nownext" role="status" aria-label="Now and next">
      {onNow !== null && cur ? (
        <button type="button" className="nownext__now" onClick={() => onOpen(cues[onNow]!.id)}>
          <span className="nownext__label">
            <i className="tally" /> Now
          </span>
          <span className="nownext__title">{cueName(cues[onNow]!)}</span>
          {cur.end !== null && <span className="nownext__time">{formatDuration(cur.end - nowSec)} left</span>}
        </button>
      ) : (
        <span className="nownext__now nownext__now--idle">
          <span className="nownext__label">Now</span>
          <span className="nownext__title muted">Nothing planned</span>
        </span>
      )}
      {next >= 0 && (
        <button type="button" className="nownext__next" onClick={() => onOpen(cues[next]!.id)}>
          <span className="nownext__label">Next</span>
          <span className="nownext__title">{cueName(cues[next]!)}</span>
          <span className="nownext__time">
            {clock12(sched.rows[next]!.start!)} · in {formatDuration(sched.rows[next]!.start! - nowSec)}
          </span>
        </button>
      )}
    </div>
  );
}
