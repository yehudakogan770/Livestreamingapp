import { useMemo, useState, type ReactNode } from 'react';
import { Check, Download, Mail, Phone, Plus, Trash2 } from 'lucide-react';
import { BUDGET_STATUS, GEAR_STATUS, KIND_WORDS, budgetTotals, dollars, listOf, parseMoney, taskCount, type Item, type ItemKind } from './items';
import { ClockInput } from './fields';
import { cueLabel, sortCues, type PlanCue } from './model';
import { personName } from './usePeople';
import type { Person } from './api';
import type { ItemStore } from './useItems';
import { downloadText, itemsToCsv } from './csv';
import './lists.css';

/** Money typed as "1,250" or "$1250.50"; saved when the field is left. */
function MoneyInput({ value, onChange, readOnly, label }: { value: number | null; onChange: (v: number | null) => void; readOnly: boolean; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const bad = draft !== null && parseMoney(draft) === undefined;
  return (
    <input
      className={`cell mono num${bad ? ' is-bad' : ''}`}
      inputMode="decimal"
      value={draft ?? (value === null ? '' : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
      readOnly={readOnly}
      aria-label={label}
      aria-invalid={bad || undefined}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        const v = parseMoney(draft);
        if (v !== undefined) onChange(v);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/**
 * One of the plan's lists as a sheet, edited in place: crew (the call sheet),
 * contacts, tasks, gear or budget.
 */
export function ListView({
  kind,
  store,
  canEdit,
  me,
  cues,
  people,
  planName,
  onCue,
}: {
  kind: ItemKind;
  store: ItemStore;
  canEdit: boolean;
  me: string;
  cues: PlanCue[];
  people: Person[];
  planName: string;
  onCue?: (id: string) => void;
}) {
  const list = useMemo(() => listOf(store.items, kind), [store.items, kind]);
  const words = KIND_WORDS[kind];
  const [mine, setMine] = useState(false);
  const shown = kind === 'task' && mine ? list.filter((t) => t.personId === me) : list;
  const sortedCues = useMemo(() => sortCues(cues), [cues]);
  const set = (id: string) => (change: Partial<Item>) => store.edit(id, change);
  const add = () => {
    const id = store.add(kind);
    setTimeout(() => document.querySelector<HTMLInputElement>(`#item-${id} .cell--first`)?.focus(), 0);
  };

  if (!store.ready)
    return (
      <div className="lists__empty">
        <p>Lists need the Planner’s show-day update on the Lumora account server.</p>
        <p className="muted small">Its owner runs supabase/update-10-planner-pro.sql once.</p>
      </div>
    );

  const head = (cols: ReactNode) => (
    <thead>
      <tr>{cols}</tr>
    </thead>
  );
  const del = (it: Item) =>
    canEdit && (
      <td className="lists__del">
        <button
          type="button"
          className="btn btn--quiet btn--icon"
          onClick={() => store.remove(it.id)}
          aria-label={`Delete ${it.title || words.one}`}
          title="Delete"
        >
          <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </td>
    );
  const text = (it: Item, field: 'title' | 'role' | 'person' | 'phone' | 'email' | 'notes', label: string, max: number, first = false) => (
    <td>
      <input
        className={`cell${first ? ' cell--first' : ''}`}
        value={it[field]}
        maxLength={max}
        readOnly={!canEdit}
        aria-label={label}
        placeholder={first ? `New ${words.one}` : undefined}
        type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
        onChange={(e) => set(it.id)({ [field]: e.target.value })}
      />
    </td>
  );

  let table: ReactNode;
  if (kind === 'crew' || kind === 'contact') {
    table = (
      <table className="lists__table">
        {head(
          <>
            <th>{words.title}</th>
            <th>{words.role}</th>
            {kind === 'crew' && <th className="lists__day">Call day</th>}
            {kind === 'crew' && <th className="lists__time">Call time</th>}
            <th>Phone</th>
            <th>Email</th>
            <th>Notes</th>
            {canEdit && <th aria-label="Delete" />}
          </>,
        )}
        <tbody>
          {shown.map((it) => (
            <tr key={it.id} id={`item-${it.id}`}>
              {text(it, 'title', words.title, 120, true)}
              {text(it, 'role', words.role, 80)}
              {kind === 'crew' && (
                <td>
                  <input
                    type="date"
                    className={`cell mono${it.day ? '' : ' is-empty'}`}
                    value={it.day}
                    readOnly={!canEdit}
                    aria-label="Call day"
                    onChange={(e) => set(it.id)({ day: e.target.value })}
                  />
                </td>
              )}
              {kind === 'crew' && (
                <td>
                  <ClockInput
                    className="cell mono"
                    value={it.callTime}
                    readOnly={!canEdit}
                    label="Call time"
                    placeholder="3:00 PM"
                    onChange={(v) => set(it.id)({ callTime: v })}
                  />
                </td>
              )}
              <td className="lists__contact">
                <input
                  className="cell"
                  type="tel"
                  value={it.phone}
                  maxLength={40}
                  readOnly={!canEdit}
                  aria-label="Phone"
                  onChange={(e) => set(it.id)({ phone: e.target.value })}
                />
                {it.phone && (
                  <a
                    className="lists__act"
                    href={`tel:${it.phone.replace(/[^\d+]/g, '')}`}
                    title={`Call ${it.title || it.phone}`}
                    aria-label={`Call ${it.title || it.phone}`}
                  >
                    <Phone size={13} strokeWidth={1.75} aria-hidden="true" />
                  </a>
                )}
              </td>
              <td className="lists__contact">
                <input
                  className="cell"
                  type="email"
                  value={it.email}
                  maxLength={120}
                  readOnly={!canEdit}
                  aria-label="Email"
                  onChange={(e) => set(it.id)({ email: e.target.value })}
                />
                {it.email && (
                  <a className="lists__act" href={`mailto:${it.email}`} title={`Email ${it.title || it.email}`} aria-label={`Email ${it.title || it.email}`}>
                    <Mail size={13} strokeWidth={1.75} aria-hidden="true" />
                  </a>
                )}
              </td>
              {text(it, 'notes', 'Notes', 2000)}
              {del(it)}
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (kind === 'task') {
    table = (
      <table className="lists__table">
        {head(
          <>
            <th className="lists__check" aria-label="Done" />
            <th>Task</th>
            <th>For</th>
            <th className="lists__day">Due</th>
            <th>Cue</th>
            <th>Notes</th>
            {canEdit && <th aria-label="Delete" />}
          </>,
        )}
        <tbody>
          {shown.map((it) => {
            const mineToTick = it.personId === me;
            return (
              <tr key={it.id} id={`item-${it.id}`} className={it.done ? 'is-done' : ''}>
                <td className="lists__check">
                  <input
                    type="checkbox"
                    checked={it.done}
                    disabled={!canEdit && !mineToTick}
                    aria-label={`Done: ${it.title || 'task'}`}
                    onChange={(e) => (canEdit ? set(it.id)({ done: e.target.checked }) : store.tick(it.id, e.target.checked))}
                  />
                </td>
                {text(it, 'title', 'Task', 120, true)}
                <td>
                  {canEdit ? (
                    <select
                      className="cell"
                      value={it.personId ?? (it.person ? `text:${it.person}` : '')}
                      aria-label="Who the task is for"
                      onChange={(e) => {
                        const v = e.target.value;
                        const p = people.find((x) => x.userId === v);
                        set(it.id)(p ? { personId: p.userId, person: personName(p) } : { personId: null, person: v.startsWith('text:') ? v.slice(5) : '' });
                      }}
                    >
                      <option value="">Anyone</option>
                      {people.map((p) => (
                        <option key={p.userId} value={p.userId}>
                          {personName(p)}
                          {p.userId === me ? ' (you)' : ''}
                        </option>
                      ))}
                      {it.person && !it.personId && <option value={`text:${it.person}`}>{it.person}</option>}
                    </select>
                  ) : (
                    <span className="cell-text">{it.person || 'Anyone'}</span>
                  )}
                </td>
                <td>
                  <input
                    type="date"
                    className={`cell mono${it.day ? '' : ' is-empty'}`}
                    value={it.day}
                    readOnly={!canEdit}
                    aria-label="Due"
                    onChange={(e) => set(it.id)({ day: e.target.value })}
                  />
                </td>
                <td>
                  {canEdit ? (
                    <select className="cell" value={it.cueId ?? ''} aria-label="Cue" onChange={(e) => set(it.id)({ cueId: e.target.value || null })}>
                      <option value="">The whole plan</option>
                      {sortedCues.map((c, i) => (
                        <option key={c.id} value={c.id}>
                          {i + 1}. {cueLabel(c)}
                        </option>
                      ))}
                    </select>
                  ) : it.cueId ? (
                    <button type="button" className="link" onClick={() => onCue?.(it.cueId!)}>
                      {(() => {
                        const c = sortedCues.findIndex((x) => x.id === it.cueId);
                        return c >= 0 ? `${c + 1}. ${cueLabel(sortedCues[c]!)}` : '';
                      })()}
                    </button>
                  ) : (
                    <span className="cell-text muted">The whole plan</span>
                  )}
                </td>
                {text(it, 'notes', 'Notes', 2000)}
                {del(it)}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  } else if (kind === 'gear') {
    table = (
      <table className="lists__table">
        {head(
          <>
            <th>Item</th>
            <th className="lists__qty">Qty</th>
            <th>{words.role}</th>
            <th>{words.person}</th>
            <th>Status</th>
            <th>Notes</th>
            {canEdit && <th aria-label="Delete" />}
          </>,
        )}
        <tbody>
          {shown.map((it) => (
            <tr key={it.id} id={`item-${it.id}`} className={it.status === 'Returned' ? 'is-done' : ''}>
              {text(it, 'title', 'Item', 120, true)}
              <td>
                <QtyInput value={it.qty} readOnly={!canEdit} onChange={(v) => set(it.id)({ qty: v })} />
              </td>
              {text(it, 'role', words.role, 80)}
              {text(it, 'person', words.person, 80)}
              <td>
                <select className="cell" value={it.status} disabled={!canEdit} aria-label="Status" onChange={(e) => set(it.id)({ status: e.target.value })}>
                  {GEAR_STATUS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  {it.status && !GEAR_STATUS.includes(it.status) && <option value={it.status}>{it.status}</option>}
                </select>
              </td>
              {text(it, 'notes', 'Notes', 2000)}
              {del(it)}
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else {
    const t = budgetTotals(store.items);
    table = (
      <table className="lists__table">
        {head(
          <>
            <th>Line</th>
            <th>{words.role}</th>
            <th>{words.person}</th>
            <th className="lists__qty">Qty</th>
            <th className="lists__money">Estimate</th>
            <th className="lists__money">Actual</th>
            <th>Status</th>
            <th>Notes</th>
            {canEdit && <th aria-label="Delete" />}
          </>,
        )}
        <tbody>
          {shown.map((it) => (
            <tr key={it.id} id={`item-${it.id}`}>
              {text(it, 'title', 'Line', 120, true)}
              {text(it, 'role', words.role, 80)}
              {text(it, 'person', words.person, 80)}
              <td>
                <QtyInput value={it.qty} readOnly={!canEdit} onChange={(v) => set(it.id)({ qty: v })} />
              </td>
              <td>
                <MoneyInput value={it.amount} readOnly={!canEdit} label="Estimate (each)" onChange={(v) => set(it.id)({ amount: v })} />
              </td>
              <td>
                <MoneyInput value={it.actual} readOnly={!canEdit} label="Actual" onChange={(v) => set(it.id)({ actual: v })} />
              </td>
              <td>
                <select className="cell" value={it.status} disabled={!canEdit} aria-label="Status" onChange={(e) => set(it.id)({ status: e.target.value })}>
                  {BUDGET_STATUS.map((s) => (
                    <option key={s} value={s}>
                      {s || '—'}
                    </option>
                  ))}
                </select>
              </td>
              {text(it, 'notes', 'Notes', 2000)}
              {del(it)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="muted">
              Total
            </td>
            <td className="mono num">
              <b>{dollars(t.estimate)}</b>
            </td>
            <td className="mono num">
              <b>{dollars(t.actual)}</b>
            </td>
            <td colSpan={canEdit ? 3 : 2} className={`mono ${t.diff > 0 ? 'warn-text' : 'muted'}`}>
              {t.actual ? (t.diff > 0 ? `${dollars(t.diff)} over` : t.diff < 0 ? `${dollars(-t.diff)} under` : 'On budget') : ''}
            </td>
          </tr>
        </tfoot>
      </table>
    );
  }

  const tasks = kind === 'task' ? taskCount(store.items) : null;
  return (
    <div className="lists">
      <div className="lists__bar">
        <span className="muted small">
          {tasks
            ? `${tasks.done} of ${tasks.all} done`
            : `${list.length} ${list.length === 1 ? words.one : words.one === 'person' ? 'people' : `${words.one}s`}`}
        </span>
        {kind === 'task' && (
          <label className="row small">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            Only mine
          </label>
        )}
        <span className="bar__spacer" />
        {list.length > 0 && (
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => downloadText(`${planName || 'Plan'} - ${words.name}.csv`, itemsToCsv(kind, list, sortedCues), 'text/csv')}
            title="For Excel, Numbers or Google Sheets"
          >
            <Download size={15} strokeWidth={1.75} aria-hidden="true" />
            Export CSV
          </button>
        )}
        {canEdit && (
          <button type="button" className="btn btn--primary" onClick={add}>
            <Plus size={15} strokeWidth={2} aria-hidden="true" />
            Add {words.one}
          </button>
        )}
      </div>
      {store.error && <p className="warn">{store.error}</p>}
      {list.length === 0 && store.loaded ? (
        <div className="lists__empty">
          <p>{words.empty}</p>
          {!canEdit && <p className="muted small">Nothing here yet.</p>}
        </div>
      ) : (
        <div className="lists__scroll">{table}</div>
      )}
    </div>
  );
}

function QtyInput({ value, onChange, readOnly }: { value: number | null; onChange: (v: number | null) => void; readOnly: boolean }) {
  return (
    <input
      className="cell mono num"
      inputMode="numeric"
      value={value ?? ''}
      readOnly={readOnly}
      aria-label="Quantity"
      placeholder="—"
      onChange={(e) => {
        const d = e.target.value.replace(/\D/g, '').slice(0, 6);
        onChange(d ? Number(d) : null);
      }}
    />
  );
}

/** The tasks on one cue, in its details: tick them off, add one. */
export function CueTasks({ cueId, store, canEdit, me }: { cueId: string; store: ItemStore; canEdit: boolean; me: string }) {
  const [text, setText] = useState('');
  const tasks = listOf(store.items, 'task', cueId);
  if (!store.ready) return null;
  return (
    <section className="cue-tasks" aria-label="Tasks for this cue">
      <h3>Checklist{tasks.length ? ` (${tasks.filter((t) => t.done).length}/${tasks.length})` : ''}</h3>
      {tasks.map((t) => (
        <label key={t.id} className={`cue-tasks__row${t.done ? ' is-done' : ''}`}>
          <input
            type="checkbox"
            checked={t.done}
            disabled={!canEdit && t.personId !== me}
            onChange={(e) => (canEdit ? store.edit(t.id, { done: e.target.checked }) : store.tick(t.id, e.target.checked))}
          />
          <span className="grow">{t.title || 'Untitled task'}</span>
          {t.person && <span className="muted small">{t.person}</span>}
          {canEdit && (
            <button type="button" className="btn btn--quiet btn--icon" onClick={() => store.remove(t.id)} aria-label={`Delete ${t.title || 'task'}`}>
              <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </label>
      ))}
      {canEdit && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            store.add('task', { title: text.trim().slice(0, 120), cueId });
            setText('');
          }}
        >
          <input
            className="input grow"
            value={text}
            maxLength={120}
            placeholder="Add a step, e.g. Check the mic"
            onChange={(e) => setText(e.target.value)}
            aria-label="New task for this cue"
          />
          <button type="submit" className="btn" disabled={!text.trim()} aria-label="Add">
            <Check size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </form>
      )}
    </section>
  );
}
