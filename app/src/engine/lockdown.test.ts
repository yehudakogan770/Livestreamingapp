import { describe, expect, it } from 'vitest';
import { blockedKey } from './lockdown';

const k = (key: string, mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}) => ({ key, ctrlKey: false, shiftKey: false, metaKey: false, ...mods });

describe('lockdown keys', () => {
  it('blocks developer tools, view-source and reload', () => {
    expect(blockedKey(k('F12'))).toBe(true);
    expect(blockedKey(k('I', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(blockedKey(k('u', { ctrlKey: true }))).toBe(true);
    expect(blockedKey(k('r', { ctrlKey: true }))).toBe(true);
    expect(blockedKey(k('F5'))).toBe(true);
  });
  it("leaves Lumora's own keys alone", () => {
    expect(blockedKey(k('1', { ctrlKey: true }))).toBe(false);
    expect(blockedKey(k('=', { ctrlKey: true }))).toBe(false);
    expect(blockedKey(k(' '))).toBe(false);
    expect(blockedKey(k('Enter'))).toBe(false);
    expect(blockedKey(k('c', { ctrlKey: true }))).toBe(false);
    expect(blockedKey(k('v', { ctrlKey: true }))).toBe(false);
  });
});
