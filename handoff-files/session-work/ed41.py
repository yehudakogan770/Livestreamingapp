import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='geometry.ts'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''export const layerBounds = (look: Look, l: Layer): Box | null => {''','''/**
 * Where a layer's own pixels are (a text's words rather than its whole box),
 * on the composition; for framing thumbnails. `ctx` measures the words (the
 * page's own canvas when left out).
 */
export function inkBounds(look: Look, l: Layer, ctx: Ctx | null = measurer()): Box | null {
  if (l.type === 'group') {
    const boxes = l.children.filter((k) => k.visible).map((k) => inkBounds(look, k, ctx)).filter((b): b is Box => !!b);
    return boxes.length ? boundsOf(boxes.flatMap((b) => [[b.x, b.y] as Vec2, [b.x + b.w, b.y + b.h] as Vec2])) : null;
  }
  if (l.type !== 'text' || !ctx || !(l.box[0] > 0)) return layerBounds(look, l);
  const lay = textLayout(l, valuesFor(look.project, look.values), tokensFor(look.project, look.brand ?? undefined), canvasMeasure(ctx), look.project.variables, look.project.textStyles);
  const [bw, bh] = l.box;
  const w = Math.min(bw, lay.width);
  const h = Math.min(bh || lay.height, lay.height);
  const x = l.style.align === 'center' ? (bw - w) / 2 : l.style.align === 'right' ? bw - w : 0;
  const y = l.style.vAlign === 'middle' ? (bh - h) / 2 : l.style.vAlign === 'bottom' ? bh - h : 0;
  const m = worldMatrix(look.comp, l, look.t, layerIndex(look.comp), groupOf(look.comp));
  return boundsOf([apply(m, [x, y]), apply(m, [x + w, y]), apply(m, [x + w, y + h]), apply(m, [x, y + h])]);
}

export const layerBounds = (look: Look, l: Layer): Box | null => {''')
open(p,'w').write(s)

p='Panels.tsx'; s=open(p).read()
rep('''export function thumbCrop(project: TitleProject, t: number): { x: number; y: number; w: number; h: number } {
  const c = compOf(project, project.main);
  const whole = { x: 0, y: 0, w: c.width, h: c.height };
  const look = { project, comp: c, t, values: {}, brand: null };
  const boxes = c.layers.filter((l) => l.visible && t >= l.start && t < l.end).map((l) => layerBounds(look, l)).filter((b): b is NonNullable<typeof b> => !!b);''','''export function thumbCrop(project: TitleProject, t: number, ctx?: Ctx | null): { x: number; y: number; w: number; h: number } {
  const c = compOf(project, project.main);
  const whole = { x: 0, y: 0, w: c.width, h: c.height };
  const look = { project, comp: c, t, values: {}, brand: null };
  const boxes = c.layers
    .filter((l) => l.visible && t >= l.start && t < l.end)
    .map((l) => inkBounds(look, l, ctx === undefined ? undefined : ctx))
    .filter((b): b is NonNullable<typeof b> => !!b);''')
rep("import { layerBounds } from './geometry';","import { inkBounds } from './geometry';")
open(p,'w').write(s)

p='thumb.test.ts'; s=open(p).read()
s=s.replace("import { describe, expect, it } from 'vitest';","import { beforeAll, describe, expect, it } from 'vitest';\nimport { canvas, registerTestFont } from '../test/nodeCanvas';")
s=s.replace('''      return { r: thumbCrop(t, c.markers.inEnd + 0.4), w: c.width };''','''      const ctx = canvas(10, 10).getContext('2d') as unknown as CanvasRenderingContext2D;
      return { r: thumbCrop(t, c.markers.inEnd + 0.4, ctx), w: c.width };''')
s=s.replace('''describe('library thumbnails', () => {''','''beforeAll(() => registerTestFont());

describe('library thumbnails', () => {''')
open(p,'w').write(s)
