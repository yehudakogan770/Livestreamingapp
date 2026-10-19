import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
rep('titler/src/core/types.ts',"""export interface PathData {
  closed: boolean;
  v: PathVertex[];
}""","""export interface PathData {
  closed: boolean;
  v: PathVertex[];
}

/** A path keyframe (a shape that changes form): vertices matched one to one with the next key's. */
export interface PathKey {
  t: number;
  /** The main outline, then any further outlines (holes, more pieces), as in `path` and `subpaths`. */
  v: PathData[];
  o?: Vec2;
  i?: Vec2;
  hold?: boolean;
}""")
rep('titler/src/core/types.ts',"""  path?: PathData;
  fill: Paint | null;""","""  path?: PathData;
  /** More outlines of the same shape (a compound path: letters with holes, several pieces under one fill). */
  subpaths?: PathData[];
  /** How overlapping outlines fill: nonzero (default) or evenodd (every other one is a hole). */
  fillRule?: 'nonzero' | 'evenodd';
  /** The path changing form over time (path and subpaths at each key). */
  morph?: PathKey[] | null;
  fill: Paint | null;""")
p='titler/src/core/render.ts'
rep(p,"""export function shapePath(l: ShapeLayer, t: number, size?: Vec2): PathData {
  if (l.shape === 'path') return l.path ?? { closed: false, v: [] };""","""export function shapePath(l: ShapeLayer, t: number, size?: Vec2): PathData {
  if (l.shape === 'path') return l.morph?.length ? (morphAt(l.morph, t)[0] ?? { closed: false, v: [] }) : (l.path ?? { closed: false, v: [] });""")
rep(p,"""function drawShape(ctx: Ctx, l: ShapeLayer, size: Vec2, s: Scene) {
  const t = s.t;
  const path = shapePath(l, t, l.fitTo ? size : undefined);""","""/** A path shape's further outlines at time t. */
export function shapeSubpaths(l: ShapeLayer, t: number): PathData[] {
  if (l.shape !== 'path') return [];
  if (l.morph?.length) return morphAt(l.morph, t).slice(1);
  return l.subpaths ?? [];
}

function drawShape(ctx: Ctx, l: ShapeLayer, size: Vec2, s: Scene) {
  const t = s.t;
  const path = shapePath(l, t, l.fitTo ? size : undefined);
  const more = shapeSubpaths(l, t);
  const trace = (c: Ctx) => {
    tracePath(c, path);
    for (const sp of more) tracePath(c, sp);
  };""")
rep(p,"""  if (l.fill && !trimmed) {
    ctx.beginPath();
    tracePath(ctx, path);
    ctx.fillStyle = paintStyle(ctx, l.fill, size[0], size[1], s);
    ctx.fill();
  }""","""  if (l.fill && !trimmed) {
    ctx.beginPath();
    trace(ctx);
    ctx.fillStyle = paintStyle(ctx, l.fill, size[0], size[1], s);
    ctx.fill(l.fillRule ?? 'nonzero');
  }""")
rep(p,"""      if (side === 'outside') ctx.rect(-1e6, -1e6, 2e6, 2e6);
      tracePath(ctx, path);
      ctx.clip(side === 'outside' ? 'evenodd' : 'nonzero');
    }
    ctx.beginPath();
    if (trimmed) traceTrimmed(ctx, path, ts, te, to);
    else tracePath(ctx, path);""","""      if (side === 'outside') ctx.rect(-1e6, -1e6, 2e6, 2e6);
      trace(ctx);
      ctx.clip(side === 'outside' ? 'evenodd' : (l.fillRule ?? 'nonzero'));
    }
    ctx.beginPath();
    if (trimmed) {
      traceTrimmed(ctx, path, ts, te, to);
      for (const sp of more) traceTrimmed(ctx, sp, ts, te, to);
    } else trace(ctx);""")
rep(p,"import { ellipsePath, rectCornersPath, rectPath, traceTrimmed, tracePath } from './paths';","import { ellipsePath, morphAt, rectCornersPath, rectPath, traceTrimmed, tracePath } from './paths';")
p='titler/src/core/paths.ts'
rep(p,"import type { PathData, PathVertex, Vec2 } from './types';","import { segmentProgress } from './easing';\nimport type { PathData, PathKey, PathVertex, Vec2 } from './types';")
s=open(p).read()
s+='''
const mixV = (a: Vec2 | undefined, b: Vec2 | undefined, e: number): Vec2 | undefined =>
  a || b ? [(a?.[0] ?? 0) + ((b?.[0] ?? 0) - (a?.[0] ?? 0)) * e, (a?.[1] ?? 0) + ((b?.[1] ?? 0) - (a?.[1] ?? 0)) * e] : undefined;

/** Two paths part way between (vertex by vertex; a path with other vertices than the next key's jumps). */
export function mixPath(a: PathData, b: PathData, e: number): PathData {
  if (a.v.length !== b.v.length) return e < 1 ? a : b;
  return {
    closed: a.closed,
    v: a.v.map((va, k) => {
      const vb = b.v[k]!;
      const out: PathVertex = { p: mixV(va.p, vb.p, e)! };
      const i = mixV(va.i, vb.i, e);
      const o = mixV(va.o, vb.o, e);
      if (i) out.i = i;
      if (o) out.o = o;
      return out;
    }),
  };
}

/** A changing shape's outlines at time t (seconds), eased like any keyframes. */
export function morphAt(keys: PathKey[], t: number): PathData[] {
  if (!keys.length) return [];
  if (t <= keys[0]!.t) return keys[0]!.v;
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return last.v;
  let n = 0;
  while (n < keys.length - 2 && keys[n + 1]!.t <= t) n++;
  const a = keys[n]!;
  const b = keys[n + 1]!;
  const span = b.t - a.t;
  const f = span > 0 ? (t - a.t) / span : 1;
  const e = segmentProgress({ t: a.t, v: 0, o: a.o, hold: a.hold }, { t: b.t, v: 1, i: b.i }, f);
  if (a.hold) return a.v;
  return a.v.map((pa, k) => (b.v[k] ? mixPath(pa, b.v[k]!, e) : pa));
}
'''
open(p,'w').write(s)
