import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/core/types.ts'
rep(p,"""  fill: Paint | null;
  stroke: Stroke | null;
  /** Trim paths""","""  fill: Paint | null;
  /** More fills drawn over the first (a gradient sheen over a color, a texture), each its own paint. */
  extraFills?: Paint[];
  stroke: Stroke | null;
  /** Trim paths""")
rep(p,"""export interface GroupLayer extends LayerBase {
  type: 'group';
  /** Front first, like the layer list. */
  children: Layer[];
}""","""export interface GroupLayer extends LayerBase {
  type: 'group';
  /** Front first, like the layer list. */
  children: Layer[];
  /**
   * Combine the layers into one shape (boolean): the back layer is the base,
   * each layer in front of it is added to it, cut out of it, kept where they
   * overlap, or kept where they do not.
   */
  combine?: 'union' | 'subtract' | 'intersect' | 'exclude' | null;
}""")
rep(p,"""export interface CompLayer extends LayerBase {
  type: 'comp';
  comp: string;
  /** Comp seconds where the inner composition's 0 is. */
  offset: number;
}""","""export interface CompLayer extends LayerBase {
  type: 'comp';
  comp: string;
  /** Comp seconds where the inner composition's 0 is. */
  offset: number;
  /**
   * This copy's own field values (a component used several times with
   * different words, colors or pictures); may use this title's fields
   * ("{{guest_2}}"). Fields not given come from the title.
   */
  values?: Values;
}""")

p='titler/src/core/render.ts'
rep(p,"""    ctx.fillStyle = paintStyle(ctx, l.fill, size[0], size[1], s);
    ctx.fill(l.fillRule ?? 'nonzero');
  }""","""    ctx.fillStyle = paintStyle(ctx, l.fill, size[0], size[1], s);
    ctx.fill(l.fillRule ?? 'nonzero');
  }
  if (!trimmed)
    for (const extra of l.extraFills ?? []) {
      ctx.beginPath();
      trace(ctx);
      ctx.fillStyle = paintStyle(ctx, extra, size[0], size[1], s);
      ctx.fill(l.fillRule ?? 'nonzero');
    }""")
rep(p,"""function drawContent(ctx: Ctx, l: Layer, world: Mat, alpha: number, s: Scene) {
  if (l.type === 'group') {
    drawList(ctx, l.children, alpha, s);
    return;
  }""","""const COMBINE: Record<NonNullable<GroupLayer['combine']>, GlobalCompositeOperation> = {
  union: 'source-over',
  subtract: 'destination-out',
  intersect: 'destination-in',
  exclude: 'xor',
};

/** A combined group (boolean shapes): back to front, each layer joined to what is there by the group's rule. */
function drawCombined(ctx: Ctx, g: GroupLayer, s: Scene): boolean {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const surf = s.f.env.createCanvas(W, H);
  const out = surf?.getContext('2d') as Ctx | null;
  const tmp = s.f.env.createCanvas(W, H);
  const tc = tmp?.getContext('2d') as Ctx | null;
  if (!surf || !out || !tmp || !tc) return false;
  let first = true;
  for (let n = g.children.length - 1; n >= 0; n--) {
    const c = g.children[n]!;
    if (!active(c, s.t) || s.mattes.has(c.id) || s.f.skip?.(c)) continue;
    tc.setTransform(1, 0, 0, 1, 0, 0);
    tc.clearRect(0, 0, W, H);
    drawLayer(tc, c, 1, s);
    out.save();
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalCompositeOperation = first ? 'source-over' : COMBINE[g.combine!];
    out.drawImage(tmp as CanvasImageSource, 0, 0);
    out.restore();
    first = false;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(surf as CanvasImageSource, 0, 0);
  ctx.restore();
  return true;
}

function drawContent(ctx: Ctx, l: Layer, world: Mat, alpha: number, s: Scene) {
  if (l.type === 'group') {
    if (l.combine && l.children.length > 1 && drawCombined(ctx, l, s)) return;
    drawList(ctx, l.children, alpha, s);
    return;
  }""")
rep(p,"""      const f2: Frame = { ...s.f, depth: s.f.depth + 1 };
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, inner.width, inner.height);""","""      const own = l.values ? Object.entries(l.values).filter(([, v]) => typeof v === 'string' && v !== '') : [];
      // This copy's own field values (a component): may use the title's fields.
      const values = own.length ? { ...s.f.values, ...Object.fromEntries(own.map(([k, v]) => [k, fill(v, s.f.values)])) } : s.f.values;
      const f2: Frame = { ...s.f, values, depth: s.f.depth + 1 };
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, inner.width, inner.height);""")
rep(p,"  Effect,\n  Layer,","  Effect,\n  GroupLayer,\n  Layer,")
