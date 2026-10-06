import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { deletePlan, removePerson } from './api';
import { ClockInput, DurationInput } from './fields';
import { Inspector, hintText, initials } from './Inspector';
import { SEGMENTS, cueAt, eventSeconds, formatDuration, clock12, longDate, schedule, segmentName, type PlanCue, type Schedule, type Segment } from './model';
import { PhonePlan } from './PhonePlan';
import { PrintSheet } from './PrintSheet';
import { db } from './session';
import { ShareDialog } from './ShareDialog';
import { usePhone, useReorder } from './touch';
import { usePlan, type PlanStore } from './usePlan';

export { hintText };

const ROLE_WORDS = { owner: 'You own this plan', editor: 'You can edit', viewer: 'View only' } as const;

function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** One plan: its details, the cue sheet, the cue being edited, and the totals. */
export function PlanView({ planId, me, onBack }: { planId: string; me: { id: string; name: string }; onBack: () => void }) {
  const store = usePlan(planId, me);
  const { plan, cues, comments, role, here, error, gone, saving } = store;
  const [sel, setSel] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const now = useNow();
  const phone = usePhone();
  const canEdit = role === 'owner' || role === 'editor';

  const sched = useMemo(() => schedule(cues, plan?.startTime ?? ''), [cues, plan?.startTime]);
  const nowSec = plan ? eventSeconds(plan.eventDate, now) : null;
  const onNow = nowSec === null ? null : cueAt(sched, nowSec);
  const commentCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of comments) m.set(c.cueId, (m.get(c.cueId) ?? 0) + 1);
    return m;
  }, [comments]);

  const selected = cues.find((c) => c.id === sel) ?? null;
  useEffect(() => {
    if (sel && !cues.some((c) => c.id === sel)) setSel(null);
  }, [cues, sel]);

  if (gone)
    return (
      <main className="page">
        <p>This plan was deleted, or it is no longer shared with you.</p>
        <button type="button" className="btn" onClick={onBack}>
          Back to plans
        </button>
      </main>
    );
  if (!plan)
    return (
      <main className="page">
        {error ? <p className="warn">{error}</p> : <p className="muted">Opening the plan…</p>}
        <button type="button" className="btn" onClick={onBack}>
          Back to plans
        </button>
      </main>
    );

  const leaveOrDelete = () => {
    if (role === 'owner') {
      if (!confirm(`Delete “${plan.name}” for everyone? Its cues and comments are deleted too. This can’t be undone.`)) return;
      deletePlan(db(), plan.id)
        .then(onBack)
        .catch((e: unknown) => alert(e instanceof Error ? e.message : String(e)));
    } else {
      if (!confirm(`Leave “${plan.name}”? You won’t see it any more unless the owner shares it again.`)) return;
      removePerson(db(), plan.id, me.id)
        .then(onBack)
        .catch((e: unknown) => alert(e instanceof Error ? e.message : String(e)));
    }
  };

  const shared = (
    <>
      <PrintSheet plan={plan} cues={cues} sched={sched} />
      {sharing && <ShareDialog plan={plan} role={role} me={me.id} onClose={() => setSharing(false)} onChanged={store.reloadRole} />}
    </>
  );

  if (phone)
    return (
      <>
        <PhonePlan
          store={store}
          sched={sched}
          sel={sel}
          onSel={setSel}
          canEdit={canEdit}
          onNow={onNow}
          nowSec={nowSec}
          commentCount={commentCount}
          me={me}
          onBack={onBack}
          onShare={() => setSharing(true)}
          onLeaveOrDelete={leaveOrDelete}
        />
        {shared}
      </>
    );

  return (
    <>
      <main className="plan no-print">
        <section className="plan__head" aria-label="Event">
          <div className="plan__crumbs">
            <a href="#/" onClick={onBack}>
              Plans
            </a>
            <span aria-hidden="true">/</span>
          </div>
          <input
            className="plan__name"
            value={plan.name}
            maxLength={120}
            readOnly={!canEdit}
            onChange={(e) => store.editPlan({ name: e.target.value })}
            aria-label="Event name"
            placeholder="Event name"
          />
          <div className="plan__meta">
            <label className="mini">
              <span>Date</span>
              <input
                type="date"
                className="input"
                value={plan.eventDate}
                readOnly={!canEdit}
                onChange={(e) => canEdit && store.editPlan({ eventDate: e.target.value })}
              />
            </label>
            <label className="mini">
              <span>Show starts</span>
              <ClockInput
                value={plan.startTime}
                readOnly={!canEdit}
                placeholder="7:30 PM"
                label="Show starts"
                onChange={(v) => store.editPlan({ startTime: v })}
                className="input input--time"
              />
            </label>
            <label className="mini mini--wide">
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
            <button type="button" className="btn btn--quiet" aria-expanded={showNotes} onClick={() => setShowNotes(!showNotes)}>
              {showNotes ? 'Hide event notes' : plan.notes ? 'Event notes (1)' : 'Event notes'}
            </button>
          </div>
          {showNotes && (
            <textarea
              className="input plan__notes"
              rows={4}
              maxLength={8000}
              value={plan.notes}
              readOnly={!canEdit}
              placeholder="Load-in, crew call, contacts, stream details…"
              onChange={(e) => store.editPlan({ notes: e.target.value })}
              aria-label="Event notes"
            />
          )}
        </section>

        <div className="tools" role="toolbar" aria-label="Plan">
          {canEdit && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                const id = store.addCue(sel);
                if (id) setSel(id);
              }}
            >
              Add cue{sel ? ' below' : ''}
            </button>
          )}
          <button type="button" className="btn" onClick={() => setSharing(true)}>
            Share…
          </button>
          <button type="button" className="btn" onClick={() => window.print()} title="Print, or save as PDF from the print window">
            Print / PDF
          </button>
          <span className="tools__note">{ROLE_WORDS[role ?? 'viewer']}</span>
          <span className="bar__spacer" />
          {here.length > 0 && (
            <span className="tools__here" title="Also has this plan open">
              {here.map((n) => (
                <span key={n} className="who-chip" title={n}>
                  {initials(n)}
                </span>
              ))}
              <span className="muted">{here.length === 1 ? `${here[0]} is here` : `${here.length} others here`}</span>
            </span>
          )}
          <span className={`tools__save tools__save--${saving}`} role="status">
            {saving === 'saved' ? 'All changes saved' : saving === 'saving' ? 'Saving…' : 'Not saved — retrying'}
          </span>
        </div>
        {error && <p className="warn plan__error">{error}</p>}

        <div className="plan__body">
          <CueSheet store={store} sched={sched} sel={sel} onSel={setSel} canEdit={canEdit} onNow={onNow} commentCount={commentCount} />
          <aside className="inspector" aria-label="Cue details">
            {selected ? (
              <Inspector
                key={selected.id}
                cue={selected}
                index={cues.indexOf(selected)}
                count={cues.length}
                store={store}
                canEdit={canEdit}
                comments={comments.filter((c) => c.cueId === selected.id)}
                me={me.id}
                isOwner={role === 'owner'}
                timed={sched.rows[cues.indexOf(selected)]}
                onSel={setSel}
              />
            ) : (
              <div className="inspector__empty">
                <p>Select a cue to see and edit its details, Lumora hints and comments.</p>
                <p className="muted small">
                  Times: a cue starts when the one before ends, unless it has a fixed start. Lengths take 5:00, 90 (seconds), 5m or 1h 30m. Drag the handle to
                  reorder.
                </p>
                <p className="muted small">In Lumora: Run of show → Load from Planner… loads these cues.</p>
                <button type="button" className="btn btn--quiet btn--danger" onClick={leaveOrDelete}>
                  {role === 'owner' ? 'Delete plan…' : 'Leave plan…'}
                </button>
              </div>
            )}
          </aside>
        </div>

        <footer className="status">
          <span>
            {cues.length} cue{cues.length === 1 ? '' : 's'}
          </span>
          <span>
            Total <b>{formatDuration(sched.totalSec) || '0:00'}</b>
          </span>
          {plan.startTime && sched.endSec !== null && (
            <span>
              Ends <b>{clock12(sched.endSec)}</b>
            </span>
          )}
          {sched.untimed > 0 && <span className="warn-text">{sched.untimed} without a length</span>}
          <span className="status__segs">
            {SEGMENTS.filter((s) => sched.bySegment[s.id]).map((s) => (
              <span key={s.id} className="status__seg">
                {s.name} {formatDuration(sched.bySegment[s.id]!)}
              </span>
            ))}
          </span>
          <span className="bar__spacer" />
          <RunningClock sched={sched} cues={cues} nowSec={nowSec} onNow={onNow} eventDate={plan.eventDate} now={now} />
        </footer>
      </main>
      {shared}
    </>
  );
}

