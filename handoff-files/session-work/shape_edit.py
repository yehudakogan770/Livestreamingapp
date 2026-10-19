import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

edit('titler/src/core/types.ts', [
("""export interface Stroke {
  paint: Paint;
  width: number;""", """export interface Stroke {
  paint: Paint;
  width: number;
  /** Where the line sits on a closed outline: centered on it (default), inside or outside. */
  align?: 'center' | 'inside' | 'outside';"""),
("""  /** Rectangle corner radius, px. */
  roundness: Prop;""", """  /** Rectangle corner radius, px. */
  roundness: Prop;
  /** Each corner its own radius (top left, top right, bottom right, bottom left), px; replaces `roundness`. */
  corners?: [number, number, number, number] | null;
  /** More outlines drawn over the first (a double outline), each with its own paint, width and place. */
  extraStrokes?: Stroke[];"""),
])

edit('titler/src/core/paths.ts', [
("""export function ellipsePath(w: number, h: number): PathData {""", """/**
 * A rectangle with its own radius at each corner (top left, top right,
 * bottom right, bottom left); radii that would overlap are scaled down
 * together, as in CSS.
 */
export function rectCornersPath(w: number, h: number, r: [number, number, number, number]): PathData {
  let [tl, tr, br, bl] = r.map((x) => Math.max(0, Number.isFinite(x) ? x : 0)) as [number, number, number, number];
  const f = Math.min(1, w / (tl + tr || 1), w / (bl + br || 1), h / (tl + bl || 1), h / (tr + br || 1));
  if (f < 1) [tl, tr, br, bl] = [tl * f, tr * f, br * f, bl * f];
  const v: PathData['v'] = [];
  const corner = (rad: number, at: [number, number], a: [number, number], b: [number, number]) => {
    // a: the point before the corner (on the incoming edge), b: after it; tangents toward the corner.
    if (rad <= 0) return v.push({ p: at });
    const c = rad * K;
    const da: [number, number] = [Math.sign(at[0] - a[0]), Math.sign(at[1] - a[1])];
    const db: [number, number] = [Math.sign(b[0] - at[0]), Math.sign(b[1] - at[1])];
    v.push({ p: [at[0] - da[0] * rad, at[1] - da[1] * rad], o: [da[0] * c, da[1] * c] });
    v.push({ p: [at[0] + db[0] * rad, at[1] + db[1] * rad], i: [-db[0] * c, -db[1] * c] });
  };
  corner(tl, [0, 0], [0, h], [w, 0]);
  corner(tr, [w, 0], [0, 0], [w, h]);
  corner(br, [w, h], [w, 0], [0, h]);
  corner(bl, [0, h], [w, h], [0, 0]);
  return { closed: true, v };
}

export function ellipsePath(w: number, h: number): PathData {"""),
])

edit('titler/src/core/render.ts', [
("""  return l.shape === 'ellipse' ? ellipsePath(w, h) : rectPath(w, h, num(l.roundness, t, 0));
}""", """  if (l.shape === 'ellipse') return ellipsePath(w, h);
  return l.corners ? rectCornersPath(w, h, l.corners) : rectPath(w, h, num(l.roundness, t, 0));
}"""),
("""  if (l.stroke && l.stroke.width > 0) {
    ctx.beginPath();
    if (trimmed) traceTrimmed(ctx, path, ts, te, to);
    else tracePath(ctx, path);
    ctx.strokeStyle = paintStyle(ctx, l.stroke.paint, size[0], size[1], s);
    ctx.lineWidth = l.stroke.width;
    ctx.lineJoin = l.stroke.join ?? 'miter';
    ctx.lineCap = l.stroke.cap ?? 'butt';
    if (l.stroke.dash?.length) ctx.setLineDash(l.stroke.dash);
    ctx.stroke();
  }
}""", """  for (const st of [l.stroke, ...(l.extraStrokes ?? [])]) {
    if (!st || st.width <= 0) continue;
    // Inside or outside a closed outline: twice as wide, with the other half clipped away.
    const side = path.closed && !trimmed && st.align && st.align !== 'center' ? st.align : null;
    ctx.save();
    if (side) {
      ctx.beginPath();
      if (side === 'outside') ctx.rect(-1e6, -1e6, 2e6, 2e6);
      tracePath(ctx, path);
      ctx.clip(side === 'outside' ? 'evenodd' : 'nonzero');
    }
    ctx.beginPath();
    if (trimmed) traceTrimmed(ctx, path, ts, te, to);
    else tracePath(ctx, path);
    ctx.strokeStyle = paintStyle(ctx, st.paint, size[0], size[1], s);
    ctx.lineWidth = side ? st.width * 2 : st.width;
    ctx.lineJoin = st.join ?? 'miter';
    ctx.lineCap = st.cap ?? 'butt';
    if (st.dash?.length) ctx.setLineDash(st.dash);
    ctx.stroke();
    ctx.restore();
  }
}"""),
("import { ellipsePath, rectPath, traceTrimmed, tracePath } from './paths';", "import { ellipsePath, rectCornersPath, rectPath, traceTrimmed, tracePath } from './paths';"),
])
print('ok')
