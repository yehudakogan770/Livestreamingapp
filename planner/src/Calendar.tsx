// The calendar of plans: a month (the default), a week, or an agenda list
// (the only view on phones). A plan opens with a click; a click on an empty
// day starts a new plan on that date (for people who can make plans).

import { useEffect, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import {
  WEEKDAYS,
  addDays,
  addMonths,
  agenda,
  dayTitle,
  monthGrid,
  monthTitle,
  parseDay,
  plansByDay,
  sameMonth,
  weekDays,
  weekTitle,
  type CalView,
} from './calDates';
import { Mark } from './Mark';
import { isoDate, showClock, type PlanSummary } from './model';

const VIEW_KEY = 'lumora.planner.calView';
function loadView(): CalView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'week' || v === 'agenda' ? v : 'month';
  } catch {
    return 'month';
  }
}

export interface CalendarProps {
  plans: PlanSummary[] | null;
  canPlan: boolean;
  onOpen: (id: string) => void;
  onCreate: (name: string, date: string) => Promise<void>;
  phone?: boolean;
  /** "Today" (for tests). */
  today?: string;
}

export function Calendar({ plans, canPlan, onOpen, onCreate, phone = false, today: todayProp }: CalendarProps) {
  const today = todayProp ?? isoDate(new Date());
  const [chosen, setChosen] = useState<CalView>(loadView);
  const view: CalView = phone ? 'agenda' : chosen;
  const [cursor, setCursor] = useState(today);
  const [making, setMaking] = useState<string | null>(null);
  const [past, setPast] = useState(false);
  const setView = (v: CalView) => {
    setChosen(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Not remembered.
    }
  };
  const byDay = plansByDay(plans ?? []);
  const step = (n: number) => setCursor((c) => (view === 'month' ? addMonths(c, n) : addDays(c, 7 * n)));
  const title = view === 'month' ? monthTitle(cursor) : view === 'week' ? weekTitle(cursor) : past ? 'Past events' : 'Upcoming';
  const newOn = (day: string) => canPlan && setMaking(day);

  const chip = (p: PlanSummary) => (
    <button
      key={p.id}
      type="button"
      className="calchip"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(p.id);
      }}
      title={[p.name, showClock(p.startTime), p.venue].filter(Boolean).join(' · ')}
    >
      {p.startTime && <span className="calchip__time mono">{showClock(p.startTime).replace(':00 ', ' ')}</span>}
      <span className="calchip__name">{p.name || 'Untitled plan'}</span>
      {p.venue && <span className="calchip__venue">{p.venue}</span>}
    </button>
  );

  return (
    <div className="cal">
      <div className="cal__bar" role="toolbar" aria-label="Calendar">
        <h2 className="cal__title">{title}</h2>
        {view !== 'agenda' && (
          <div className="cal__nav">
            <button
              type="button"
              className="btn btn--icon btn--quiet"
              aria-label={view === 'month' ? 'Previous month' : 'Previous week'}
              onClick={() => step(-1)}
            >
              <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button type="button" className="btn" onClick={() => setCursor(today)}>
              Today
            </button>
            <button type="button" className="btn btn--icon btn--quiet" aria-label={view === 'month' ? 'Next month' : 'Next week'} onClick={() => step(1)}>
              <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        )}
        {view === 'agenda' && (
          <div className="seg" role="group" aria-label="Which events">
            <button type="button" className={`seg__btn${past ? '' : ' is-on'}`} aria-pressed={!past} onClick={() => setPast(false)}>
              Upcoming
            </button>
            <button type="button" className={`seg__btn${past ? ' is-on' : ''}`} aria-pressed={past} onClick={() => setPast(true)}>
              Past
            </button>
          </div>
        )}
        <span className="bar__spacer" />
        {!phone && (
          <div className="seg" role="group" aria-label="Calendar view">
            {(['month', 'week', 'agenda'] as const).map((v) => (
              <button key={v} type="button" className={`seg__btn${view === v ? ' is-on' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>
                {v === 'month' ? 'Month' : v === 'week' ? 'Week' : 'Agenda'}
              </button>
            ))}
          </div>
        )}
        {canPlan && (
          <button type="button" className="btn btn--primary" onClick={() => setMaking(view === 'agenda' || cursor < today ? today : cursor)}>
            <Plus size={15} strokeWidth={2} aria-hidden="true" />
            New plan
          </button>
        )}
      </div>

      {plans === null && <p className="muted cal__note">Loading plans…</p>}

      {plans !== null && view === 'month' && (
        <div className="month" role="grid" aria-label={monthTitle(cursor)}>
          <div className="month__head" role="row">
            {WEEKDAYS.map((d) => (
              <span key={d} role="columnheader">
                {d}
              </span>
            ))}
          </div>
          {monthGrid(cursor).map((week) => (
            <div key={week[0]} className="month__week" role="row">
              {week.map((d) => {
                const list = byDay.get(d) ?? [];
                return (
                  <div
                    key={d}
                    role="gridcell"
                    aria-label={dayTitle(d, today)}
                    className={`month__day${sameMonth(d, cursor) ? '' : ' is-out'}${d === today ? ' is-today' : ''}${canPlan ? ' is-new' : ''}`}
                    onClick={() => newOn(d)}
                    title={canPlan ? `New plan on ${dayTitle(d, today)}` : undefined}
                  >
                    <span className="month__n">{parseDay(d)!.getDate()}</span>
                    <div className="month__plans">
                      {list.slice(0, 3).map(chip)}
                      {list.length > 3 && (
                        <button
                          type="button"
                          className="month__more"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCursor(d);
                            setView('week');
                          }}
                        >
                          {list.length - 3} more
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {plans !== null && view === 'week' && (
        <div className="week">
          {weekDays(cursor).map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <div key={d} className={`week__day${d === today ? ' is-today' : ''}${canPlan ? ' is-new' : ''}`} onClick={() => newOn(d)}>
                <div className="week__head">
                  <span className="muted">{WEEKDAYS[parseDay(d)!.getDay()]}</span>
                  <b className="week__n">{parseDay(d)!.getDate()}</b>
                </div>
                <div className="week__plans">
                  {list.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="weekcard"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(p.id);
                      }}
                    >
                      <span className="weekcard__time mono">{showClock(p.startTime) || 'No start time'}</span>
                      <span className="weekcard__name">{p.name || 'Untitled plan'}</span>
                      {p.venue && <span className="weekcard__venue muted">{p.venue}</span>}
                      <span className="weekcard__meta muted small">
                        {p.cueCount} cue{p.cueCount === 1 ? '' : 's'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {plans !== null && view === 'agenda' && <Agenda plans={plans} today={today} past={past} onOpen={onOpen} />}

      {making && <NewPlanDialog date={making} today={today} onClose={() => setMaking(null)} onCreate={onCreate} />}
    </div>
  );
}

function Agenda({ plans, today, past, onOpen }: { plans: PlanSummary[]; today: string; past: boolean; onOpen: (id: string) => void }) {
  const days = agenda(plans, today, past);
  const undated = past ? [] : plans.filter((p) => !p.eventDate);
  if (!days.length && !undated.length)
    return (
      <div className="empty empty--center">
        <Mark size={32} />
        <p>{past ? 'No past events.' : 'Nothing coming up.'}</p>
        <p className="muted">Plans with a date show here, soonest first.</p>
      </div>
    );
  const group = (label: string, key: string, list: PlanSummary[], isToday = false) => (
    <section key={key} className="agenda__day">
      <h3 className={`agenda__title${isToday ? ' is-today' : ''}`}>{label}</h3>
      <ul className="agenda__list">
        {list.map((p) => (
          <li key={p.id}>
            <a
              className="agenda__item"
              href={`#/plan/${p.id}`}
              onClick={(e) => {
                e.preventDefault();
                onOpen(p.id);
              }}
            >
              <span className="agenda__time mono">{showClock(p.startTime) || 'All day'}</span>
              <span className="agenda__main">
                <span className="agenda__name">{p.name || 'Untitled plan'}</span>
                <span className="agenda__sub muted">{[p.venue, `${p.cueCount} cue${p.cueCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <div className="agenda">
      {days.map((d) => group(d.day === today ? `Today · ${dayTitle(d.day, today)}` : dayTitle(d.day, today), d.day, d.plans, d.day === today))}
      {undated.length > 0 && group('No date yet', 'none', undated)}
    </div>
  );
}

function NewPlanDialog({
  date,
  today,
  onClose,
  onCreate,
}: {
  date: string;
  today: string;
  onClose: () => void;
  onCreate: (name: string, date: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [day, setDay] = useState(date);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    onCreate(name, day)
      .catch((x: unknown) => setErr(x instanceof Error ? x.message : String(x)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="dialog" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog__box dialog__box--small" role="dialog" aria-modal="true" aria-label="New plan" onSubmit={submit}>
        <div className="dialog__head">
          <h2>New plan</h2>
          <button type="button" className="btn btn--quiet btn--icon" aria-label="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className="dialog__body">
          <label className="field">
            <span>Event name</span>
            <input className="input" autoFocus value={name} maxLength={120} placeholder="Annual conference" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Date</span>
            <input type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          <p className="muted small">{day ? dayTitle(day, today) : 'No date'}</p>
          {err && <p className="warn">{err}</p>}
          <div className="row dialog__acts">
            <span className="bar__spacer" />
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? 'Making it…' : 'Make the plan'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
