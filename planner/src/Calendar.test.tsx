import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Calendar } from './Calendar';
import {
  addMonths,
  agenda,
  dayForKey,
  firstHour,
  monthGrid,
  placeDay,
  planSpan,
  planTime,
  plansByDay,
  stepView,
  upcoming,
  weekDays,
  weekTitle,
} from './calDates';
import { localZone } from './model';
import type { PlanSummary } from './model';

const plan = (id: string, name: string, eventDate: string, startTime = '', venue = ''): PlanSummary => ({
  id,
  name,
  eventDate,
  venue,
  startTime,
  role: 'owner',
  ownerName: 'Pat',
  cueCount: 3,
  updatedAt: 0,
  updatedBy: '',
});
const plans = [
  plan('g', 'Benefit gala', '2026-10-17', '18:00', 'Grand ballroom'),
  plan('c', 'Annual conference', '2026-10-06', '09:00', 'Main stage'),
  plan('k', 'Product launch', '2026-10-06', '14:00'),
  plan('o', 'Spring concert', '2026-04-11', '19:30'),
  plan('n', 'Town hall', ''),
];

describe('calendar arithmetic', () => {
  it('lays out a month as whole weeks from Sunday', () => {
    const weeks = monthGrid('2026-10-15');
    expect(weeks.length).toBe(5);
    expect(weeks[0]![0]).toBe('2026-09-27');
    expect(weeks.at(-1)!.at(-1)).toBe('2026-10-31');
    expect(monthGrid('2026-08-01').length).toBe(6);
  });

  it('moves by months and weeks', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-05', 1)).toBe('2027-01-05');
    expect(weekDays('2026-10-07')).toEqual(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
    expect(weekTitle('2026-10-07')).toBe('Oct 4 – 10, 2026');
    expect(weekTitle('2026-09-29')).toBe('Sep 27 – Oct 3, 2026');
  });

  it('puts plans on their days, in order of start time', () => {
    const m = plansByDay(plans);
    expect(m.get('2026-10-06')!.map((p) => p.id)).toEqual(['c', 'k']);
    expect([...m.keys()]).not.toContain('');
    expect(agenda(plans, '2026-10-06').map((d) => d.day)).toEqual(['2026-10-06', '2026-10-17']);
    expect(agenda(plans, '2026-10-06', true).map((d) => d.day)).toEqual(['2026-04-11']);
    expect(upcoming(plans, '2026-10-07').map((p) => p.id)).toEqual(['g']);
  });
});

