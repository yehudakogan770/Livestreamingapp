import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='geometry.ts'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep("import { canvasMeasure, contentSize, fittedBox, groupOf, layerIndex, ownMatrix, textLayout, worldMatrix, type Ctx } from '../core/render';",
"import { canvasMeasure, contentSize, fittedBox, groupOf, layerIndex, ownMatrix, textLayout, viewOfLayer, worldMatrix, type Ctx } from '../core/render';")
rep('''  return [apply(m, [b.x, b.y]), apply(m, [b.x + b.w, b.y]), apply(m, [b.x + b.w, b.y + b.h]), apply(m, [b.x, b.y + b.h])];
}''','''  const pts = [apply(m, [b.x, b.y]), apply(m, [b.x + b.w, b.y]), apply(m, [b.x + b.w, b.y + b.h]), apply(m, [b.x, b.y + b.h])];
  // A 3D layer: where the camera sees its corners.
  const seen = viewOfLayer(c, l, look.t);
  return seen ? pts.map(seen) : pts;
}''')
open(p,'w').write(s)
