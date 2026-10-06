// The schedule: the people side of the event (crew call, load-in, sound check,
// doors, show, strike…). A day timeline on larger screens (one column per day),
// a simple list on phones; "My schedule" keeps the blocks for this person.

import { useMemo, useState } from 'react';
import { MapPin, Plus, Trash2, Users } from 'lucide-react';
import { blockTime, byDay, isMine, layoutDay, loadRoles, saveRoles, splitRoles, typicalDay, type Block } from './blocks';
import { ClockInput, TimeInput } from './fields';
import { Mark } from './Mark';
import { clock12, longDate, shortDate, type Plan } from './model';
import type { BlockStore } from './useBlocks';

const PX_PER_MIN = 1;

export interface ScheduleProps {
  store: BlockStore;
  plan: Plan;
  canEdit: boolean;
  me: { id: string; name: string };
  sel: string | null;
  onSel: (id: string | null) => void;
  phone?: boolean;
}

/** "My schedule": on, and the roles this person goes by (remembered on this device). */
export function useMine(): { mine: boolean; setMine: (v: boolean) => void; roles: string; setRoles: (v: string) => void } {
  const [mine, setMine] = useState(false);
  const [roles, setRolesState] = useState(loadRoles);
  const setRoles = (v: string) => {
    setRolesState(v);
    saveRoles(v);
  };
  return { mine, setMine, roles, setRoles };
}

export function ScheduleView({ store, plan, canEdit, me, sel, onSel, phone = false }: ScheduleProps) {
  const { mine, setMine, roles, setRoles } = useMine();
  const shown = useMemo(() => (mine ? store.blocks.filter((b) => isMine(b, me.name, splitRoles(roles))) : store.blocks), [store.blocks, mine, me.name, roles]);
  const days = useMemo(() => byDay(shown), [shown]);
  const add = (init: Partial<Block> = {}) => onSel(store.add(plan.eventDate, init));
  const typical = () => store.addMany(typicalDay(plan.startTime).map((b) => ({ ...b, day: plan.eventDate })));

  const toolbar = (
    <div className="sched__tools" role="toolbar" aria-label="Schedule">
      <div className="seg" role="group" aria-label="Whose schedule">
        <button type="button" className={`seg__btn${mine ? '' : ' is-on'}`} aria-pressed={!mine} onClick={() => setMine(false)}>
          Everyone
        </button>
        <button type="button" className={`seg__btn${mine ? ' is-on' : ''}`} aria-pressed={mine} onClick={() => setMine(true)}>
          My schedule
        </button>
      </div>
      {mine && (
        <label className="sched__roles">
          <span className="muted">{me.name ? `${me.name.split(/\s+/)[0]}, and roles:` : 'My roles:'}</span>
          <input
            className="input"
            value={roles}
            placeholder="e.g. Audio, Camera"
            maxLength={120}
            onChange={(e) => setRoles(e.target.value)}
            aria-label="My roles"
          />
        </label>
      )}
      <span className="bar__spacer" />
      {canEdit && (
        <button type="button" className="btn btn--primary" onClick={() => add()}>
          <Plus size={15} strokeWidth={2} aria-hidden="true" />
          Add block
        </button>
      )}
    </div>
  );

  let body;
  if (store.error && !store.loaded) body = <p className="warn sched__note">{store.error}</p>;
  else if (!store.loaded) body = <p className="muted sched__note">Loading the schedule…</p>;
  else if (store.blocks.length === 0)
    body = (
      <div className="empty empty--center">
        <Mark size={32} />
        <p>No schedule yet.</p>
        <p className="muted">
          The day for the people: crew call, load-in, sound check, rehearsal, doors, show and strike, with who and where. It can span several days.
        </p>
        {canEdit && (
          <div className="row row--wrap empty__acts">
            <button type="button" className="btn btn--primary" onClick={typical}>
              Start from a typical show day
            </button>
            <button type="button" className="btn" onClick={() => add()}>
              Add a block
            </button>
          </div>
        )}
      </div>
    );
  else if (shown.length === 0)
    body = (
      <div className="empty empty--center">
        <p>Nothing on your schedule.</p>
        <p className="muted">
          Blocks show here when their “Who” names you{me.name ? ` (${me.name})` : ''}, one of your roles, or everyone (“All crew”, “Everyone”).
        </p>
      </div>
    );
  else if (phone) body = <ScheduleList days={days} sel={sel} onSel={onSel} />;
  else body = <Timeline days={days} sel={sel} onSel={onSel} canEdit={canEdit} onAdd={(day, starts) => add({ day, starts })} />;

  return (
    <div className="sched">
      {toolbar}
      {store.error && store.loaded && <p className="warn plan__error">{store.error}</p>}
      <div className="sched__body">{body}</div>
    </div>
  );
}

