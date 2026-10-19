import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/core/svgImport.ts'
s=open(p).read()
s+='''
/** Layers (and those in their groups) shown from 0 to `end` seconds. */
export function spanning(layers: Layer[], end: number): Layer[] {
  return layers.map((l) => ({ ...l, start: 0, end, ...(l.type === 'group' ? { children: spanning(l.children, end) } : {}) }) as Layer);
}
'''
open(p,'w').write(s)
rep('titler/src/designer/importing.ts',"  p.compositions[0]!.layers = r.layers.map((l) => ({ ...l, end: p.compositions[0]!.duration }));","  p.compositions[0]!.layers = spanning(r.layers, p.compositions[0]!.duration);")
rep('titler/src/designer/importing.ts',"import { fromSvg } from '../core/svgImport';","import { fromSvg, spanning } from '../core/svgImport';")
rep('titler/src/designer/Designer.tsx',"            const pasted = svg.layers.map((l) => ({ ...l, end: c.duration }));","            const pasted = spanning(svg.layers, c.duration);")
rep('titler/src/designer/Designer.tsx',"import { fromSvg } from '../core/svgImport';","import { fromSvg, spanning } from '../core/svgImport';")
