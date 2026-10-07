import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AdminSettings, SettingsChange } from './settings';

const saveSettings = vi.fn<(c: SettingsChange) => Promise<AdminSettings>>();
const setOverride = vi.fn((_u: string, _f: string, _on: boolean | null) => Promise.resolve());
const inviteByEmail = vi.fn((_e: string, _l: boolean, _s: boolean) => Promise.resolve({ pending: true }));
const cancelInvite = vi.fn((_e: string) => Promise.resolve());
vi.mock('./settings', async (importOriginal) => {
  const real = await importOriginal<typeof import('./settings')>();
  return {
    ...real,
    saveSettings: (c: SettingsChange) => saveSettings(c),
    setOverride: (u: string, f: string, on: boolean | null) => setOverride(u, f, on),
    inviteByEmail: (e: string, l: boolean, s: boolean) => inviteByEmail(e, l, s),
    cancelInvite: (e: string) => cancelInvite(e),
  };
});
vi.mock('./auth', () => ({ supabase: () => ({}), missingFunction: () => false }));

const { DEFAULT_SETTINGS } = await import('./settings');
const { SignInSettingsTab, FeaturesTab, InvitesTab, PersonFeatures } = await import('./TeamSettings');

let data: AdminSettings;
beforeEach(() => {
  data = {
    settings: { ...DEFAULT_SETTINGS, updated_at: '2026-10-01T15:00:00Z', updated_by_name: 'Ann' },
    invites: [],
    overrides: [],
    log: [
      { id: 2, at: '2026-10-01T15:00:00Z', by_name: 'Ann', setting: 'offline_days', person_email: '', old_value: 14, new_value: 7 },
      { id: 1, at: '2026-09-30T15:00:00Z', by_name: 'Ann', setting: 'features.captions', person_email: '', old_value: null, new_value: true },
    ],
  };
  saveSettings.mockReset();
  saveSettings.mockImplementation((c) => {
    data = { ...data, settings: { ...data.settings, ...c, features: { ...data.settings.features, ...(c.features ?? {}) } } };
    return Promise.resolve(data);
  });
  setOverride.mockClear();
  inviteByEmail.mockClear();
});
afterEach(cleanup);

/** Renders a tab that gets the saved settings back (as People and approvals does). */
function renderTab(Tab: typeof SignInSettingsTab) {
  const onSaved = vi.fn((d: AdminSettings) => r.rerender(<Tab data={d} onSaved={onSaved} />));
  const r = render(<Tab data={data} onSaved={onSaved} />);
  return onSaved;
}