describe('calendar grids', () => {
  it('steps by the view, and moves the focused day by key', () => {
    expect(stepView('month', '2026-10-31', 1)).toBe('2026-11-30');
    expect(stepView('week', '2026-10-06', -1)).toBe('2026-09-29');
    expect(stepView('day', '2026-12-31', 1)).toBe('2027-01-01');
    expect(dayForKey('2026-10-06', 'ArrowLeft')).toBe('2026-10-05');
    expect(dayForKey('2026-10-01', 'ArrowLeft')).toBe('2026-09-30');
    expect(dayForKey('2026-10-06', 'ArrowUp')).toBe('2026-09-29');
    expect(dayForKey('2026-10-06', 'Home')).toBe('2026-10-04');
    expect(dayForKey('2026-10-06', 'End')).toBe('2026-10-10');
    expect(dayForKey('2026-01-31', 'PageDown')).toBe('2026-02-28');
    expect(dayForKey('2026-10-06', 'PageUp', true)).toBe('2025-10-06');
    expect(dayForKey('2026-10-06', 'x')).toBeNull();
  });

  it('lays out months across years and leap days', () => {
    expect(monthGrid('2028-02-10').flat()).toContain('2028-02-29');
    expect(monthGrid('2026-02-01').length).toBe(4);
    const dec = monthGrid('2026-12-15');
    expect(dec[0]![0]).toBe('2026-11-29');
    expect(dec.at(-1)!.at(-1)).toBe('2027-01-02');
    // Every week is seven days, Sunday first, one after another.
    for (const w of monthGrid('2026-03-08')) {
      expect(w).toHaveLength(7);
      expect(new Date(`${w[0]}T12:00:00`).getDay()).toBe(0);
    }
  });

  it('places plans on the time grid: start, end, and side by side where they overlap', () => {
    const a = { ...plan('a', 'A', '2026-10-06', '09:00'), endBy: '11:00' };
    const b = plan('b', 'B', '2026-10-06', '10:00');
    const c = plan('c', 'C', '2026-10-06', '10:30');
    const d = plan('d', 'D', '2026-10-06', '13:00');
    const n = plan('n', 'No time', '2026-10-06');
    expect(planSpan(a)).toEqual({ start: 540, end: 660 });
    expect(planSpan(b)).toEqual({ start: 600, end: 660 });
    expect(planSpan(n)).toBeNull();
    // An end before the start runs to midnight.
    expect(planSpan({ ...d, endBy: '01:00' })).toEqual({ start: 780, end: 1440 });
    const placed = placeDay([d, c, b, a, n]);
    expect(placed.map((p) => [p.plan.id, p.col, p.cols])).toEqual([
      ['a', 0, 3],
      ['b', 1, 3],
      ['c', 2, 3],
      ['d', 0, 1],
    ]);
    expect(firstHour([b, d])).toBe(8);
    expect(firstHour([plan('e', 'Early', '2026-10-06', '06:30')])).toBe(5);
    expect(firstHour([])).toBe(8);
  });

  it('shows an event’s own time, with its zone when it is not this device’s', () => {
    const p = plan('z', 'Remote show', '2026-10-06', '18:00');
    expect(planTime(p)).toEqual({ short: '6 PM', zone: '', here: '' });
    expect(planTime({ ...p, timeZone: localZone() }).zone).toBe('');
    const away = localZone() === 'Asia/Tokyo' ? 'America/Chicago' : 'Asia/Tokyo';
    const t = planTime({ ...p, timeZone: away });
    expect(t.short).toBe('6 PM');
    expect(t.zone).not.toBe('');
    expect(t.here).toMatch(/AM|PM/);
  });
});

