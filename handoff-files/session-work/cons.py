import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
p='titler/src/core/formats.ts'
s=open(p).read()
a="""/** A layer's constraints: as set, else pinned to the edge (or middle) it is nearest. */
export function constraintsOf(l: Layer, center: Vec2, w: number, h: number): Required<Constraints> {
  const third = (v: number, size: number) => (v < size / 3 ? 0 : v > (size * 2) / 3 ? 2 : 1);
  return {
    h: l.constraints?.h ?? (['left', 'center', 'right'] as const)[third(center[0], w)],
    v: l.constraints?.v ?? (['top', 'center', 'bottom'] as const)[third(center[1], h)],
  };
}"""
b="""/**
 * A layer's constraints: as set, else automatic: a layer more than half the
 * frame wide (a banner, a ticker) stretches with it, the others are pinned
 * to the edge (or the middle) they are nearest; the same down.
 */
export function constraintsOf(l: Layer, center: Vec2, w: number, h: number, size: Vec2 = [0, 0]): Required<Constraints> {
  const third = (v: number, s: number) => (v < s / 3 ? 0 : v > (s * 2) / 3 ? 2 : 1);
  return {
    h: l.constraints?.h ?? (size[0] > w / 2 ? 'stretch' : (['left', 'center', 'right'] as const)[third(center[0], w)]),
    v: l.constraints?.v ?? (size[1] > h / 2 ? 'stretch' : (['top', 'center', 'bottom'] as const)[third(center[1], h)]),
  };
}"""
assert a in s
s=s.replace(a,b)
s=s.replace("  const c = constraintsOf(l, center, fromW, fromH);","  const c = constraintsOf(l, center, fromW, fromH, size);")
open(p,'w').write(s)

p='titler/src/core/formats.test.ts'
s=open(p).read()
a="""    expect(constraintsOf(right, [1750, 125], 1920, 1080)).toEqual({ h: 'right', v: 'top' });"""
assert a in s
s=s.replace(a,a+"""
    // More than half the frame wide (a banner): stretches.
    expect(constraintsOf(right, [960, 1040], 1920, 1080, [1800, 80])).toEqual({ h: 'stretch', v: 'bottom' });""")
s=s.replace("""  it('a lower third stays at the bottom left in 9:16; everything doubles in 4K', () => {""","""  it('a full-width banner in 9:16: the bars narrow with the frame, the label stays left, the headline box narrows (its words shrink to fit)', () => {
    const p = fromTemplate(starterTemplates().find((t) => t.name === 'Breaking banner')!);
    const main = p.compositions.find((c) => c.id === p.main)!;
    const v = makeFormat(p, '9:16 vertical', 1080, 1920);
    const vert = v.project.compositions.find((c) => c.id === v.id)!;
    const get = (c: typeof main, name: string) => c.layers.find((l) => l.name === name)!;
    const banner = get(vert, 'Banner');
    expect(pos(banner)[0]).toBe(pos(get(main, 'Banner'))[0]);
    if (banner.type === 'shape' && get(main, 'Banner').type === 'shape') {
      const before = (get(main, 'Banner') as typeof banner).size.v![0];
      expect(banner.size.v![0]).toBe(before - 840);
    }
    const head = get(vert, 'Headline');
    expect(head.type === 'text' && head.box[0]).toBe((get(main, 'Headline') as { box: Vec2 }).box[0] - 840);
    expect(pos(get(vert, 'Label box'))[0]).toBe(pos(get(main, 'Label box'))[0]);
  });

  it('a lower third stays at the bottom left in 9:16; everything doubles in 4K', () => {""")
open(p,'w').write(s)
print('ok')
