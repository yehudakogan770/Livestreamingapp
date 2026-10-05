// A clip's color grade as a small node graph, like a colorist's node tree.
// The grade is one effect on the clip (type "grade"), so it keeps its place
// among the clip's other effects. Its steps run one after another; a step is
// one node, or a group of nodes that all start from the same picture and are
// then mixed (parallel) or stacked top over bottom (layer).
import { valueAt } from './anim';
import type { CurveSet } from '../render/color';
import { uid, type Clip, type Effect, type Param, type Project } from './types';

export type { CurveSet };

/** Only change colors in a range of hue, saturation and brightness (an HSL key). */
export interface Qualifier {
  /** Degrees (0–360) and how wide around it (degrees, 360 = every hue). */
  hue: number;
  hueWidth: number;
  /** 0–100. */
  satLo: number;
  satHi: number;
  lumLo: number;
  lumHi: number;
  /** How gently the edges fade (0–100). */
  soft: number;
  invert: boolean;
}

/** Only change part of the frame: a circle or rectangle (a power window). */
export interface GradeWindow {
  shape: 'circle' | 'rect';
  /** Center, 0–1 across and down the frame. */
  x: number;
  y: number;
  /** Size, as a part of the frame's height (so a circle stays round). */
  w: number;
  h: number;
  /** How gently the edge fades (0–100). */
  soft: number;
  invert: boolean;
}

export interface GradeNode {
  id: string;
  label: string;
  /** Off: the node is skipped (bypassed). */
  on: boolean;
  /** The correction controls (see NODE_PARAMS); numbers that can be keyframed. */
  p: Record<string, Param>;
  curves: CurveSet | null;
  qualifier: Qualifier | null;
  window: GradeWindow | null;
}

export type MixKind = 'parallel' | 'layer';

export type GradeStep = { kind: 'serial'; node: GradeNode } | { kind: MixKind; id: string; nodes: GradeNode[] };

export interface Grade {
  steps: GradeStep[];
}

// ---- The controls in each node ----