const minutesOf = (t: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Larger screens: one column per day on a shared time axis, blocks placed by time. */
function Timeline({
  days,
  sel,
  onSel,
  canEdit,
  onAdd,
}: {
  days: { day: string; blocks: Block[] }[];
  sel: string | null;
  onSel: (id: string) => void;
  canEdit: boolean;
  onAdd: (day: string, starts: string) => void;
}) {
  const laid = days.map((d) => ({ ...d, ...layoutDay(d.blocks), untimed: d.blocks.filter((b) => minutesOf(b.starts) === null) }));
  const from = Math.min(...laid.map((d) => d.from));
  const to = Math.max(...laid.map((d) => d.to));
  const hours: number[] = [];
  for (let h = from; h <= to; h += 60) hours.push(h);
  const anyUntimed = laid.some((d) => d.untimed.length > 0);
  return (
    <div className="tl" style={{ ['--days' as string]: laid.length }}>
      <div className="tl__heads">
        <span className="tl__corner" />
        {laid.map((d) => (
          <div key={d.day || 'none'} className="tl__head">
            <b>{d.day ? longDate(d.day).replace(/, \d{4}$/, '') : 'No date'}</b>
            <span className="muted small">
              {d.blocks.length} block{d.blocks.length === 1 ? '' : 's'}
            </span>
          </div>
        ))}
      </div>
      {anyUntimed && (
        <div className="tl__untimed">
          <span className="tl__corner muted small">Any time</span>
          {laid.map((d) => (
            <div key={d.day || 'none'} className="tl__untimed-col">
              {d.untimed.map((b) => (
                <button key={b.id} type="button" className={`tblock tblock--flat${sel === b.id ? ' is-sel' : ''}`} onClick={() => onSel(b.id)}>
                  <span className={`tblock__title${b.title ? '' : ' is-empty'}`}>{b.title || 'Untitled block'}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="tl__grid" style={{ height: (to - from) * PX_PER_MIN }}>
        <div className="tl__axis" aria-hidden="true">
          {hours.map((h) => (
            <span key={h} className="tl__hour" style={{ top: (h - from) * PX_PER_MIN }}>
              {h === to ? '' : clock12(h * 60).replace(':00', '')}
            </span>
          ))}
        </div>
        {laid.map((d) => (
          <div
            key={d.day || 'none'}
            className="tl__col"
            onDoubleClick={(e) => {
              if (!canEdit || e.target !== e.currentTarget) return;
              const y = e.nativeEvent.offsetY / PX_PER_MIN + from;
              const m = Math.floor(y / 30) * 30;
              onAdd(d.day, `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
            }}
            title={canEdit ? 'Double-click to add a block here' : undefined}
          >
            {hours.map((h) => (
              <span key={h} className="tl__line" style={{ top: (h - from) * PX_PER_MIN }} aria-hidden="true" />
            ))}
            {d.placed.map((p) => {
              const b = p.block;
              const small = p.height < 40;
              return (
                <button
                  key={b.id}
                  type="button"
                  className={`tblock${sel === b.id ? ' is-sel' : ''}${small ? ' tblock--small' : ''}`}
                  style={{
                    top: (p.top - from) * PX_PER_MIN + 1,
                    height: p.height * PX_PER_MIN - 2,
                    left: `calc(${(p.lane / p.lanes) * 100}% + 2px)`,
                    width: `calc(${100 / p.lanes}% - 4px)`,
                  }}
                  onClick={() => onSel(b.id)}
                  aria-label={`${b.title || 'Untitled block'}, ${blockTime(b)}`}
                >
                  <span className={`tblock__title${b.title ? '' : ' is-empty'}`}>{b.title || 'Untitled block'}</span>
                  <span className="tblock__time mono">{blockTime(b)}</span>
                  {!small && (b.location || b.who) && <span className="tblock__sub">{[b.location, b.who].filter(Boolean).join(' · ')}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Phones: the blocks as a list, by day. */
export function ScheduleList({ days, sel, onSel }: { days: { day: string; blocks: Block[] }[]; sel: string | null; onSel: (id: string) => void }) {
  return (
    <div className="slist">
      {days.map((d) => (
        <section key={d.day || 'none'} className="slist__day" aria-label={d.day ? longDate(d.day) : 'No date'}>
          <h3 className="slist__title">{d.day ? longDate(d.day) : 'No date'}</h3>
          <ul className="slist__items">
            {d.blocks.map((b) => (
              <li key={b.id}>
                <button type="button" className={`srow${sel === b.id ? ' is-sel' : ''}`} onClick={() => onSel(b.id)}>
                  <span className="srow__time mono">{blockTime(b) || 'Any time'}</span>
                  <span className="srow__main">
                    <span className={`srow__title${b.title ? '' : ' is-empty'}`}>{b.title || 'Untitled block'}</span>
                    {(b.location || b.who) && (
                      <span className="srow__sub">
                        {b.location && (
                          <span>
                            <MapPin size={12} strokeWidth={1.75} aria-hidden="true" /> {b.location}
                          </span>
                        )}
                        {b.who && (
                          <span>
                            <Users size={12} strokeWidth={1.75} aria-hidden="true" /> {b.who}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** One block's fields: in the side panel, or a full-screen sheet on phones. */
export function BlockEditor({
  block,
  store,
  canEdit,
  onClose,
  phone = false,
}: {
  block: Block;
  store: BlockStore;
  canEdit: boolean;
  onClose: () => void;
  phone?: boolean;
}) {
  const set = (change: Partial<Block>) => store.edit(block.id, change);
  const Time = ({ value, label, placeholder, onChange }: { value: string; label: string; placeholder: string; onChange: (v: string) => void }) =>
    phone ? (
      <TimeInput className="input mono" value={value} readOnly={!canEdit} label={label} onChange={onChange} />
    ) : (
      <ClockInput className="input mono" value={value} readOnly={!canEdit} label={label} placeholder={placeholder} onChange={onChange} />
    );
  return (
    <div className="inspector__in block-ed">
      <label className="field">
        <span>Title</span>
        <input
          className="input"
          value={block.title}
          maxLength={120}
          readOnly={!canEdit}
          placeholder="Load-in, Sound check, Doors…"
          autoFocus={!phone && canEdit && !block.title}
          onChange={(e) => set({ title: e.target.value })}
        />
      </label>
      <div className="grid3">
        <label className="field">
          <span>Day</span>
          <input type="date" className="input" value={block.day} readOnly={!canEdit} onChange={(e) => canEdit && set({ day: e.target.value })} />
        </label>
        <label className="field">
          <span>Starts</span>
          {Time({ value: block.starts, label: 'Starts', placeholder: '3:00 PM', onChange: (v) => set({ starts: v }) })}
        </label>
        <label className="field">
          <span>Ends</span>
          {Time({ value: block.ends, label: 'Ends', placeholder: '5:00 PM', onChange: (v) => set({ ends: v }) })}
        </label>
      </div>
      <label className="field">
        <span>Location</span>
        <input
          className="input"
          value={block.location}
          maxLength={120}
          readOnly={!canEdit}
          placeholder="Stage, loading dock, green room…"
          onChange={(e) => set({ location: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Who</span>
        <input
          className="input"
          value={block.who}
          maxLength={200}
          readOnly={!canEdit}
          placeholder="People or roles: Audio, Sam, All crew"
          onChange={(e) => set({ who: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea className="input" rows={4} maxLength={2000} value={block.notes} readOnly={!canEdit} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      {block.updatedBy && <p className="muted small">Last changed by {block.updatedBy}</p>}
      {canEdit && (
        <div className="insp-actions row">
          <button
            type="button"
            className="btn btn--quiet btn--danger"
            onClick={() => {
              if (!confirm(`Delete “${block.title || 'Untitled block'}” from the schedule?`)) return;
              store.remove(block.id);
              onClose();
            }}
          >
            <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
            Delete block
          </button>
        </div>
      )}
    </div>
  );
}

/** The schedule on paper, under the cue sheet. */
export function PrintSchedule({ blocks }: { blocks: Block[] }) {
  if (!blocks.length) return null;
  return (
    <section className="print__sched">
      <h2>Schedule</h2>
      <table className="print__cues">
        <thead>
          <tr>
            <th>Day</th>
            <th>Time</th>
            <th>What</th>
            <th>Where</th>
            <th>Who</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {byDay(blocks).flatMap((d) =>
            d.blocks.map((b, i) => (
              <tr key={b.id}>
                <td className="nowrap">{i === 0 ? shortDate(d.day) || '—' : ''}</td>
                <td className="nowrap">{blockTime(b)}</td>
                <td>
                  <b>{b.title || 'Untitled block'}</b>
                </td>
                <td>{b.location}</td>
                <td>{b.who}</td>
                <td className="pre">{b.notes}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </section>
  );
}
