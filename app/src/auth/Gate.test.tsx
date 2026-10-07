import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Access } from './access';
import { rulesFrom } from './rules';

const approved: Access = { userId: 'u1', email: 'a@b.c', name: 'A', state: 'approved', admin: false, lumora: true, studio: true };
let answer: () => Promise<Access | null> = () => Promise.resolve(approved);
let changed: () => void = () => {};
let signUpsAreOpen = true;
vi.mock('./config', () => ({ AUTH_URL: 'x', AUTH_KEY: 'x', authOn: () => true }));
vi.mock('../e2e', () => ({ TEST_BUILD: false }));
vi.mock('./auth', () => ({
  checkAccess: () => answer(),
  onSignInChange: (f: () => void) => {
    changed = f;
    return () => {};
  },
  signIn: vi.fn(),
  signOut: () => Promise.resolve(),
  signUp: vi.fn(),
  signUpsOpen: () => Promise.resolve(signUpsAreOpen),
  supabase: () => ({}),
  MIN_PASSWORD: 10,
}));
vi.mock('./TwoStep', () => ({ CodeForm: () => <p>Type your code</p>, TwoStepSetup: () => <p>Scan this code</p> }));

const { Gate, useFeature } = await import('./Gate');

afterEach(() => {
  cleanup();
  signUpsAreOpen = true;
});

test('a sign-in that lapses during the event never closes Lumora', async () => {
  answer = () => Promise.resolve(approved);
  render(
    <Gate product="lumora">
      <p>The show</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.getByText('The show')).toBeInTheDocument();
  // The session can't be renewed (no internet): signed out, then an error.
  answer = () => Promise.resolve(null);
  await act(async () => changed());
  expect(screen.getByText('The show')).toBeInTheDocument();
  answer = () => Promise.reject(new Error('Lumora cannot reach the internet.'));
  await act(async () => changed());
  expect(screen.getByText('The show')).toBeInTheDocument();
});

