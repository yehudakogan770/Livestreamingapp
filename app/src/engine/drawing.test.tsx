import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DrawingCard, drawingTarget } from '../views/DrawingCard';
import { DemoClient } from './client';
import { demoApply } from './demo';
import { addStroke, arrowHead, emptyDrawing, MAX_POINTS, paintDrawing, repairStroke, thin } from './drawing';
import type { Action } from './types/Action';
import type { Show } from './types/Show';

describe('drawing on screen', () => {
  it('keeps strokes in range, thins them, and adds the oldest-first way', () => {
    expect(
      repairStroke({
        color: 'red',
        width: 9,
        points: [
          [0.5, 0.5],
          [NaN, 0],
          [2, -3],
        ],
        arrow: true,
      }),
    ).toEqual({
      color: '#ffd400',
      width: 0.05,
      points: [
        [0.5, 0.5],
        [1.1, -0.1],
      ],
      arrow: true,
    });
    const many = Array.from({ length: 5000 }, (_, i) => [i / 5000, 0.5] as [number, number]);
    const t = thin(many);
    expect(t.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(t[0]).toEqual([0, 0.5]);
    expect(t.at(-1)).toEqual([4999 / 5000, 0.5]);
    // Points closer than the step are left out; the end is kept.
    expect(
      thin([
        [0, 0],
        [0.0001, 0],
        [0.0002, 0],
        [0.5, 0],
      ]),
    ).toEqual([
      [0, 0],
      [0.5, 0],
    ]);
    const d = emptyDrawing();
    addStroke(d, { color: '#ff3b30', width: 0.008, points: [], arrow: false }, 5);
    expect(d.strokes).toHaveLength(0);
    addStroke(d, { color: '#ff3b30', width: 0.008, points: [[0.1, 0.1]], arrow: false }, 6);
    expect(d).toMatchObject({ changedAt: 6, strokes: [{ color: '#ff3b30' }] });
  });

  it('points the arrowhead along the end of the line', () => {
    const head = arrowHead(
      {
        color: '#fff',
        width: 0.01,
        points: [
          [0, 0.5],
          [0.5, 0.5],
        ],
        arrow: true,
      },
      1000,
      1000,
    )!;
    expect(head[0]).toEqual([500, 500]);
    // Both back corners are behind the tip, one above and one below.
    expect(head[1]![0]).toBeLessThan(500);
    expect(head[2]![0]).toBeLessThan(500);
    expect(Math.sign(head[1]![1] - 500)).toBe(-Math.sign(head[2]![1] - 500));
    expect(arrowHead({ color: '#fff', width: 0.01, points: [[0.5, 0.5]], arrow: true }, 100, 100)).toBeNull();
  });

  it('paints lines, dots and arrowheads on a canvas', () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, k: string) => (k in _t ? _t[k] : (..._a: unknown[]) => calls.push(k)),
      set: (t, k: string, v) => ((t[k] = v), true),
    }) as unknown as CanvasRenderingContext2D;
    paintDrawing(
      ctx,
      {
        changedAt: 0,
        strokes: [
          { color: '#ff3b30', width: 0.01, points: [[0.1, 0.1]], arrow: false },
          {
            color: '#ffd400',
            width: 0.01,
            points: [
              [0, 0.5],
              [0.5, 0.5],
            ],
            arrow: true,
          },
        ],
      },
      1920,
      1080,
    );
    expect(calls.filter((c) => c === 'arc')).toHaveLength(1);
    expect(calls.filter((c) => c === 'stroke')).toHaveLength(1);
    expect(calls.filter((c) => c === 'fill')).toHaveLength(2);
  });
});

async function withDrawing(): Promise<Show> {
  let s = (await new DemoClient().getShow()).show;
  s = demoApply(s, { type: 'addSource', source: { id: 'draw', name: 'Drawing', kind: { type: 'drawing', strokes: [], changedAt: 0 } } }, 0);
  return s;
}

describe('the drawing input', () => {
  it('takes strokes, undo and clear (the browser engine)', async () => {
    let s = await withDrawing();
    s = demoApply(
      s,
      {
        type: 'drawStroke',
        id: 'draw',
        stroke: {
          color: '#ffffff',
          width: 0.004,
          points: [
            [0.2, 0.2],
            [0.3, 0.3],
          ],
          arrow: false,
        },
      },
      10,
    );
    s = demoApply(s, { type: 'drawStroke', id: 'draw', stroke: { color: '#ffffff', width: 0.004, points: [[0.4, 0.4]], arrow: true } }, 11);
    const k = () => {
      const kind = s.sources.find((x) => x.id === 'draw')!.kind;
      if (kind.type !== 'drawing') throw new Error('not a drawing');
      return kind;
    };
    expect(k()).toMatchObject({ changedAt: 11 });
    expect(k().strokes).toHaveLength(2);
    s = demoApply(s, { type: 'drawUndo', id: 'draw' }, 12);
    expect(k().strokes).toHaveLength(1);
    s = demoApply(s, { type: 'drawClear', id: 'draw' }, 13);
    expect(k().strokes).toHaveLength(0);
    expect(() => demoApply(s, { type: 'drawClear', id: 'nope' }, 14)).toThrow();
  });

  it('the card appears for a drawing on an overlay, and a line drawn on the pad is sent', async () => {
    let s = await withDrawing();
    expect(drawingTarget(s, 'live')).toBeNull();
    s = demoApply(s, { type: 'setOverlaySource', channel: 1, sourceId: 'draw' }, 0);
    expect(drawingTarget(s, 'live')).toMatchObject({ id: 'draw', where: 'ready', channel: 1 });
    const acts: Action[] = [];
    render(<DrawingCard show={s} act={(a) => acts.push(a)} screen="live" client={new DemoClient()} />);
    const pad = screen.getByRole('img', { name: /Draw here/ });
    pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 90, right: 160, bottom: 90, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    fireEvent.click(screen.getByRole('button', { name: /Arrow/ }));
    fireEvent.pointerDown(pad, { button: 0, clientX: 16, clientY: 45, pointerId: 1 });
    fireEvent.pointerMove(pad, { clientX: 80, clientY: 45, pointerId: 1 });
    fireEvent.pointerUp(pad, { pointerId: 1 });
    expect(acts).toEqual([
      {
        type: 'drawStroke',
        id: 'draw',
        stroke: {
          color: '#ff3b30',
          width: 0.008,
          arrow: true,
          points: [
            [0.1, 0.5],
            [0.5, 0.5],
          ],
        },
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Put on screen' }));
    expect(acts.at(-1)).toEqual({ type: 'setOverlayOn', channel: 1, value: true });
  });
});
