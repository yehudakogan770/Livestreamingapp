import { describe, expect, it } from 'vitest';
import { gradeAt, newNode, type Grade, type GradeNode, type GradeNow } from '../model/grade';
import { basicPx, gradePx, hsv2rgb, mattePx, planGrade, rgb2hsv, type RGB } from './grade';

const node = (change: Partial<GradeNode> = {}): GradeNode => ({ ...newNode(), ...change });
const now = (g: Grade): GradeNow => gradeAt(g, 0);
const close = (a: RGB, b: RGB, digits = 5) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i] as number, digits));

const brighter = () => node({ p: { exposure: 1 } });
const offset = () => node({ p: { offset: 40 } });
/** The left or right half of the frame, as a hard-edged window. */
const half = (side: 'left' | 'right') => ({
  shape: 'rect' as const,
  x: side === 'left' ? 0.25 : 0.75,
  y: 0.5,
  w: 0.5 * (16 / 9),
  h: 1.01,
  soft: 0,
  invert: false,
});

describe('planning a grade', () => {
  it('costs nothing with one untouched node', () => {
    expect(planGrade(now({ steps: [{ kind: 'serial', node: node() }] })).steps).toEqual([]);
    // Moving the pivot alone doesn't change anything either.
    expect(planGrade(now({ steps: [{ kind: 'serial', node: node({ p: { pivot: 30 } }) }] })).steps).toEqual([]);
  });

  it('skips bypassed and idle nodes, and a group of one is serial', () => {
    const a = brighter();
    const g: Grade = { steps: [{ kind: 'parallel', id: 'm', nodes: [a, node(), node({ on: false, p: { exposure: 2 } })] }] };
    expect(planGrade(now(g)).steps).toEqual([{ kind: 'serial', node: expect.objectContaining({ id: a.id }) }]);
  });

  it('keeps an idle node above others in a layer mix (it shows the picture as it came in)', () => {
    const top = node({ window: half('left') });
    const g: Grade = { steps: [{ kind: 'layer', id: 'm', nodes: [node(), brighter(), top] }] };
    const plan = planGrade(now(g));
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ kind: 'layer', nodes: [{ p: { exposure: 1 } }, { id: top.id }] });
  });

  it('stops at the node whose matte is shown', () => {
    const a = brighter();
    const b = node({ window: half('left') });
    const plan = planGrade(
      now({
        steps: [
          { kind: 'serial', node: a },
          { kind: 'serial', node: b },
          { kind: 'serial', node: offset() },
        ],
      }),
      b.id,
    );
    expect(plan.steps).toHaveLength(1);
    expect(plan.matte?.id).toBe(b.id);
    close(gradePx(plan, [0.2, 0.2, 0.2], [0.1, 0.5]), [1, 1, 1]);
    close(gradePx(plan, [0.2, 0.2, 0.2], [0.9, 0.5]), [0, 0, 0]);
  });
});

