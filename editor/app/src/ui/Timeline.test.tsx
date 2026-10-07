import { act, render } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { bigProject } from '../bench';
import { Doc } from '../doc';
import { Engine } from '../player/engine';
import { makeActions } from './actions';
import { Ui } from './state';
import { Timeline } from './Timeline';

// A big project's timeline stays a handful of shapes when zoomed out (docs/PERFORMANCE.md, Studio).
describe('the timeline with a big project', () => {
  beforeAll(() => {
    // jsdom has no ResizeObserver (the timeline is then 0 wide: what is drawn is the first step past it).
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
  const setup = () => {
    const p = bigProject({ minutes: 30, cuts: 400, markers: 80 });
    const doc = new Doc(p);
    const engine = new Engine();
    engine.setProject(p);
    const ui = new Ui();
    const actions = makeActions(doc, engine, ui);
    const view = render(<Timeline doc={doc} engine={engine} ui={ui} actions={actions} />);
    return { p, doc, ui, view };
  };

  it('draws only what is on screen, and far out draws clips too narrow to see as bands', () => {
    const { p, ui, view } = setup();
    const all = p.sequences[0]!.clips.length;
    expect(all).toBeGreaterThan(1500);
    // About 10 pixels a second: only the first minutes are drawn.
    act(() => ui.set({ zoom: 0.33 }));
    const near = view.container.querySelectorAll('[data-clip]').length;
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(all / 4);
    // Markers off screen aren't drawn either.
    expect(view.container.querySelectorAll('.ruler__marker').length).toBeLessThan(20);
    // The whole half hour in a few hundred pixels: bands, not clips.
    act(() => ui.set({ zoom: 0.005 }));
    expect(view.container.querySelectorAll('[data-clip]').length).toBeLessThan(40);
    expect(view.container.querySelectorAll('.clip-dense').length).toBeGreaterThan(0);
  });

  it('a change to one clip shows, and the others stay as they were', () => {
    const { doc, ui, view } = setup();
    act(() => ui.set({ zoom: 0.33 }));
    const before = new Map([...view.container.querySelectorAll<HTMLElement>('[data-clip]')].map((el) => [el.dataset.clip, el]));
    const first = [...before.keys()][0] as string;
    act(() =>
      doc.edit(
        (p) => ({ ...p, sequences: p.sequences.map((s) => ({ ...s, clips: s.clips.map((c) => (c.id === first ? { ...c, name: 'Renamed' } : c)) })) }),
        'Rename',
      ),
    );
    const after = [...view.container.querySelectorAll<HTMLElement>('[data-clip]')];
    expect(after.length).toBe(before.size);
    for (const el of after) expect(before.get(el.dataset.clip)).toBe(el);
    expect(view.container.querySelector(`[data-clip="${first}"]`)?.textContent).toContain('Renamed');
  });
});
