import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/core/lottieExport.ts'
rep(p,"""  if (l.fill) items.push(paintItems(x, l.fill, 'fill', size, { r: l.fillRule === 'evenodd' ? 2 : 1 }));""","""  // Fills drawn over the first come before it (Lottie draws the first style item on top).
  for (const f of [...(l.extraFills ?? [])].reverse()) items.push(paintItems(x, f, 'fill', size, { r: l.fillRule === 'evenodd' ? 2 : 1 }));
  if (l.fill) items.push(paintItems(x, l.fill, 'fill', size, { r: l.fillRule === 'evenodd' ? 2 : 1 }));""")
rep(p,"""    case 'group': {
      const id = `group_${l.id}`;""","""    case 'group': {
      if (l.combine) x.notes.add('Combined shapes (union, subtract…) are drawn as separate shapes.');
      const id = `group_${l.id}`;""")
rep(p,"""      const id = `comp_${inner.id}`;
      if (!x.done.has(id)) {
        x.done.add(id);
        const outer = x.index;
        x.index = layerIndex(inner);
        x.assets.push({ id, nm: inner.name, w: inner.width, h: inner.height, fr: x.fr, layers: layersJson(x, inner.layers, inner.width, inner.height) });
        x.index = outer;
      }""","""      // A copy with its own field values gets its own precomp (Lottie has no fields).
      const own = Object.entries(l.values ?? {}).filter(([, v]) => v);
      const id = own.length ? `comp_${inner.id}_${l.id}` : `comp_${inner.id}`;
      if (!x.done.has(id)) {
        x.done.add(id);
        const outer = x.index;
        const outerValues = x.values;
        x.index = layerIndex(inner);
        if (own.length) x.values = { ...outerValues, ...Object.fromEntries(own.map(([k, v]) => [k, fill(v, outerValues)])) };
        x.assets.push({ id, nm: inner.name, w: inner.width, h: inner.height, fr: x.fr, layers: layersJson(x, inner.layers, inner.width, inner.height) });
        x.index = outer;
        x.values = outerValues;
      }""")
p='titler/src/core/lottie.ts'
rep(p,"""interface Styles {
  fill: Paint | null;""","""interface Styles {
  fill: Paint | null;
  extraFills: Paint[];""")
rep(p,"""    if ((it.ty === 'fl' || it.ty === 'gf') && !fill) {
      s.fill = paintOf(it, c, shift);
      s.fillRule = numOr(it.r, 1) === 2 ? 'evenodd' : 'nonzero';
      fill = true;
    }""","""    if ((it.ty === 'fl' || it.ty === 'gf') && !fill) {
      s.fill = paintOf(it, c, shift);
      s.extraFills = [];
      s.fillRule = numOr(it.r, 1) === 2 ? 'evenodd' : 'nonzero';
      fill = true;
    } else if (it.ty === 'fl' || it.ty === 'gf') {
      // More fills: the earlier one is on top, so this one goes under it.
      const under = paintOf(it, c, shift);
      if (under && s.fill) {
        s.extraFills = [s.fill, ...s.extraFills];
        s.fill = under;
      }
    }""")
rep(p,"""    const base = { ...baseOf(String(one?.nm ?? 'Shape'), start, end, { ...STILL }), type: 'shape' as const, fill: styles.fill, stroke: styles.stroke, trim: styles.trim ?? null };""","""    const base = {
      ...baseOf(String(one?.nm ?? 'Shape'), start, end, { ...STILL }),
      type: 'shape' as const,
      fill: styles.fill,
      ...(styles.extraFills.length ? { extraFills: styles.extraFills } : {}),
      stroke: styles.stroke,
      trim: styles.trim ?? null,
    };""")
rep(p,"{ fill: null, fillRule: 'nonzero', stroke: null, trim: null }","{ fill: null, extraFills: [], fillRule: 'nonzero', stroke: null, trim: null }")
