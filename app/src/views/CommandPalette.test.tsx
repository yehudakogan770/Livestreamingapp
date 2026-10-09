import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DemoClient } from '../engine/client';
import { demoApply } from '../engine/demo';
import type { Action } from '../engine/types/Action';
import type { Show } from '../engine/types/Show';
import { CommandPalette, findEntries, menuEntries, showEntries, type PaletteEntry } from './CommandPalette';

async function showWith(): Promise<Show> {
  let s = (await new DemoClient().getShow()).show;
  s = demoApply(s, { type: 'addSource', source: { id: 'cam1', name: 'Stage camera', kind: { type: 'pattern' } } }, 0);
  s = demoApply(s, { type: 'addSource', source: { id: 'cam2', name: 'Wide camera', kind: { type: 'pattern' } } }, 0);
  return s;
}

describe('find a command', () => {
  it('lists every menu item and the show’s inputs, presets and macros', async () => {
    const s = await showWith();
    const menus = { Event: [{ label: 'Event setup…', onClick: () => {} }, null, { label: '● Gala', onClick: () => {}, disabled: true }] };
    const acts: Action[] = [];
    const all = [...menuEntries(menus), ...showEntries(s, 'live', (a) => acts.push(a))];
    expect(all.map((e) => e.label)).toContain('Event setup…');
    expect(all.some((e) => e.label.includes('Gala'))).toBe(false);
    const next = all.find((e) => e.label === 'Line up “Wide camera” in Next')!;
    next.run();
    expect(acts).toEqual([{ type: 'setPreview', screen: 'live', sourceId: 'cam2' }]);
  });

  it('matches every word typed, best first', () => {
    const e = (label: string, group = 'Menu'): PaletteEntry => ({ id: label, label, group, run: () => {} });
    const list = [e('Line up “Stage camera” in Next'), e('Stage visuals'), e('Recording and streaming…', 'Settings'), e('Camera control…')];
    expect(findEntries(list, 'stage').map((x) => x.label)).toEqual(['Stage visuals', 'Line up “Stage camera” in Next']);
    expect(findEntries(list, 'cam next').map((x) => x.label)).toEqual(['Line up “Stage camera” in Next']);
    expect(findEntries(list, 'settings rec').map((x) => x.label)).toEqual(['Recording and streaming…']);
    expect(findEntries(list, '')).toHaveLength(4);
  });

  it('runs from the keyboard alone', () => {
    const ran = vi.fn();
    const onClose = vi.fn();
    const entries: PaletteEntry[] = [
      { id: 'a', label: 'Event setup…', group: 'Event', run: () => ran('setup') },
      { id: 'b', label: 'Keyboard shortcuts', group: 'Help', run: () => ran('keys') },
      { id: 'c', label: 'Check for updates…', group: 'Help', run: () => ran('updates') },
    ];
    render(<CommandPalette entries={entries} onClose={onClose} />);
    const box = screen.getByRole('combobox', { name: 'Find a command' });
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: 'help' } });
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(ran).toHaveBeenCalledWith('updates');
    expect(onClose).toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing matches “zzz”.')).toBeInTheDocument();
  });
});
