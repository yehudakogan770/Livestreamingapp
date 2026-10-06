import { describe, expect, it } from 'vitest';
import type { Access } from '../../app/src/auth/access';
import { verdict } from './session';

const lumora: Access = { userId: 'u', email: 'u@x.org', name: 'U', state: 'approved', admin: false, lumora: true, studio: false };

describe('who may do what in the Planner', () => {
  it('an approved account with Lumora makes plans', () => {
    expect(verdict(lumora)).toMatchObject({ s: 'in', canPlan: true });
    expect(verdict({ ...lumora, admin: true, lumora: false })).toMatchObject({ s: 'in', canPlan: true });
  });

  it('a teammate (any account, not approved or without Lumora) works only on plans shared with them', () => {
    expect(verdict({ ...lumora, state: 'pending', lumora: false })).toMatchObject({ s: 'in', canPlan: false });
    expect(verdict({ ...lumora, lumora: false, studio: true })).toMatchObject({ s: 'in', canPlan: false });
  });

  it('a blocked account is not let in', () => {
    expect(verdict({ ...lumora, state: 'blocked' }).s).toBe('denied');
  });

  it('with two-step sign-in on, the code comes first', () => {
    expect(verdict({ ...lumora, twoStep: true, codeNeeded: true }).s).toBe('code');
    expect(verdict({ ...lumora, state: 'pending', twoStep: true, codeNeeded: true }).s).toBe('code');
    expect(verdict({ ...lumora, twoStep: true, aal2: true })).toMatchObject({ s: 'in', canPlan: true });
  });
});
