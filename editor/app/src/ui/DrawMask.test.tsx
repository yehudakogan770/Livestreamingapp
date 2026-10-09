import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Doc } from '../doc';
import { MASK_TYPES, newEffect } from '../model/effects';
import { current } from '../model/seq';
import { emptyProject, newClip } from '../model/types';
import { drawnShape, inside, WHOLE_FRAME } from '../render/drawnmask';
import { drawMask, DrawMaskOverlay } from './DrawMask';

describe('drawn masks', () => {
  it('need three points; can limit other effects like any mask; cover the whole frame', () => {
    expect(
      drawnShape({
        points: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toBeNull();
    const s = drawnShape({
      points: [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.5, 0.9],
      ],
      aspect: 2,
    });
    expect(s?.aspect).toBe(2);
    expect(inside(s!.points, 0.5, 0.4)).toBe(true);
    expect(inside(s!.points, 0.05, 0.9)).toBe(false);
    expect(MASK_TYPES).toContain('drawnmask');
    expect(WHOLE_FRAME).toMatchObject({ scale: 100, fill: true, x: 0, y: 0 });
  });

  it('are drawn by clicking on the viewer; a right-click takes a point away', () => {
    const fx = newEffect('drawnmask');
    const p0 = emptyProject('t');
    const s0 = current(p0);
    const v = s0.tracks.find((t) => t.kind === 'video')!;
    const clip = { ...newClip(v.id, 0, 100, { kind: 'color', color: '#336699' }, 'Color'), effects: [fx] };
    const doc = new Doc({ ...p0, sequences: [{ ...s0, clips: [clip] }] });
    render(<DrawMaskOverlay doc={doc} />);
    act(() => drawMask.start({ clip: clip.id, effect: fx.id }));
    const svg = screen.getByRole('application');
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(svg, { button: 0, clientX: 20, clientY: 10 });
    fireEvent.pointerDown(svg, { button: 0, clientX: 180, clientY: 10 });
    fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 90 });
    const pts = () => current(doc.project).clips[0]!.effects[0]!.d?.points as [number, number][];
    expect(pts()).toEqual([
      [0.1, 0.1],
      [0.9, 0.1],
      [0.5, 0.9],
    ]);
    expect(current(doc.project).clips[0]!.effects[0]!.d?.aspect).toBeCloseTo(16 / 9);
    fireEvent.contextMenu(screen.getByLabelText('Point 2'));
    expect(pts()).toHaveLength(2);
    act(() => drawMask.start(null));
    expect(screen.queryByRole('application')).toBeNull();
  });
});
