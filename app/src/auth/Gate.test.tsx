import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Access } from './access';

const approved: Access = { userId: 'u1', email: 'a@b.c', name: 'A', state: 'approved', admin: false, lumora: true, studio: true };
let answer: () => Promise<Access | null> = () => Promise.resolve(approved);
let changed: () => void = () => {};
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
}));

const { Gate } = await import('./Gate');

afterEach(cleanup);

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
