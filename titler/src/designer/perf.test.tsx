// Heavy titles stay quick: 240 layers drawn, laid out in the timeline and
// hit-tested within budgets that leave room for 60 fps interaction (the
// budgets are generous for slow test machines; the browser is faster).

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { keys } from '../core/easing';
import { newProject, newShape, newText } from '../core/build';
import type { Layer, TitleProject, Vec2 } from '../core/types';
import { renderFrame } from '../core/render';
import { canvas, env } from '../test/nodeCanvas';
import { Timeline } from './Timeline';
import { Store } from './store';
import { hitLayer } from './geometry';
import { lookOf } from './Viewport';

function heavy(n = 240): TitleProject {
  const p = newProject();
  const c = p.compositions[0]!;
  const layers: Layer[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i % 20) * 90;
    const y = Math.floor(i / 20) * 80;
    const l = i % 3 === 0 ? newText(c, `Item ${i}`, [x, y], [80, 30], { size: 20 }) : newShape(c, i % 2 ? 'rect' : 'ellipse', [x, y], [70, 50]);
    l.transform.position = keys<Vec2>([0.2, [x, y + 20]], [0.8, [x, y]]);
    l.transform.opacity = keys<number>([0.2, 0], [0.6, 100]);
    layers.push(l);
  }
  c.layers = layers;
  return p;
}

describe('heavy titles', () => {
  it('240 animated layers: a frame draws in well under a frame’s time on average', () => {
    const p = heavy();
    const cv = canvas(960, 540);
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D;
    renderFrame(ctx, p, { time: 0.1, env, width: 960, height: 540 });
    const t0 = performance.now();
    const frames = 30;
    for (let i = 0; i < frames; i++) renderFrame(ctx, p, { time: 0.1 + i / 30, env, width: 960, height: 540 });
    const each = (performance.now() - t0) / frames;
    expect(each).toBeLessThan(40);
  });

  it('the timeline shows 240 layers, and finds the layer under the pointer quickly', async () => {
    const s = new Store(heavy());
    await act(async () => render(<Timeline store={s} />));
    expect(screen.getAllByText(/^Item \d+$/).length).toBe(80);
    const look = lookOf(s.get());
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) hitLayer(look, [i * 17, i * 5]);
    expect((performance.now() - t0) / 100).toBeLessThan(16);
    // The playhead moving (60 times a second while playing) doesn't redraw every row.
    const t1 = performance.now();
    for (let i = 0; i < 30; i++) await act(async () => s.set({ time: i / 30 }));
    const per = (performance.now() - t1) / 30;
    expect(per).toBeLessThan(16);
  });
});
