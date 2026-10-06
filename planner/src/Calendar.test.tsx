import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Calendar } from './Calendar';
import { addMonths, agenda, monthGrid, plansByDay, upcoming, weekDays, weekTitle } from './calDates';
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
    expect(day).toHaveTextContent('Grand ballroom');
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

  it('shows only the agenda on phones', () => {
    localStorage.setItem('lumora.planner.calView', 'month');
    render(<Calendar plans={plans} canPlan onOpen={() => {}} onCreate={async () => {}} today="2026-10-06" phone />);
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.getByText('Annual conference')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Month' })).toBeNull();
  });
});
