import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Profile } from './access';

let people: Profile[] = [];
const setPerson = vi.fn((_id: string, _c: object) => Promise.resolve());
const resetTwoStep = vi.fn((_id: string) => Promise.resolve());
let step = { on: true, aal2: true, factorId: 'f' };
vi.mock('./auth', () => ({
  listPeople: () => Promise.resolve(people.map((p) => ({ ...p }))),
  setPerson: (id: string, c: object) => setPerson(id, c),
  twoStepStatus: () => Promise.resolve(step),
  twoStepPeople: () => Promise.resolve(new Set(['e'])),
  resetTwoStep: (id: string) => resetTwoStep(id),
  supabase: () => ({}),
}));
vi.mock('./TwoStep', () => ({
  TwoStepSetup: () => <p>Scan this code</p>,
  CodeForm: () => <p>Type your code</p>,
}));
vi.mock('../reports/ReportsAdmin', () => ({ ReportsAdmin: () => null }));

const { PeopleDialog } = await import('./PeopleDialog');

const base = { blocked: false, is_admin: false };
const newcomer: Profile = { ...base, id: 'n', name: 'Nina', email: 'nina@x.org', approved: false, lumora: false, studio: false };
const editor: Profile = { ...base, id: 'e', name: 'Eli', email: 'eli@x.org', approved: true, lumora: false, studio: true };

beforeEach(() => {
  step = { on: true, aal2: true, factorId: 'f' };
  setPerson.mockClear();
  resetTwoStep.mockClear();
  people = [newcomer, editor];
});
afterEach(cleanup);

async function open(tab?: string) {
  render(<PeopleDialog onClose={() => {}} />);
  await act(async () => {});
  if (tab) await act(async () => fireEvent.click(screen.getByRole('button', { name: tab })));
}
const row = (name: string) => screen.getByText(name).closest('.people__row') as HTMLElement;

test('approving needs at least one app ticked, and keeps the chosen apps', async () => {
  await open();
  const r = row('Nina');
  expect(within(r).getByRole('button', { name: 'Approve' })).toBeDisabled();
  expect(within(r).getByText('Tick Lumora and/or Studio, then approve.')).toBeInTheDocument();
  people = [{ ...newcomer, studio: true }, editor];
  await act(async () => fireEvent.click(within(r).getByRole('checkbox', { name: 'Studio' })));
  expect(setPerson).toHaveBeenLastCalledWith('n', { studio: true });
  const approve = within(row('Nina')).getByRole('button', { name: 'Approve' });
  expect(approve).toBeEnabled();
  await act(async () => fireEvent.click(approve));
  // Approval alone: the apps already chosen stay as they are.
  expect(setPerson).toHaveBeenLastCalledWith('n', { approved: true });
});

test('turning an app on or off for an approved person saves at once', async () => {
  await open('Approved');
  const r = row('Eli');
  expect(within(r).getByRole('checkbox', { name: 'Lumora' })).not.toBeChecked();
  expect(within(r).getByRole('checkbox', { name: 'Studio' })).toBeChecked();
  await act(async () => fireEvent.click(within(r).getByRole('checkbox', { name: 'Lumora' })));
  expect(setPerson).toHaveBeenLastCalledWith('e', { lumora: true });
});

test('an approved person keeps at least one app', async () => {
  await open('Approved');
  await act(async () => fireEvent.click(within(row('Eli')).getByRole('checkbox', { name: 'Studio' })));
  expect(setPerson).not.toHaveBeenCalled();
  expect(screen.getByText(/needs at least one app/)).toBeInTheDocument();
});

test('a change that cannot be saved says why', async () => {
  setPerson.mockImplementationOnce(() => Promise.reject(new Error('Lumora cannot reach the internet.')));
  await open('Approved');
  await act(async () => fireEvent.click(within(row('Eli')).getByRole('checkbox', { name: 'Lumora' })));
  expect(screen.getByText('Lumora cannot reach the internet.')).toBeInTheDocument();
});

test('the Lumora team sets up two-step sign-in before anyone is listed', async () => {
  step = { on: false, aal2: false, factorId: null as unknown as string };
  await open();
  expect(screen.getByText('Scan this code')).toBeInTheDocument();
  expect(screen.queryByText('Nina')).toBeNull();
  cleanup();
  step = { on: true, aal2: false, factorId: 'f' };
  await open();
  expect(screen.getByText('Type your code')).toBeInTheDocument();
  expect(screen.queryByText('Nina')).toBeNull();
});

test('accounts made in the Planner are kept apart from people waiting for the apps', async () => {
  const tal: Profile = { ...base, id: 't', name: 'Tal', email: 'tal@x.org', approved: false, lumora: false, studio: false, planner_only: true };
  people = [newcomer, editor, tal];
  await open();
  expect(screen.getByRole('button', { name: 'Waiting (1)' })).toBeInTheDocument();
  const group = screen.getByText(/Planner-only accounts \(1\)/).closest('details') as HTMLElement;
  expect(group).not.toHaveAttribute('open');
  expect(within(group).getByText('Tal')).toBeInTheDocument();
});

test('a lost phone: the team resets two-step sign-in, after a second click', async () => {
  await open('Approved');
  const r = row('Eli');
  await act(async () => fireEvent.click(within(r).getByRole('button', { name: 'Reset two-step' })));
  expect(resetTwoStep).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(within(r).getByRole('button', { name: 'Sure? Reset' })));
  expect(resetTwoStep).toHaveBeenCalledWith('e');
});
