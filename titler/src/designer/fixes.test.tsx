// Regression tests for what was found driving the designer in a browser:
// dialogs and the keyboard, typing on the canvas, notes, Space, the Alt
// keyframe keys, the Layer menu and the camera, docking from the keyboard,
// and data sources read on their own intervals.

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Designer } from './Designer';
import type { Host } from './host';
import type { BrowserEnv } from '../core/browserEnv';
import type { TitleProject } from '../core/types';
import { newProject } from '../core/build';
import { Store } from './store';
import { LiveData } from './liveData';
import { findPanel, loadLayout } from './workspace';

beforeEach(() => localStorage.clear());

function memoryHost(): Host {
  const library = new Map<string, TitleProject>();
  return {
    kind: 'web',
    libraryName: 'this test',
    renderFormats: ['png-sequence'],
    listLibrary: async () => [...library.entries()].map(([id, p]) => ({ id, name: p.name, category: p.category, modified: 0 })),
    readLibrary: async (id) => ({ project: library.get(id) ?? null, error: library.has(id) ? null : 'gone', notes: [] }),
    saveLibrary: async (p, id) => {
      const key = id ?? p.id;
      library.set(key, p);
      return key;
    },
    removeLibrary: async (id) => void library.delete(id),
    openFile: async () => null,
    saveFile: async (p) => `${p.name}.lumtitle`,
    pickFiles: async () => [],
    urlFor: (s) => s,
    autosave: () => {},
    recover: async () => null,
  };
}

const env: BrowserEnv = { createCanvas: () => null, image: () => null, onReady: () => () => {}, prepare: async () => {} };

async function openTemplate(name: string) {
  await act(async () => {
    fireEvent.click(within(screen.getByTestId('titler-library')).getByText(name));
  });
}
const layerMenu = () => screen.getAllByRole('button', { name: 'Layer' }).find((b) => b.getAttribute('aria-haspopup') === 'menu')!;
const layerNames = () => within(screen.getByTestId('titler-timeline')).queryAllByText(/./, { selector: '.tt-name' }).map((e) => e.textContent);

