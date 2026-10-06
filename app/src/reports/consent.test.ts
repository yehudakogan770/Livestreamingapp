import { beforeEach, describe, expect, it } from 'vitest';
import { mayAutoSend, onConsentChange, readConsent, setConsent, shouldAsk } from './consent';
import { TEST_BUILD } from '../e2e';

describe('asking before sending error reports', () => {
  beforeEach(() => localStorage.clear());

  it('sends nothing until the person says yes', () => {
    expect(readConsent()).toBe('unasked');
    expect(mayAutoSend(readConsent())).toBe(false);
    setConsent('no');
    expect(mayAutoSend(readConsent())).toBe(false);
    setConsent('yes');
    expect(mayAutoSend(readConsent())).toBe(true);
  });

  it('asks once, only when signed in, never in the test build', () => {
    expect(shouldAsk('unasked', true, false)).toBe(true);
    expect(shouldAsk('unasked', false, false)).toBe(false);
    expect(shouldAsk('unasked', true, true)).toBe(false);
    expect(shouldAsk('no', true, false)).toBe(false);
    expect(shouldAsk('yes', true, false)).toBe(false);
  });

  it('remembers the answer, tells the menus, and copes without storage', () => {
    const heard: string[] = [];
    const stop = onConsentChange((c) => heard.push(c));
    setConsent('yes');
    stop();
    setConsent('no');
    expect(heard).toEqual(['yes']);
    expect(readConsent()).toBe('no');
    localStorage.setItem('lumora.errorReports', 'maybe');
    expect(readConsent()).toBe('unasked');
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readConsent(broken)).toBe('unasked');
    expect(() => setConsent('yes', null)).not.toThrow();
  });

  it('is not a test build (the sign-in can only be skipped in the CI test build)', () => {
    expect(TEST_BUILD).toBe(false);
  });
});
