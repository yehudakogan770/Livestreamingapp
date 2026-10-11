import { describe, expect, it } from 'vitest';
import { effectsAt } from '../render/frame';
import { isAudioEffect } from '../render/frame';
import {
  addNode,
  cloneComposite,
  connect,
  evaluationOrder,
  graphOf,
  NODE_EFFECTS,
  newCompositeEffect,
  newGraph,
  nodeNumbers,
  nodeParams,
  outputNode,
  paramKey,
  removeNode,
  usesUnder,
} from './nodes';
import { newClip, type Effect } from './types';

const ids = (list: { id: string }[]) => list.map((n) => n.id);

describe('node composites', () => {
  it('start as the clip straight into the output', () => {
    const g = newGraph();
    const [input, out] = g.nodes;
    expect(input?.kind).toBe('in');
    expect(out?.kind).toBe('out');
    expect(out?.inputs).toEqual([input?.id]);
    expect(ids(evaluationOrder(g))).toEqual([input?.id, out?.id]);
  });

  it('a merge layers a masked solid over the clip, worked out in order', () => {
    let g = newGraph();
    let p: Effect['p'] = {};
    const [input, out] = g.nodes as [NonNullable<(typeof g.nodes)[0]>, NonNullable<(typeof g.nodes)[0]>];
    const m = addNode(g, p, 'merge', { x: 200, y: 80 });
    ({ graph: g, p } = m);
    const s = addNode(g, p, 'solid', { x: 0, y: 200 });
    ({ graph: g, p } = s);
    const k = addNode(g, p, 'mask', { x: 0, y: 300 });
    ({ graph: g, p } = k);
    g = connect(g, input.id, m.id, 0);
    g = connect(g, s.id, m.id, 1);
    g = connect(g, k.id, m.id, 2);
    g = connect(g, m.id, out.id, 0);
    const order = ids(evaluationOrder(g));
    expect(order[order.length - 1]).toBe(out.id);
    for (const before of [input.id, s.id, k.id]) expect(order.indexOf(before)).toBeLessThan(order.indexOf(m.id));
    // Every setting starts at its default, kept in the effect under the node's id.
    expect(p[paramKey(m.id, 'opacity')]).toBe(100);
    expect(p[paramKey(k.id, 'w')]).toBe(40);
    expect(g.nodes.find((n) => n.id === s.id)?.d?.color).toBe('#1e2a38');
  });

  it('refuses joins that would loop back, and the output feeds nothing', () => {
    let g = newGraph();
    let p: Effect['p'] = {};
    const a = addNode(g, p, 'transform', { x: 0, y: 0 });
    ({ graph: g, p } = a);
    const b = addNode(g, p, 'transform', { x: 0, y: 0 });
    ({ graph: g, p } = b);
    g = connect(g, a.id, b.id, 0);
    expect(connect(g, b.id, a.id, 0)).toBe(g);
    expect(connect(g, a.id, a.id, 0)).toBe(g);
    const out = outputNode(g) as NonNullable<ReturnType<typeof outputNode>>;
    expect(connect(g, out.id, a.id, 0)).toBe(g);
    // A join to an input that doesn't exist is refused too.
    expect(connect(g, a.id, b.id, 5)).toBe(g);
  });

  it('nodes not reaching the output are left out; removing a node unjoins and forgets its settings', () => {
    let g = newGraph();
    let p: Effect['p'] = {};
    const blur = addNode(g, p, 'fx', { x: 0, y: 0 }, 'blur');
    ({ graph: g, p } = blur);
    expect(evaluationOrder(g).some((n) => n.id === blur.id)).toBe(false);
    expect(p[paramKey(blur.id, 'radius')]).toBe(20);
    const input = g.nodes[0]?.id as string;
    const out = outputNode(g)?.id as string;
    g = connect(g, input, blur.id, 0);
    g = connect(g, blur.id, out, 0);
    expect(evaluationOrder(g).some((n) => n.id === blur.id)).toBe(true);
    const r = removeNode(g, p, blur.id);
    expect(r.graph.nodes.some((n) => n.id === blur.id)).toBe(false);
    expect(outputNode(r.graph)?.inputs).toEqual([null]);
    expect(Object.keys(r.p).some((k) => k.startsWith(blur.id))).toBe(false);
    // The output can't be taken out.
    expect(removeNode(g, p, out).graph).toBe(g);
  });

  it('effect nodes take any video effect that needs only its input', () => {
    const types = NODE_EFFECTS.map((e) => e.type);
    for (const t of ['basic', 'blur', 'chromakey', 'glow', 'vignette']) expect(types).toContain(t);
    for (const t of ['grade', 'lut', 'personmask', 'nodes', 'eq']) expect(types).not.toContain(t);
    const g = addNode(newGraph(), {}, 'fx', { x: 0, y: 0 }, 'chromakey');
    const n = g.graph.nodes.find((x) => x.id === g.id);
    expect(n?.d?.color).toBe('#00b140');
    expect(nodeParams(n as NonNullable<typeof n>).map((x) => x.key)).toEqual(['tolerance', 'softness', 'spill']);
  });

  it('settings keyframe like any effect: worked out at the frame', () => {
    const e = newCompositeEffect();
    let g = graphOf(e);
    const t = addNode(g, e.p, 'transform', { x: 0, y: 0 });
    g = t.graph;
    const fx: Effect = {
      ...e,
      p: {
        ...t.p,
        [paramKey(t.id, 'x')]: {
          k: [
            { t: 0, v: 0, e: 'linear' },
            { t: 10, v: 100, e: 'linear' },
          ],
        },
      },
      d: { graph: g },
    };
    const clip = { ...newClip('v', 0, 20, { kind: 'color', color: '#000' }, 'c'), effects: [fx] };
    const now = effectsAt(clip, 5, 'video', isAudioEffect)[0];
    const node = g.nodes.find((n) => n.id === t.id) as NonNullable<(typeof g.nodes)[0]>;
    expect(nodeNumbers(node, now?.p ?? {})('x')).toBeCloseTo(50, 5);
    expect(nodeNumbers(node, now?.p ?? {})('scale')).toBe(100);
  });

  it('knows when it uses what is under the clip, and copies with new ids', () => {
    let g = newGraph();
    let p: Effect['p'] = {};
    const u = addNode(g, p, 'under', { x: 0, y: 0 });
    ({ graph: g, p } = u);
    expect(usesUnder(g)).toBe(false);
    g = connect(g, u.id, outputNode(g)?.id as string, 0);
    expect(usesUnder(g)).toBe(true);
    const e: Effect = { id: 'e1', type: 'nodes', on: true, p: { ...p, [paramKey(u.id, 'x')]: 3 }, d: { graph: g } };
    const c = cloneComposite(e);
    const cg = graphOf(c);
    expect(c.id).not.toBe('e1');
    expect(cg.nodes.some((n) => g.nodes.some((o) => o.id === n.id))).toBe(false);
    expect(usesUnder(cg)).toBe(true);
    const newU = cg.nodes.find((n) => n.kind === 'under')?.id as string;
    expect(c.p[paramKey(newU, 'x')]).toBe(3);
  });
});
