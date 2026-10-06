import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankCue, type Plan, type PlanCue } from './model';
import type { PlanStore } from './usePlan';

// A phone-sized window: every media query matches (the phone layout's).
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterAll(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

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
  { ...blankCue('p', 'c', 3), title: 'Video', segment: 'video', durationSec: 90 },
];
const store: PlanStore = {
  plan,
  cues,
  comments: [{ id: 'k', planId: 'p', cueId: 'b', author: 'me', authorName: 'Me', text: 'Mic check first', createdAt: 0 }],
  role: 'owner',
  here: [],
  error: '',
  gone: false,
  saving: 'saved',
  editPlan: vi.fn(),
  editCue: vi.fn(),
  addCue: vi.fn(() => 'c'),
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
const view = () => render(<PlanView planId="p" me={{ id: 'me', name: 'Me' }} onBack={() => {}} />);

beforeEach(() => vi.clearAllMocks());

describe('plan view on a phone', () => {
  it('lists the cues as cards, not the wide table', () => {
    view();
    expect(document.querySelector('table.cues')).toBeNull();
    const card = screen.getByRole('button', { name: 'Cue 2: Welcome' });
    expect(card).toHaveTextContent('7:10 PM');
    expect(card).toHaveTextContent('5:00');
    expect(card).toHaveTextContent('Speaker');
    expect(card).toHaveTextContent('Dana · Camera 1 · Fade');
    expect(document.querySelector('.cards__section')).toHaveTextContent('Opening');
    expect(screen.getByRole('navigation', { name: 'Plan actions' })).toHaveTextContent('Add cue');
    expect(screen.getByText(/3 cues · Total/)).toBeInTheDocument();
  });

  it('opens a cue in a full-screen sheet with its fields and comments, and Done closes it', () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Cue 2: Welcome' }));
    const sheet = screen.getByRole('dialog', { name: 'Cue 2' });
    expect(within(sheet).getByDisplayValue('Welcome')).toBeInTheDocument();
    expect(within(sheet).getByText('Mic check first')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Fixed start')).toHaveAttribute('type', 'time');
    expect(within(sheet).getByLabelText('Length, minutes')).toHaveAttribute('inputmode', 'numeric');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the sheet with the browser’s Back', () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Cue 1: Doors' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => {
      history.replaceState(null, '');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves the cue up and down from the sheet', () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Cue 2: Welcome' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move cue down' }));
    expect(store.move).toHaveBeenCalledWith(1, 2);
    fireEvent.click(screen.getByRole('button', { name: 'Move cue up' }));
    expect(store.move).toHaveBeenCalledWith(1, 0);
  });

  it('takes a length as minutes and seconds', () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Cue 3: Video' }));
    expect(screen.getByLabelText('Length, minutes')).toHaveValue('1');
    expect(screen.getByLabelText('Length, seconds')).toHaveValue('30');
    const min = screen.getByLabelText('Length, minutes');
    fireEvent.change(min, { target: { value: '4' } });
    fireEvent.blur(min);
    expect(store.editCue).toHaveBeenCalledWith('c', { durationSec: 270 });
  });

  it('adds a cue and opens it', () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Add cue' }));
    expect(store.addCue).toHaveBeenCalledWith(null);
    expect(screen.getByRole('dialog', { name: 'Cue 3' })).toBeInTheDocument();
  });

  it('reorders by dragging a card’s handle', () => {
    view();
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-reorder]'));
    cards.forEach((el, i) => {
      el.getBoundingClientRect = () => ({ top: i * 70, bottom: i * 70 + 64, height: 64, left: 0, right: 300, width: 300, x: 0, y: i * 70, toJSON: () => ({}) });
    });
    const grip = cards[0]!.querySelector('.card__grip')!;
    fireEvent.pointerDown(grip, { pointerId: 1, pointerType: 'touch', clientY: 30 });
    fireEvent.pointerMove(grip, { pointerId: 1, pointerType: 'touch', clientY: 160 });
    expect(cards[2]).toHaveClass('drop-before');
    fireEvent.pointerUp(grip, { pointerId: 1, pointerType: 'touch', clientY: 160 });
    expect(store.move).toHaveBeenCalledWith(0, 1);
  });

  it('shows the event details only when asked', () => {
    view();
    const when = screen.getByRole('button', { name: /Oct 20, 2026 · 7:00 PM · Main hall/ });
    expect(screen.queryByLabelText('Show starts')).toBeNull();
    fireEvent.click(when);
    expect(screen.getByLabelText('Show starts')).toHaveAttribute('type', 'time');
  });
});
