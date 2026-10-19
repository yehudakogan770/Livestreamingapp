import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

P = 'planner/src/PlanView.tsx'
apply(P, [
("""/** On the event day: what is on now and how long it has left; otherwise how far away the event is. */""",
"""function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" className="popover__item" onClick={onClick}>
      {children}
    </button>
  );
}

/** How the planned end compares with the time the show must end by. */
function EndBy({ endSec, endBy }: { endSec: number; endBy: number }) {
  // The end-by time is on the event day, or just after midnight.
  const target = endBy < endSec - 12 * 3600 ? endBy + 86_400 : endBy;
  const d = endSec - target;
  if (Math.abs(d) < 30) return <span>On time for {clock12(endBy)}</span>;
  return (
    <span className={d > 0 ? 'warn-text' : 'muted'} title={`The show must end by ${clock12(endBy)}`}>
      <b>{formatDuration(Math.abs(d))}</b> {d > 0 ? 'over' : 'under'} the {clock12(endBy)} end
    </span>
  );
}

/** Choose what to print. */
function PrintChooser({ onPick, onClose, canBudget }: { onPick: (l: PrintLayout) => void; onClose: () => void; canBudget: boolean }) {
  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-label="Print" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog__box">
        <header className="dialog__head">
          <h2>Print or save as PDF</h2>
          <button type="button" className="btn btn--quiet btn--icon" onClick={onClose} aria-label="Close" title="Close">
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>
        <div className="dialog__body">
          <div className="choices">
            {PRINT_LAYOUTS.map((l) => (
              <button key={l.id} type="button" className="choice" onClick={() => onPick(l.id)}>
                <b>{l.name}</b>
                <span className="muted small">{l.id === 'lists' && !canBudget ? l.what.replace(/ \\(and the budget.*\\)/, '') : l.what}</span>
              </button>
            ))}
          </div>
          <p className="muted small">To save a PDF, choose “Save as PDF” as the printer.</p>
        </div>
      </div>
    </div>
  );
}

/** On the event day: what is on now and how long it has left; otherwise how far away the event is. */"""),
# CueSheet props
("""  canEdit,
  onNow,
  commentCount,
  hasStart,
  onOpen,
}: {
  store: PlanStore;
  sched: Schedule;
  sel: string | null;
  onSel: (id: string | null) => void;
  canEdit: boolean;
  onNow: number | null;""",
"""  canEdit,
  editable = () => canEdit,
  columns = [],
  onNow,
  commentCount,
  hasStart,
  onOpen,
}: {
  store: PlanStore;
  sched: Schedule;
  sel: string | null;
  onSel: (id: string | null) => void;
  canEdit: boolean;
  /** May this cue be changed here (its section may be locked)? */
  editable?: (c: PlanCue) => boolean;
  /** The plan's extra columns. */
  columns?: CustomColumn[];
  onNow: number | null;"""),
("""          <col className="c-notes" />
          <col className="c-com" />
        </colgroup>""",
"""          <col className="c-notes" />
          {columns.map((c) => (
            <col key={c.id} className="c-extra" />
          ))}
          <col className="c-com" />
        </colgroup>"""),
("""            <th className="th-notes">Notes</th>
            <th aria-label="Comments" />""",
"""            <th className="th-notes">Notes</th>
            {columns.map((c) => (
              <th key={c.id} className="th-extra">
                {c.name}
              </th>
            ))}
            <th aria-label="Comments" />"""),
("""                extra={rowClass(i)}
                canEdit={canEdit}""",
"""                extra={rowClass(i)}
                canEdit={editable(c)}
                columns={columns}"""),
("""            <td colSpan={6} className="muted">""",
"""            <td colSpan={6 + columns.length} className="muted">"""),
("""  comments,
  canOpen,
  act,
}: {
  c: PlanCue;""",
"""  comments,
  canOpen,
  act,
  columns,
}: {
  columns: CustomColumn[];
  c: PlanCue;"""),
("""        <tr className="cues__section">
          <td colSpan={10}>{section}</td>""",
"""        <tr className="cues__section">
          <td colSpan={10 + columns.length}>{section}</td>"""),
("""        className={`cues__row${isSel ? ' is-sel' : ''}${isNow ? ' is-now' : ''}${c.segment === 'break' ? ' is-break' : ''}${extra}`}""",
"""        className={`cues__row${isSel ? ' is-sel' : ''}${isNow ? ' is-now' : ''}${c.segment === 'break' ? ' is-break' : ''}${c.skip ? ' is-skip' : ''}${c.color ? ` cue--${c.color}` : ''}${extra}`}"""),
("""        <td className="cell-text notes">{c.notes.split('\\n')[0]}</td>""",
"""        <td className="cell-text notes">{c.notes.split('\\n')[0]}</td>
        {columns.map((col) => (
          <td key={col.id} className="extra">
            <input
              className="cell"
              value={c.custom[col.id] ?? ''}
              maxLength={200}
              readOnly={!canEdit}
              aria-label={`${col.name} for cue ${i + 1}`}
              onChange={(e) => act.edit(c.id, { custom: { ...c.custom, [col.id]: e.target.value } })}
            />
          </td>
        ))}"""),
])

# The skipped cue: time cell
apply(P, [
("""          ) : (
            <span className="cell-text">{start !== null ? clock12(start) : ''}</span>
          )}""",
"""          ) : (
            <span className="cell-text">{start !== null && !c.skip ? clock12(start) : ''}</span>
          )}
          {c.skip && <span className="drift drift--float">floated</span>}"""),
])

# CueRow memo needs columns compare: default shallow compare is fine (same array object).

U = 'planner/src/usePlan.ts'
apply(U, [
("""  editPlan: (change: api.PlanChange) => void;""",
"""  editPlan: (change: api.PlanChange) => void;
  /** Change the plan here only (what the server already changed, like the public link). */
  patchPlan: (change: Partial<Plan>) => void;"""),
("""  const editCue = useCallback(""",
"""  const patchPlan = useCallback((change: Partial<Plan>) => setPlan((p) => (p ? { ...p, ...change } : p)), []);

  const editCue = useCallback("""),
("""    editPlan,
    editCue,""",
"""    editPlan,
    patchPlan,
    editCue,"""),
])
