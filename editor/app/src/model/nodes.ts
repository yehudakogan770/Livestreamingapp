// Node compositing (as in Fusion or Nuke): a clip's picture made by a graph
// of nodes joined output to input. Pictures come in (the clip itself, what is
// under it on the timeline, solid colors, gradients), go through nodes
// (transform, any video effect, shape masks, keys) and are layered by Merge
// nodes, to one Output. The graph is kept in a "Node composite" effect on the
// clip: its shape in `d.graph`, every node's numbers in `p` under
// "<node>.<setting>", so they keyframe like any effect's.
import { EFFECTS, effectDef, type ParamDef } from './effects';
import { uid, type BlendMode, type Effect, type Param } from './types';

export type NodeKind = 'in' | 'under' | 'solid' | 'gradient' | 'transform' | 'merge' | 'mask' | 'fx' | 'out';

export interface CompNode {
  id: string;
  kind: NodeKind;
  /** Where it sits on the canvas (pixels). */
  x: number;
  y: number;
  /** What feeds each input (a node's id), in the kind's input order. */
  inputs: (string | null)[];
  /** A name of its own. */
  label?: string;
  /** Bypassed: its first input goes straight through. */
  off?: boolean;
  /** An effect node's effect. */
  fx?: string;
  /** Settings that aren't numbers: colors (and the effect's own, such as the key color). */
  d?: Record<string, string>;
}

export interface CompGraph {
  nodes: CompNode[];
}

export interface NodeDef {
  kind: NodeKind;
  name: string;
  /** What each input is. */
  inputs: string[];
  params: ParamDef[];
  /** Color settings: key, label, starting value. */
  colors?: [string, string, string][];
  /** One line on what it does. */
  about: string;
}

const P = (key: string, label: string, min: number, max: number, def: number, step = 1, unit?: string): ParamDef => ({
  key,
  label,
  min,
  max,
  def,
  step,
  ...(unit ? { unit } : {}),
});

export const BLENDS: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'add',
  'darken',
  'lighten',
  'difference',
  'softlight',
  'hardlight',
  'colordodge',
  'colorburn',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
];
const BLEND_NAMES = [
  'Normal',
  'Multiply',
  'Screen',
  'Overlay',
  'Add',
  'Darken',
  'Lighten',
  'Difference',
  'Soft light',
  'Hard light',
  'Color dodge',
  'Color burn',
  'Exclusion',
  'Hue',
  'Saturation',
  'Color',
  'Luminosity',
];

export const NODE_DEFS: Record<NodeKind, NodeDef> = {
  in: { kind: 'in', name: 'Clip', inputs: [], params: [], about: 'The clip’s own picture, with the effects before this composite.' },
  under: { kind: 'under', name: 'Background', inputs: [], params: [], about: 'Everything under this clip on the timeline at this frame.' },
  solid: {
    kind: 'solid',
    name: 'Solid color',
    inputs: [],
    params: [P('opacity', 'Opacity', 0, 100, 100, 1, '%')],
    colors: [['color', 'Color', '#1e2a38']],
    about: 'A full frame of one color.',
  },
  gradient: {
    kind: 'gradient',
    name: 'Gradient',
    inputs: [],
    params: [
      { ...P('round', 'Shape', 0, 1, 0), options: ['Straight', 'Round'], still: true },
      P('angle', 'Direction', 0, 360, 90, 1, '°'),
      P('center', 'Middle', 0, 100, 50, 1, '%'),
      P('softness', 'Softness', 0, 100, 50, 1, '%'),
    ],
    colors: [
      ['color1', 'From', '#1e3a5f'],
      ['color2', 'To', '#d08a48'],
    ],
    about: 'A smooth blend between two colors.',
  },
  transform: {
    kind: 'transform',
    name: 'Transform',
    inputs: ['Input'],
    params: [
      P('x', 'Position ↔', -4000, 4000, 0, 1, 'px'),
      P('y', 'Position ↕', -4000, 4000, 0, 1, 'px'),
      P('scale', 'Scale', 0, 1000, 100, 0.5, '%'),
      P('rotation', 'Rotation', -720, 720, 0, 0.5, '°'),
      P('cropL', 'Crop left', 0, 100, 0, 0.5, '%'),
      P('cropR', 'Crop right', 0, 100, 0, 0.5, '%'),
      P('cropT', 'Crop top', 0, 100, 0, 0.5, '%'),
      P('cropB', 'Crop bottom', 0, 100, 0, 0.5, '%'),
    ],
    about: 'Moves, scales, turns and crops its input.',
  },
  merge: {
    kind: 'merge',
    name: 'Merge',
    inputs: ['Background', 'Foreground', 'Mask'],
    params: [
      { ...P('blend', 'Blend', 0, BLENDS.length - 1, 0), options: BLEND_NAMES, still: true },
      P('opacity', 'Opacity', 0, 100, 100, 1, '%'),
      { ...P('invert', 'Invert the mask', 0, 1, 0), toggle: true },
    ],
    about: 'Layers the foreground over the background (only where the mask is, when one is joined).',
  },
  mask: {
    kind: 'mask',
    name: 'Shape mask',
    inputs: ['Input'],
    params: [
      { ...P('shape', 'Shape', 0, 2, 0), options: ['Ellipse', 'Rectangle', 'Rounded rectangle'], still: true },
      P('cx', 'Center ↔', -100, 100, 0, 0.5, '%'),
      P('cy', 'Center ↕', -100, 100, 0, 0.5, '%'),
      P('w', 'Width', 1, 200, 40, 0.5, '%'),
      P('h', 'Height', 1, 200, 50, 0.5, '%'),
      P('angle', 'Rotation', -180, 180, 0, 0.5, '°'),
      P('corner', 'Corners', 0, 100, 20, 1, '%'),
      P('feather', 'Feather', 0, 100, 10),
      { ...P('invert', 'Invert', 0, 1, 0), toggle: true },
    ],
    about: 'Keeps its input inside a shape (with nothing joined: a white shape, for a Merge node’s mask).',
  },
  fx: { kind: 'fx', name: 'Effect', inputs: ['Input'], params: [], about: 'Any video effect: color, blur, keys, stylize, distort.' },
  out: { kind: 'out', name: 'Output', inputs: ['Input'], params: [], about: 'What the clip shows.' },
};

