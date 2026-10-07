import { describe, expect, it } from 'vitest';
import { accessFrom, cachedAccess, mayUse } from './access';
import { DEFAULT_RULES, effectiveFeature, featureOn, keepWhileInUse, rulesFrom, turnedOff } from './rules';
import { describeChange, parseDomains, validDomain } from './settings';

const p = { id: 'u1', email: 'a@b.c', name: 'Ann', approved: true, blocked: false, is_admin: false };
const day = 86_400_000;

describe('the sign-in rules from the server', () => {
  it('reads the server’s answer', () => {
    const r = rulesFrom({
      signups: 'closed',
      two_step: 'everyone',
      two_step_required: true,
      offline_days: 14,
      planner_makers: 'anyone',
      can_make_plans: true,
      waiting_message: 'Call Dana.',
      features: { captions: false, planner: true, nonsense: false },
      pause_messages: { planner: 'Back at 6 PM' },
    });
    expect(r).toEqual({
      signups: 'closed',
      twoStep: 'everyone',
      twoStepRequired: true,
      offlineDays: 14,
      plannerMakers: 'anyone',
      canMakePlans: true,
      waitingMessage: 'Call Dana.',
      features: { captions: false, planner: true },
      pauseMessages: { planner: 'Back at 6 PM' },
    });
  });

  it('anything missing or odd keeps the usual behavior', () => {
    expect(rulesFrom(null)).toEqual(DEFAULT_RULES);
    expect(rulesFrom({ offline_days: 5, signups: 'maybe', two_step: 'sometimes' })).toMatchObject({ offlineDays: 7, signups: 'open', twoStep: 'optional' });
    // A remembered copy (already read once) reads the same.
    const r = rulesFrom({ offline_days: 3, features: { ai_tools: false } });
    expect(rulesFrom(r)).toEqual(r);
  });

  it('features are on unless switched off', () => {
    expect(featureOn(undefined, 'captions')).toBe(true);
    expect(featureOn(rulesFrom({ features: { captions: false } }), 'captions')).toBe(false);
    expect(featureOn(rulesFrom({ features: { captions: false } }), 'ai_tools')).toBe(true);
  });

  it('one person’s setting wins over the setting for everyone; the team is never paused', () => {
    expect(effectiveFeature('captions', {}, undefined)).toBe(true);
    expect(effectiveFeature('captions', { captions: false }, undefined)).toBe(false);
    expect(effectiveFeature('captions', { captions: false }, true)).toBe(true);
    expect(effectiveFeature('captions', {}, false)).toBe(false);
    expect(effectiveFeature('planner', { planner: false }, undefined, true)).toBe(true);
    expect(effectiveFeature('planner', { planner: false }, false, true)).toBe(true);
    expect(effectiveFeature('captions', {}, false, true)).toBe(false);
  });

  it('something in use stays on when switched off, until it is no longer in use', () => {
    expect(keepWhileInUse(false, true, true)).toBe(true);
    expect(keepWhileInUse(false, false, true)).toBe(false);
    expect(keepWhileInUse(false, true, false)).toBe(false);
    expect(keepWhileInUse(true, false, false)).toBe(true);
  });

  it('notices which features were switched off', () => {
    expect(turnedOff(DEFAULT_RULES, rulesFrom({ features: { captions: false, lumora: false } }))).toEqual(['captions']);
    expect(turnedOff(rulesFrom({ features: { captions: false } }), rulesFrom({ features: { captions: false } }))).toEqual([]);
  });
});

describe('the rules in the apps', () => {
  it('offline use lasts the days the Lumora team chose', () => {
    const short = { ...accessFrom(p), rules: rulesFrom({ offline_days: 1 }), at: 0 };
    expect(cachedAccess(short, 'u1', day / 2)).not.toBeNull();
    expect(cachedAccess(short, 'u1', 2 * day)).toBeNull();
    const long = { ...accessFrom(p), rules: rulesFrom({ offline_days: 30 }), at: 0 };
    expect(cachedAccess(long, 'u1', 20 * day)).not.toBeNull();
    expect(cachedAccess(long, 'u1', 31 * day)).toBeNull();
    // Remembered before the setting existed: 7 days.
    const old = { ...accessFrom(p), at: 0 };
    expect(cachedAccess(old, 'u1', 6 * day)).not.toBeNull();
    expect(cachedAccess(old, 'u1', 8 * day)).toBeNull();
  });

  it('an app paused, or two-step sign-in still to set up, keeps the app closed (not for the team’s pause)', () => {
    const a = accessFrom(p);
    expect(mayUse({ ...a, rules: rulesFrom({ features: { lumora: false } }) }, 'lumora')).toBe(false);
    expect(mayUse({ ...a, rules: rulesFrom({ features: { lumora: false } }) }, 'studio')).toBe(true);
    expect(mayUse({ ...accessFrom({ ...p, is_admin: true }), rules: rulesFrom({ features: { lumora: false } }) }, 'lumora')).toBe(true);
    expect(mayUse({ ...a, setupNeeded: true }, 'lumora')).toBe(false);
  });

  it('a remembered answer that still needed two-step setup is not used offline', () => {
    expect(cachedAccess({ ...accessFrom(p), setupNeeded: true, at: 0 }, 'u1', 1000)).toBeNull();
  });
});

describe('words for the Lumora team', () => {
  it('cleans up a list of domains', () => {
    expect(parseDomains(' @MyCompany.com, partner.org\nmycompany.com ')).toEqual(['mycompany.com', 'partner.org']);
    expect(validDomain('mycompany.com')).toBe(true);
    expect(validDomain('not a domain')).toBe(false);
    expect(validDomain('localhost')).toBe(false);
  });

  it('describes each change in a sentence', () => {
    const e = { id: 1, at: '2026-10-06T15:00:00Z', by_name: 'Ann', person_email: '', old_value: 'open', new_value: 'closed', setting: 'signups' };
    expect(describeChange(e)).toBe('Ann changed New sign-ups from Open to Closed');
    expect(describeChange({ ...e, setting: 'features.captions', old_value: null, new_value: false })).toBe('Ann turned Live captions off for everyone');
    expect(describeChange({ ...e, setting: 'person.ai_tools', person_email: 'eli@x.org', old_value: null, new_value: true })).toBe(
      'Ann set AI features for eli@x.org: on',
    );
    expect(describeChange({ ...e, setting: 'offline_days', old_value: 7, new_value: 1 })).toBe('Ann changed Offline use from 7 days to 1 day');
    expect(describeChange({ ...e, setting: 'invite', person_email: 'z@x.org', new_value: { lumora: true, studio: false, pending: true } })).toBe(
      'Ann invited z@x.org (Lumora)',
    );
  });
});