describe('node math', () => {
  const run = (g: Grade, c: RGB, uv: [number, number] = [0.5, 0.5]) => gradePx(planGrade(now(g)), c, uv);
  const serial = (...nodes: GradeNode[]): Grade => ({ steps: nodes.map((n) => ({ kind: 'serial' as const, node: n })) });

  it('does the primaries the same as the Basic correction effect', () => {
    close(run(serial(brighter()), [0.2, 0.3, 0.4]), [0.4, 0.6, 0.8]);
    // Contrast pushes away from the pivot: a pixel at the pivot stays.
    close(run(serial(node({ p: { contrast: 50, pivot: 40 } })), [0.4, 0.4, 0.4]), [0.4, 0.4, 0.4]);
    close(run(serial(node({ p: { contrast: 50, pivot: 40 } })), [0.6, 0.6, 0.6]), [0.7, 0.7, 0.7]);
    const legacy = basicPx([0.6, 0.6, 0.6], { uBasicA: [0, 0.5, 0.5, 0], uBasicB: [0, 0, 0, 0], uBasicC: [0, 1, 0, 0] });
    close(run(serial(node({ p: { contrast: 50 } })), [0.6, 0.6, 0.6]), legacy);
    close(run(serial(node({ p: { saturation: 0 } })), [1, 0, 0]), [0.2126, 0.2126, 0.2126]);
  });

  it('does the wheels: gain, lift and offset', () => {
    close(run(serial(node({ p: { gain: 100 } })), [0.2, 0.3, 0.4]), [0.4, 0.6, 0.8]);
    close(run(serial(node({ p: { lift: 100 } })), [0, 0, 0]), [0.5, 0.5, 0.5]);
    close(run(serial(offset()), [0.1, 0.2, 0.3]), [0.3, 0.4, 0.5]);
  });

  it('turns hue and leaves curves that are straight alone', () => {
    close(hsv2rgb(rgb2hsv([0.3, 0.6, 0.9])), [0.3, 0.6, 0.9]);
    close(run(serial(node({ p: { hue: 120 } })), [1, 0, 0]), [0, 1, 0]);
    const inverted = node({
      curves: {
        master: [
          [0, 1],
          [1, 0],
        ],
        r: [
          [0, 0],
          [1, 1],
        ],
        g: [
          [0, 0],
          [1, 1],
        ],
        b: [
          [0, 0],
          [1, 1],
        ],
      },
    });
    close(run(serial(inverted), [0, 1, 0.5]), [1, 0, 0.5], 2);
  });

  it('runs serial nodes one after the other', () => {
    close(run(serial(brighter(), offset()), [0.1, 0.1, 0.1]), [0.4, 0.4, 0.4]);
    close(run(serial(offset(), brighter()), [0.1, 0.1, 0.1]), [0.6, 0.6, 0.6]);
  });

  it('keys colors with a qualifier and parts of the frame with a window', () => {
    const red = node({ qualifier: { hue: 0, hueWidth: 40, satLo: 20, satHi: 100, lumLo: 0, lumHi: 100, soft: 5, invert: false } });
    const n = now(serial(red)).steps[0];
    const nn = n?.kind === 'serial' ? n.node : null;
    if (!nn) throw new Error('no node');
    expect(mattePx(nn, [0.9, 0.1, 0.1], [0.5, 0.5], 16 / 9)).toBeCloseTo(1);
    expect(mattePx(nn, [0.1, 0.9, 0.1], [0.5, 0.5], 16 / 9)).toBeCloseTo(0);
    expect(mattePx(nn, [0.5, 0.5, 0.5], [0.5, 0.5], 16 / 9)).toBeCloseTo(0);
    const inverted = { ...nn, qualifier: { ...(nn.qualifier as NonNullable<typeof nn.qualifier>), invert: true } };
    expect(mattePx(inverted, [0.1, 0.9, 0.1], [0.5, 0.5], 16 / 9)).toBeCloseTo(1);
    // A soft circle: full in the middle, nothing outside, part way in its soft edge.
    const circle = { ...nn, qualifier: null, window: { shape: 'circle' as const, x: 0.5, y: 0.5, w: 0.5, h: 0.5, soft: 50, invert: false } };
    expect(mattePx(circle, [0, 0, 0], [0.5, 0.5], 16 / 9)).toBeCloseTo(1);
    expect(mattePx(circle, [0, 0, 0], [0.5, 0.95], 16 / 9)).toBe(0);
    const edge = mattePx(circle, [0, 0, 0], [0.5, 0.5 + 0.25 * 0.75], 16 / 9);
    expect(edge).toBeGreaterThan(0.1);
    expect(edge).toBeLessThan(0.9);
    // The node only changes the picture where its matte is.
    const g = serial(node({ p: { exposure: 1 }, window: half('left') }));
    close(run(g, [0.2, 0.2, 0.2], [0.1, 0.5]), [0.4, 0.4, 0.4]);
    close(run(g, [0.2, 0.2, 0.2], [0.9, 0.5]), [0.2, 0.2, 0.2]);
  });

  it('adds up the changes of parallel nodes', () => {
    const both: Grade = { steps: [{ kind: 'parallel', id: 'm', nodes: [brighter(), offset()] }] };
    // (0.2 doubled is +0.2) and (+0.2 offset): +0.4 from the same input.
    close(run(both, [0.2, 0.2, 0.2]), [0.6, 0.6, 0.6]);
    // With windows that don't overlap, each side gets only its own node.
    const sides: Grade = {
      steps: [{ kind: 'parallel', id: 'm', nodes: [node({ p: { exposure: 1 }, window: half('left') }), node({ p: { offset: 40 }, window: half('right') })] }],
    };
    close(run(sides, [0.1, 0.1, 0.1], [0.1, 0.5]), [0.2, 0.2, 0.2]);
    close(run(sides, [0.1, 0.1, 0.1], [0.9, 0.5]), [0.3, 0.3, 0.3]);
  });

  it('puts upper layer nodes over lower ones through their mattes', () => {
    const g: Grade = { steps: [{ kind: 'layer', id: 'm', nodes: [brighter(), node({ p: { offset: 40 }, window: half('left') })] }] };
    // Left: the top node (offset, from the input); right: the bottom node (brighter).
    close(run(g, [0.1, 0.1, 0.1], [0.1, 0.5]), [0.3, 0.3, 0.3]);
    close(run(g, [0.1, 0.1, 0.1], [0.9, 0.5]), [0.2, 0.2, 0.2]);
    // An untouched top node shows the picture as it came in.
    const reveal: Grade = { steps: [{ kind: 'layer', id: 'm', nodes: [brighter(), node({ window: half('left') })] }] };
    close(run(reveal, [0.1, 0.1, 0.1], [0.1, 0.5]), [0.1, 0.1, 0.1]);
  });
});
