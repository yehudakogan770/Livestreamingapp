// The calendar of plans, as a calendar: a month (the default), a week or a day
// on a time grid, or an agenda list. Phones get a compact month with the
// chosen day's plans under it. A plan opens with a click; a click on an empty
// day starts a new plan on that date (for people who can make plans). Times
// are each event's own, with its time zone when it is not this device's.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import {
  CAL_VIEWS,
  WEEKDAYS,
  addDays,
  agenda,
  dayForKey,
  dayTitle,
  firstHour,
  hourLabel,
  longDay,
  monthGrid,
  monthTitle,
  parseDay,
  placeDay,
  planTime,
  plansByDay,
  sameMonth,
  shortClock,
  stepView,
  upcoming,
  weekDays,
  weekTitle,
  type CalView,
  type Placed,
} from './calDates';
import { Mark } from './Mark';
import { isoDate, type PlanSummary } from './model';
import './calendar.css';

const VIEW_KEY = 'lumora.planner.calView';
function loadView(): CalView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'week' || v === 'day' || v === 'agenda' ? v : 'month';
  } catch {
    return 'month';
  }
}

const VIEW_NAME: Record<CalView, string> = { month: 'Month', week: 'Week', day: 'Day', agenda: 'Agenda' };
/** Keys for the views (and T for today), on a computer. */
const VIEW_KEYS: Record<string, CalView> = { m: 'month', w: 'week', d: 'day', a: 'agenda' };
/** Plans shown in a month's day before "+N more". */
const MONTH_CHIPS = 3;
/** One hour on the week and day views, in pixels. */
const HOUR = 48;

export interface CalendarProps {
  plans: PlanSummary[] | null;
  canPlan: boolean;
  onOpen: (id: string) => void;
  onCreate: (name: string, date: string) => Promise<void>;
  phone?: boolean;
  /** "Today" (for tests). */
  today?: string;
}

const planName = (p: PlanSummary) => p.name || 'Untitled plan';
const cueWords = (n: number) => `${n} cue${n === 1 ? '' : 's'}`;

/** "Benefit gala · 6 PM CDT (4 PM here) · Grand ballroom": a plan's tooltip. */
function planTip(p: PlanSummary): string {
  const t = planTime(p);
  const when = t.short ? `${t.short}${t.zone ? ` ${t.zone}` : ''}${t.here ? ` (${t.here} here)` : ''}` : '';
  return [planName(p), when, p.venue].filter(Boolean).join(' · ');
}

/** "6 PM" or "6 PM CDT". */
function TimeOf({ p, className = '' }: { p: PlanSummary; className?: string }) {
  const t = planTime(p);
  if (!t.short) return null;
  return (
    <span className={className}>
      {t.short}
      {t.zone && <span className="cal__zone"> {t.zone}</span>}
    </span>
  );
}