describe('calendar view', () => {
  beforeEach(() => localStorage.removeItem('lumora.planner.calView'));

  it('shows the month with plans on their dates; a plan opens, an empty day starts a new plan', async () => {
    const onOpen = vi.fn();
    const onCreate = vi.fn(async () => {});
    render(<Calendar plans={plans} canPlan onOpen={onOpen} onCreate={onCreate} today="2026-10-06" />);
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    const day = screen.getByRole('gridcell', { name: 'Saturday, October 17' });
    expect(day).toHaveTextContent('Benefit gala');
    expect(day).toHaveTextContent('6 PM');
    expect(within(day).getByRole('button', { name: /Benefit gala/ })).toHaveAttribute('title', 'Benefit gala · 6 PM · Grand ballroom');
    fireEvent.click(within(day).getByRole('button', { name: /Benefit gala/ }));
    expect(onOpen).toHaveBeenCalledWith('g');
    fireEvent.click(screen.getByRole('gridcell', { name: 'Tuesday, October 20' }));
    const dialog = screen.getByRole('dialog', { name: 'New plan' });
    fireEvent.change(within(dialog).getByLabelText('Event name'), { target: { value: 'Board meeting' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make the plan' }));
    expect(onCreate).toHaveBeenCalledWith('Board meeting', '2026-10-20');
  });

  it('goes to the next month and back to today', () => {
    render(<Calendar plans={plans} canPlan={false} onOpen={() => {}} onCreate={async () => {}} today="2026-10-06" />);
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    // No new plans without Lumora access.
    fireEvent.click(screen.getByRole('gridcell', { name: 'Tuesday, October 20' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New plan' })).toBeNull();
  });

  it('has a week view and an agenda', () => {
    render(<Calendar plans={plans} canPlan onOpen={() => {}} onCreate={async () => {}} today="2026-10-06" />);
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByRole('heading', { name: 'Oct 4 – 10, 2026' })).toBeInTheDocument();
    expect(screen.getByText('Product launch')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Agenda' }));
    expect(screen.getByText('Today · Tuesday, October 6')).toBeInTheDocument();
    expect(screen.getByText('No date yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Past' }));
    expect(screen.getByText('Spring concert')).toBeInTheDocument();
  });

  it('opens in the month view, and a day shows on its own time grid', () => {
    const onOpen = vi.fn();
    render(<Calendar plans={plans} canPlan onOpen={onOpen} onCreate={async () => {}} today="2026-10-06" />);
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true');
    // The day's number shows that day.
    fireEvent.click(screen.getByRole('button', { name: 'Show Tuesday, October 6' }));
    expect(screen.getByRole('heading', { name: 'Tuesday, October 6, 2026' })).toBeInTheDocument();
    const col = screen.getByRole('group', { name: 'Tuesday, October 6' });
    fireEvent.click(within(col).getByRole('button', { name: /Product launch/ }));
    expect(onOpen).toHaveBeenCalledWith('k');
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(screen.getByRole('heading', { name: 'Wednesday, October 7, 2026' })).toBeInTheDocument();
  });

  it('moves between days with the keyboard', () => {
    render(<Calendar plans={plans} canPlan onOpen={() => {}} onCreate={async () => {}} today="2026-10-06" />);
    const today = screen.getByRole('gridcell', { name: 'Tuesday, October 6' });
    expect(today).toHaveAttribute('tabindex', '0');
    expect(today).toHaveAttribute('aria-current', 'date');
    today.focus();
    fireEvent.keyDown(today, { key: 'ArrowDown' });
    const next = screen.getByRole('gridcell', { name: 'Tuesday, October 13' });
    expect(next).toHaveFocus();
    expect(next).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(next, { key: 'PageDown' });
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('gridcell', { name: 'Friday, November 13' }), { key: 'Enter' });
    expect(screen.getByRole('heading', { name: 'Friday, November 13, 2026' })).toBeInTheDocument();
    // Letters switch the view; T goes back to today.
    fireEvent.keyDown(document.body, { key: 'm' });
    fireEvent.keyDown(document.body, { key: 't' });
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
  });

  it('shows more than three plans on a day as "+N more"', () => {
    const busy = ['a', 'b', 'c', 'd', 'e'].map((id, i) => plan(id, `Show ${id}`, '2026-10-09', `${10 + i}:00`));
    render(<Calendar plans={busy} canPlan={false} onOpen={() => {}} onCreate={async () => {}} today="2026-10-06" />);
    const day = screen.getByRole('gridcell', { name: 'Friday, October 9' });
    expect(within(day).getAllByRole('button', { name: /Show [a-e]$/ })).toHaveLength(2);
    fireEvent.click(within(day).getByRole('button', { name: '+3 more' }));
    expect(screen.getByRole('heading', { name: 'Friday, October 9, 2026' })).toBeInTheDocument();
  });

  it('on phones: a compact month, and the chosen day’s plans under it', () => {
    const onOpen = vi.fn();
    render(<Calendar plans={plans} canPlan onOpen={onOpen} onCreate={async () => {}} today="2026-10-06" phone />);
    expect(screen.queryByRole('button', { name: 'Month' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Today · Tuesday, October 6' })).toBeInTheDocument();
    expect(screen.getByText('Annual conference')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('gridcell', { name: 'Saturday, October 17, 1 plan' }));
    expect(screen.getByRole('heading', { name: 'Saturday, October 17' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('link', { name: /Benefit gala/ })[0]!);
    expect(onOpen).toHaveBeenCalledWith('g');
    fireEvent.click(screen.getByRole('gridcell', { name: 'Tuesday, October 20' }));
    expect(screen.getByText('No plans on this day.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New plan' }));
    expect(screen.getByRole('dialog', { name: 'New plan' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
  });
});