/** On the event day: what is on now and how long it has left; otherwise how far away the event is. */
function RunningClock({
  sched,
  cues,
  nowSec,
  onNow,
  eventDate,
  now,
}: {
  sched: Schedule;
  cues: PlanCue[];
  nowSec: number | null;
  onNow: number | null;
  eventDate: string;
  now: Date;
}) {
  if (!eventDate) return <span className="muted">Set the date to follow the plan live</span>;
  if (nowSec === null) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate);
    const day = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
    const days = day ? Math.ceil((day.getTime() - now.getTime()) / 86_400_000) : 0;
    return <span className="muted">{days > 0 ? `${longDate(eventDate)} — in ${days} day${days === 1 ? '' : 's'}` : longDate(eventDate)}</span>;
  }
  if (onNow === null) {
    const next = sched.rows.findIndex((r) => r.start !== null && r.start > nowSec);
    if (next < 0) return <span className="muted">Show over (as planned)</span>;
    return (
      <span>
        Next <b>{cues[next]!.title || segmentName(cues[next]!.segment)}</b> in <b className="mono">{formatDuration(sched.rows[next]!.start! - nowSec)}</b>
      </span>
    );
  }
  const r = sched.rows[onNow]!;
  return (
    <span className="status__live">
      <i className="tally" /> On now: <b>{cues[onNow]!.title || segmentName(cues[onNow]!.segment)}</b>
      {r.end !== null && (
        <>
          {' '}
          · <b className="mono">{formatDuration(r.end - nowSec)}</b> left
        </>
      )}
    </span>
  );
}

