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
let adminData: unknown = null;
vi.mock('./settings', async (importOriginal) => {
  const real = await importOriginal<typeof import('./settings')>();
  return {
    ...real,
    loadAdminSettings: () =>
      adminData
        ? Promise.resolve(real.adminSettingsFrom(adminData))
        : Promise.reject(new Error('These settings need the latest update on the Lumora account server.')),
    setOverride: () => Promise.resolve(),
  };
});

const { PeopleDialog } = await import('./PeopleDialog');

const base = { blocked: false, is_admin: false };
const newcomer: Profile = { ...base, id: 'n', name: 'Nina', email: 'nina@x.org', approved: false, lumora: false, studio: false };
const editor: Profile = { ...base, id: 'e', name: 'Eli', email: 'eli@x.org', approved: true, lumora: false, studio: true };

beforeEach(() => {
  step = { on: true, aal2: true, factorId: 'f' };
  setPerson.mockClear();
  resetTwoStep.mockClear();
  people = [newcomer, editor];
  adminData = {
    settings: { two_step: 'optional' },
    invites: [{ email: 'z@x.org', lumora: true, studio: false, invited_by_name: 'Ann', created_at: '2026-10-01' }],
    overrides: [{ user_id: 'e', feature: 'captions', enabled: false }],
    log: [],
  };
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

test('two-step sign-in is optional for the Lumora team, but asks for the code when it is on', async () => {
  step = { on: false, aal2: false, factorId: null as unknown as string };
  await open();
  expect(screen.queryByText('Scan this code')).toBeNull();
  expect(screen.getByText('Nina')).toBeInTheDocument();
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

test('the Lumora team controls sign-in and features from here', async () => {
  await open('Sign-in settings');
  expect(screen.getByRole('radio', { name: /Need my approval/ })).toBeChecked();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Features' })));
  expect(screen.getByRole('switch', { name: 'Live captions' })).toBeChecked();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Invited (1)' })));
  expect(screen.getByText('z@x.org')).toBeInTheDocument();
});

test('one person’s features open from their row', async () => {
  await open('Approved');
  const r = row('Eli');
  await act(async () => fireEvent.click(within(r).getByRole('button', { name: 'Features (1)' })));
  expect(within(r).getByRole('combobox', { name: 'Live captions for Eli' })).toHaveValue('off');
});

test('before the server update, People still works and the settings say what to run', async () => {
  adminData = null;
  await open();
  expect(screen.getByText('Nina')).toBeInTheDocument();
  expect(within(row('Nina')).queryByRole('button', { name: /^Features/ })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign-in settings' })));
  expect(screen.getByText(/need the latest update/)).toBeInTheDocument();
});
