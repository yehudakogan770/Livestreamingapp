import { act, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { Access } from './access';

const approved: Access = { userId: 'u1', email: 'a@b.c', name: 'A', state: 'approved', admin: false };
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

test('a sign-in that lapses during the event never closes Lumora', async () => {
  render(
    <Gate>
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
