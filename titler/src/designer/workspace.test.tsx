// The designer's workspace and history: sums in number fields, panel sizes
// and the four workspaces, recent titles, the undo history (going back and
// forward to any step), and versions kept and restored.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { newProject } from '../core/build';
import { evalMath } from './math';
import { NumberField } from './fields';
import { Store } from './store';
import { clampSize, loadLayout, recentTitles, rememberTitle, saveLayout, workspace, WORKSPACES } from './workspace';
import { listVersions, memoryStore, MAX_VERSIONS, readVersion, saveVersion } from './versions';
import { HistoryPanel } from './HistoryPanel';

beforeEach(() => localStorage.clear());

describe('sums in number fields', () => {
  it('works out what is typed, from the current value when it starts with an operator', () => {
    expect(evalMath('100+20')).toBe(120);
    expect(evalMath('1920/2')).toBe(960);
    expect(evalMath('(40+8)*2')).toBe(96);
    expect(evalMath('-12.5')).toBe(-12.5);
    expect(evalMath('2*-3')).toBe(-6);
    expect(evalMath('*2', 35)).toBe(70);
    expect(evalMath('/4', 100)).toBe(25);
    expect(evalMath('+=10', 5)).toBe(15);
    expect(evalMath('-=10', 5)).toBe(-5);
    expect(evalMath('1,5')).toBe(1.5);
    expect(evalMath('7 % 4')).toBe(3);
    for (const bad of ['', 'abc', '1+', '(2', '2)', '1/0', 'alert(1)']) expect(evalMath(bad)).toBeNull();
  });

  it('the field takes a sum when it is typed', () => {
    let v = 100;
    render(<NumberField value={v} label="X" onChange={(n) => (v = n)} />);
    const input = screen.getByLabelText('X');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '*3+5' } });
    fireEvent.blur(input);
    expect(v).toBe(305);
  });
});

describe('workspaces', () => {
  it('each workspace sets its sizes and tabs; sizes stay within limits; the layout is kept', () => {
    expect(workspace('animate').timeline).toBeGreaterThan(workspace('design').timeline);
    expect(workspace('operator').rightTab).toBe('fields');
    expect(workspace('data').rightTab).toBe('data');
    expect(clampSize('left', 20)).toBe(160);
    expect(clampSize('timeline', 5000)).toBe(900);
    saveLayout({ ...workspace('animate'), left: 300, canvasOnly: true });
    const l = loadLayout();
    expect(l).toMatchObject({ workspace: 'animate', left: 300, timeline: WORKSPACES.animate.timeline, canvasOnly: false });
  });

  it('recent titles: newest first, each once, ten kept', () => {
    for (let i = 0; i < 12; i++) rememberTitle(`t${i}`, `Title ${i}`, i);
    rememberTitle('t3', 'Title 3', 99);
    const r = recentTitles();
    expect(r).toHaveLength(10);
    expect(r[0]).toMatchObject({ id: 't3', name: 'Title 3' });
    expect(r.filter((x) => x.id === 't3')).toHaveLength(1);
  });
});

describe('undo history and versions', () => {
  it('goes back to any step and forward again', () => {
    const s = new Store(newProject());
    for (const n of ['A', 'B', 'C']) s.edit(`Rename ${n}`, (p) => ({ ...p, name: n }));
    expect(s.history()).toEqual({ labels: ['Rename A', 'Rename B', 'Rename C'], done: 3 });
    s.goTo(1);
    expect(s.get().project.name).toBe('A');
    expect(s.history().done).toBe(1);
    s.goTo(3);
    expect(s.get().project.name).toBe('C');
    s.goTo(0);
    expect(s.get().project.name).toBe('Untitled title');
    // A new change after going back drops the steps that were undone.
    s.edit('Rename D', (p) => ({ ...p, name: 'D' }));
    expect(s.history()).toEqual({ labels: ['Rename D'], done: 1 });
  });

  it('keeps versions per title (the newest 50) and reads them back', async () => {
    const store = memoryStore();
    const p = newProject();
    const other = newProject();
    await saveVersion({ ...p, name: 'First' }, 'Before colors', store, 1);
    await saveVersion(other, 'Elsewhere', store, 2);
    const v = await saveVersion({ ...p, name: 'Second' }, '', store, 3);
    const list = await listVersions(p.id, store);
    expect(list.map((x) => x.name)).toEqual(['Version', 'Before colors']);
    expect((await readVersion(v.id, store))!.name).toBe('Second');
    for (let i = 0; i < MAX_VERSIONS + 5; i++) await saveVersion(p, `v${i}`, store, 10 + i);
    expect(await listVersions(p.id, store)).toHaveLength(MAX_VERSIONS);
    expect(await listVersions(other.id, store)).toHaveLength(1);
  });

  it('the History tab: click a step to go back to it; restore a version as one step that can be undone', async () => {
    const versions = memoryStore();
    const s = new Store(newProject());
    s.edit('Rename A', (p) => ({ ...p, name: 'A' }));
    await saveVersion(s.get().project, 'Named A', versions);
    s.edit('Rename B', (p) => ({ ...p, name: 'B' }));
    render(<HistoryPanel store={s} versions={versions} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename A' }));
    expect(s.get().project.name).toBe('A');
    fireEvent.click(screen.getByRole('button', { name: 'Rename B' }));
    expect(s.get().project.name).toBe('B');
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Named A' }));
    await waitFor(() => expect(s.get().project.name).toBe('A'));
    expect(s.history().labels.at(-1)).toBe('Restore “Named A”');
    s.undo();
    expect(s.get().project.name).toBe('B');
  });
});
