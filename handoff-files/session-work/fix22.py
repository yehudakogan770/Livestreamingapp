import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/core/render.ts'
rep(p,"""  const mx = (u0 + u1 + u2) / 3;
  const my = (v0 + v1 + v2) / 3;
  const grow = (u: number, v: number): Vec2 => {
    const len = Math.hypot(u - mx, v - my) || 1;
    return [u + ((u - mx) / len) * 0.75, v + ((v - my) / len) * 0.75];
  };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  const p0 = grow(u0, v0);
  const p1 = grow(u1, v1);
  const p2 = grow(u2, v2);
  ctx.moveTo(p0[0], p0[1]);""","""  const [p0, p1, p2] = outset([
    [u0, v0],
    [u1, v1],
    [u2, v2],
  ]);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);""")
rep(p,"""/** One triangle of a picture moved to another (affine)""","""/** A triangle with each edge moved out by `by` px (neighbors overlap, so their soft edges hide inside each other). */
function outset(t: [Vec2, Vec2, Vec2], by = 1): [Vec2, Vec2, Vec2] {
  const area = (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1]);
  const sign = area > 0 ? 1 : -1;
  // Each edge as a line moved outward: point and direction.
  const lines = [0, 1, 2].map((k) => {
    const a = t[k]!;
    const b = t[(k + 1) % 3]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = (dy / len) * sign * by;
    const ny = (-dx / len) * sign * by;
    return { p: [a[0] + nx, a[1] + ny] as Vec2, d: [dx, dy] as Vec2 };
  });
  return [0, 1, 2].map((k) => {
    // Vertex k: where the edges before and after it meet (kept near the corner on thin triangles).
    const l1 = lines[(k + 2) % 3]!;
    const l2 = lines[k]!;
    const den = l1.d[0] * l2.d[1] - l1.d[1] * l2.d[0];
    const v = t[k]!;
    if (Math.abs(den) < 1e-9) return v;
    const s = ((l2.p[0] - l1.p[0]) * l2.d[1] - (l2.p[1] - l1.p[1]) * l2.d[0]) / den;
    const q: Vec2 = [l1.p[0] + l1.d[0] * s, l1.p[1] + l1.d[1] * s];
    const far = Math.hypot(q[0] - v[0], q[1] - v[1]);
    return far > by * 4 ? ([v[0] + ((q[0] - v[0]) / far) * by * 4, v[1] + ((q[1] - v[1]) / far) * by * 4] as Vec2) : q;
  }) as [Vec2, Vec2, Vec2];
}

/** One triangle of a picture moved to another (affine)""")
