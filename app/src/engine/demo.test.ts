import { describe, expect, it } from 'vitest';
import { demoApply } from './demo';
import { emptyShow } from './client';
import type { Action } from './types/Action';
import type { Show } from './types/Show';

const run = (actions: Action[], show: Show = emptyShow(), now = 1000): Show =>
  actions.reduce((s, a, i) => demoApply(s, a, now + i), show);

const two: Action[] = [
  { type: 'addSource', source: { id: 'a', name: 'A', kind: { type: 'color', color: '#ff0000' } } },
  { type: 'addSource', source: { id: 'b', name: 'B', kind: { type: 'pattern' } } },
];

describe('demo engine (same rules as the Rust engine)', () => {
  it('TAKE sends preview to air and drops what was on air back into preview', () => {
    const s = run([...two, { type: 'setPreview', screen: 'live', sourceId: 'a' }, { type: 'take', screen: 'live' }, { type: 'setPreview', screen: 'live', sourceId: 'b' }, { type: 'take', screen: 'live' }]);
    expect(s.screens.live).toMatchObject({ program: 'b', previous: 'a', preview: 'a' });
    expect(s.screens.live.transition?.kind).toBe('fade');
  });

  it('the T-bar mixes, and reaching the end finishes the take once', () => {
    let s = run([...two, { type: 'cutTo', screen: 'live', sourceId: 'a' }, { type: 'setPreview', screen: 'live', sourceId: 'b' }, { type: 'setTbar', screen: 'live', value: 0.4 }]);
    expect(s.screens.live).toMatchObject({ program: 'a', tbar: 0.4 });
    s = demoApply(s, { type: 'setTbar', screen: 'live', value: 1 }, 5000);
    expect(s.screens.live).toMatchObject({ program: 'b', preview: 'a', tbar: 0 });
    expect(s.screens.live.transition?.kind).toBe('cut');
  });

  it('refuses switching the Monitor, which is text only', () => {
    expect(() => run([...two, { type: 'setPreview', screen: 'monitor', sourceId: 'a' }])).toThrow();
    try {
      run([...two, { type: 'setPreview', screen: 'monitor', sourceId: 'a' }]);
    } catch (e) {
      expect(e).toEqual({ code: 'monitorIsTextOnly' });
    }
  });

  it('Back = Live copies the Live Screen, and a manual Back take stops it', () => {
    let s = run([...two, { type: 'cutTo', screen: 'live', sourceId: 'a' }, { type: 'setBackFollowsLive', value: true }]);
    expect(s.screens.back.program).toBe('a');
    s = run([{ type: 'setPreview', screen: 'live', sourceId: 'b' }, { type: 'take', screen: 'live' }], s, 9000);
    expect(s.screens.back).toMatchObject({ program: 'b', previous: 'a' });
    expect(s.screens.back.transition).toEqual(s.screens.live.transition);
    s = run([{ type: 'setPreview', screen: 'back', sourceId: 'a' }, { type: 'take', screen: 'back' }], s, 12_000);
    expect(s.backFollowsLive).toBe(false);
    expect(s.screens.back.program).toBe('a');
  });

  it('removing an input clears it from every screen', () => {
    const s = run([...two, { type: 'cutTo', screen: 'live', sourceId: 'a' }, { type: 'setPreview', screen: 'back', sourceId: 'a' }, { type: 'removeSource', id: 'a' }]);
    expect(s.sources.map((x) => x.id)).toEqual(['b']);
    expect(s.screens.live.program).toBeNull();
    expect(s.screens.back.preview).toBeNull();
  });

  it('never changes the show it was given', () => {
    const before = run(two);
    const copy = structuredClone(before);
    demoApply(before, { type: 'cutTo', screen: 'live', sourceId: 'a' }, 1);
    expect(before).toEqual(copy);
  });
});
