import { describe, expect, it } from 'vitest';
import { aalOf, cleanCode, isCode, sayCode } from './mfa';

const token = (payload: object) =>
  `x.${btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')}.y`;

describe('two-step sign-in', () => {
  it('reads how a session signed in from its token', () => {
    expect(aalOf(token({ sub: 'u', aal: 'aal2' }))).toBe('aal2');
    expect(aalOf(token({ sub: 'u', aal: 'aal1', name: '>>>???' }))).toBe('aal1');
    expect(aalOf(token({ sub: 'u' }))).toBeNull();
    expect(aalOf('nonsense')).toBeNull();
    expect(aalOf(undefined)).toBeNull();
  });

  it('takes a code as people type it', () => {
    expect(cleanCode('123 456')).toBe('123456');
    expect(isCode('123-456')).toBe(true);
    expect(isCode('12345')).toBe(false);
    expect(isCode('12345a')).toBe(false);
  });

  it('says what went wrong in plain words', () => {
    expect(sayCode({ message: 'Invalid TOTP code entered' }).message).toMatch(/not right/);
    expect(sayCode({ message: 'AAL2 required to unenroll verified factor' }).message).toMatch(/current code/);
  });
});
