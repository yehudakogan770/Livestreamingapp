root='/home/user/Livestreamingapp/.claude/worktrees/agent-aa20d25c9832f0a41/editor/app/src/'
def rep(path,a,b):
    s=open(root+path).read()
    assert s.count(a)==1,(path,a[:70],s.count(a))
    s=s.replace(a,b)
    open(root+path,'w').write(s)

rep('titler/titlerClip.ts',"import { newClip, placeClips } from '../model/edit';\nimport { current } from '../model/seq';\nimport type { Project } from '../model/types';","import { placeClips } from '../model/edit';\nimport { current } from '../model/seq';\nimport { newClip, type Project } from '../model/types';")

rep('model/types.ts',"""  /** A drawn shape: rectangle, ellipse, polygon, star or line. */
  | { kind: 'shape'; shape: ShapeData };""","""  /** A drawn shape: rectangle, ellipse, polygon, star or line. */
  | { kind: 'shape'; shape: ShapeData }
  /** A Lumora Titler graphic (lower third, bug, ticker, card…): IN from the clip's start, OUT to its end. */
  | { kind: 'titler'; project: TitleProject; values: Record<string, string> };""")
s=open(root+'model/types.ts').read()
s="import type { TitleProject } from '../../../../titler/src/core/types';\n"+s if not s.startswith('//') else s
open(root+'model/types.ts','w').write(s)

rep('render/frame.ts',"""  | { kind: 'shape'; shape: ShapeData; local: number; length: number }""","""  | { kind: 'shape'; shape: ShapeData; local: number; length: number }
  | TitlerLayerSource""")
rep('render/frame.ts',"""  else if (src.kind === 'shape') source = { kind: 'shape', shape: src.shape, local, length: c.length };""","""  else if (src.kind === 'shape') source = { kind: 'shape', shape: src.shape, local, length: c.length };
  else if (src.kind === 'titler') source = { kind: 'titler', project: src.project, values: src.values, brand: p.brand, local, length: c.length, fps };""")
rep('render/frame.ts',"""import { withTracking } from '../track/paths';""","""import { withTracking } from '../track/paths';
import type { TitlerLayerSource } from '../titler/titlerClip';""")

# WebGL compositor
rep('render/compositor.ts',"""    if (src?.kind !== 'text' && src?.kind !== 'shape') return null;
    if (!this.textCanvas)""","""    if (src?.kind !== 'text' && src?.kind !== 'shape' && src?.kind !== 'titler') return null;
    if (!this.textCanvas)""")
rep('render/compositor.ts',"""    if (src.kind === 'shape') drawShape(ctx, src.shape, this.w, this.h, src.local);
    else drawText(ctx, src.text, this.w, this.h, src.local, src.length, layer.fps);
    return c;""","""    if (src.kind === 'shape') drawShape(ctx, src.shape, this.w, this.h, src.local);
    else if (src.kind === 'titler') drawTitler(ctx, src, this.w, this.h);
    else drawText(ctx, src.text, this.w, this.h, src.local, src.length, layer.fps);
    return c;""")
rep('render/compositor.ts',"""    } else if (src.kind === 'text' || src.kind === 'shape') {
      // Words and shapes are drawn again only when they look different (while they animate, or are changed).
      const key = `text:${layer.key}`;
      const look = src.kind === 'shape' ? shapeStamp(src.shape, src.local) : textStamp(src.text, src.local, src.length, layer.fps);""","""    } else if (src.kind === 'text' || src.kind === 'shape' || src.kind === 'titler') {
      // Words and shapes are drawn again only when they look different (while they animate, or are changed).
      const key = `text:${layer.key}`;
      const look = src.kind === 'shape' ? shapeStamp(src.shape, src.local) : src.kind === 'titler' ? titlerStamp(src) : textStamp(src.text, src.local, src.length, layer.fps);""")
s=open(root+'render/compositor.ts').read()
i=s.index('\nimport ')
s=s[:i]+"\nimport { drawTitler, titlerStamp } from '../titler/titlerClip';"+s[i:]
open(root+'render/compositor.ts','w').write(s)

# native resources
rep('render/native/resources.ts',"""    if (src?.kind !== 'text' && src?.kind !== 'shape') return null;
    const look = src.kind === 'shape' ? shapeStamp(src.shape, src.local) : textStamp(src.text, src.local, src.length, layer.fps);""","""    if (src?.kind !== 'text' && src?.kind !== 'shape' && src?.kind !== 'titler') return null;
    const look = src.kind === 'shape' ? shapeStamp(src.shape, src.local) : src.kind === 'titler' ? titlerStamp(src) : textStamp(src.text, src.local, src.length, layer.fps);""")
rep('render/native/resources.ts',"""      if (src.kind === 'shape') drawShape(ctx as CanvasRenderingContext2D, src.shape, w, h, src.local);
      else drawText(""","""      if (src.kind === 'shape') drawShape(ctx as CanvasRenderingContext2D, src.shape, w, h, src.local);
      else if (src.kind === 'titler') drawTitler(ctx as CanvasRenderingContext2D, src, w, h);
      else drawText(""")
s=open(root+'render/native/resources.ts').read()
i=s.index('\nimport ')
s=s[:i]+"\nimport { drawTitler, titlerStamp } from '../../titler/titlerClip';"+s[i:]
open(root+'render/native/resources.ts','w').write(s)
rep('render/native/record.ts',"""    } else if (src.kind === 'text' || src.kind === 'shape') {""","""    } else if (src.kind === 'text' || src.kind === 'shape' || src.kind === 'titler') {""")
