import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

P = 'planner/src/PlanView.tsx'
apply(P, [
# CueSheet props
("""  editable = () => canEdit,
  columns = [],
  onNow,
  commentCount,
  hasStart,
  onOpen,
}: {
  store: PlanStore;""",
"""  editable = () => canEdit,
  columns: allColumns = [],
  hidden = '',
  onNow,
  commentCount,
  hasStart,
  onOpen,
}: {
  /** Columns this person hid ("type,who,hint,notes" and extra columns' ids). */
  hidden?: string;
  store: PlanStore;"""),
("""          <col className="c-seg" />
          <col className="c-title" />
          <col className="c-who" />
          <col className="c-hint" />
          <col className="c-notes" />""",
"""          {!off('type') && <col className="c-seg" />}
          <col className="c-title" />
          {!off('who') && <col className="c-who" />}
          {!off('hint') && <col className="c-hint" />}
          {!off('notes') && <col className="c-notes" />}"""),
("""            <th className="th-type">Type</th>
            <th>Cue</th>
            <th>Who</th>
            <th className="th-hint">Lumora</th>
            <th className="th-notes">Notes</th>""",
"""            {!off('type') && <th className="th-type">Type</th>}
            <th>Cue</th>
            {!off('who') && <th>Who</th>}
            {!off('hint') && <th className="th-hint">Lumora</th>}
            {!off('notes') && <th className="th-notes">Notes</th>}"""),
("""                canEdit={editable(c)}
                columns={columns}
                comments={commentCount.get(c.id) ?? 0}""",
"""                canEdit={editable(c)}
                columns={columns}
                hidden={hidden}
                comments={commentCount.get(c.id) ?? 0}"""),
("""            <td colSpan={6 + columns.length} className="muted">""",
"""            <td colSpan={6 + columns.length - baseOff} className="muted">"""),
("""  comments,
  canOpen,
  act,
  columns,
}: {
  columns: CustomColumn[];""",
"""  comments,
  canOpen,
  act,
  columns,
  hidden,
}: {
  columns: CustomColumn[];
  hidden: string;"""),
("""          <td colSpan={10 + columns.length}>{section}</td>""",
"""          <td colSpan={10 + columns.length - BASE_COLUMNS.filter((k) => hidden.split(',').includes(k)).length}>{section}</td>"""),
("""        <td className="type">
          <select""",
"""        {!hidden.split(',').includes('type') && (
        <td className="type">
          <select"""),
("""            {SEGMENTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </td>
        <td>
          <input
            className="cell cell--title\"""",
"""            {SEGMENTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </td>
        )}
        <td>
          <input
            className="cell cell--title\""""),
("""        <td>
          <input
            className="cell"
            value={c.who}
            maxLength={80}
            readOnly={!canEdit}
            aria-label={`Who for cue ${i + 1}`}
            onChange={(e) => act.edit(c.id, { who: e.target.value })}
          />
        </td>
        <td className="cell-text hint">{hintText(c)}</td>
        <td className="cell-text notes">{c.notes.split('\\n')[0]}</td>""",
"""        {!hidden.split(',').includes('who') && (
          <td>
            <input
              className="cell"
              value={c.who}
              maxLength={80}
              readOnly={!canEdit}
              aria-label={`Who for cue ${i + 1}`}
              onChange={(e) => act.edit(c.id, { who: e.target.value })}
            />
          </td>
        )}
        {!hidden.split(',').includes('hint') && <td className="cell-text hint">{hintText(c)}</td>}
        {!hidden.split(',').includes('notes') && <td className="cell-text notes">{c.notes.split('\\n')[0]}</td>}"""),
])

# Helpers inside CueSheet: off(), columns filtered, baseOff
apply(P, [
("""  const { cues } = store;
  // Rows drag only by their handle""",
"""  const { cues } = store;
  const hiddenList = hidden.split(',');
  const off = (k: string) => hiddenList.includes(k);
  const columns = useMemo(() => allColumns.filter((c) => !hiddenList.includes(c.id)), [allColumns, hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  const baseOff = BASE_COLUMNS.filter(off).length;
  // Rows drag only by their handle"""),
("""interface RowActions {""",
"""/** The cue sheet's columns a person can hide (besides the extra ones). */
export const BASE_COLUMNS = ['type', 'who', 'hint', 'notes'] as const;
const BASE_NAMES: Record<(typeof BASE_COLUMNS)[number], string> = { type: 'Type', who: 'Who', hint: 'Lumora', notes: 'Notes' };

/** The columns this person hid on this plan (kept on this device). */
function useHidden(planId: string): [string, (v: string) => void] {
  const key = `lumora.planner.hide.${planId}`;
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  });
  const set = (next: string) => {
    setV(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Not remembered: fine.
    }
  };
  return [v, set];
}

/** Which columns show on the cue sheet (for this person, on this device). */
function ColumnsMenu({ hidden, onChange, columns }: { hidden: string; onChange: (v: string) => void; columns: CustomColumn[] }) {
  const [open, setOpen] = useState(false);
  const list = hidden.split(',').filter(Boolean);
  const toggle = (k: string) => onChange((list.includes(k) ? list.filter((x) => x !== k) : [...list, k]).join(','));
  return (
    <div className="account">
      <button type="button" className={`btn btn--quiet${list.length ? ' is-on' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Columns3 size={15} strokeWidth={1.75} aria-hidden="true" />
        Columns{list.length ? ` (${list.length} hidden)` : ''}
      </button>
      {open && (
        <div className="popover popover--menu" role="menu" aria-label="Columns" onMouseLeave={() => setOpen(false)}>
          <p className="muted small popover__note">What you see on this device; others keep their own.</p>
          {[...BASE_COLUMNS.map((k) => [k, BASE_NAMES[k]] as const), ...columns.map((c) => [c.id, c.name || 'Untitled column'] as const)].map(([k, name]) => (
            <label key={k} className="popover__item popover__check">
              <input type="checkbox" checked={!list.includes(k)} onChange={() => toggle(k)} />
              {name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

interface RowActions {"""),
])

# Use it in PlanView
apply(P, [
("""  const [printLayout, setPrintLayout] = useState<PrintLayout>('run');""",
"""  const [printLayout, setPrintLayout] = useState<PrintLayout>('run');
  const [hidden, setHidden] = useHidden(planId);"""),
("""              canEdit={canEdit}
              editable={editable}
              columns={plan.columns}""",
"""              canEdit={canEdit}
              editable={editable}
              columns={plan.columns}
              hidden={hidden}"""),
("""          {(tab === 'run' || tab === 'chat') && canEdit && (
            <button
              type="button\"""",
"""          {(tab === 'run' || tab === 'chat') && <ColumnsMenu hidden={hidden} onChange={setHidden} columns={plan.columns} />}
          {(tab === 'run' || tab === 'chat') && canEdit && (
            <button
              type="button\""""),
("""import { Check, ChevronRight, CircleAlert, Ellipsis,""",
"""import { Check, ChevronRight, CircleAlert, Columns3, Ellipsis,"""),
])