/** The cue sheet: one row per cue, edited in place, dragged to reorder. */
function CueSheet({
  store,
  sched,
  sel,
  onSel,
  canEdit,
  onNow,
  commentCount,
}: {
  store: PlanStore;
  sched: Schedule;
  sel: string | null;
  onSel: (id: string | null) => void;
  canEdit: boolean;
  onNow: number | null;
  commentCount: Map<string, number>;
}) {
  const { cues } = store;
  // Rows drag only by their handle (so text in the cells can still be selected), by mouse, pen or touch.
  const { listRef, handle, rowClass } = useReorder<HTMLTableSectionElement>(cues.length, store.move, canEdit);
  const keys = (e: KeyboardEvent, i: number) => {
    if (!canEdit || !e.altKey) return;
    if (e.key === 'ArrowUp' && i > 0) {
      e.preventDefault();
      store.move(i, i - 1);
    } else if (e.key === 'ArrowDown' && i < cues.length - 1) {
      e.preventDefault();
      store.move(i, i + 1);
    }
  };

  return (
    <div className="sheet">
      <table className="cues">
        <colgroup>
          <col className="c-handle" />
          <col className="c-n" />
          <col className="c-time" />
          <col className="c-len" />
          <col className="c-seg" />
          <col className="c-title" />
          <col className="c-who" />
          <col className="c-hint" />
          <col className="c-notes" />
          <col className="c-com" />
        </colgroup>
        <thead>
          <tr>
            <th aria-label="Drag to reorder" />
            <th className="num">#</th>
            <th>Start</th>
            <th>Length</th>
            <th>Type</th>
            <th>Cue</th>
            <th>Who</th>
            <th className="th-hint">Lumora</th>
            <th className="th-notes">Notes</th>
            <th aria-label="Comments" />
          </tr>
        </thead>
        <tbody ref={listRef}>
          {cues.map((c, i) => {
            const t = sched.rows[i]!;
            const section = c.section && c.section !== cues[i - 1]?.section ? c.section : null;
            return [
              section ? (
                <tr key={`s-${c.id}`} className="cues__section">
                  <td colSpan={10}>{section}</td>
                </tr>
              ) : null,
              <tr
                key={c.id}
                data-reorder
                className={`cues__row${sel === c.id ? ' is-sel' : ''}${onNow === i ? ' is-now' : ''}${c.segment === 'break' ? ' is-break' : ''}${rowClass(i)}`}
                onClick={() => onSel(c.id)}
                onFocus={() => sel !== c.id && onSel(c.id)}
                onKeyDown={(e) => keys(e, i)}
              >
                <td
                  className={`handle${canEdit ? '' : ' handle--off'}`}
                  {...handle(i)}
                  title={canEdit ? 'Drag to reorder (or Alt+↑/↓)' : undefined}
                  aria-hidden="true"
                >
                  {canEdit && <span className="grip" />}
                </td>
                <td className="num mono">{i + 1}</td>
                <td className={`mono${t.fixed ? ' is-fixed' : ''}`}>
                  {canEdit ? (
                    <ClockInput
                      className="cell mono"
                      value={c.startTime}
                      placeholder={t.start !== null ? clock12(t.start) : ''}
                      label={`Start of cue ${i + 1}`}
                      onChange={(v) => store.editCue(c.id, { startTime: v })}
                    />
                  ) : (
                    <span className="cell-text">{t.start !== null ? clock12(t.start) : ''}</span>
                  )}
                  {t.drift !== null && t.drift !== 0 && (
                    <span
                      className={`drift ${t.drift < 0 ? 'drift--over' : ''}`}
                      title={t.drift < 0 ? 'The cue before runs past this time' : 'A gap before this cue'}
                    >
                      {t.drift < 0 ? `−${formatDuration(-t.drift)}` : `+${formatDuration(t.drift)}`}
                    </span>
                  )}
                </td>
                <td className="mono">
                  <DurationInput
                    className="cell mono"
                    value={c.durationSec}
                    readOnly={!canEdit}
                    placeholder="—"
                    label={`Length of cue ${i + 1}`}
                    onChange={(v) => store.editCue(c.id, { durationSec: v })}
                  />
                </td>
                <td>
                  <select
                    className="cell cell--seg"
                    value={c.segment}
                    disabled={!canEdit}
                    aria-label={`Type of cue ${i + 1}`}
                    onChange={(e) => store.editCue(c.id, { segment: e.target.value as Segment })}
                  >
                    {SEGMENTS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="cell cell--title"
                    value={c.title}
                    maxLength={120}
                    readOnly={!canEdit}
                    placeholder={segmentName(c.segment)}
                    aria-label={`Cue ${i + 1}`}
                    onChange={(e) => store.editCue(c.id, { title: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="cell"
                    value={c.who}
                    maxLength={80}
                    readOnly={!canEdit}
                    aria-label={`Who for cue ${i + 1}`}
                    onChange={(e) => store.editCue(c.id, { who: e.target.value })}
                  />
                </td>
                <td className="cell-text hint">{hintText(c)}</td>
                <td className="cell-text notes">{c.notes.split('\n')[0]}</td>
                <td className="num com">{commentCount.get(c.id) ? <span className="com__n">{commentCount.get(c.id)}</span> : null}</td>
              </tr>,
            ];
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} />
            <td className="mono">
              <b>{formatDuration(sched.totalSec) || '0:00'}</b>
            </td>
            <td colSpan={6} className="muted">
              {cues.length === 0 ? (canEdit ? 'No cues yet: Add cue starts the list.' : 'No cues yet.') : 'Total planned length'}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
