import { describe, expect, it } from 'vitest';
import type { Macro } from '../engine/types/Macro';
import { hotkeyProblem, hotkeyTaken, keyName, macroForKey, macroTime, MacroRecorder, stepFromAction, withMacroTime } from './macros';

const key = (over: Partial<KeyboardEvent>) => ({ key: 'a', code: 'KeyA', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });

const mac = (id: string, hotkey = '', steps = 1): Macro => ({
  id,
  name: id,
  hotkey,
  steps: Array.from({ length: steps }, () => ({ type: 'take' as const, screen: 'live' as const })),
});

describe('macro keys', () => {
  it('names key presses the same on every keyboard layout', () => {
    expect(keyName(key({ ctrlKey: true, code: 'Digit1', key: '1' }))).toBe('Ctrl+1');
    expect(keyName(key({ ctrlKey: true, shiftKey: true, code: 'Digit5', key: '%' }))).toBe('Ctrl+Shift+5');
    expect(keyName(key({ altKey: true, code: 'KeyM', key: 'µ' }))).toBe('Alt+M');
    expect(keyName(key({ key: 'F7', code: 'F7' }))).toBe('F7');
    expect(keyName(key({ metaKey: true, code: 'KeyK', key: 'k' }))).toBe('Ctrl+K');
    expect(keyName(key({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBeNull();
  });

  it('keeps keys Lumora and Windows already use free', () => {
    expect(hotkeyProblem('Ctrl+1')).toBeNull();
    expect(hotkeyProblem('F9')).toBeNull();
    expect(hotkeyProblem('')).toBeNull();
    expect(hotkeyProblem('B')).toMatch(/Ctrl or Alt/);
    expect(hotkeyProblem('Shift+5')).toMatch(/Ctrl or Alt/);
    expect(hotkeyProblem('F2')).toMatch(/choose the screen/);
    expect(hotkeyProblem('Ctrl+Z')).toMatch(/already used/);
  });

  it('finds the macro a key runs, and a key already taken', () => {
    const list = [mac('a', 'Ctrl+1'), mac('b', 'F8', 0), mac('c')];
    expect(macroForKey(list, 'Ctrl+1')?.id).toBe('a');
    expect(macroForKey(list, 'F8')).toBeNull();
    expect(macroForKey(list, null)).toBeNull();
    expect(hotkeyTaken(list, 'c', 'Ctrl+1')?.id).toBe('a');
    expect(hotkeyTaken(list, 'a', 'Ctrl+1')).toBeNull();
  });
});

describe('recording a macro', () => {
  it('turns what the operator does into steps with the pauses as waits', () => {
    const r = new MacroRecorder();
    r.capture({ type: 'cutTo', screen: 'live', sourceId: 'cam' }, 0);
    expect(r.count).toBe(0);
    r.start(1000);
    r.capture({ type: 'setPreview', screen: 'live', sourceId: 'cam' }, 1500);
    r.capture({ type: 'take', screen: 'live' }, 1600);
    r.capture({ type: 'setOverlayOn', channel: 1, value: true }, 3640);
    r.capture({ type: 'setMasterVolume', volume: 0.5 } as never, 3700);
    expect(r.stop()).toEqual([
      { type: 'preview', screen: 'live', sourceId: 'cam' },
      { type: 'take', screen: 'live' },
      { type: 'wait', ms: 2000 },
      { type: 'overlay', channel: 1, value: true },
    ]);
    expect(r.recording).toBe(false);
  });

  it('stops at the most steps a macro can hold', () => {
    const r = new MacroRecorder();
    r.start(0);
    for (let i = 0; i < 80; i++) r.capture({ type: 'take', screen: 'live' }, i * 1000);
    expect(r.stop().length).toBeLessThanOrEqual(50);
  });

  it('knows which actions are steps', () => {
    expect(stepFromAction({ type: 'take', screen: 'monitor' })).toBeNull();
    expect(stepFromAction({ type: 'runMacro', id: 'm' })).toEqual({ type: 'macro', macroId: 'm' });
    expect(stepFromAction({ type: 'dataStep', delta: -3 })).toEqual({ type: 'dataStep', delta: -1 });
    expect(stepFromAction({ type: 'pickPreset' })).toBeNull();
  });
});

describe('a macro every day at a set time', () => {
  it('is kept as a trigger that runs the macro, and can be removed', () => {
    const m = { id: 'm1', name: 'Doors open' };
    const other = withMacroTime([], { id: 'x', name: 'x' }, 600, 0);
    const set = withMacroTime(other, m, 19 * 60 + 30, 120);
    expect(set).toHaveLength(2);
    expect(set[1]).toMatchObject({ when: { type: 'atTime', minute: 1170, utcOffsetMin: 120 }, steps: [{ type: 'macro', macroId: 'm1' }] });
    expect(macroTime(set, 'm1')).toBe(1170);
    const moved = withMacroTime(set, m, 8 * 60, 120);
    expect(moved).toHaveLength(2);
    expect(macroTime(moved, 'm1')).toBe(480);
    const off = withMacroTime(moved, m, null, 120);
    expect(macroTime(off, 'm1')).toBeNull();
    expect(off).toHaveLength(1);
  });
});
