import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/core/types.ts'
rep(p,"""  /** 0–100. */
  opacity: Prop;
}""","""  /** 0–100. */
  opacity: Prop;
  /** 3D layers: turned about the anchor point across (X) and up and down (Y), degrees, seen through the composition's camera. */
  rotationX?: Prop;
  rotationY?: Prop;
  /** 3D layers: toward (negative) or away from the camera, px. */
  z?: Prop;
}""")
rep(p,"""  guides?: { x: number[]; y: number[] };""","""  guides?: { x: number[]; y: number[] };
  /** How far the camera is from the picture for 3D layers, px (nearer: stronger perspective); 2000 when left out. */
  perspective?: number;""")
p='titler/src/core/render.ts'
rep(p,"""function needsOwnCanvas(l: Layer): boolean {
  return !!(l.masks?.length || l.matte || effectsOn(l).length || (l.blend && l.blend !== 'normal' && l.type === 'group'));
}""","""function needsOwnCanvas(l: Layer): boolean {
  return !!(l.masks?.length || l.matte || effectsOn(l).length || (l.blend && l.blend !== 'normal' && l.type === 'group') || is3d(l));
}

/** Does the layer turn in 3D (X or Y rotation, or depth)? */
export function is3d(l: Layer): boolean {
  const tr = l.transform;
  const on = (p: Prop | undefined) => !!p && (isAnimated(p) || !!p.x || (p.v ?? 0) !== 0);
  return on(tr.rotationX) || on(tr.rotationY) || on(tr.z);
}

/** The 3D turn of a layer at t: a point of the picture (px) to where the camera sees it, or null behind the camera. */
export function projector(l: Layer, t: number, pivot: Vec2, distance: number): (x: number, y: number) => Vec2 | null {
  const rx = (num(l.transform.rotationX, t, 0) * Math.PI) / 180;
  const ry = (num(l.transform.rotationY, t, 0) * Math.PI) / 180;
  const z0 = num(l.transform.z, t, 0) * (distance / 2000 > 0 ? 1 : 1);
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  return (x, y) => {
    const px = x - pivot[0];
    const py = y - pivot[1];
    // Turn about Y (across), then X (up and down).
    const x1 = px * cy;
    const z1 = -px * sy;
    const y2 = py * cx - z1 * sx;
    const z2 = py * sx + z1 * cx + z0;
    const k = distance + z2;
    if (k <= distance * 0.05) return null;
    const s = distance / k;
    return [pivot[0] + x1 * s, pivot[1] + y2 * s];
  };
}

/** Draw `src` (a canvas the size of the picture) as seen through `project`, in triangles fine enough to look smooth. */
function drawProjected(ctx: Ctx, src: CanvasImageSource, area: { x: number; y: number; w: number; h: number }, project: (x: number, y: number) => Vec2 | null, steps: number) {
  if (area.w <= 0 || area.h <= 0) return;
  const n = Math.max(1, Math.min(24, steps));
  const pts: (Vec2 | null)[][] = [];
  for (let j = 0; j <= n; j++) {
    const row: (Vec2 | null)[] = [];
    for (let i = 0; i <= n; i++) row.push(project(area.x + (area.w * i) / n, area.y + (area.h * j) / n));
    pts.push(row);
  }
  const at = (i: number, j: number): Vec2 => [area.x + (area.w * i) / n, area.y + (area.h * j) / n];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const d00 = pts[j]![i]!;
      const d10 = pts[j]![i + 1]!;
      const d01 = pts[j + 1]![i]!;
      const d11 = pts[j + 1]![i + 1]!;
      if (!d00 || !d10 || !d01 || !d11) continue;
      const cell = { x: at(i, j)[0], y: at(i, j)[1], w: area.w / n, h: area.h / n };
      triangle(ctx, src, cell, [at(i, j), at(i + 1, j), at(i + 1, j + 1)], [d00, d10, d11]);
      triangle(ctx, src, cell, [at(i, j), at(i + 1, j + 1), at(i, j + 1)], [d00, d11, d01]);
    }
}

/** One triangle of a picture moved to another (affine), clipped a hair larger so neighbors meet without seams. */
function triangle(ctx: Ctx, src: CanvasImageSource, cell: { x: number; y: number; w: number; h: number }, s: [Vec2, Vec2, Vec2], d: [Vec2, Vec2, Vec2]) {
  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const [[u0, v0], [u1, v1], [u2, v2]] = d;
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(det) < 1e-9) return;
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
  const c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det;
  const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det;
  const dd = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;
  const e = u0 - a * x0 - c * y0;
  const f = v0 - b * x0 - dd * y0;
  const mx = (u0 + u1 + u2) / 3;
  const my = (v0 + v1 + v2) / 3;
  const grow = (u: number, v: number): Vec2 => {
    const len = Math.hypot(u - mx, v - my) || 1;
    return [u + ((u - mx) / len) * 0.6, v + ((v - my) / len) * 0.6];
  };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  const p0 = grow(u0, v0);
  const p1 = grow(u1, v1);
  const p2 = grow(u2, v2);
  ctx.moveTo(p0[0], p0[1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, b, c, dd, e, f);
  const sx = Math.max(0, Math.floor(cell.x - 1));
  const sy = Math.max(0, Math.floor(cell.y - 1));
  const sw = Math.ceil(cell.w + 2);
  const sh = Math.ceil(cell.h + 2);
  ctx.drawImage(src, sx, sy, sw, sh, sx, sy, sw, sh);
  ctx.restore();
}""")
# use in drawLayer final draw
rep(p,"""  ctx.drawImage(surf as CanvasImageSource, 0, 0);
  ctx.restore();
}

/** The part of the canvas a layer covers""","""  if (is3d(l)) {
    // 3D: the layer's picture turned about its anchor point and seen through the camera.
    const a = vec(l.transform.anchor, t, [0, 0]);
    const pivot: Vec2 = [world[0] * a[0] + world[2] * a[1] + world[4], world[1] * a[0] + world[3] * a[1] + world[5]];
    const project = projector(l, t, pivot, (s.comp.perspective ?? 2000) * s.f.px);
    const bend = Math.max(Math.abs(Math.sin((num(l.transform.rotationX, t, 0) * Math.PI) / 180)), Math.abs(Math.sin((num(l.transform.rotationY, t, 0) * Math.PI) / 180)));
    const area = l.type === 'group' || l.type === 'comp' ? { x: 0, y: 0, w: cw, h: ch } : canvasBox(own, l, world, s);
    drawProjected(ctx, surf as CanvasImageSource, area, project, Math.ceil(2 + bend * 14));
  } else ctx.drawImage(surf as CanvasImageSource, 0, 0);
  ctx.restore();
}

/** The part of the canvas a layer covers""")
p='titler/src/designer/props.ts'
rep(p,"""export function propsOf(l: Layer): PropInfo[] {
  const out = [...T];""","""export function propsOf(l: Layer): PropInfo[] {
  const out = [...T];
  if (l.transform.rotationX || l.transform.rotationY || l.transform.z)
    out.push(
      { path: 'transform.rotationX', label: 'X rotation', dims: 1, fallback: 0, unit: '°' },
      { path: 'transform.rotationY', label: 'Y rotation', dims: 1, fallback: 0, unit: '°' },
      { path: 'transform.z', label: 'Depth (Z)', dims: 1, fallback: 0, unit: 'px' },
    );""")