export function Calendar({ plans, canPlan, onOpen, onCreate, phone = false, today: todayProp }: CalendarProps) {
  const today = todayProp ?? isoDate(new Date());
  const [chosen, setChosen] = useState<CalView>(loadView);
  const view: CalView = chosen;
  const [cursor, setCursor] = useState(today);
  const [making, setMaking] = useState<string | null>(null);
  const [past, setPast] = useState(false);
  const setView = useCallback((v: CalView) => {
    setChosen(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Not remembered.
    }
  }, []);
  const byDay = useMemo(() => plansByDay(plans ?? []), [plans]);
  const step = useCallback((n: number) => setCursor((c) => stepView(view, c, n)), [view]);
  const newOn = (day: string) => canPlan && setMaking(day);
  const showDay = useCallback(
    (d: string) => {
      setCursor(d);
      setView('day');
    },
    [setView],
  );

  // On a computer: M, W, D and A for the views, T for today, and [ and ] (or J and K) back and on.
  useEffect(() => {
    if (phone) return;
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || making) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]') || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (VIEW_KEYS[k]) setView(VIEW_KEYS[k]);
      else if (k === 't') setCursor(today);
      else if ((k === '[' || k === 'k') && view !== 'agenda') step(-1);
      else if ((k === ']' || k === 'j') && view !== 'agenda') step(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [phone, making, view, today, step, setView]);

  if (phone)
    return (
      <div className="cal cal--phone">
        <PhoneCalendar plans={plans} byDay={byDay} today={today} canPlan={canPlan} onOpen={onOpen} onNew={newOn} />
        {making && <NewPlanDialog date={making} today={today} onClose={() => setMaking(null)} onCreate={onCreate} />}
      </div>
    );

  const title = view === 'month' ? monthTitle(cursor) : view === 'week' ? weekTitle(cursor) : view === 'day' ? longDay(cursor) : 'Agenda';
  const unit = view === 'month' ? 'month' : view === 'week' ? 'week' : 'day';

  return (
    <div className="cal">
      <div className="cal__bar" role="toolbar" aria-label="Calendar">
        {view !== 'agenda' ? (
          <div className="cal__nav">
            <button type="button" className="btn" onClick={() => setCursor(today)} title="Today (T)">
              Today
            </button>
            <div className="cal__arrows">
              <button type="button" className="btn btn--icon btn--quiet" aria-label={`Previous ${unit}`} title={`Previous ${unit}`} onClick={() => step(-1)}>
                <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
              <button type="button" className="btn btn--icon btn--quiet" aria-label={`Next ${unit}`} title={`Next ${unit}`} onClick={() => step(1)}>
                <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : (
          <div className="seg" role="group" aria-label="Which events">
            <button type="button" className={`seg__btn${past ? '' : ' is-on'}`} aria-pressed={!past} onClick={() => setPast(false)}>
              Upcoming
            </button>
            <button type="button" className={`seg__btn${past ? ' is-on' : ''}`} aria-pressed={past} onClick={() => setPast(true)}>
              Past
            </button>
          </div>
        )}
        <h2 className="cal__title" aria-live="polite">
          {title}
        </h2>
        <span className="bar__spacer" />
        <div className="seg" role="group" aria-label="Calendar view">
          {CAL_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              className={`seg__btn${view === v ? ' is-on' : ''}`}
              aria-pressed={view === v}
              title={`${VIEW_NAME[v]} (${v[0]!.toUpperCase()})`}
              onClick={() => setView(v)}
            >
              {VIEW_NAME[v]}
            </button>
          ))}
        </div>
        {canPlan && (
          <button type="button" className="btn btn--primary" onClick={() => setMaking(view === 'agenda' || cursor < today ? today : cursor)}>
            <Plus size={15} strokeWidth={2} aria-hidden="true" />
            New plan
          </button>
        )}
      </div>

      {plans === null && <p className="muted cal__note">Loading plans…</p>}

      {plans !== null && view === 'month' && (
        <MonthView
          cursor={cursor}
          today={today}
          byDay={byDay}
          canPlan={canPlan}
          onCursor={setCursor}
          onOpen={onOpen}
          onDay={showDay}
          onNew={(d) => (canPlan ? newOn(d) : showDay(d))}
        />
      )}
      {plans !== null && (view === 'week' || view === 'day') && (
        <TimeGrid
          days={view === 'week' ? weekDays(cursor) : [cursor]}
          today={today}
          byDay={byDay}
          canPlan={canPlan}
          onOpen={onOpen}
          onDay={showDay}
          onNew={newOn}
        />
      )}
      {plans !== null && view === 'agenda' && <Agenda plans={plans} today={today} past={past} onOpen={onOpen} />}

      {making && <NewPlanDialog date={making} today={today} onClose={() => setMaking(null)} onCreate={onCreate} />}
    </div>
  );
}

/** A plan in a month's day: its start and name on one line. */
function Chip({ p, today, onOpen }: { p: PlanSummary; today: string; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      className={`calchip${p.eventDate < today ? ' is-past' : ''}${p.startTime ? '' : ' calchip--allday'}`}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(p.id);
      }}
      title={planTip(p)}
    >
      <TimeOf p={p} className="calchip__time" />
      <span className="calchip__name">{planName(p)}</span>
    </button>
  );
}