/** The video effects an effect node can be (the ones that need nothing but their input). */
export const NODE_EFFECTS = EFFECTS.filter(
  (e) => e.kind === 'video' && !e.hidden && !['grade', 'lut', 'curves', 'mask', 'drawnmask', 'personmask', 'objectmask', 'nodes'].includes(e.type),
);

/** A node's settings (an effect node has its effect's). */
export function nodeParams(n: CompNode): ParamDef[] {
  if (n.kind === 'fx') return effectDef(n.fx ?? '')?.params ?? [];
  return NODE_DEFS[n.kind].params;
}

/** The node's name as shown. */
export function nodeName(n: CompNode): string {
  if (n.label) return n.label;
  if (n.kind === 'fx') return effectDef(n.fx ?? '')?.name ?? 'Effect';
  return NODE_DEFS[n.kind].name;
}

export const nodeInputs = (n: CompNode): string[] => NODE_DEFS[n.kind].inputs;

/** Where a node's number is kept in the effect. */
export const paramKey = (node: string, key: string): string => `${node}.${key}`;

/** A new composite: the clip straight to the output. */
export function newGraph(): CompGraph {
  const input: CompNode = { id: uid('n'), kind: 'in', x: 40, y: 80, inputs: [] };
  const out: CompNode = { id: uid('n'), kind: 'out', x: 420, y: 80, inputs: [input.id] };
  return { nodes: [input, out] };
}

/** A "Node composite" effect with a new graph. */
export function newCompositeEffect(): Effect {
  return { id: uid('e'), type: 'nodes', on: true, p: {}, d: { graph: newGraph() } };
}

/** The graph of a composite effect (an empty one stands in for a broken one). */
export function graphOf(e: Pick<Effect, 'd'>): CompGraph {
  const g = e.d?.graph as CompGraph | undefined;
  return g && Array.isArray(g.nodes) ? g : newGraph();
}

export const outputNode = (g: CompGraph): CompNode | undefined => g.nodes.find((n) => n.kind === 'out');

