import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

edit('titler/src/core/types.ts', [
("""/** A property: a still value, or keyframes in time order. */
export type Prop<T extends Value = number> = { v: T; k?: undefined } | { k: Keyframe<T>[]; v?: undefined };""",
"""/**
 * A property: a still value, or keyframes in time order; `x`: an expression
 * worked out from it (see core/expr.ts), e.g. "wiggle(2, 8)".
 */
export type Prop<T extends Value = number> = { v: T; k?: undefined; x?: string } | { k: Keyframe<T>[]; v?: undefined; x?: string };"""),
])

edit('titler/src/core/easing.ts', [
("""/** A property's value at time t (seconds). */
export function valueAt<T extends Value>(p: Prop<T> | undefined, t: number, fallback: T): T {
  if (!p) return fallback;""", """/** A property's value at time t (seconds), with its expression if it has one. */
export function valueAt<T extends Value>(p: Prop<T> | undefined, t: number, fallback: T): T {
  const v = keyedValueAt(p, t, fallback);
  if (!p?.x) return v;
  return applyExpr(p.x, p, t, v, (tt) => keyedValueAt(p, tt, fallback));
}

/** The keyframed (or still) value at time t, before any expression. */
export function keyedValueAt<T extends Value>(p: Prop<T> | undefined, t: number, fallback: T): T {
  if (!p) return fallback;"""),
("""import type { Keyframe, Prop, Value, Vec2 } from './types';""", """import { applyExpr } from './expr';
import type { Keyframe, Prop, Value, Vec2 } from './types';

/** The expression a property carries, to keep on a changed property. */
const keepX = (p: Prop<Value> | undefined) => (p?.x ? { x: p.x } : {});"""),
("""  list.push(had ? { ...had, v } : { t, v });
  list.sort((a, b) => a.t - b.t);
  return { k: list };
}""", """  list.push(had ? { ...had, v } : { t, v });
  list.sort((a, b) => a.t - b.t);
  return { k: list, ...keepX(p) };
}"""),
("""  return isAnimated(p) ? setKey(p, t, v) : { v };
}""", """  return isAnimated(p) ? setKey(p, t, v) : { v, ...keepX(p) };
}"""),
("""  if (isAnimated(p)) return { v: valueAt(p, t, fallback) };
  return { k: [{ t, v: (p?.v ?? fallback) as T }] };""", """  if (isAnimated(p)) return { v: keyedValueAt(p, t, fallback), ...keepX(p) };
  return { k: [{ t, v: (p?.v ?? fallback) as T }], ...keepX(p) };"""),
("""  const k = p.k.filter((x) => Math.abs(x.t - t) > 1e-6);
  return k.length ? { k } : { v: valueAt(p, t, fallback) };""", """  const k = p.k.filter((x) => Math.abs(x.t - t) > 1e-6);
  return k.length ? { k, ...keepX(p) } : { v: keyedValueAt(p, t, fallback), ...keepX(p) };"""),
("""  const b = k[idx + 1];
  if (b && easeId !== 'hold') b.i = [...e.i];
  return { k };""", """  const b = k[idx + 1];
  if (b && easeId !== 'hold') b.i = [...e.i];
  return { k, ...keepX(p) };"""),
])
print('ok')
