import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blankCue, blankPlan, type PlanCue } from './model';
import { OFF, type Live } from './live';
import { blankItem } from './items';
import type { LiveStore } from './useLive';
import type { ItemStore } from './useItems';

vi.mock('./session', () => ({ db: () => ({}) }));
const publicData = vi.fn();
vi.mock('./apiPro', async (orig) => ({
  ...(await orig<typeof import('./apiPro')>()),
  loadPublic: (...a: unknown[]) => publicData(...a),
  listTemplates: async () => [{ id: 't1', name: 'Our gala template', venue: 'Main hall', updatedAt: 0 }],
  copyPlan: vi.fn(async () => 'new-plan'),
}));
const fromTemplate = vi.fn(async () => 'from-template');
vi.mock('./newPlan', () => ({ planFromTemplate: (...a: unknown[]) => fromTemplate(...(a as [])) }));

const { ShowView, StageTimer } = await import('./ShowView');
const { ListView, CueTasks } = await import('./ListView');
const { PublicView } = await import('./PublicView');
const { NewPlanDialog } = await import('./NewPlan');
const { Prompter } = await import('./Prompter');

const plan = blankPlan('p', { name: 'Fall Dinner', startTime: '19:00' });
const cues: PlanCue[] = [
  { ...blankCue('p', 'a', 1), title: 'Doors', durationSec: 300, who: 'Dana', script: 'Welcome, everyone.' },
  { ...blankCue('p', 'b', 2), title: 'Spare', durationSec: 60, skip: true },
  { ...blankCue('p', 'c', 3), title: 'Welcome', durationSec: 120 },
];

function liveStore(live: Live | null): LiveStore {
  return { live, log: [], offset: 0, error: '', busy: false, ready: true, act: vi.fn(async () => {}), clearRun: vi.fn(async () => {}) };
}
const running = (more: Partial<Live> = {}): Live => ({
  ...OFF,
  planId: 'p',
  runId: 'r',
  state: 'running',
  cueId: 'a',
  cueStartedAt: Date.now() - 60_000,
  showStartedAt: Date.now() - 60_000,
  ...more,
});

afterEach(() => vi.useRealTimers());

describe('calling the show', () => {
  it('before the show: starts from the first cue, or a rehearsal', () => {
    const s = liveStore(null);
    render(<ShowView data={{ plan, cues, live: null, log: [], offset: 0 }} store={s} />);
    expect(screen.getByText('First: Doors')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Start the show/ }));
    expect(s.act).toHaveBeenCalledWith('start', { cue: 'a' });
    fireEvent.click(screen.getByRole('button', { name: 'Start a rehearsal' }));
    expect(s.act).toHaveBeenCalledWith('rehearse', { cue: 'a' });
  });

  it('can start from another cue', () => {
    const s = liveStore(null);
    render(<ShowView data={{ plan, cues, live: null, log: [], offset: 0 }} store={s} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Start here' })[1]!);
    fireEvent.click(screen.getByRole('button', { name: /Start the show/ }));
    expect(s.act).toHaveBeenCalledWith('start', { cue: 'c' });
  });

  it('shows the time left and what is next (floated cues passed over); GO, pause, a minute more, a message', () => {
    const s = liveStore(running());
    render(<ShowView data={{ plan, cues, live: s.live, log: [], offset: 0 }} store={s} />);
    expect(screen.getByRole('timer')).toHaveTextContent('4:00');
    expect(screen.getByText('On now · Cue 1 of 3')).toBeInTheDocument();
    expect(screen.getAllByText('Welcome').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /GO · next cue/ }));
    expect(s.act).toHaveBeenCalledWith('go', { cue: 'c' });
    fireEvent.keyDown(document.body, { key: 'p' });
    expect(s.act).toHaveBeenCalledWith('pause');
    fireEvent.click(screen.getByRole('button', { name: '+1:00' }));
    expect(s.act).toHaveBeenCalledWith('adjust', { seconds: 60 });
    fireEvent.change(screen.getByLabelText('Message to the stage timer'), { target: { value: 'Wrap up' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(s.act).toHaveBeenCalledWith('message', { message: 'Wrap up', flash: false });
  });

  it('the crew only follows: no buttons', () => {
    render(<ShowView data={{ plan, cues, live: running(), log: [], offset: 0 }} />);
    expect(screen.queryByRole('button', { name: /GO/ })).toBeNull();
    expect(screen.getByRole('timer')).toHaveTextContent('4:00');
  });

  it('the stage timer counts down and shows messages', () => {
    render(<StageTimer data={{ plan, cues, live: running({ messageOn: true, message: 'Wrap up' }), log: [], offset: 0 }} />);
    expect(screen.getByRole('timer')).toHaveTextContent('4:00');
    expect(screen.getByText('Wrap up')).toBeInTheDocument();
  });

  it('runs over in red, counting up', () => {
    render(<StageTimer data={{ plan, cues, live: running({ cueStartedAt: Date.now() - 330_000 }), log: [], offset: 0 }} />);
    expect(screen.getByRole('timer')).toHaveTextContent('−0:30');
    expect(document.querySelector('.stage')).toHaveClass('stage--over');
  });
});

