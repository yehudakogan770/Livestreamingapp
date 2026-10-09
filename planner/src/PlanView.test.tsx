import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { blankCue, blankPlan, type Plan, type PlanCue } from './model';
import type { PlanStore } from './usePlan';
import type { ChatStore } from './useChat';
import type { BlockStore } from './useBlocks';

const plan: Plan = blankPlan('p', { owner: 'me', name: 'Fall Dinner', eventDate: '2026-10-20', venue: 'Main hall', startTime: '19:00' });
const cues: PlanCue[] = [
  { ...blankCue('p', 'a', 1), title: 'Doors', segment: 'countdown', durationSec: 600, section: 'Opening' },
  { ...blankCue('p', 'b', 2), title: 'Welcome', segment: 'speaker', who: 'Dana', durationSec: 300, input: 'Camera 1', transition: 'Fade' },
];
const store: PlanStore = {
  plan,
  cues,
  comments: [{ id: 'k', planId: 'p', cueId: 'b', author: 'me', authorName: 'Me', text: 'Mic check first', createdAt: 0, mentions: [] }],
  role: 'owner',
  here: ['Eli Cohen'],
  error: '',
  gone: false,
  saving: 'saved',
  fromCopy: false,
  editPlan: vi.fn(),
  editCue: vi.fn(),
  addCue: vi.fn(() => 'new'),
  duplicateCue: vi.fn(() => null),
  deleteCue: vi.fn(),
  move: vi.fn(),
  comment: vi.fn(async () => {}),
  uncomment: vi.fn(),
  reloadRole: vi.fn(),
  addCues: vi.fn(() => []),
  editCues: vi.fn(),
  patchPlan: vi.fn(),
};
const chatStore: ChatStore = {
  messages: [{ id: 'm1', planId: 'p', author: 'dana', authorName: 'Dana', body: 'Is #2 still five minutes?', createdAt: Date.parse('2026-10-06T18:00:00') }],
  loaded: true,
  error: '',
  unread: 1,
  send: vi.fn(async () => {}),
  remove: vi.fn(),
  markRead: vi.fn(),
};
const blockStore: BlockStore = { blocks: [], loaded: true, error: '', add: vi.fn(() => 'blk'), addMany: vi.fn(), edit: vi.fn(), remove: vi.fn() };
vi.mock('./usePlan', () => ({ usePlan: () => store }));
vi.mock('./useChat', () => ({ useChat: () => chatStore }));
vi.mock('./useBlocks', () => ({ useBlocks: () => blockStore }));
vi.mock('./session', () => ({ db: () => ({}) }));
const stores = await import('./testStores');
vi.mock('./useLive', async (orig) => ({ ...(await orig<typeof import('./useLive')>()), useLive: () => stores.liveStore }));
vi.mock('./useItems', async (orig) => ({ ...(await orig<typeof import('./useItems')>()), useItems: () => stores.itemStore }));
vi.mock('./Files', async (orig) => ({ ...(await orig<typeof import('./Files')>()), useFiles: () => stores.fileStore }));
vi.mock('./usePeople', async (orig) => ({ ...(await orig<typeof import('./usePeople')>()), usePeople: () => [] }));
vi.mock('./apiPro', async (orig) => ({ ...(await orig<typeof import('./apiPro')>()), loadLocks: async () => [], watchLocks: () => () => {} }));

const { PlanView } = await import('./PlanView');

describe('plan view', () => {
  it('works from the keyboard on a computer: arrows select, Enter edits, N adds, Esc deselects', () => {
    render(<PlanView planId="p" me={{ id: 'me', name: 'Me' }} onBack={() => {}} />);
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(document.getElementById('cue-a')).toHaveClass('is-sel');
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(document.getElementById('cue-b')).toHaveClass('is-sel');
    expect(screen.getByText('Mic check first')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(screen.getByLabelText('Cue 2')).toHaveFocus();
    // Typing in a cell: N is a letter, not a new cue.
    fireEvent.keyDown(screen.getByLabelText('Cue 2'), { key: 'n' });
    expect(store.addCue).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('Cue 2'), { key: 'Escape' });
    expect(screen.getByLabelText('Cue 2')).not.toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(document.getElementById('cue-b')).not.toHaveClass('is-sel');
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(store.addCue).toHaveBeenCalledWith(null);
  });

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

  it('shows an unread count on the chat tab, and a #2 in a message shows cue 2', () => {
    render(<PlanView planId="p" me={{ id: 'me', name: 'Me' }} onBack={() => {}} />);
    const chatTab = screen.getByRole('tab', { name: /Chat/ });
    expect(chatTab).toHaveTextContent('Chat1');
    fireEvent.click(chatTab);
    expect(screen.getByRole('article', { name: /^Dana, / })).toHaveTextContent('Is #2 still five minutes?');
    fireEvent.click(screen.getByRole('button', { name: '#2' }));
    expect(document.getElementById('cue-b')).toHaveClass('is-sel');
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Yes' } });
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' });
    expect(chatStore.send).toHaveBeenCalledWith('Yes');
  });

  it('marks an untitled cue as a placeholder and points at what is missing', () => {
    const before = [...store.cues];
    store.cues = [...before, { ...blankCue('p', 'c', 3), segment: 'camera' }];
    store.plan = { ...plan, startTime: '' };
    try {
      render(<PlanView planId="p" me={{ id: 'me', name: 'Me' }} onBack={() => {}} />);
      expect(screen.getByLabelText('Cue 3')).toHaveValue('');
      expect(screen.getByLabelText('Cue 3')).toHaveAttribute('placeholder', 'Untitled cue');
      expect(screen.getByText('Set a start time to see when each cue begins')).toBeInTheDocument();
      fireEvent.click(screen.getByText('1 without a length'));
      expect(document.getElementById('cue-c')).toHaveClass('is-sel');
    } finally {
      store.cues = before;
      store.plan = plan;
    }
  });

  it('switches to the schedule', () => {
    const onTab = vi.fn();
    const { rerender } = render(<PlanView planId="p" me={{ id: 'me', name: 'Me' }} onBack={() => {}} onTab={onTab} />);
    fireEvent.click(screen.getByRole('tab', { name: /Schedule/ }));
    expect(onTab).toHaveBeenCalledWith('schedule');
    rerender(<PlanView planId="p" me={{ id: 'me', name: 'Me' }} onBack={() => {}} onTab={onTab} tab="schedule" />);
    expect(screen.getByText('No schedule yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Start from a typical show day'));
    expect(blockStore.addMany).toHaveBeenCalled();
    const made = (blockStore.addMany as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { title: string; day: string }[];
    expect(made.map((b) => b.title)).toContain('Sound check');
    expect(made[0]!.day).toBe('2026-10-20');
  });
});
