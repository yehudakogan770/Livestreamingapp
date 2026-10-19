import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/core/render.ts'
rep(p,"export function projector(l: Layer, t: number, pivot: Vec2, distance: number): (x: number, y: number) => Vec2 | null {","export function projector(l: Layer, t: number, pivot: Vec2, distance: number, px = 1): (x: number, y: number) => Vec2 | null {")
rep(p,"  const z0 = num(l.transform.z, t, 0) * (distance / 2000 > 0 ? 1 : 1);","  const z0 = num(l.transform.z, t, 0) * px;")
rep(p,"const project = projector(l, t, pivot, (s.comp.perspective ?? 2000) * s.f.px);","const project = projector(l, t, pivot, (s.comp.perspective ?? 2000) * s.f.px, s.f.px);")
p='titler/src/core/lottieExport.ts'
rep(p,"""  return {
    a: lprop(x, shifted, [0, 0], v3),""","""  const deep: J = {};
  if (tr.rotationX || tr.rotationY || tr.z) {
    x.notes.add('3D layers turn in Lottie players that draw in 3D (the HTML renderer); others draw them flat.');
    deep.rx = lprop(x, tr.rotationX, 0, (v) => [r3(v)]);
    deep.ry = lprop(x, tr.rotationY, 0, (v) => [r3(v)]);
    deep.rz = lprop(x, tr.rotation, 0, (v) => [r3(v)]);
    deep.or = { a: 0, k: [0, 0, 0] };
  }
  return {
    ...deep,
    a: lprop(x, shifted, [0, 0], v3),""")
rep(p,"""  switch (l.type) {
    case 'null':""","""  if (l.transform.rotationX || l.transform.rotationY || l.transform.z) base.ddd = 1;
  switch (l.type) {
    case 'null':""")
p='titler/src/core/lottie.ts'
rep(p,"""  if (k.rx || k.ry) c.notes.add('3D rotation (X and Y) is left out; Z rotation is kept.');
  return {""","""  const deep: Partial<Transform> = {};
  if (k.rx) deep.rotationX = prop(k.rx, c, scalar, 0, shift);
  if (k.ry) deep.rotationY = prop(k.ry, c, scalar, 0, shift);
  if (k.or && arr((k.or as J).k).some((v) => numOr(v, 0))) c.notes.add('3D orientation is left out (X and Y rotation are kept).');
  const p3 = isObj(k.p) && !k.p.s ? first(k.p, c, 'Depth') : [];
  if (p3.length > 2 && p3[2]) deep.z = { v: p3[2] };
  return {
    ...deep,""")
rep(p,"""    if (l.ddd === 1) c.notes.add('3D layers are drawn flat.');\n""","")