/** A node added (with its settings' starting values in `p`). */
export function addNode(
  g: CompGraph,
  p: Record<string, Param>,
  kind: NodeKind,
  at: { x: number; y: number },
  fx?: string,
): { graph: CompGraph; p: Record<string, Param>; id: string } {
  const id = uid('n');
  const node: CompNode = { id, kind, x: Math.round(at.x), y: Math.round(at.y), inputs: NODE_DEFS[kind].inputs.map(() => null) };
  if (kind === 'fx' && fx) node.fx = fx;
  const colors =
    kind === 'fx'
      ? Object.entries((effectDef(fx ?? '')?.data ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === 'string' && String(v).startsWith('#'))
      : (NODE_DEFS[kind].colors ?? []).map(([k, , v]) => [k, v]);
  if (colors.length) node.d = Object.fromEntries(colors as [string, string][]);
  const next = { ...p };
  for (const pd of nodeParams(node)) next[paramKey(id, pd.key)] = pd.def;
  return { graph: { nodes: [...g.nodes, node] }, p: next, id };
}

/** A node taken out (its settings too; whatever it fed is left unjoined). Clip and Output stay. */
export function removeNode(g: CompGraph, p: Record<string, Param>, id: string): { graph: CompGraph; p: Record<string, Param> } {
  const n = g.nodes.find((x) => x.id === id);
  if (!n || n.kind === 'out') return { graph: g, p };
  const nodes = g.nodes.filter((x) => x.id !== id).map((x) => (x.inputs.includes(id) ? { ...x, inputs: x.inputs.map((i) => (i === id ? null : i)) } : x));
  const next = Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith(`${id}.`)));
  return { graph: { nodes }, p: next };
}

/** Does `from` (or anything feeding it) come from `to`? */
function feeds(g: CompGraph, from: string, to: string, seen = new Set<string>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  const n = g.nodes.find((x) => x.id === from);
  return !!n && n.inputs.some((i) => i !== null && feeds(g, i, to, seen));
}

/** Join a node's output to another's input (null: unjoin it). A join that would loop back is refused. */
export function connect(g: CompGraph, from: string | null, to: string, input: number): CompGraph {
  const target = g.nodes.find((x) => x.id === to);
  if (!target || input < 0 || input >= nodeInputs(target).length) return g;
  if (from !== null) {
    const src = g.nodes.find((x) => x.id === from);
    if (!src || src.kind === 'out' || feeds(g, from, to)) return g;
  }
  return { nodes: g.nodes.map((x) => (x.id === to ? { ...x, inputs: x.inputs.map((v, i) => (i === input ? from : v)) } : x)) };
}

export function moveNode(g: CompGraph, id: string, x: number, y: number): CompGraph {
  return { nodes: g.nodes.map((n) => (n.id === id ? { ...n, x: Math.round(x), y: Math.round(y) } : n)) };
}

export function updateNode(g: CompGraph, id: string, change: Partial<Omit<CompNode, 'id' | 'kind'>>): CompGraph {
  return { nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...change } : n)) };
}

/**
 * The nodes the output needs, in the order to work them out (each after
 * what feeds it). Nodes joined to nothing that reaches the output are left out.
 */
export function evaluationOrder(g: CompGraph): CompNode[] {
  const out = outputNode(g);
  if (!out) return [];
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const order: CompNode[] = [];
  const done = new Set<string>();
  const visit = (n: CompNode, path: Set<string>) => {
    if (done.has(n.id) || path.has(n.id)) return;
    path.add(n.id);
    for (const i of n.inputs) {
      const src = i ? byId.get(i) : undefined;
      if (src) visit(src, path);
    }
    path.delete(n.id);
    done.add(n.id);
    order.push(n);
  };
  visit(out, new Set());
  return order;
}

/** Does the graph use what is under the clip? */
export const usesUnder = (g: CompGraph): boolean => evaluationOrder(g).some((n) => n.kind === 'under');

/** A node's numbers at this moment, from the effect's (already worked out) numbers. */
export function nodeNumbers(n: CompNode, p: Record<string, number>): (key: string, def?: number) => number {
  return (key, def = 0) => {
    const v = p[paramKey(n.id, key)];
    if (Number.isFinite(v)) return v as number;
    return nodeParams(n).find((x) => x.key === key)?.def ?? def;
  };
}

/** A copy of a graph with new node ids (for pasting the composite onto another clip). */
export function cloneComposite(e: Effect): Effect {
  const g = graphOf(e);
  const ids = new Map(g.nodes.map((n) => [n.id, uid('n')]));
  const nodes = g.nodes.map((n) => ({ ...n, id: ids.get(n.id) as string, inputs: n.inputs.map((i) => (i ? (ids.get(i) ?? null) : null)) }));
  const p = Object.fromEntries(
    Object.entries(e.p).map(([k, v]) => {
      const [node, key] = [k.slice(0, k.indexOf('.')), k.slice(k.indexOf('.') + 1)];
      return [ids.has(node) ? paramKey(ids.get(node) as string, key) : k, v];
    }),
  );
  return { ...e, id: uid('e'), p, d: { ...e.d, graph: { nodes } } };
}