test('an approved account without Lumora Studio sees why, and can check again', async () => {
  answer = () => Promise.resolve({ ...approved, studio: false });
  render(
    <Gate product="studio">
      <p>The editor</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.queryByText('The editor')).toBeNull();
  expect(screen.getByRole('heading')).toHaveTextContent("Your account isn't set up for Lumora Studio.");
  expect(screen.getByText('Contact the Lumora team for help.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  // The team turns Studio on.
  answer = () => Promise.resolve(approved);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Check again' })));
  expect(screen.getByText('The editor')).toBeInTheDocument();
});

test('the same account can be turned off for Lumora but on for Studio', async () => {
  answer = () => Promise.resolve({ ...approved, lumora: false });
  render(
    <Gate product="lumora">
      <p>The show</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.queryByText('The show')).toBeNull();
  expect(screen.getByRole('heading')).toHaveTextContent("Your account isn't set up for Lumora.");
  cleanup();
  render(
    <Gate product="studio">
      <p>The editor</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.getByText('The editor')).toBeInTheDocument();
});

test('an account waiting for approval can use neither app', async () => {
  answer = () => Promise.resolve({ ...approved, state: 'pending' });
  for (const product of ['lumora', 'studio'] as const) {
    render(
      <Gate product={product}>
        <p>Inside</p>
      </Gate>,
    );
    await act(async () => {});
    expect(screen.queryByText('Inside')).toBeNull();
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
    cleanup();
  }
});

test('the Lumora team always gets in', async () => {
  answer = () => Promise.resolve({ ...approved, admin: true, lumora: false, studio: false });
  render(
    <Gate product="studio">
      <p>The editor</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.getByText('The editor')).toBeInTheDocument();
});

test('if the account is blocked during the event, Lumora stays open and says so', async () => {
  answer = () => Promise.resolve(approved);
  render(
    <Gate product="lumora">
      <p>The show</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.queryByRole('status')).toBeNull();
  answer = () => Promise.resolve({ ...approved, state: 'blocked' });
  await act(async () => changed());
  expect(screen.getByText('The show')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Your access has changed; Lumora will close the next time it starts.');
  // Or the app turned off for this account: the same.
  cleanup();
  answer = () => Promise.resolve(approved);
  render(
    <Gate product="studio">
      <p>The editor</p>
    </Gate>,
  );
  await act(async () => {});
  answer = () => Promise.resolve({ ...approved, studio: false });
  await act(async () => changed());
  expect(screen.getByText('The editor')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Lumora Studio will close the next time it starts');
});

test('with two-step sign-in on, the app opens only after the code', async () => {
  answer = () => Promise.resolve({ ...approved, twoStep: true, codeNeeded: true });
  render(
    <Gate product="lumora">
      <p>The show</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.queryByText('The show')).toBeNull();
  expect(screen.getByText('Type your code')).toBeInTheDocument();
  answer = () => Promise.resolve({ ...approved, twoStep: true, aal2: true });
  await act(async () => changed());
  expect(screen.getByText('The show')).toBeInTheDocument();
});

test('making an account links to the Terms of Use and Privacy Policy, opened in the browser', async () => {
  answer = () => Promise.resolve(null);
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  render(
    <Gate product="lumora">
      <p>The show</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Terms of Use' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Make an account' }));
  expect(screen.getByText(/By creating an account, you agree to the/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Terms of Use' }));
  fireEvent.click(screen.getByRole('button', { name: 'Privacy Policy' }));
  expect(open.mock.calls.map((c) => c[0])).toEqual([expect.stringMatching(/\/terms\.html$/), expect.stringMatching(/\/privacy\.html$/)]);
  open.mockRestore();
});

// ---- The Lumora team's sign-in settings and features ----

test('the waiting and no-access screens show the Lumora team’s own words', async () => {
  const rules = rulesFrom({ waiting_message: 'Email help@mycompany.com and we’ll set you up.' });
  answer = () => Promise.resolve({ ...approved, studio: false, rules });
  render(
    <Gate product="studio">
      <p>The editor</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.getByRole('heading')).toHaveTextContent("Your account isn't set up for Lumora Studio.");
  expect(screen.getByText('Email help@mycompany.com and we’ll set you up.')).toBeInTheDocument();
  expect(screen.queryByText('Contact the Lumora team for help.')).toBeNull();
  cleanup();
  answer = () => Promise.resolve({ ...approved, state: 'pending', rules });
  render(
    <Gate product="lumora">
      <p>The show</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
  expect(screen.getByText('Email help@mycompany.com and we’ll set you up.')).toBeInTheDocument();
});

test('two-step sign-in required by the Lumora team: set it up first', async () => {
  answer = () => Promise.resolve({ ...approved, setupNeeded: true, rules: rulesFrom({ two_step: 'everyone', two_step_required: true }) });
  render(
    <Gate product="lumora">
      <p>The show</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.queryByText('The show')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Set up two-step sign-in' })).toBeInTheDocument();
  expect(screen.getByText('Scan this code')).toBeInTheDocument();
  answer = () => Promise.resolve({ ...approved, twoStep: true, aal2: true });
  await act(async () => changed());
  expect(screen.getByText('The show')).toBeInTheDocument();
});

test('a paused app shows the Lumora team’s message; a show already running is never closed', async () => {
  const pausedRules = rulesFrom({ features: { lumora: false }, pause_messages: { lumora: 'Paused for maintenance until 6 PM.' } });
  answer = () => Promise.resolve({ ...approved, rules: pausedRules });
  render(
    <Gate product="lumora">
      <p>The show</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.getByRole('heading', { name: 'Lumora is paused' })).toBeInTheDocument();
  expect(screen.getByText('Paused for maintenance until 6 PM.')).toBeInTheDocument();
  cleanup();
  answer = () => Promise.resolve(approved);
  render(
    <Gate product="lumora">
      <p>The show</p>
    </Gate>,
  );
  await act(async () => {});
  answer = () => Promise.resolve({ ...approved, rules: pausedRules });
  await act(async () => changed());
  expect(screen.getByText('The show')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('The Lumora team has paused Lumora: Paused for maintenance until 6 PM.');
});

function Captions({ inUse }: { inUse: boolean }) {
  return <p>{useFeature('captions', inUse) ? 'Captions available' : 'Captions off'}</p>;
}

test('a feature switched off while open: what is in use keeps working, and a note says so', async () => {
  answer = () => Promise.resolve(approved);
  const { rerender } = render(
    <Gate product="lumora">
      <Captions inUse />
    </Gate>,
  );
  await act(async () => {});
  expect(screen.getByText('Captions available')).toBeInTheDocument();
  answer = () => Promise.resolve({ ...approved, rules: rulesFrom({ features: { captions: false } }) });
  await act(async () => changed());
  expect(screen.getByText('Captions available')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('The Lumora team turned off Live captions. Anything in use keeps working');
  // Stopped: now it is off.
  rerender(
    <Gate product="lumora">
      <Captions inUse={false} />
    </Gate>,
  );
  expect(screen.getByText('Captions off')).toBeInTheDocument();
});

test('closed sign-ups: no “Make an account”, except for invited people', async () => {
  signUpsAreOpen = false;
  answer = () => Promise.resolve(null);
  render(
    <Gate product="lumora">
      <p>The show</p>
    </Gate>,
  );
  await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Make an account' })).toBeNull();
  expect(screen.getByText(/Invited by the Lumora team\?/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Make your account' }));
  expect(screen.getByText('New sign-ups are closed: use the email address the Lumora team invited.')).toBeInTheDocument();
});