describe('dialogs and the keyboard', () => {
  it('Escape closes a dialog, and the shortcuts wait while one is open', async () => {
    render(<Designer host={memoryHost()} env={env} />);
    await openTemplate('Live bug');
    fireEvent.click(within(screen.getByTestId('titler-timeline')).getByText('Live box'));
    const before = layerNames().length;
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    expect(screen.getByRole('dialog', { name: 'Export' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: 'r' });
    expect(layerNames()).toHaveLength(before);
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Export' })).toBeNull();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
  });

  it('Alt+R and Alt+T add rotation and opacity keys (not the rectangle or text tools)', async () => {
    render(<Designer host={memoryHost()} env={env} />);
    await openTemplate('Logo bug');
    fireEvent.click(within(screen.getByTestId('titler-timeline')).getByText('Logo'));
    fireEvent.keyDown(window, { key: '®', code: 'KeyR', altKey: true });
    fireEvent.keyDown(window, { key: '†', code: 'KeyT', altKey: true });
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
    const inspector = screen.getByTestId('titler-inspector');
    expect(within(inspector).getByRole('button', { name: 'Animate Rotation' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(inspector).getByRole('button', { name: 'Animate Opacity' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Space plays when let go, but not after moving the view with it held', async () => {
    render(<Designer host={memoryHost()} env={env} />);
    await openTemplate('Live bug');
    const play = () => screen.queryByRole('button', { name: 'Pause' }) !== null;
    fireEvent.keyDown(window, { key: ' ' });
    expect(play()).toBe(false);
    fireEvent.keyUp(window, { key: ' ' });
    expect(play()).toBe(true);
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyUp(window, { key: ' ' });
    expect(play()).toBe(false);
    // Held and dragged on the canvas: the view moves, nothing plays.
    fireEvent.keyDown(window, { key: ' ' });
    const cv = screen.getByLabelText('Composition canvas');
    fireEvent.pointerDown(cv, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(cv, { clientX: 140, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(cv, { clientX: 140, clientY: 120, pointerId: 1 });
    fireEvent.keyUp(window, { key: ' ' });
    expect(play()).toBe(false);
  });
});

describe('typing on the canvas', () => {
  it('the text tool opens a box on the canvas; the words typed are one undo step; Escape ends it', async () => {
    render(<Designer host={memoryHost()} env={env} />);
    await openTemplate('Live bug');
    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    const cv = screen.getByLabelText('Composition canvas');
    fireEvent.pointerDown(cv, { clientX: 200, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(cv, { clientX: 200, clientY: 150, pointerId: 1 });
    const box = screen.getByLabelText('Words on the canvas');
    fireEvent.change(box, { target: { value: 'Breaking' } });
    fireEvent.change(box, { target: { value: 'Breaking news' } });
    // Keys typed in the box are not shortcuts.
    fireEvent.keyDown(box, { key: 'r' });
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByLabelText('Words on the canvas')).toBeNull();
    expect(layerNames()[0]).toBe('Breaking news');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(layerNames()[0]).toBe('Text');
  });

  it('a note placed on the canvas opens its card', async () => {
    render(<Designer host={memoryHost()} env={env} />);
    await openTemplate('Live bug');
    fireEvent.keyDown(window, { key: 'm' });
    const cv = screen.getByLabelText('Composition canvas');
    const down = fireEvent.pointerDown(cv, { clientX: 300, clientY: 200, pointerId: 1 });
    // The canvas does not take the focus back from the card.
    expect(down).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Note 1' })).toBeInTheDocument();
  });
});

describe('the Layer menu, the camera and docking', () => {
  it('adds a camera; its panel shows the camera, not a transform', async () => {
    render(<Designer host={memoryHost()} env={env} />);
    await openTemplate('Live bug');
    fireEvent.click(layerMenu());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Camera (for 3D layers)' }));
    expect(layerNames()[0]).toBe('Camera');
    const inspector = screen.getByTestId('titler-inspector');
    expect(within(inspector).getByText('Orbit across')).toBeInTheDocument();
    expect(within(inspector).queryByText('Anchor point')).toBeNull();
    // A second camera is not added: the menu selects the one there.
    fireEvent.click(layerMenu());
    expect(screen.getByRole('menuitem', { name: 'Select the camera' })).toBeInTheDocument();
  });

  it('Alt+Shift+arrow on a panel tab docks it on the other side, and it is kept', async () => {
    render(<Designer host={memoryHost()} env={env} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Fields' }), { key: 'ArrowLeft', altKey: true, shiftKey: true });
    const left = screen.getByRole('complementary', { name: 'Left panels' });
    expect(within(left).getByRole('tab', { name: 'Fields' })).toHaveAttribute('aria-selected', 'true');
    expect(findPanel(loadLayout().docks, 'fields')?.side).toBe('left');
  });
});

describe('data sources', () => {
  it('each source is read on its own interval, whatever panel is showing', async () => {
    const p = newProject();
    p.variables = [{ key: 'name', label: 'Name', type: 'text', value: '' }];
    p.data = [
      { id: 'fast', name: 'Fast', kind: 'csv', url: 'x', refresh: 2, row: 0, map: {} },
      { id: 'once', name: 'Once', kind: 'csv', url: 'y', refresh: 0, row: 0, map: {} },
    ];
    const s = new Store(p);
    const live = new LiveData(s);
    const reads: string[] = [];
    const reader = async (src: { id: string }) => {
      reads.push(src.id);
      return { headers: ['name'], rows: [['Alex']] };
    };
    const settle = () => new Promise((r) => setTimeout(r, 0));
    live.tick(10_000, reader as never);
    await settle();
    live.tick(11_000, reader as never);
    await settle();
    live.tick(12_100, reader as never);
    await settle();
    expect(reads).toEqual(['fast', 'fast']);
    await new Promise((r) => setTimeout(r, 0));
    expect(s.get().values.name).toBe('Alex');
  });
});
