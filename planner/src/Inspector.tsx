import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Trash2, X } from 'lucide-react';
import { ClockInput, DurationInput, MinSecInput, TimeInput } from './fields';
import { SEGMENTS, TRANSITION_NAMES, clock12, formatDuration, type PlanComment, type PlanCue, type Schedule, type Segment } from './model';
import type { PlanStore } from './usePlan';

/** "Camera 1 · Fade · Lower third" — the Lumora hints in short. */
export function hintText(c: PlanCue): string {
  return [c.input, c.transition, c.overlay]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' · ');
}

/** "Eli Cohen" → "EC". */
export const initials = (n: string): string =>
  n
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/**
 * Everything about one cue, and its comments: in the side panel on larger
 * screens, in a full-screen sheet on phones (`phone`: the sheet has its own
 * header with Back and the move buttons, and the fields use the phone's
 * time picker and number keypad).
 */
export function Inspector({
  cue,
  index,
  count,
  store,
  canEdit,
  comments,
  me,
  isOwner,
  timed,
  onSel,
  phone = false,
}: {
  cue: PlanCue;
  index: number;
  count: number;
  store: PlanStore;
  canEdit: boolean;
  comments: PlanComment[];
  me: string;
  isOwner: boolean;
  timed: Schedule['rows'][number] | undefined;
  onSel: (id: string | null) => void;
  phone?: boolean;
}) {
  const set = (change: Partial<PlanCue>) => store.editCue(cue.id, change);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = () => {
    if (!text.trim()) return;
    setBusy(true);
    setErr('');
    store
      .comment(cue.id, text)
      .then(() => setText(''))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="inspector__in">
      {!phone && (
        <div className="inspector__head">
          <div className="inspector__id">
            <b>
              Cue {index + 1} <span className="muted">of {count}</span>
            </b>
            <span className="muted small mono">
              {timed?.start != null && clock12(timed.start)}
              {timed?.end != null && `–${clock12(timed.end)}`}
              {timed && ` · ${formatDuration(timed.elapsed)} in`}
            </span>
          </div>
          <button type="button" className="btn btn--quiet btn--icon" onClick={() => onSel(null)} aria-label="Close cue details" title="Close">
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      )}
      {phone && timed?.start != null && (
        <p className="muted small">
          {clock12(timed.start)}
          {timed.end != null && `–${clock12(timed.end)}`}
          {` · ${formatDuration(timed.elapsed)} into the show`}
        </p>
      )}
      <label className="field">
        <span>Cue</span>
        <input
          className="input input--title"
          value={cue.title}
          maxLength={120}
          readOnly={!canEdit}
          placeholder="Untitled cue"
          onChange={(e) => set({ title: e.target.value })}
        />
      </label>
      <div className="grid2">
        <label className="field">
          <span>Section</span>
          <input
            className="input"
            value={cue.section}
            maxLength={60}
            readOnly={!canEdit}
            placeholder="e.g. Opening"
            onChange={(e) => set({ section: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Type</span>
          <select className="input" value={cue.segment} disabled={!canEdit} onChange={(e) => set({ segment: e.target.value as Segment })}>
            {SEGMENTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid2 insp-group">
        <h4 className="insp-group__title">Timing</h4>
        <label className="field">
          <span>Fixed start (optional)</span>
          {phone ? (
            <>
              <span className="row">
                <TimeInput value={cue.startTime} readOnly={!canEdit} label="Fixed start" className="input grow" onChange={(v) => set({ startTime: v })} />
                {canEdit && cue.startTime && (
                  <button type="button" className="btn" onClick={() => set({ startTime: '' })}>
                    Clear
                  </button>
                )}
              </span>
              {!cue.startTime && <span className="muted small">Empty: starts when the cue before ends.</span>}
            </>
          ) : (
            <ClockInput
              value={cue.startTime}
              readOnly={!canEdit}
              placeholder="after the cue before"
              label="Fixed start"
              onChange={(v) => set({ startTime: v })}
            />
          )}
        </label>
        {phone ? (
          <div className="field">
            <span>Length</span>
            <MinSecInput value={cue.durationSec} readOnly={!canEdit} label="Length" onChange={(v) => set({ durationSec: v })} />
          </div>
        ) : (
          <label className="field">
            <span>Length</span>
            <DurationInput
              value={cue.durationSec}
              readOnly={!canEdit}
              placeholder="Minutes, e.g. 5 or 4:30"
              label="Length"
              onChange={(v) => set({ durationSec: v })}
            />
          </label>
        )}
      </div>
      <label className="field">
        <span>Who</span>
        <input
          className="input"
          value={cue.who}
          maxLength={80}
          readOnly={!canEdit}
          placeholder="Person or role responsible"
          onChange={(e) => set({ who: e.target.value })}
        />
      </label>
      <fieldset className="hints">
        <legend>In Lumora</legend>
        <label className="field">
          <span>Input on Live</span>
          <input
            className="input"
            value={cue.input}
            maxLength={80}
            readOnly={!canEdit}
            placeholder="Input name, e.g. Camera 1"
            onChange={(e) => set({ input: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Title or overlay</span>
          <input
            className="input"
            value={cue.overlay}
            maxLength={80}
            readOnly={!canEdit}
            placeholder="Overlay input or preset name, or “Overlay 2”"
            onChange={(e) => set({ overlay: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Transition</span>
          <input
            className="input"
            list="planner-transitions"
            value={cue.transition}
            maxLength={40}
            readOnly={!canEdit}
            placeholder="Cut"
            onChange={(e) => set({ transition: e.target.value })}
          />
          <datalist id="planner-transitions">
            {TRANSITION_NAMES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <p className="muted small">Names are matched to the inputs, overlays and presets in the Lumora event when the plan is loaded.</p>
      </fieldset>
      <label className="field insp-group">
        <span>Notes</span>
        <textarea className="input" rows={4} maxLength={4000} value={cue.notes} readOnly={!canEdit} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      {canEdit && (
        <div className="row row--wrap insp-actions">
          {!phone && (
            <>
              <button type="button" className="btn" disabled={index === 0} onClick={() => store.move(index, index - 1)}>
                <ArrowUp size={14} strokeWidth={1.75} aria-hidden="true" />
                Move up
              </button>
              <button type="button" className="btn" disabled={index === count - 1} onClick={() => store.move(index, index + 1)}>
                <ArrowDown size={14} strokeWidth={1.75} aria-hidden="true" />
                Move down
              </button>
            </>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => {
              const id = store.duplicateCue(cue.id);
              if (id) onSel(id);
            }}
          >
            <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
            Duplicate
          </button>
          <span className="bar__spacer" />
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              if (comments.length && !confirm('Delete this cue and its comments?')) return;
              store.deleteCue(cue.id);
            }}
          >
            <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
            Delete cue
          </button>
        </div>
      )}
      {cue.updatedBy && (
        <p className="muted small">
          Last changed by {cue.updatedBy}
          {cue.updatedAt ? `, ${new Date(cue.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
        </p>
      )}

      <section className="comments" aria-label="Comments">
        <h3>Comments{comments.length ? ` (${comments.length})` : ''}</h3>
        {comments.map((c) => (
          <div key={c.id} className="comment">
            <div className="comment__head">
              <b>{c.authorName || 'Someone'}</b>
              <span className="muted small">
                {new Date(c.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
              <span className="bar__spacer" />
              {(c.author === me || isOwner) && (
                <button type="button" className="link" onClick={() => store.uncomment(c.id)}>
                  Delete
                </button>
              )}
            </div>
            <p>{c.text}</p>
          </div>
        ))}
        <textarea
          className="input"
          rows={2}
          maxLength={2000}
          value={text}
          placeholder={phone ? 'Write a comment' : 'Write a comment (Ctrl+Enter sends)'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
          }}
          aria-label="New comment"
        />
        {err && <p className="warn small">{err}</p>}
        <div className="row">
          <button type="button" className="btn" disabled={busy || !text.trim()} onClick={send}>
            Comment
          </button>
        </div>
      </section>
    </div>
  );
}
