import { describe, expect, it } from 'vitest';
import type { Access } from '../../app/src/auth/access';
import { rulesFrom } from '../../app/src/auth/rules';
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

  it('the Lumora team can let any account make plans (the server says)', () => {
    const anyone = rulesFrom({ planner_makers: 'anyone', can_make_plans: true });
    expect(verdict({ ...lumora, state: 'pending', lumora: false, rules: anyone })).toMatchObject({ s: 'in', canPlan: true });
    expect(verdict({ ...lumora, rules: rulesFrom({ can_make_plans: false }) })).toMatchObject({ s: 'in', canPlan: false });
  });

  it('a paused Planner shows the Lumora team’s message (the team still gets in)', () => {
    const paused = rulesFrom({ features: { planner: false }, pause_messages: { planner: 'Back at 6 PM' } });
    expect(verdict({ ...lumora, rules: paused })).toMatchObject({ s: 'denied', title: 'The Planner is paused', why: 'Back at 6 PM' });
    expect(verdict({ ...lumora, admin: true, rules: paused }).s).toBe('in');
  });

  it('two-step sign-in required and not set up: set it up first', () => {
    expect(verdict({ ...lumora, setupNeeded: true }).s).toBe('setup');
  });
});
