import { beforeEach, describe, expect, it } from 'vitest';
import type { Access } from '../../app/src/auth/access';
import { KEEP_PLANS, clearCache, offlineWho, rememberPlan, rememberPlans, rememberWho, savedPlan, savedPlans, setCacheUser } from './offlineCache';
import type { Plan, PlanSummary } from './model';

const access = (id: string): Access => ({ userId: id, email: `${id}@x.org`, name: id, state: 'approved', admin: false, lumora: true, studio: false });
const signIn = (id: string) => localStorage.setItem('lumora.planner', JSON.stringify({ access_token: 't', user: { id } }));
const summary = (id: string): PlanSummary => ({
  id,
  name: `Plan ${id}`,
  eventDate: '2026-10-06',
  venue: '',
  startTime: '',
  role: 'owner',
  ownerName: 'Pat',
  cueCount: 0,
  updatedAt: 0,
  updatedBy: '',
});
const plan = (id: string): Plan => ({ id, owner: 'a', name: `Plan ${id}`, eventDate: '', venue: '', startTime: '', notes: '', updatedAt: 0, updatedBy: '' });

describe('the copy of the plans kept on this device', () => {
  beforeEach(() => {
    localStorage.clear();
    setCacheUser(null);
  });

  it('opens with no internet as the account signed in here, read from its own copy', () => {
    signIn('a');
    rememberWho({ s: 'in', access: access('a'), canPlan: true });
    rememberPlans([summary('p1')]);
    rememberPlan('p1', { plan: plan('p1'), cues: [], role: 'owner' });
    setCacheUser(null);

    const who = offlineWho();
    expect(who?.access.userId).toBe('a');
    expect(who?.access.offline).toBe(true);
    expect(savedPlans()?.plans.map((p) => p.id)).toEqual(['p1']);
    expect(savedPlan('p1')?.plan?.name).toBe('Plan p1');
  });

  it('keeps one copy per account: another account signed in here sees nothing of it', () => {
    signIn('a');
    rememberWho({ s: 'in', access: access('a'), canPlan: true });
    rememberPlans([summary('p1')]);
    signIn('b');
    expect(offlineWho()).toBeNull();
    setCacheUser('b');
    expect(savedPlans()).toBeNull();
    expect(savedPlan('p1')).toBeNull();
  });

  it('needs a sign-in on this device', () => {
    rememberWho({ s: 'in', access: access('a'), canPlan: true });
    rememberPlans([summary('p1')]);
    expect(offlineWho()).toBeNull();
  });

  it('adds what loads to the plan’s copy, and keeps only the plans opened most recently', () => {
    setCacheUser('a');
    rememberPlan('p0', { plan: plan('p0') });
    rememberPlan('p0', { blocks: [] });
    expect(savedPlan('p0')).toMatchObject({ plan: { id: 'p0' }, blocks: [] });
    for (let i = 1; i <= KEEP_PLANS + 3; i++) rememberPlan(`p${i}`, { plan: plan(`p${i}`) });
    const raw = JSON.parse(localStorage.getItem('lumora.planner.cache.a')!) as { open: Record<string, unknown> };
    expect(Object.keys(raw.open).length).toBeLessThanOrEqual(KEEP_PLANS);
    expect(savedPlan(`p${KEEP_PLANS + 3}`)).not.toBeNull();
  });

  it('is cleared on sign out, for every account', () => {
    setCacheUser('a');
    rememberPlans([summary('p1')]);
    setCacheUser('b');
    rememberPlans([summary('p2')]);
    localStorage.setItem('lumora.planner.theme', 'dark');
    clearCache();
    expect(Object.keys(localStorage).filter((k) => k.startsWith('lumora.planner.cache.'))).toEqual([]);
    expect(localStorage.getItem('lumora.planner.theme')).toBe('dark');
    expect(savedPlans()).toBeNull();
  });
});
