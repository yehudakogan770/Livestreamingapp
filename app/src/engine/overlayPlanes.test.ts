import { expect, test } from 'vitest';
import { defaultCountdown, emptyShow } from './client';
import { demoApply } from './demo';
import { overlayPlanes } from './overlayPlanes';
import type { Action } from './types/Action';
import type { Show } from './types/Show';

const W = 1920;
const H = 1080;

function build(actions: Action[]): Show {
  let s = emptyShow();
  for (const a of actions) s = demoApply(s, a, 1000);
  return s;
}

const base: Action[] = [
  { type: 'addSource', source: { id: 'cam', name: 'Camera', kind: { type: 'camera', deviceId: 'd', label: 'Cam' } } },
  { type: 'addSource', source: { id: 'cd', name: 'Countdown', kind: { type: 'countdown', background: '#000000', timer: defaultCountdown() } } },
];

const names = (s: Show, now = 5000) => overlayPlanes(s, 'live', now, W, H).map((p) => `${p.name} ${p.w}x${p.h}`);

test('a camera on air needs no plane (the engine draws it)', () => {
  const s = build([...base, { type: 'cutTo', screen: 'live', sourceId: 'cam' }]);
  expect(names(s)).toEqual([]);
});

test('a graphics input on air is a whole-screen plane, also while it fades out', () => {
  const s = build([...base, { type: 'cutTo', screen: 'live', sourceId: 'cd' }]);
  expect(names(s)).toEqual(['g:cd 1920x1080']);
  const t = demoApply(s, { type: 'setPreview', screen: 'live', sourceId: 'cam' }, 2000);
  const mid = demoApply(t, { type: 'take', screen: 'live', transition: 'fade', durationMs: 1000 }, 2000);
  expect(names(mid, 2500)).toEqual(['g:cd 1920x1080']);
  expect(names(mid, 3500)).toEqual([]);
  // Not on the Back Screen.
  expect(overlayPlanes(s, 'back', 5000, W, H)).toEqual([]);
});

test('in a split screen each graphics box is a plane of that box’s size', () => {
  const s = build(base);
  s.sources.push({
    ...s.sources[0]!,
    id: 'sp',
    name: 'Split',
    kind: {
      type: 'split',
      layout: 'sideBySide',
      gap: 0,
      background: '#000000',
      border: false,
      borderColor: '#ffffff',
      boxes: [
        { sourceId: 'cam', frame: { x: 0, y: 0, w: 50, h: 100 } },
        { sourceId: 'cd', frame: { x: 50, y: 25, w: 50, h: 50 } },
      ],
    },
  });
  s.screens.live.program = 'sp';
  expect(names(s)).toEqual(['g:cd 960x540']);
});

test('an overlay channel’s input is a plane of the channel’s box', () => {
  const s = build(base);
  const o = s.overlays[0]!;
  o.sourceId = 'cd';
  o.frame = { x: 6, y: 72, w: 50, h: 16 };
  o.on = true;
  o.changedAt = 0;
  o.screens = ['live'];
  s.screens.live.program = 'cam';
  const planes = overlayPlanes(s, 'live', 5000, W, H);
  expect(planes.map((p) => `${p.name} ${p.w}x${p.h}`)).toEqual(['g:cd 960x173']);
  expect(planes[0]!.kind).toBe('channel');
});

test('a stinger is the top plane; PANIC with the logo is the panic plane', () => {
  const s = build([...base, { type: 'cutTo', screen: 'live', sourceId: 'cam' }]);
  s.settings.stingers[0] = { path: 'sting.webm', durationMs: 1000, cutMs: 400 };
  s.screens.live.previous = 'cam';
  s.screens.live.program = 'cd';
  s.screens.live.transition = { kind: 'stinger1', durationMs: 1000, startedAt: 4800 };
  expect(names(s)).toContain('top 1920x1080');
  s.screens.live.transition = null;
  s.panic = true;
  s.panicChangedAt = 4000;
  s.event.panicShows = 'logo';
  expect(names(s)).toContain('panic 1920x1080');
  s.event.panicShows = 'black';
  expect(names(s)).not.toContain('panic 1920x1080');
});
