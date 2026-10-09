// The plan's dialogs: versions (history), importing a sheet, the plan's
// settings (time zone, end by, extra columns), keyboard shortcuts.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, FileSpreadsheet, History, Plus, Trash2, X } from 'lucide-react';
import * as pro from './apiPro';
import { COMMON_ZONES, MAX_COLUMNS, localZone, validZone, zoneAbbr, type CustomColumn, type Plan, type PlanCue } from './model';
import { ClockInput } from './fields';
import { diffCues, diffWords } from './versions';
import { parseCsv, readXlsx, rowsToCues, type Imported } from './csv';
import { db } from './session';
import { useBackToClose } from './touch';

/** A dialog box: Esc and the backdrop close it. */
export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useBackToClose(true, onClose);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog__box${wide ? ' dialog__box--wide' : ''}`}>
        <header className="dialog__head">
          <h2>{title}</h2>
          <button type="button" className="btn btn--quiet btn--icon" onClick={onClose} aria-label="Close" title="Close">
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>
        <div className="dialog__body">{children}</div>
      </div>
    </div>
  );
}

const when = (ms: number) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Versions: saved by hand, and kept automatically before each round of edits (and before a restore). */
export function VersionsDialog({ plan, cues, canEdit, isOwner, onClose }: { plan: Plan; cues: PlanCue[]; canEdit: boolean; isOwner: boolean; onClose: () => void }) {
  const [list, setList] = useState<pro.Version[] | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [content, setContent] = useState<pro.VersionContent | null>(null);
  const refresh = () =>
    pro
      .listVersions(db(), plan.id)
      .then(setList)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    void refresh();
  }, [plan.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setContent(null);
    if (!open) return;
    let on = true;
    pro
      .loadVersion(db(), open)
      .then((c) => on && setContent(c))
      .catch((e: unknown) => on && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      on = false;
    };
  }, [open]);
  const diff = useMemo(() => (content ? diffCues(content.cues, cues) : null), [content, cues]);
  const run = (p: Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError('');
    p.then(() => {
      after?.();
      return refresh();
    })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const v = list?.find((x) => x.id === open);
  return (
    <Dialog title="Versions" onClose={onClose} wide>
      {canEdit && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            run(pro.saveVersion(db(), plan.id, name || 'Saved version'), () => setName(''));
          }}
        >
          <input
            className="input grow"
            value={name}
            maxLength={120}
            placeholder="Name this version, e.g. Sent to the client"
            onChange={(e) => setName(e.target.value)}
            aria-label="Version name"
          />
          <button type="submit" className="btn btn--primary" disabled={busy}>
            Save a version
          </button>
        </form>
      )}
      <p className="muted small">
        The Planner also keeps a version by itself before each round of changes (after half an hour with none), and before a version is restored.
      </p>
      {error && <p className="warn">{error}</p>}
      <div className="versions">
        <ul className="versions__list" aria-label="Saved versions">
          {list === null && <li className="muted">Loading…</li>}
          {list?.length === 0 && <li className="muted">No versions yet.</li>}
          {list?.map((x) => (
            <li key={x.id}>
              <button type="button" className={`versions__item${open === x.id ? ' is-on' : ''}`} onClick={() => setOpen(x.id)} aria-pressed={open === x.id}>
                <History size={14} strokeWidth={1.75} aria-hidden="true" />
                <span className="grow">
                  <b>{x.name || 'Untitled version'}</b>
                  <span className="muted small">
                    {when(x.createdAt)}
                    {x.createdBy && ` · ${x.createdBy}`} · {x.cueCount} cue{x.cueCount === 1 ? '' : 's'}
                    {x.auto && ' · automatic'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="versions__view">
          {!v ? (
            <p className="muted">Choose a version to see what has changed since, and to put it back.</p>
          ) : !content || !diff ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <h3>{v.name || 'Untitled version'}</h3>
              <p>
                <b>{diffWords(diff)}</b> <span className="muted">since {when(v.createdAt)}.</span>
              </p>
              {(content.plan.name !== plan.name || content.plan.eventDate !== plan.eventDate || content.plan.startTime !== plan.startTime) && (
                <p className="small muted">The event’s name, date or start time differ too.</p>
              )}
              <ul className="versions__diff">
                {diff.changed.slice(0, 30).map((c) => (
                  <li key={c.id}>
                    <b>{c.title}</b>: <span className="muted">{c.what.join(', ')}</span>
                  </li>
                ))}
                {diff.added.slice(0, 15).map((t, i) => (
                  <li key={`a${i}`}>
                    <b>{t}</b>: <span className="muted">added since</span>
                  </li>
                ))}
                {diff.removed.slice(0, 15).map((t, i) => (
                  <li key={`r${i}`}>
                    <b>{t}</b>: <span className="muted">deleted since (restoring brings it back)</span>
                  </li>
                ))}
              </ul>
              <div className="row row--wrap">
                {canEdit && (
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Put the plan back as it was in “${v.name || 'this version'}”? Its cues and schedule replace the ones now (the plan as it is now is kept as a version first).`))
                        run(pro.restoreVersion(db(), v.id), onClose);
                    }}
                  >
                    Restore this version
                  </button>
                )}
                {isOwner && (
                  <button
                    type="button"
                    className="btn btn--quiet btn--danger"
                    disabled={busy}
                    onClick={() => confirm('Delete this version?') && run(pro.deleteVersion(db(), v.id), () => setOpen(null))}
                  >
                    Delete version
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Import cues from a spreadsheet: a CSV or Excel file, or rows pasted from
 * Google Sheets, Excel or Numbers. Shows what each column is read as before
 * adding the cues.
 */
export function ImportDialog({
  plan,
  onAdd,
  onAddColumns,
  onClose,
}: {
  plan: Plan;
  onAdd: (cues: Partial<PlanCue>[]) => void;
  onAddColumns: (cols: CustomColumn[]) => CustomColumn[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [makeCols, setMakeCols] = useState(true);
  const pick = useRef<HTMLInputElement>(null);
  const read = async (f: File) => {
    setError('');
    try {
      if (/\.xlsx$/i.test(f.name)) setRows(await readXlsx(new Uint8Array(await f.arrayBuffer())));
      else if (/\.xls$/i.test(f.name)) setError('That is an old Excel file (.xls). Save it as .xlsx or CSV, then import it.');
      else setRows(parseCsv(await f.text()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const result: Imported | null = useMemo(() => (rows ? rowsToCues(rows, plan.columns) : null), [rows, plan.columns]);
  const room = MAX_COLUMNS - plan.columns.length;
  const newCols = result ? result.extra.filter((h) => !plan.columns.some((c) => c.name.trim().toLowerCase() === h.toLowerCase())) : [];
  const FIELD_WORDS: Record<string, string> = {
    title: 'Cue',
    section: 'Section',
    start: 'Start (times only)',
    fixed: 'Fixed start',
    length: 'Length',
    end: 'End (for the length)',
    segment: 'Type',
    who: 'Who',
    input: 'Input',
    transition: 'Transition',
    overlay: 'Title or overlay',
    notes: 'Notes',
    script: 'Script',
    color: 'Color',
    skip: 'Floated',
    skipnum: 'Not needed (numbers)',
    extra: 'Extra column',
  };
  return (
    <Dialog title="Import cues" onClose={onClose} wide>
      {!rows ? (
        <>
          <p>Bring in a run of show from a spreadsheet or another rundown tool. The first row should name the columns (Cue, Length, Who, Notes…).</p>
          <div className="row row--wrap">
            <button type="button" className="btn btn--primary" onClick={() => pick.current?.click()}>
              <FileSpreadsheet size={15} strokeWidth={1.75} aria-hidden="true" />
              Choose a CSV or Excel file
            </button>
            <input ref={pick} type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv" hidden onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
          </div>
          <label className="field">
            <span>Or paste rows from Google Sheets, Excel or Numbers</span>
            <textarea className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Cue\tLength\tWho\nWelcome\t5:00\tDana'} />
          </label>
          <div className="row">
            <button type="button" className="btn" disabled={!text.trim()} onClick={() => setRows(parseCsv(text))}>
              Read the rows
            </button>
          </div>
        </>
      ) : result && result.cues.length === 0 ? (
        <>
          <p className="warn">No cues found in that sheet. Each row needs at least a cue name or a length.</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => setRows(null)}>
              Try another
            </button>
          </div>
        </>
      ) : (
        result && (
          <>
            <p>
              <b>
                {result.cues.length} cue{result.cues.length === 1 ? '' : 's'}
              </b>{' '}
              will be added at the end of the run of show.
              {result.skipped > 0 && <span className="muted"> ({result.skipped} empty rows left out.)</span>}
            </p>
            {result.mapping.some((m) => m.field) && (
              <table className="import__map">
                <thead>
                  <tr>
                    <th>Column in the sheet</th>
                    <th>Read as</th>
                  </tr>
                </thead>
                <tbody>
                  {result.mapping.map((m, i) => (
                    <tr key={i}>
                      <td>{m.header || <i className="muted">(no name)</i>}</td>
                      <td className={m.field ? '' : 'muted'}>
                        {m.field === 'extra' && !makeCols ? 'Left out' : m.field ? FIELD_WORDS[m.field] : 'Left out'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {newCols.length > 0 && (
              <label className="row small">
                <input type="checkbox" checked={makeCols} onChange={(e) => setMakeCols(e.target.checked)} disabled={room <= 0} />
                {room > 0
                  ? `Add ${Math.min(room, newCols.length)} extra column${newCols.length === 1 ? '' : 's'} to the sheet (${newCols.slice(0, room).join(', ')})`
                  : 'This plan already has 12 extra columns: the other columns are left out.'}
              </label>
            )}
            <ol className="import__preview">
              {result.cues.slice(0, 8).map((c, i) => (
                <li key={i}>
                  <b>{c.title || 'Untitled cue'}</b>
                  <span className="muted small">{[c.section, c.who, c.durationSec != null ? `${Math.round(c.durationSec / 60)} min` : ''].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
              {result.cues.length > 8 && <li className="muted">and {result.cues.length - 8} more…</li>}
            </ol>
            <div className="row">
              <button type="button" className="btn" onClick={() => setRows(null)}>
                Back
              </button>
              <span className="bar__spacer" />
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  let cols = plan.columns;
                  if (makeCols && newCols.length && room > 0) cols = onAddColumns(newCols.slice(0, room).map((name) => ({ id: colId(name), name: name.slice(0, 40) })));
                  // Values for columns made just now.
                  const again = rows ? rowsToCues(rows, cols) : result;
                  onAdd(again.cues);
                  onClose();
                }}
              >
                Add {result.cues.length} cue{result.cues.length === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )
      )}
      {error && <p className="warn">{error}</p>}
    </Dialog>
  );
}

/** A short id for an extra column. */
export const colId = (name: string): string =>
  `${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20) || 'col'}-${Math.random().toString(36).slice(2, 6)}`;

/** The plan's settings: time zone, "end by", extra columns, template. */
export function PlanSettings({
  plan,
  canEdit,
  onChange,
  onClose,
}: {
  plan: Plan;
  canEdit: boolean;
  onChange: (change: Partial<Pick<Plan, 'timeZone' | 'endBy' | 'columns' | 'isTemplate'>>) => void;
  onClose: () => void;
}) {
  const [cols, setCols] = useState<CustomColumn[]>(plan.columns);
  const [zone, setZone] = useState(plan.timeZone);
  const here = localZone();
  const zoneOk = !zone || validZone(zone);
  const saveCols = (next: CustomColumn[]) => {
    setCols(next);
    onChange({ columns: next.filter((c) => c.name.trim()).map((c) => ({ ...c, name: c.name.trim() })) });
  };
  return (
    <Dialog title="Plan settings" onClose={onClose}>
      <label className="field">
        <span>Time zone of the event</span>
        <input
          className={`input${zoneOk ? '' : ' is-bad'}`}
          list="planner-zones"
          value={zone}
          readOnly={!canEdit}
          placeholder={here ? `As each person’s device (yours: ${here.replace(/_/g, ' ')})` : 'As each person’s device'}
          onChange={(e) => setZone(e.target.value)}
          onBlur={() => {
            const z = zone.trim();
            if (!z || validZone(z)) onChange({ timeZone: z });
          }}
          aria-invalid={!zoneOk || undefined}
        />
        <datalist id="planner-zones">
          {COMMON_ZONES.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, ' ')} ({zoneAbbr(z)})
            </option>
          ))}
        </datalist>
        <span className="muted small">
          {zoneOk
            ? zone
              ? `Times in this plan are ${zoneAbbr(zone)} (${zone.replace(/_/g, ' ')}). The show clock, the calendar feed and the countdown use it, wherever people are.`
              : 'Set it when the team is in more than one time zone (for a remote crew, or a stream watched elsewhere).'
            : 'Not a time zone this browser knows: pick one from the list, like America/Chicago.'}
        </span>
      </label>
      <label className="field">
        <span>The show must end by (optional)</span>
        <ClockInput value={plan.endBy} readOnly={!canEdit} placeholder="e.g. 9:30 PM" label="End by" onChange={(v) => onChange({ endBy: v })} />
        <span className="muted small">The run of show says how far over or under this time the plan runs.</span>
      </label>
      <fieldset className="hints">
        <legend>Extra columns on the cue sheet</legend>
        <p className="muted small">For what your team tracks: Camera, Audio, Lights, Mic, Wardrobe… (up to {MAX_COLUMNS}).</p>
        {cols.map((c, i) => (
          <div key={c.id} className="row">
            <input
              className="input grow"
              value={c.name}
              maxLength={40}
              readOnly={!canEdit}
              aria-label={`Column ${i + 1} name`}
              onChange={(e) => setCols(cols.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))}
              onBlur={() => saveCols(cols)}
            />
            {canEdit && (
              <>
                <button
                  type="button"
                  className="btn btn--quiet btn--icon"
                  disabled={i === 0}
                  onClick={() => saveCols(cols.map((x, j) => (j === i - 1 ? cols[i]! : j === i ? cols[i - 1]! : x)))}
                  aria-label="Move left"
                >
                  <ArrowUp size={14} strokeWidth={1.75} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn btn--quiet btn--icon"
                  disabled={i === cols.length - 1}
                  onClick={() => saveCols(cols.map((x, j) => (j === i + 1 ? cols[i]! : j === i ? cols[i + 1]! : x)))}
                  aria-label="Move right"
                >
                  <ArrowDown size={14} strokeWidth={1.75} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn btn--quiet btn--icon"
                  onClick={() => confirm(`Remove the “${c.name || 'untitled'}” column? What is written in it is kept, and comes back if a column with that name is added again.`) && saveCols(cols.filter((x) => x.id !== c.id))}
                  aria-label={`Remove ${c.name || 'column'}`}
                >
                  <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        ))}
        {canEdit && cols.length < MAX_COLUMNS && (
          <div className="row">
            <button type="button" className="btn" onClick={() => setCols([...cols, { id: colId('col'), name: '' }])}>
              <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
              Add a column
            </button>
          </div>
        )}
      </fieldset>
      {canEdit && (
        <label className="row">
          <input type="checkbox" checked={plan.isTemplate} onChange={(e) => onChange({ isTemplate: e.target.checked })} />
          <span>
            Use this plan as a template <span className="muted small">(it is listed under Templates, for new plans to start from)</span>
          </span>
        </label>
      )}
    </Dialog>
  );
}

/** Every keyboard shortcut, by where it works. */
export const ALL_SHORTCUTS: { where: string; keys: [string, string][] }[] = [
  {
    where: 'Run of show',
    keys: [
      ['N', 'New cue below'],
      ['↑ ↓', 'Move the selection'],
      ['Enter', 'Edit the selected cue'],
      ['Alt+↑ ↓', 'Move the cue up or down'],
      ['D', 'Duplicate the selected cue'],
      ['F', 'Float the selected cue (leave it out of the timing)'],
      ['Esc', 'Close the panel'],
      ['?', 'These shortcuts'],
    ],
  },
  {
    where: 'Calling the show',
    keys: [
      ['Space or →', 'GO: the next cue'],
      ['←', 'Back to the cue before'],
      ['P', 'Pause or resume'],
      ['[ and ]', 'A minute less or more for the cue on now'],
    ],
  },
  {
    where: 'Prompter',
    keys: [
      ['Space', 'Scroll or stop'],
      ['↑ ↓', 'Faster or slower'],
      ['Esc', 'Back'],
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      {ALL_SHORTCUTS.map((g) => (
        <div key={g.where} className="keys">
          <div className="keys__head">{g.where}</div>
          <dl className="keys__list">
            {g.keys.map(([k, what]) => (
              <div key={what} className="keys__row">
                <dt>{what}</dt>
                <dd>
                  <kbd>{k}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </Dialog>
  );
}

