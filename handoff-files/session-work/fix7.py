import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
p='titler/src/core/lottieExport.ts'
s=open(p).read()
def rep(a,b):
    global s
    assert a in s,a; s=s.replace(a,b,1)
rep("""
/** Is any keyframe value out of what Lottie keeps? (For tests: the keyed value at t.) */
export const keyed = keyedValueAt;
""","")
rep("import { isAnimated, keyedValueAt, valueAt } from './easing';","import { isAnimated, valueAt } from './easing';")
rep("  const firstTop = lay.lines[0] ? lay.lines[0].y - size * 0.8 : 0;","  // How far the first line sits below where it would with the words at the top of the box (middle, bottom).\n  const firstTop = lay.lines[0] ? lay.lines[0].y - (lh * 0.5 + size * 0.35) : 0;")
open(p,'w').write(s)
p='titler/src/core/lottie.ts'
s=open(p).read()
rep("""        const children = shapeItems(arr(l.shapes).filter(isObj), { fill: null, fillRule: 'nonzero', stroke: null, trim: null }, start, end, c, shift);
        layer = { ...b, type: 'group', children };""","""        const children = shapeItems(arr(l.shapes).filter(isObj), { fill: null, fillRule: 'nonzero', stroke: null, trim: null }, start, end, c, shift);
        layer = collapse({ ...b, type: 'group', children });""")
rep("""function imageAsset(""","""const isStill = <T extends Value>(p: Prop<T>, v: T) => !('k' in p && p.k) && !p.x && JSON.stringify(p.v) === JSON.stringify(v);
const plain = (tr: Transform) => isStill(tr.anchor, [0, 0]) && isStill(tr.position, [0, 0]) && isStill(tr.scale, [100, 100]) && isStill(tr.rotation, 0) && isStill(tr.opacity, 100);

/** A shape layer that is one shape (After Effects' usual layer > group > rectangle) as that shape. */
function collapse(g: GroupLayer): Layer {
  let children = g.children;
  while (children.length === 1 && children[0]!.type === 'group' && plain(children[0]!.transform) && !children[0]!.masks?.length) children = (children[0] as GroupLayer).children;
  const only = children.length === 1 ? children[0]! : null;
  if (only && only.type === 'shape' && !only.masks?.length) {
    const tr = only.transform;
    const centered = !('k' in tr.anchor && tr.anchor.k) && !('k' in tr.position && tr.position.k) && JSON.stringify(tr.anchor.v) === JSON.stringify(tr.position.v);
    if (centered && isStill(tr.scale, [100, 100]) && isStill(tr.rotation, 0) && isStill(tr.opacity, 100)) {
      const { children: _c, type: _t, ...rest } = g;
      return { ...only, ...rest, name: g.name, type: 'shape', transform: g.transform };
    }
  }
  return { ...g, children };
}

function imageAsset(""")
open(p,'w').write(s)
