import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/core/types.ts'
rep(p,"""  combine?: 'union' | 'subtract' | 'intersect' | 'exclude' | null;
}""","""  combine?: 'union' | 'subtract' | 'intersect' | 'exclude' | null;
  /**
   * Repeat the group once for each line of a list field (a row of a table:
   * results, standings, a schedule), each copy moved by dx, dy and coming in
   * `stagger` seconds after the one before. In copy n, every list field is
   * its line n.
   */
  repeat?: { field: string; dx: number; dy: number; stagger?: number; max?: number } | null;
}""")
p='titler/src/core/render.ts'
rep(p,"""function drawContent(ctx: Ctx, l: Layer, world: Mat, alpha: number, s: Scene) {
  if (l.type === 'group') {
    if (l.combine && l.children.length > 1 && drawCombined(ctx, l, s)) return;""","""/** A repeated group's copies: one for each line of its list field. */
function drawRepeated(ctx: Ctx, g: GroupLayer, alpha: number, s: Scene) {
  const r = g.repeat!;
  const lists = s.f.project.variables.filter((v) => v.type === 'list');
  const lines = (k: string) => (s.f.values[k] ?? '').split(/\\r?\\n/);
  const count = Math.min(r.max ?? 100, 100, (s.f.values[r.field] ?? '').trim() ? lines(r.field).length : 0);
  for (let n = 0; n < count; n++) {
    const values = { ...s.f.values };
    for (const v of lists) values[v.key] = lines(v.key)[n] ?? '';
    values['row'] = String(n + 1);
    const scene: Scene = { ...s, t: s.t - n * (r.stagger ?? 0), base: mul(s.base, [1, 0, 0, 1, n * r.dx, n * r.dy]), f: { ...s.f, values } };
    if (g.combine && g.children.length > 1 && drawCombined(ctx, g, scene)) continue;
    drawList(ctx, g.children, alpha, scene);
  }
}

function drawContent(ctx: Ctx, l: Layer, world: Mat, alpha: number, s: Scene) {
  if (l.type === 'group') {
    if (l.repeat?.field) {
      drawRepeated(ctx, l, alpha, s);
      return;
    }
    if (l.combine && l.children.length > 1 && drawCombined(ctx, l, s)) return;""")
