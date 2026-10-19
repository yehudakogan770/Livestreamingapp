import { describe, expect, it } from 'vitest';
import { isComputerSound, isMicrophone, programName } from './computerSound';
import type { Source } from './types/Source';

const mic = (deviceId: string) => ({ id: 'x', name: 'x', kind: { type: 'microphone', deviceId, label: '' } }) as unknown as Source;

describe('this computer’s sound', () => {
  it('is told apart from microphones by its device', () => {
    expect(isComputerSound('lumora:computer')).toBe(true);
    expect(isComputerSound('lumora:app:spotify.exe')).toBe(true);
    expect(isComputerSound('default')).toBe(false);
    expect(isMicrophone(mic('abc123'))).toBe(true);
    expect(isMicrophone(mic('lumora:computer'))).toBe(false);
    expect(programName('lumora:app:spotify.exe')).toBe('Spotify');
    expect(programName('lumora:app:Zoom.EXE')).toBe('Zoom');
  });
});
