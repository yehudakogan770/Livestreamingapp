import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { blankCue, type Plan, type PlanCue } from './model';
import type { PlanStore } from './usePlan';

const plan: Plan = {
  id: 'p',
  owner: 'me',
  name: 'Fall Dinner',
  eventDate: '2026-10-20',
  venue: 'Main hall',
  startTime: '19:00',
  notes: '',
  updatedAt: 0,
  updatedBy: '',
};
const cues: PlanCue[] = [
  { ...blankCue('p', 'a', 1), title: 'Doors', segment: 'countdown', durationSec: 600, section: 'Opening' },
  { ...blankCue('p', 'b', 2), title: 'Welcome', segment: 'speaker', who: 'Dana', durationSec: 300, input: 'Camera 1', transition: 'Fade' },
];
const store: PlanStore = {
  plan,
  cues,
  comments: [{ id: 'k', planId: 'p', cueId: 'b', author: 'me', authorName: 'Me', text: 'Mic check first', createdAt: 0 }],
  role: 'owner',
  here: ['Eli Cohen'],
  error: '',
  gone: false,
  saving: 'saved',
  editPlan: vi.fn(),
  editCue: vi.fn(),
  addCue: vi.fn(() => 'new'),
  duplicateCue: vi.fn(() => null),
  deleteCue: vi.fn(),
  move: vi.fn(),
  comment: vi.fn(async () => {}),
  uncomment: vi.fn(),
  reloadRole: vi.fn(),
};
vi.mock('./usePlan', () => ({ usePlan: () => store }));
vi.mock('./session', () => ({ db: () => ({}) }));

const { PlanView } = await import('./PlanView');

describe('plan view', () => {
  it('shows the cue sheet with times, totals and who is here', () => {
    render(<PlanView planId="p" me={{ id: 'me', name: 'Me' }} onBack={() => {}} />);
    expect(screen.getByDisplayValue('Fall Dinner')).toBeInTheDocument();
    expect(screen.getByLabelText('Cue 1')).toHaveValue('Doors');
    expect(screen.getByLabelText('Start of cue 2')).toHaveAttribute('placeholder', '7:10 PM');
    expect(screen.getByText('Camera 1 · Fade')).toBeInTheDocument();
    expect(screen.getAllByText('15:00').length).toBeGreaterThan(0);
    expect(screen.getByText('Eli Cohen is here')).toBeInTheDocument();
    expect(screen.getAllByText('Opening').length).toBeGreaterThan(0);
  });

  it('edits a cue in place and opens its details with comments', () => {
    render(<PlanView planId="p" me={{ id: 'me', name: 'Me' }} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText('Who for cue 2'), { target: { value: 'Eli' } });
    expect(store.editCue).toHaveBeenCalledWith('b', { who: 'Eli' });
    fireEvent.click(screen.getByLabelText('Cue 2'));
    expect(screen.getByText('Mic check first')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Move up'));
    expect(store.move).toHaveBeenCalledWith(1, 0);
  });
});
