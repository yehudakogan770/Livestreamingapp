import { describe, expect, it } from 'vitest';
import { Doc } from '../doc';
import { emptyProject } from '../model/types';
import { assign, COMMANDS, comboOf, conflicts, diff, effective, holderOf, keyName, lookup, normalize, PRESETS, unassign, type KeyLike } from './shortcuts';

const press = (code: string, key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe('keyboard shortcuts', () => {
  it('reads keys by their place, in any layout', () => {
    expect(comboOf(press('KeyK', 'k', { ctrlKey: true }))).toBe('Ctrl+K');
    // A Hebrew keyboard: the same place is the same shortcut.
    expect(comboOf(press('KeyK', 'ל'))).toBe('K');
    expect(comboOf(press('Digit1', '!', { shiftKey: true }))).toBe('Shift+1');
    expect(comboOf(press('ArrowLeft', 'ArrowLeft', { altKey: true }))).toBe('Alt+Left');
    expect(comboOf(press('Space', ' ', { metaKey: true, shiftKey: true }))).toBe('Ctrl+Shift+Space');
    expect(comboOf(press('Semicolon', ';'))).toBe(';');
    expect(comboOf(press('ShiftLeft', 'Shift', { shiftKey: true }))).toBeNull();
    expect(keyName({ key: 'F1', code: 'F1' })).toBe('F1');
    expect(keyName({ key: 'q' })).toBe('Q');
    expect(normalize('shift+ctrl+k')).toBe('Ctrl+Shift+K');
    expect(normalize('Cmd+Option+v')).toBe('Ctrl+Alt+V');
  });

  it('every ready-made set gives each key to one command, and names real commands', () => {
    const ids = new Set(COMMANDS.map((c) => c.id));
    for (const p of PRESETS) {
      expect([...conflicts(p.bindings).entries()], p.name).toEqual([]);
      for (const cmd of Object.keys(p.bindings)) expect(ids.has(cmd), `${p.name}: ${cmd}`).toBe(true);
    }
    expect(PRESETS.map((p) => p.name)).toEqual(['Lumora Studio', 'Premiere-like', 'Resolve-like', 'Final Cut-like']);
  });

  it('the sets differ where the editors do', () => {
    const at = (preset: string, combo: string) => lookup(effective(preset, {})).get(combo);
    expect(at('lumora', 'C')).toBe('toolRazor');
    expect(at('resolve', 'B')).toBe('toolRazor');
    expect(at('resolve', 'Ctrl+B')).toBe('addEdit');
    expect(at('finalcut', 'Ctrl+B')).toBe('addEdit');
    expect(at('finalcut', 'Delete')).toBe('rippleDelete');
    expect(at('lumora', 'Delete')).toBe('clear');
    expect(at('premiere', 'A')).toBe('selectForward');
  });

  it('finds clashes, and moves keys from one command to another', () => {
    const base = effective('lumora', {});
    expect(holderOf(base, 'ctrl+k')).toBe('addEdit');
    expect(holderOf(base, 'Ctrl+K', 'addEdit')).toBeNull();
    const clash = assign(base, 'marker', 'Ctrl+K', false);
    expect(conflicts(clash).get('Ctrl+K')?.sort()).toEqual(['addEdit', 'marker']);
    const moved = assign(base, 'marker', 'Ctrl+K');
    expect(conflicts(moved).size).toBe(0);
    expect(moved.addEdit).toEqual([]);
    expect(moved.marker).toEqual(['M', 'Ctrl+K']);
    expect(unassign(moved, 'marker', 'm').marker).toEqual(['Ctrl+K']);
    // Only changes are kept; the set fills in the rest.
    const d = diff('lumora', moved);
    expect(Object.keys(d).sort()).toEqual(['addEdit', 'marker']);
    expect(effective('lumora', d).marker).toEqual(['M', 'Ctrl+K']);
  });
});

describe('undo history', () => {
  it('lists the steps and goes back or forward to any of them', () => {
    const d = new Doc(emptyProject('a'));
    for (const n of ['b', 'c', 'd']) d.edit((p) => ({ ...p, name: n }), `Name ${n}`);
    expect(d.steps).toEqual({ done: ['Name b', 'Name c', 'Name d'], undone: [] });
    d.goTo(1);
    expect(d.project.name).toBe('b');
    expect(d.steps).toEqual({ done: ['Name b'], undone: ['Name c', 'Name d'] });
    d.goTo(3);
    expect(d.project.name).toBe('d');
    d.goTo(0);
    expect(d.project.name).toBe('a');
    d.goTo(99);
    expect(d.project.name).toBe('d');
    // A step the gate refuses stops the walk instead of looping.
    d.gate = () => 'locked';
    d.goTo(0);
    expect(d.project.name).toBe('d');
  });
});