describe('the prompter', () => {
  it('shows each cue’s script in order, and none for floated cues', () => {
    render(<Prompter cues={cues} live={null} title="Fall Dinner" />);
    expect(screen.getByText('Welcome, everyone.')).toBeInTheDocument();
    expect(screen.getByText('1. Doors')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mirror' }));
    expect(screen.getByRole('button', { name: 'Mirror' })).toHaveAttribute('aria-pressed', 'true');
  });
});

function itemStore(items = [blankItem('p', 'i1', 'task', 1, { title: 'Test the mic', personId: 'me', person: 'Me' })]): ItemStore {
  return { items, loaded: true, error: '', ready: true, add: vi.fn(() => 'new'), addMany: vi.fn(), edit: vi.fn(), tick: vi.fn(), remove: vi.fn() };
}

describe('lists', () => {
  it('an editor adds and edits; a viewer ticks off their own task', () => {
    const s = itemStore();
    const { rerender } = render(<ListView kind="task" store={s} canEdit me="me" cues={cues} people={[]} planName="Gala" />);
    fireEvent.click(screen.getByRole('button', { name: /Add task/ }));
    expect(s.add).toHaveBeenCalledWith('task');
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Test both mics' } });
    expect(s.edit).toHaveBeenCalledWith('i1', { title: 'Test both mics' });
    rerender(<ListView kind="task" store={s} canEdit={false} me="me" cues={cues} people={[]} planName="Gala" />);
    fireEvent.click(screen.getByLabelText('Done: Test the mic'));
    expect(s.tick).toHaveBeenCalledWith('i1', true);
  });

  it('adds up the budget', () => {
    const s = itemStore([blankItem('p', 'b1', 'budget', 1, { title: 'Lights', amount: 1000, actual: 1250 })]);
    render(<ListView kind="budget" store={s} canEdit me="me" cues={cues} people={[]} planName="Gala" />);
    expect(screen.getByText('$250.00 over')).toBeInTheDocument();
  });

  it('a cue’s checklist', () => {
    const s = itemStore([blankItem('p', 't1', 'task', 1, { title: 'Check the mic', cueId: 'a' })]);
    render(<CueTasks cueId="a" store={s} canEdit me="me" />);
    expect(screen.getByText('Checklist (0/1)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('New task for this cue'), { target: { value: 'Water on the podium' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(s.add).toHaveBeenCalledWith('task', { title: 'Water on the podium', cueId: 'a' });
  });
});

describe('the public page', () => {
  it('shows the agenda without signing in', async () => {
    publicData.mockResolvedValue({
      scope: 'agenda',
      serverNow: Date.now(),
      plan: { ...plan, name: 'Open house' },
      cues,
      blocks: [],
      crew: [],
      live: null,
    });
    render(<PublicView token="00000000-0000-0000-0000-000000000001" screen="" go={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Open house' })).toBeInTheDocument();
    expect(screen.getByText('Agenda')).toBeInTheDocument();
    expect(screen.queryByText('Spare')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Prompter' })).toBeNull();
  });

  it('says so when the link is off', async () => {
    publicData.mockResolvedValue(null);
    render(<PublicView token="00000000-0000-0000-0000-000000000002" screen="" go={() => {}} />);
    expect(await screen.findByText('This link doesn’t open a plan')).toBeInTheDocument();
  });
});

describe('a new plan', () => {
  it('starts from a template', async () => {
    const made = vi.fn();
    render(<NewPlanDialog userId="me" onBlank={vi.fn(async () => {})} onMade={made} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Spring conference' } });
    fireEvent.click(screen.getByRole('radio', { name: /Conference day/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make the plan' }));
    });
    expect(fromTemplate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'conference' }), 'Spring conference', '', 'me');
    await waitFor(() => expect(made).toHaveBeenCalledWith('from-template'));
  });

  it('lists your own templates', async () => {
    render(<NewPlanDialog userId="me" onBlank={vi.fn(async () => {})} onMade={() => {}} onClose={() => {}} />);
    expect(await screen.findByRole('radio', { name: /Our gala template/ })).toBeInTheDocument();
  });
});