export interface NodeParam {
  key: string;
  label: string;
  def: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

const N = (key: string, label: string, def: number, min: number, max: number, step = 1, unit?: string): NodeParam => ({
  key,
  label,
  def,
  min,
  max,
  step,
  ...(unit ? { unit } : {}),
});

/** Primary corrections (the same as the Basic correction effect, plus a contrast pivot and a hue turn). */
export const BASIC_PARAMS: NodeParam[] = [
  N('exposure', 'Exposure', 0, -4, 4, 0.05),
  N('contrast', 'Contrast', 0, -100, 100),
  N('pivot', 'Pivot', 50, 0, 100, 1, '%'),
  N('highlights', 'Highlights', 0, -100, 100),
  N('shadows', 'Shadows', 0, -100, 100),
  N('whites', 'Whites', 0, -100, 100),
  N('blacks', 'Blacks', 0, -100, 100),
  N('temperature', 'Temperature', 0, -100, 100),
  N('tint', 'Tint', 0, -100, 100),
  N('saturation', 'Saturation', 100, 0, 200, 1, '%'),
  N('vibrance', 'Vibrance', 0, -100, 100),
  N('hue', 'Hue', 0, -180, 180, 1, '°'),
];

/** The four color wheels: a color push (X, Y) and a level each. */
export const WHEELS = ['lift', 'gamma', 'gain', 'offset'] as const;
export const WHEEL_PARAMS: NodeParam[] = WHEELS.flatMap((w) => [
  N(`${w}X`, `${w} ↔`, 0, -1, 1, 0.01),
  N(`${w}Y`, `${w} ↕`, 0, -1, 1, 0.01),
  N(w, w, 0, -100, 100),
]);

/** Change one color (the same as the Change one color effect). */
export const HSL_PARAMS: NodeParam[] = [
  N('hslHue', 'Which color', 30, 0, 360, 1, '°'),
  N('hslRange', 'How wide', 30, 5, 180, 1, '°'),
  N('hslShift', 'Hue shift', 0, -180, 180, 1, '°'),
  N('hslSat', 'Saturation', 0, -100, 100),
  N('hslLight', 'Lightness', 0, -100, 100),
];

export const NODE_PARAMS: NodeParam[] = [...BASIC_PARAMS, ...WHEEL_PARAMS, N('curveMix', 'Curves amount', 100, 0, 100, 1, '%'), ...HSL_PARAMS];

const DEFAULTS: Record<string, number> = Object.fromEntries(NODE_PARAMS.map((x) => [x.key, x.def]));
export const paramDefault = (key: string): number => DEFAULTS[key] ?? 0;

export const DEFAULT_QUALIFIER: Qualifier = { hue: 30, hueWidth: 60, satLo: 10, satHi: 100, lumLo: 0, lumHi: 100, soft: 10, invert: false };
export const DEFAULT_WINDOW: GradeWindow = { shape: 'circle', x: 0.5, y: 0.5, w: 0.6, h: 0.6, soft: 30, invert: false };

export const flatCurves = (): CurveSet => ({
  master: [
    [0, 0],
    [1, 1],
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
});

export function newNode(label = ''): GradeNode {
  return { id: uid('n'), label, on: true, p: {}, curves: null, qualifier: null, window: null };
}

export const newGrade = (): Grade => ({ steps: [{ kind: 'serial', node: newNode() }] });

export function newGradeEffect(grade: Grade = newGrade()): Effect {
  return { id: uid('e'), type: 'grade', on: true, p: {}, d: grade as unknown as Record<string, unknown> };
}

// ---- Reading a clip's grade ----

export const isGrade = (e: Effect): boolean => e.type === 'grade';

/** The grade stored in a grade effect (an empty one if it is damaged). */
export function gradeOf(e: Effect | undefined): Grade {
  const g = e?.d as unknown as Grade | undefined;
  return g && Array.isArray(g.steps) ? g : { steps: [] };
}

export const gradeEffect = (c: Clip): Effect | undefined => c.effects.find(isGrade);

/** Every node, in the order they are drawn in. */
export function allNodes(g: Grade): GradeNode[] {
  return g.steps.flatMap((s) => (s.kind === 'serial' ? [s.node] : s.nodes));
}

export const findNode = (g: Grade, id: string | null): GradeNode | undefined => allNodes(g).find((n) => n.id === id);

/** Where a node is: which step, and where in that step's group (-1 for a serial node). */
export function locate(g: Grade, id: string): { step: number; at: number } | null {
  for (let i = 0; i < g.steps.length; i++) {
    const s = g.steps[i] as GradeStep;
    if (s.kind === 'serial' && s.node.id === id) return { step: i, at: -1 };
    if (s.kind !== 'serial') {
      const at = s.nodes.findIndex((n) => n.id === id);
      if (at >= 0) return { step: i, at };
    }
  }
  return null;
}

/** "01", "02"… in drawing order, as colorists number their nodes. */
export function nodeNumber(g: Grade, id: string): string {
  return String(allNodes(g).findIndex((n) => n.id === id) + 1).padStart(2, '0');
}

// ---- Changing the graph (each gives back a new grade) ----

function mapNodes(g: Grade, f: (n: GradeNode) => GradeNode): Grade {
  return {
    steps: g.steps.map((s) => (s.kind === 'serial' ? { ...s, node: f(s.node) } : { ...s, nodes: s.nodes.map(f) })),
  };
}

export function updateNode(g: Grade, id: string, f: (n: GradeNode) => GradeNode): Grade {
  return mapNodes(g, (n) => (n.id === id ? f(n) : n));
}

/** A group with one node left is just a serial node. */
function tidy(steps: GradeStep[]): GradeStep[] {
  return steps
    .filter((s) => s.kind === 'serial' || s.nodes.length > 0)
    .map((s) => (s.kind !== 'serial' && s.nodes.length === 1 ? { kind: 'serial', node: s.nodes[0] as GradeNode } : s));
}

/** A new node after the selected one's step (or at the end). */
export function addSerial(g: Grade, after: string | null, node: GradeNode = newNode()): Grade {
  const at = after ? locate(g, after) : null;
  const i = at ? at.step + 1 : g.steps.length;
  const steps = [...g.steps];
  steps.splice(i, 0, { kind: 'serial', node });
  return { steps };
}

/**
 * A new node beside the selected one, mixed with it: a serial node becomes a
 * group of two; a node already in a group adds to that group (which becomes
 * this kind of mix).
 */
export function addBeside(g: Grade, to: string | null, kind: MixKind, node: GradeNode = newNode()): Grade {
  const at = to ? locate(g, to) : null;
  if (!at) {
    const last = g.steps[g.steps.length - 1];
    if (!last) return { steps: [{ kind: 'serial', node }] };
    const lastNode = last.kind === 'serial' ? last.node : (last.nodes[last.nodes.length - 1] as GradeNode);
    return addBeside(g, lastNode.id, kind, node);
  }
  const steps = g.steps.map((s, i): GradeStep => {
    if (i !== at.step) return s;
    if (s.kind === 'serial') return { kind, id: uid('m'), nodes: [s.node, node] };
    return { ...s, kind, nodes: [...s.nodes, node] };
  });
  return { steps };
}

/** Take a node out (the last node is reset instead, so there is always one). */
export function removeNode(g: Grade, id: string): Grade {
  if (allNodes(g).length <= 1) return resetNode(g, id);
  const steps = g.steps.flatMap((s): GradeStep[] => {
    if (s.kind === 'serial') return s.node.id === id ? [] : [s];
    return [{ ...s, nodes: s.nodes.filter((n) => n.id !== id) }];
  });
  return { steps: tidy(steps) };
}

/** Back to doing nothing (its name and place are kept). */
export function resetNode(g: Grade, id: string): Grade {
  return updateNode(g, id, (n) => ({ ...n, on: true, p: {}, curves: null, qualifier: null, window: null }));
}

/** Move a whole step to another place in the chain. */
export function moveStep(g: Grade, from: number, to: number): Grade {
  if (from === to || from < 0 || from >= g.steps.length) return g;
  const steps = [...g.steps];
  const [s] = steps.splice(from, 1);
  steps.splice(Math.max(0, Math.min(steps.length, to)), 0, s as GradeStep);
  return { steps };
}

/** Move a node one place earlier or later: its step in the chain, or itself inside its group. */
export function nudgeNode(g: Grade, id: string, dir: -1 | 1): Grade {
  const at = locate(g, id);
  if (!at) return g;
  if (at.at < 0) return moveStep(g, at.step, at.step + dir);
  const s = g.steps[at.step] as Extract<GradeStep, { nodes: GradeNode[] }>;
  const j = at.at + dir;
  if (j < 0 || j >= s.nodes.length) return g;
  const nodes = [...s.nodes];
  [nodes[at.at], nodes[j]] = [nodes[j] as GradeNode, nodes[at.at] as GradeNode];
  return { steps: g.steps.map((x, i) => (i === at.step ? { ...s, nodes } : x)) };
}

/** Switch a group between parallel and layer mixing. */
export function setMix(g: Grade, step: number, kind: MixKind): Grade {
  return { steps: g.steps.map((s, i) => (i === step && s.kind !== 'serial' ? { ...s, kind } : s)) };
}

/** A copy with new node ids (for pasting onto another clip). */
export function cloneGrade(g: Grade): Grade {
  const copy = structuredClone(g);
  return mapNodes(copy, (n) => ({ ...n, id: uid('n') }));
}

/** Every keyframed number in the grade, changed the same way (trims and speed changes). */
export function mapGradeParams(g: Grade, f: (p: Param) => Param): Grade {
  return mapNodes(g, (n) => ({ ...n, p: Object.fromEntries(Object.entries(n.p).map(([k, v]) => [k, f(v)])) }));
}

// ---- The grade at one frame ----

export interface NodeNow {
  id: string;
  /** Every control, with its default when not set. */
  p: Record<string, number>;
  curves: CurveSet | null;
  qualifier: Qualifier | null;
  window: GradeWindow | null;
}
export type StepNow = { kind: 'serial'; node: NodeNow } | { kind: MixKind; nodes: NodeNow[] };
export interface GradeNow {
  steps: StepNow[];
}

/** The grade's numbers at a frame of the clip; bypassed nodes are left out. */
export function gradeAt(g: Grade, t: number): GradeNow {
  const now = (n: GradeNode): NodeNow => ({
    id: n.id,
    p: Object.fromEntries(NODE_PARAMS.map((x) => [x.key, valueAt(n.p[x.key], t, x.def)])),
    curves: n.curves,
    qualifier: n.qualifier,
    window: n.window,
  });
  const steps: StepNow[] = [];
  for (const s of g.steps) {
    if (s.kind === 'serial') {
      if (s.node.on) steps.push({ kind: 'serial', node: now(s.node) });
      continue;
    }
    const nodes = s.nodes.filter((n) => n.on).map(now);
    if (nodes.length) steps.push({ kind: s.kind, nodes });
  }
  return { steps };
}

// ---- Older projects: color effects become nodes ----

/** The color effects that a node can hold, in the order a node applies them. */
const NODE_ORDER = ['basic', 'wheels', 'curves', 'hsl'];

const HSL_KEYS: Record<string, string> = { hue: 'hslHue', range: 'hslRange', shift: 'hslShift', sat: 'hslSat', light: 'hslLight' };

/** Put one old color effect's settings into a node. */
function absorb(n: GradeNode, e: Effect): GradeNode {
  if (e.type === 'curves') {
    const d = e.d as unknown as CurveSet | undefined;
    return { ...n, p: { ...n.p, ...(e.p.mix !== undefined ? { curveMix: e.p.mix } : {}) }, curves: d?.master ? structuredClone(d) : null };
  }
  const keyOf = (k: string) => (e.type === 'hsl' ? (HSL_KEYS[k] ?? k) : k);
  return { ...n, p: { ...n.p, ...Object.fromEntries(Object.entries(e.p).map(([k, v]) => [keyOf(k), structuredClone(v)])) } };
}

/**
 * Old color effects in a row (Basic, Color wheels, Curves, Change one color)
 * as nodes that look exactly the same: one node while they are in the order a
 * node applies them, a new node when the order goes back (or for one that was off).
 */
export function nodesFromEffects(list: Effect[]): GradeNode[] {
  const nodes: GradeNode[] = [];
  let cur: GradeNode | null = null;
  let last = -1;
  for (const e of list) {
    const k = NODE_ORDER.indexOf(e.type);
    if (!cur || !cur.on || !e.on || k <= last) {
      cur = { ...newNode(), on: e.on };
      nodes.push(cur);
    }
    const next = absorb(cur, e);
    nodes[nodes.length - 1] = next;
    cur = next;
    last = k;
  }
  return nodes;
}

/** The first row of old color effects on a clip: where it starts and how many. */
function legacyRun(c: Clip): { from: number; count: number } | null {
  const from = c.effects.findIndex((e) => NODE_ORDER.includes(e.type));
  if (from < 0) return null;
  let count = 0;
  while (from + count < c.effects.length && NODE_ORDER.includes((c.effects[from + count] as Effect).type)) count++;
  return { from, count };
}

/** Color effects on the clip that aren't in its node grade (still drawn as they were). */
export const looseColorEffects = (c: Clip): Effect[] => c.effects.filter((e) => NODE_ORDER.includes(e.type));

/**
 * The clip with a node grade: an old row of color effects becomes the grade
 * (in the same place, so it looks the same); with none, an empty grade is
 * added at the end. A clip that already has a grade is unchanged.
 */
export function withGrade(c: Clip): Clip {
  if (gradeEffect(c)) return c;
  const run = legacyRun(c);
  if (!run) return { ...c, effects: [...c.effects, newGradeEffect()] };
  const nodes = nodesFromEffects(c.effects.slice(run.from, run.from + run.count));
  const fx = newGradeEffect({ steps: nodes.map((node) => ({ kind: 'serial', node })) });
  const effects = [...c.effects];
  effects.splice(run.from, run.count, fx);
  return { ...c, effects };
}

/**
 * The grade the Color page shows for a clip: its own, or (before its first
 * change) the one it would get, with stand-in node ids.
 */
export function shownGrade(c: Clip): Grade {
  const own = gradeEffect(c);
  if (own) return gradeOf(own);
  let i = 0;
  return mapNodes(gradeOf(gradeEffect(withGrade(c))), (n) => ({ ...n, id: `new${i++}` }));
}

/** Change a clip's grade (it gets one first if it has none). */
export function changeGrade(c: Clip, f: (g: Grade) => Grade): Clip {
  const graded = withGrade(c);
  const fx = gradeEffect(graded) as Effect;
  const next = f(gradeOf(fx));
  return { ...graded, effects: graded.effects.map((e) => (e.id === fx.id ? { ...e, d: next as unknown as Record<string, unknown> } : e)) };
}

/** Old projects: each clip's color effects become a node grade (clips without any are untouched). */
export function migrateProject(p: Project): Project {
  const old = (c: Clip) => !gradeEffect(c) && !!legacyRun(c);
  if (!p.sequences.some((s) => s.clips.some(old))) return p;
  return { ...p, sequences: p.sequences.map((s) => (s.clips.some(old) ? { ...s, clips: s.clips.map((c) => (old(c) ? withGrade(c) : c)) } : s)) };
}
