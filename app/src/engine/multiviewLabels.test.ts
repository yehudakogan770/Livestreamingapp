import { expect, test } from 'vitest';
import { emptyShow } from './client';
import { demoApply } from './demo';
import { clockText, drawMultiviewWords, tallies, type MvLayout } from './multiviewLabels';

/** A context that records the words written (and where). */
function recorder() {
  const words: { text: string; x: number; y: number; fill: unknown }[] = [];
  const state: Record<string, unknown> = { fillStyle: '#000' };
  const ctx = new Proxy(state, {
    get: (t, k) => {
      if (k === 'fillText') return (text: string, x: number, y: number) => words.push({ text, x, y, fill: t.fillStyle });
      if (k === 'measureText') return (s: string) => ({ width: s.length * 7 });
      if (k === 'roundRect') return () => {};
      return k in t ? t[k as string] : () => {};
    },
    set: (t, k, v) => {
      t[k as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, words };
}

const layout: MvLayout = {
  width: 1920,
  height: 1080,
  scale: 1,
  header: [4, 4, 1912, 32],
  tiles: [
    {
      content: { type: 'next', id: 'live' },
      rect: [4, 40, 954, 622],
      picture: [5, 41, 952, 593],
      label: [5, 634, 952, 27],
      tally: 'pvw',
      big: true,
      number: null,
    },
    {
      content: { type: 'program', id: 'live' },
      rect: [962, 40, 954, 622],
      picture: [963, 41, 952, 593],
      label: [963, 634, 952, 27],
      tally: 'pgm',
      big: true,
      number: null,
    },
    {
      content: { type: 'input', id: 'a' },
      rect: [4, 666, 270, 400],
      picture: [5, 667, 268, 375],
      label: [5, 1042, 268, 23],
      tally: 'pgm',
      big: false,
      number: 1,
    },
    {
      content: { type: 'input', id: 'b' },
      rect: [278, 666, 270, 400],
      picture: [279, 667, 268, 375],
      label: [279, 1042, 268, 23],
      tally: 'pvw',
      big: false,
      number: 2,
    },
  ],
};

test('the header, each tile’s name and tally words, and the clock', () => {
  let show = emptyShow();
  for (const [id, name] of [
    ['a', 'Stage'],
    ['b', 'Wide'],
  ] as const)
    show = demoApply(show, { type: 'addSource', source: { id, name, kind: { type: 'camera', deviceId: id, label: id } } }, 0);
  show = demoApply(show, { type: 'cutTo', screen: 'live', sourceId: 'a' }, 0);
  show = demoApply(show, { type: 'setPreview', screen: 'live', sourceId: 'b' }, 0);
  show.event.name = 'Gala';
  show.panic = true;
  const { ctx, words } = recorder();
  const now = new Date(2026, 9, 7, 18, 5, 9).getTime();
  drawMultiviewWords(ctx, layout, show, now);
  const texts = words.map((w) => w.text);
  expect(texts).toEqual(expect.arrayContaining(['Gala', 'Multiview', 'PANIC', '18:05:09', 'NEXT', 'ON AIR', 'LIVE', 'Stage', 'Wide', '1', '2']));
  // The input on air is marked with the screen it is on.
  const stage = words.find((w) => w.text === 'Stage' && w.y > 1000)!;
  expect(words.some((w) => w.text === 'LIVE' && Math.abs(w.y - stage.y) < 2 && w.x > stage.x)).toBe(true);
  expect(clockText(new Date(2026, 0, 1, 7, 3, 4))).toBe('07:03:04');
  expect(tallies(show).next.has('b')).toBe(true);
});