/** The month: whole weeks from Sunday. Arrow keys move between days; Enter shows the day. */
function MonthView({
  cursor,
  today,
  byDay,
  canPlan,
  onCursor,
  onOpen,
  onDay,
  onNew,
}: {
  cursor: string;
  today: string;
  byDay: Map<string, PlanSummary[]>;
  canPlan: boolean;
  onCursor: (d: string) => void;
  onOpen: (id: string) => void;
  onDay: (d: string) => void;
  onNew: (d: string) => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const weeks = monthGrid(cursor);
  // The focused day follows the cursor when it was moved with the keys.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-day="${cursor}"]`)?.focus();
  }, [cursor]);
  const keys = (e: KeyboardEvent<HTMLDivElement>, d: string) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onDay(d);
      return;
    }
    if (e.key === 'n' && canPlan) {
      e.preventDefault();
      onNew(d);
      return;
    }
    const next = dayForKey(d, e.key, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    moved.current = true;
    onCursor(next);
  };
  return (
    <div className="month" role="grid" aria-label={monthTitle(cursor)} ref={grid}>
      <div className="month__head" role="row">
        {WEEKDAYS.map((d) => (
          <span key={d} role="columnheader" className="month__wd">
            {d}
          </span>
        ))}
      </div>
      <div className="month__weeks" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
        {weeks.map((week) => (
          <div key={week[0]} className="month__week" role="row">
            {week.map((d) => {
              const list = byDay.get(d) ?? [];
              const shown = list.length > MONTH_CHIPS ? list.slice(0, MONTH_CHIPS - 1) : list;
              const more = list.length - shown.length;
              const label = dayTitle(d, today);
              return (
                <div
                  key={d}
                  role="gridcell"
                  data-day={d}
                  tabIndex={d === cursor ? 0 : -1}
                  aria-label={label}
                  aria-current={d === today ? 'date' : undefined}
                  aria-selected={d === cursor}
                  className={`month__day${sameMonth(d, cursor) ? '' : ' is-out'}${d === today ? ' is-today' : ''}${d < today ? ' is-before' : ''}${canPlan ? ' is-new' : ''}`}
                  onClick={() => onNew(d)}
                  onKeyDown={(e) => keys(e, d)}
                  title={canPlan ? `New plan on ${label}` : undefined}
                >
                  <button
                    type="button"
                    className="month__n"
                    tabIndex={-1}
                    aria-label={`Show ${label}`}
                    title={`Show ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDay(d);
                    }}
                  >
                    {d.endsWith('-01') ? parseDay(d)!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : parseDay(d)!.getDate()}
                  </button>
                  <div className="month__plans">
                    {shown.map((p) => (
                      <Chip key={p.id} p={p} today={today} onOpen={onOpen} />
                    ))}
                    {more > 0 && (
                      <button
                        type="button"
                        className="month__more"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDay(d);
                        }}
                      >
                        +{more} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The week or a day on a time grid: plans by their start (and end), all-day plans on top, a line at now. */
function TimeGrid({
  days,
  today,
  byDay,
  canPlan,
  onOpen,
  onDay,
  onNew,
}: {
  days: string[];
  today: string;
  byDay: Map<string, PlanSummary[]>;
  canPlan: boolean;
  onOpen: (id: string) => void;
  onDay: (d: string) => void;
  onNew: (d: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const single = days.length === 1;
  const lists = days.map((d) => byDay.get(d) ?? []);
  const allDay = lists.map((l) => l.filter((p) => !planTime(p).short));
  const placed = lists.map((l) => placeDay(l));
  const hasAllDay = allDay.some((l) => l.length > 0);
  const top = firstHour(lists.flat());
  const key = days.join();
  // Opens at the first plan (or 8 AM), not at midnight.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = Math.max(0, top * HOUR - 10);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = useNow();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const cols = { gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` };

  return (
    <div className={`tgrid${single ? ' tgrid--day' : ''}`}>
      <div className="tgrid__head" style={cols}>
        <span className="tgrid__corner" />
        {days.map((d) => {
          const x = parseDay(d)!;
          return (
            <button
              key={d}
              type="button"
              className={`tgrid__dayhead${d === today ? ' is-today' : ''}`}
              onClick={() => onDay(d)}
              aria-label={`Show ${dayTitle(d, today)}`}
              disabled={single}
            >
              <span className="tgrid__wd">{WEEKDAYS[x.getDay()]}</span>
              <span className="tgrid__n">{x.getDate()}</span>
            </button>
          );
        })}
      </div>
      {hasAllDay && (
        <div className="tgrid__allday" style={cols}>
          <span className="tgrid__gutter">No time</span>
          {allDay.map((l, i) => (
            <div key={days[i]} className="tgrid__alldaycell">
              {l.map((p) => (
                <button key={p.id} type="button" className="tevent tevent--allday" onClick={() => onOpen(p.id)} title={planTip(p)}>
                  <span className="tevent__name">{planName(p)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="tgrid__scroll" ref={scroller}>
        <div className="tgrid__body" style={{ ...cols, height: 24 * HOUR }}>
          <div className="tgrid__hours" aria-hidden="true">
            {Array.from({ length: 23 }, (_, i) => (
              <span key={i} className="tgrid__hour" style={{ top: (i + 1) * HOUR }}>
                {hourLabel(i + 1)}
              </span>
            ))}
          </div>
          {days.map((d, i) => (
            <div
              key={d}
              className={`tgrid__col${d === today ? ' is-today' : ''}${canPlan ? ' is-new' : ''}`}
              onClick={() => onNew(d)}
              title={canPlan ? `New plan on ${dayTitle(d, today)}` : undefined}
              aria-label={dayTitle(d, today)}
              role="group"
            >
              {placed[i]!.map((x) => (
                <TimedEvent key={x.plan.id} x={x} past={d < today} wide={single} onOpen={onOpen} />
              ))}
              {d === today && (
                <div className="tgrid__now" style={{ top: (nowMin / 60) * HOUR }} aria-hidden="true">
                  <span />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TimedEvent({ x, past, wide, onOpen }: { x: Placed; past: boolean; wide: boolean; onOpen: (id: string) => void }) {
  const p = x.plan;
  const height = ((x.end - x.start) / 60) * HOUR;
  const short = height < 40;
  const roomy = height >= 62;
  const until = p.endBy ? shortClock(x.end) : '';
  return (
    <button
      type="button"
      className={`tevent${past ? ' is-past' : ''}${short ? ' tevent--short' : ''}`}
      style={{
        top: (x.start / 60) * HOUR + 1,
        height: height - 2,
        left: `calc(${(x.col / x.cols) * 100}% + 2px)`,
        width: `calc(${100 / x.cols}% - 4px)`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(p.id);
      }}
      title={planTip(p)}
    >
      <span className="tevent__name">{planName(p)}</span>
      <span className="tevent__time">
        <TimeOf p={p} />
        {until && ` – ${until}`}
        {wide && [p.venue, cueWords(p.cueCount)].filter(Boolean).map((t) => ` · ${t}`)}
      </span>
      {roomy && !wide && p.venue && <span className="tevent__meta">{p.venue}</span>}
    </button>
  );
}

/** The time now, once a minute (for the line across today). */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** A list of plans, each with its time, name, venue and cues. */
function PlanRows({ list, onOpen }: { list: PlanSummary[]; onOpen: (id: string) => void }) {
  return (
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
            <span className="agenda__time">{planTime(p).short ? <TimeOf p={p} /> : 'No time'}</span>
            <span className="agenda__main">
              <span className="agenda__name">{planName(p)}</span>
              <span className="agenda__sub">{[p.venue, cueWords(p.cueCount)].filter(Boolean).join(' · ')}</span>
            </span>
            <ChevronRight className="agenda__go" size={16} strokeWidth={1.75} aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty empty--center cal__empty">
      <Mark size={32} />
      <p>{title}</p>
      {children}
    </div>
  );
}

function Agenda({ plans, today, past, onOpen }: { plans: PlanSummary[]; today: string; past: boolean; onOpen: (id: string) => void }) {
  const days = agenda(plans, today, past);
  const undated = past ? [] : plans.filter((p) => !p.eventDate);
  if (!days.length && !undated.length)
    return (
      <Empty title={past ? 'No past events.' : 'Nothing coming up.'}>
        <p className="muted">Plans with a date show here, {past ? 'latest' : 'soonest'} first.</p>
      </Empty>
    );
  const group = (label: string, key: string, list: PlanSummary[], isToday = false) => (
    <section key={key} className="agenda__day">
      <h3 className={`agenda__title${isToday ? ' is-today' : ''}`}>{label}</h3>
      <PlanRows list={list} onOpen={onOpen} />
    </section>
  );
  return (
    <div className="agenda">
      {days.map((d) => group(d.day === today ? `Today · ${dayTitle(d.day, today)}` : dayTitle(d.day, today), d.day, d.plans, d.day === today))}
      {undated.length > 0 && group('No date yet', 'none', undated)}
    </div>
  );
}

/** Phones: a compact month (a dot under days with plans), and the chosen day's plans under it. */
function PhoneCalendar({
  plans,
  byDay,
  today,
  canPlan,
  onOpen,
  onNew,
}: {
  plans: PlanSummary[] | null;
  byDay: Map<string, PlanSummary[]>;
  today: string;
  canPlan: boolean;
  onOpen: (id: string) => void;
  onNew: (d: string) => void;
}) {
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today);
  const weeks = monthGrid(month);
  const pick = (d: string) => {
    setDay(d);
    if (!sameMonth(d, month)) setMonth(d);
  };
  const list = byDay.get(day) ?? [];
  const next = plans ? upcoming(plans, addDays(day, 1), 5) : [];
  // Swipe the month sideways for the next or last one.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  return (
    <>
      <section className="mcal" aria-label="Month">
        <div className="mcal__bar">
          <h2 className="mcal__title">{monthTitle(month)}</h2>
          <span className="bar__spacer" />
          {(day !== today || !sameMonth(month, today)) && (
            <button
              type="button"
              className="btn btn--quiet mcal__today"
              onClick={() => {
                setDay(today);
                setMonth(today);
              }}
            >
              Today
            </button>
          )}
          <button type="button" className="btn btn--icon btn--quiet" aria-label="Previous month" onClick={() => setMonth((m) => stepView('month', m, -1))}>
            <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button type="button" className="btn btn--icon btn--quiet" aria-label="Next month" onClick={() => setMonth((m) => stepView('month', m, 1))}>
            <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div
          className="mcal__grid"
          role="grid"
          aria-label={monthTitle(month)}
          onTouchStart={(e) => (swipe.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY })}
          onTouchEnd={(e) => {
            const s = swipe.current;
            swipe.current = null;
            if (!s) return;
            const dx = e.changedTouches[0]!.clientX - s.x;
            const dy = e.changedTouches[0]!.clientY - s.y;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) setMonth((m) => stepView('month', m, dx < 0 ? 1 : -1));
          }}
        >
          <div className="mcal__row" role="row">
            {WEEKDAYS.map((d) => (
              <span key={d} role="columnheader" className="mcal__wd" aria-label={d}>
                {d[0]}
              </span>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0]} className="mcal__row" role="row">
              {week.map((d) => {
                const n = byDay.get(d)?.length ?? 0;
                return (
                  <button
                    key={d}
                    type="button"
                    role="gridcell"
                    aria-label={`${dayTitle(d, today)}${n ? `, ${n} plan${n === 1 ? '' : 's'}` : ''}`}
                    aria-selected={d === day}
                    aria-current={d === today ? 'date' : undefined}
                    className={`mcal__day${sameMonth(d, month) ? '' : ' is-out'}${d === today ? ' is-today' : ''}${d === day ? ' is-on' : ''}`}
                    onClick={() => pick(d)}
                  >
                    <span className="mcal__n">{parseDay(d)!.getDate()}</span>
                    <span className="mcal__dots" aria-hidden="true">
                      {Array.from({ length: Math.min(n, 3) }, (_, i) => (
                        <i key={i} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <section className="mday" aria-label={dayTitle(day, today)}>
        <div className="mday__head">
          <h3 className="mday__title">{day === today ? `Today · ${dayTitle(day, today)}` : dayTitle(day, today)}</h3>
          {canPlan && (
            <button type="button" className="btn btn--quiet mday__new" onClick={() => onNew(day)}>
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              New plan
            </button>
          )}
        </div>
        {plans === null ? (
          <p className="muted cal__note">Loading plans…</p>
        ) : list.length ? (
          <PlanRows list={list} onOpen={onOpen} />
        ) : (
          <p className="mday__none muted">No plans on this day.</p>
        )}
        {next.length > 0 && (
          <>
            <h3 className="mday__title mday__title--next">Coming up</h3>
            <ul className="agenda__list">
              {next.map((p) => (
                <li key={p.id}>
                  <a
                    className="agenda__item agenda__item--dated"
                    href={`#/plan/${p.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onOpen(p.id);
                    }}
                  >
                    <span className="agenda__time agenda__date">
                      <span>{parseDay(p.eventDate)!.toLocaleDateString('en-US', { month: 'short' })}</span>
                      <b>{parseDay(p.eventDate)!.getDate()}</b>
                    </span>
                    <span className="agenda__main">
                      <span className="agenda__name">{planName(p)}</span>
                      <span className="agenda__sub">
                        {[parseDay(p.eventDate)!.toLocaleDateString('en-US', { weekday: 'long' }), planTime(p).short, p.venue].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <ChevronRight className="agenda__go" size={16} strokeWidth={1.75} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
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
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
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