test('the usual settings: approval, open sign-ups, optional two-step, 7 days offline', () => {
  renderTab(SignInSettingsTab);
  expect(screen.getByRole('radio', { name: /Need my approval/ })).toBeChecked();
  expect(screen.getByRole('radio', { name: /^Open/ })).toBeChecked();
  expect(screen.getByRole('radio', { name: /Optional for everyone/ })).toBeChecked();
  expect(screen.getByRole('radio', { name: '7 days' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: /Approved Lumora accounts make new plans/ })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  expect(screen.getByText(/Last changed by Ann on Oct 1, 2026/)).toBeInTheDocument();
});

test('a change is saved after a confirmation, then says “Saved”', async () => {
  renderTab(SignInSettingsTab);
  fireEvent.click(screen.getByRole('radio', { name: /Approve automatically/ }));
  // Which apps automatically approved accounts get.
  fireEvent.click(screen.getByRole('checkbox', { name: 'Studio' }));
  fireEvent.change(screen.getByLabelText(/Only for emails from these domains/), { target: { value: '@MyCompany.com' } });
  fireEvent.click(screen.getByRole('radio', { name: /^Closed/ }));
  fireEvent.click(screen.getByRole('radio', { name: '14 days' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  const confirm = screen.getByRole('alertdialog', { name: 'Save these changes?' });
  expect(within(confirm).getByText('New accounts: Approve automatically')).toBeInTheDocument();
  expect(within(confirm).getByText('New sign-ups: Closed')).toBeInTheDocument();
  expect(within(confirm).getByText('Offline use: 14 days')).toBeInTheDocument();
  expect(saveSettings).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, save' })));
  expect(saveSettings).toHaveBeenCalledWith({ approval: 'auto', auto_studio: false, auto_domains: ['mycompany.com'], signups: 'closed', offline_days: 14 });
  expect(screen.getByRole('status')).toHaveTextContent('Saved');
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});

test('keep editing: nothing is saved', () => {
  renderTab(SignInSettingsTab);
  fireEvent.click(screen.getByRole('radio', { name: /Any account makes new plans/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(saveSettings).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Undo changes' }));
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});

test('automatic approval needs an app, and domains must be domains', async () => {
  renderTab(SignInSettingsTab);
  fireEvent.click(screen.getByRole('radio', { name: /Approve automatically/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Lumora' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Studio' }));
  expect(screen.getByText('Choose at least one app.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Only for emails from these domains/), { target: { value: 'not a domain' } });
  expect(screen.getByText(/“not” is not a domain/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, save' })));
  expect(saveSettings).not.toHaveBeenCalled();
  expect(within(screen.getByRole('alertdialog')).getByText('“not” is not a domain (like mycompany.com).')).toBeInTheDocument();
});

test('requiring two-step sign-in warns to turn it on for yourself first; a refusal from the server is shown', async () => {
  saveSettings.mockImplementationOnce(() => Promise.reject(new Error('Turn on two-step sign-in for your own account first.')));
  renderTab(SignInSettingsTab);
  fireEvent.click(screen.getByRole('radio', { name: /Required for everyone/ }));
  expect(screen.getByText(/Turn on two-step sign-in for your own account first \(My account/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, save' })));
  expect(saveSettings).toHaveBeenCalledWith({ two_step: 'everyone' });
  expect(screen.getByText('Turn on two-step sign-in for your own account first.')).toBeInTheDocument();
});

test('the waiting message is saved, and the history says who changed what', async () => {
  renderTab(SignInSettingsTab);
  fireEvent.change(screen.getByRole('textbox', { name: 'Waiting message' }), { target: { value: 'Call Dana.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, save' })));
  expect(saveSettings).toHaveBeenCalledWith({ waiting_message: 'Call Dana.' });
  expect(screen.getByText('History of changes (1)')).toBeInTheDocument();
  expect(screen.getByText('Ann changed Offline use from 14 days to 7 days')).toBeInTheDocument();
});

test('features: switch off for everyone, pause an app with a message', async () => {
  renderTab(FeaturesTab);
  const captions = screen.getByRole('switch', { name: 'Live captions' });
  expect(captions).toBeChecked();
  fireEvent.click(captions);
  fireEvent.click(screen.getByRole('switch', { name: 'Lumora Planner' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message while paused' }), { target: { value: 'Back at 6 PM' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  const confirm = screen.getByRole('alertdialog');
  expect(within(confirm).getByText('Live captions: off')).toBeInTheDocument();
  expect(within(confirm).getByText('Lumora Planner: paused')).toBeInTheDocument();
  await act(async () => fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, save' })));
  expect(saveSettings).toHaveBeenCalledWith({ features: { planner: false, captions: false }, pause_messages: { planner: 'Back at 6 PM' } });
  expect(screen.getByRole('status')).toHaveTextContent('Saved');
  expect(screen.getByRole('switch', { name: 'Live captions' })).not.toBeChecked();
  expect(screen.getByText('Ann turned Live captions on for everyone')).toBeInTheDocument();
});

test('one person: a feature on or off just for them, saved at once', async () => {
  data.settings.features = { captions: false };
  data.overrides = [{ user_id: 'e', feature: 'ai_tools', enabled: false }];
  render(<PersonFeatures userId="e" name="Eli" admin={false} data={data} onChanged={() => {}} />);
  const captions = screen.getByRole('combobox', { name: 'Live captions for Eli' });
  expect(captions).toHaveValue('default');
  expect(within(captions).getByRole('option', { name: 'As for everyone (off)' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'AI features for Eli' })).toHaveValue('off');
  await act(async () => fireEvent.change(captions, { target: { value: 'on' } }));
  expect(setOverride).toHaveBeenCalledWith('e', 'captions', true);
  expect(screen.getByRole('status')).toHaveTextContent('Saved');
  await act(async () => fireEvent.change(screen.getByRole('combobox', { name: 'AI features for Eli' }), { target: { value: 'default' } }));
  expect(setOverride).toHaveBeenLastCalledWith('e', 'ai_tools', null);
});

test('invite by email, with the chosen apps; waiting invitations can be cancelled', async () => {
  data.invites = [{ email: 'old@x.org', lumora: false, studio: true, invited_by_name: 'Ann', created_at: '2026-10-01T15:00:00Z' }];
  const changed = vi.fn();
  render(<InvitesTab data={data} onChanged={changed} />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@x.org' } });
  fireEvent.click(within(screen.getByRole('group', { name: 'Apps for this invitation' })).getByRole('checkbox', { name: 'Studio' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Invite' })));
  expect(inviteByEmail).toHaveBeenCalledWith('new@x.org', true, true);
  expect(screen.getByText(/Invited\. Lumora doesn’t send an email/)).toBeInTheDocument();
  expect(changed).toHaveBeenCalled();
  expect(screen.getByText('Studio only')).toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel invitation' })));
  expect(cancelInvite).toHaveBeenCalledWith('old@x.org');
});
