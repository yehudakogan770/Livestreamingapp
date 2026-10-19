import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/core/lottieExport.ts'
rep(p,"""  if (l.fitTo) x.notes.add('Boxes that follow their words keep the size they have now.');
  const half = (v: Vec2) => [r3(v[0] / 2), r3(v[1] / 2)];
  if (l.shape === 'rect' && !l.corners) {""","""  const half = (v: Vec2) => [r3(v[0] / 2), r3(v[1] / 2)];
  const fit = l.fitTo ? fitted(x, l) : null;
  if (fit) {
    // A box following its words: the size it has with the words now.
    x.notes.add('Boxes that follow their words keep the size they have with the words now.');
    if (l.shape === 'rect' && !l.corners)
      items.push({ ty: 'rc', d: 1, s: { a: 0, k: [r3(fit.w), r3(fit.h)] }, p: { a: 0, k: [r3(fit.dx + fit.w / 2), r3(fit.h / 2)] }, r: lprop(x, l.roundness, 0, (v) => [r3(v)]) });
    else if (l.shape === 'ellipse') items.push({ ty: 'el', d: 1, s: { a: 0, k: [r3(fit.w), r3(fit.h)] }, p: { a: 0, k: [r3(fit.dx + fit.w / 2), r3(fit.h / 2)] } });
    else items.push({ ty: 'sh', ks: { a: 0, k: lpath(rectCornersPath(fit.w, fit.h, l.corners ?? [0, 0, 0, 0])) } });
  } else if (l.shape === 'rect' && !l.corners) {""")
rep(p,"""function shapeContents(x: X, l: ShapeLayer): J[] {""","""/** A box that follows a text layer's words: its size and place now (render.ts fittedBox). */
function fitted(x: X, l: ShapeLayer): { dx: number; w: number; h: number } | null {
  const f = l.fitTo;
  const text = f ? x.index.get(f.layer) : undefined;
  if (!f || !text || text.type !== 'text') return null;
  const lay = textLayout(text, x.values, x.tokens, x.measure, x.p.variables);
  const base = contentSize(l, 0, x.p);
  const min = f.min ?? [0, 0];
  const empty = !lay.lines.some((q) => q.glyphs.length);
  const w = empty ? min[0] : Math.max(min[0], lay.width + f.pad[0] * 2);
  const h = f.axis === 'both' ? Math.max(min[1], lay.height + f.pad[1] * 2) : base[1];
  const dx = text.style.align === 'center' ? (base[0] - w) / 2 : text.style.align === 'right' ? base[0] - w : 0;
  return { dx, w, h };
}

function shapeContents(x: X, l: ShapeLayer): J[] {""")
rep(p,"""  done: Set<string>;
  seq: number;
}""","""  done: Set<string>;
  seq: number;
  /** The layers of the composition being written, by id (boxes following words find their text). */
  index: Map<string, Layer>;
}""")
rep(p,"""    done: new Set(),
    seq: 0,
  };""","""    done: new Set(),
    seq: 0,
    index: layerIndex(comp),
  };""")
rep(p,"""        x.assets.push({ id, nm: inner.name, w: inner.width, h: inner.height, fr: x.fr, layers: layersJson(x, inner.layers, inner.width, inner.height) });""","""        const outer = x.index;
        x.index = layerIndex(inner);
        x.assets.push({ id, nm: inner.name, w: inner.width, h: inner.height, fr: x.fr, layers: layersJson(x, inner.layers, inner.width, inner.height) });
        x.index = outer;""")
rep(p,"import { contentSize, exprScopeFor, textLayout } from './render';","import { contentSize, exprScopeFor, layerIndex, textLayout } from './render';")
