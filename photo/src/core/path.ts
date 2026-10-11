// Vector paths: subpaths of Bézier anchors (the Pen tool, shapes, vector
// masks, the Paths panel), with flattening to polygons for selections and
// masks, bounds, transforms and the shape builders.

export interface Anchor {
  x: number;
  y: number;
  /** Incoming control point (absolute). Equal to the anchor for a corner. */
  ix: number;
  iy: number;
  /** Outgoing control point. */
  ox: number;
  oy: number;
  /** Smooth anchors keep their handles in line. */
  smooth?: boolean;
}

export interface SubPath {
  anchors: Anchor[];
  closed: boolean;
  /** How this subpath combines with those before it. */
  op?: 'add' | 'subtract' | 'intersect' | 'exclude';
}

export interface VectorPath {
  subpaths: SubPath[];
  /** 'nonzero' or 'evenodd' when filling. */
  rule?: 'nonzero' | 'evenodd';
}

export const corner = (x: number, y: number): Anchor => ({ x, y, ix: x, iy: y, ox: x, oy: y });

export const emptyPath = (): VectorPath => ({ subpaths: [] });

export function clonePath(p: VectorPath): VectorPath {
  return { rule: p.rule, subpaths: p.subpaths.map((s) => ({ closed: s.closed, op: s.op, anchors: s.anchors.map((a) => ({ ...a })) })) };
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** Each subpath as a polygon (flat points [x0,y0,x1,y1,...]); `tol` is the flatness in pixels. */
export function flatten(p: VectorPath, tol = 0.25): { pts: number[]; closed: boolean; op: SubPath['op'] }[] {
  const out: { pts: number[]; closed: boolean; op: SubPath['op'] }[] = [];
  for (const s of p.subpaths) {
    const a = s.anchors;
    if (a.length === 0) continue;
    const pts: number[] = [a[0]!.x, a[0]!.y];
    const n = s.closed ? a.length : a.length - 1;
    for (let i = 0; i < n; i++) {
      const A = a[i]!,
        B = a[(i + 1) % a.length]!;
      const straight = A.ox === A.x && A.oy === A.y && B.ix === B.x && B.iy === B.y;
      if (straight) {
        pts.push(B.x, B.y);
        continue;
      }
      // Steps from the control polygon's length.
      const len = Math.hypot(A.ox - A.x, A.oy - A.y) + Math.hypot(B.ix - A.ox, B.iy - A.oy) + Math.hypot(B.x - B.ix, B.y - B.iy);
      const steps = Math.max(2, Math.min(256, Math.ceil(Math.sqrt(len / tol))));
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        pts.push(cubic(A.x, A.ox, B.ix, B.x, t), cubic(A.y, A.oy, B.iy, B.y, t));
      }
    }
    if (s.closed && pts.length >= 4) {
      // Drop the repeated first point.
      const L = pts.length;
      if (pts[L - 2] === pts[0] && pts[L - 1] === pts[1]) pts.length -= 2;
    }
    out.push({ pts, closed: s.closed, op: s.op });
  }
  return out;
}

export function pathBounds(p: VectorPath): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const s of flatten(p, 1)) {
    for (let i = 0; i < s.pts.length; i += 2) {
      const x = s.pts[i]!,
        y = s.pts[i + 1]!;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Apply an affine matrix [a, b, c, d, e, f] (x' = a x + c y + e; y' = b x + d y + f). */
export function transformPath(p: VectorPath, m: number[]): VectorPath {
  const [a, b, c, d, e, f] = m as [number, number, number, number, number, number];
  const T = (x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f];
  return {
    rule: p.rule,
    subpaths: p.subpaths.map((s) => ({
      closed: s.closed,
      op: s.op,
      anchors: s.anchors.map((k) => {
        const [x, y] = T(k.x, k.y);
        const [ix, iy] = T(k.ix, k.iy);
        const [ox, oy] = T(k.ox, k.oy);
        return { x, y, ix, iy, ox, oy, smooth: k.smooth };
      }),
    })),
  };
}

/** Commands for a canvas Path2D (or SVG). */
export function pathToSvg(p: VectorPath): string {
  let d = '';
  const f = (v: number) => +v.toFixed(3);
  for (const s of p.subpaths) {
    const a = s.anchors;
    if (!a.length) continue;
    d += `M${f(a[0]!.x)} ${f(a[0]!.y)}`;
    const n = s.closed ? a.length : a.length - 1;
    for (let i = 0; i < n; i++) {
      const A = a[i]!,
        B = a[(i + 1) % a.length]!;
      if (A.ox === A.x && A.oy === A.y && B.ix === B.x && B.iy === B.y) d += `L${f(B.x)} ${f(B.y)}`;
      else d += `C${f(A.ox)} ${f(A.oy)} ${f(B.ix)} ${f(B.iy)} ${f(B.x)} ${f(B.y)}`;
    }
    if (s.closed) d += 'Z';
  }
  return d;
}

// ---- shapes ----

export function rectPath(x: number, y: number, w: number, h: number, r = 0): VectorPath {
  if (r <= 0) return { subpaths: [{ closed: true, anchors: [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)] }] };
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  const k = 0.5522847498 * r;
  const A = (x0: number, y0: number, ix: number, iy: number, ox: number, oy: number): Anchor => ({ x: x0, y: y0, ix, iy, ox, oy, smooth: true });
  return {
    subpaths: [
      {
        closed: true,
        anchors: [
          A(x + r, y, x + r - k, y, x + r, y),
          A(x + w - r, y, x + w - r, y, x + w - r + k, y),
          A(x + w, y + r, x + w, y + r - k, x + w, y + r),
          A(x + w, y + h - r, x + w, y + h - r, x + w, y + h - r + k),
          A(x + w - r, y + h, x + w - r + k, y + h, x + w - r, y + h),
          A(x + r, y + h, x + r, y + h, x + r - k, y + h),
          A(x, y + h - r, x, y + h - r + k, x, y + h - r),
          A(x, y + r, x, y + r, x, y + r - k),
        ],
      },
    ],
  };
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): VectorPath {
  const kx = 0.5522847498 * rx,
    ky = 0.5522847498 * ry;
  return {
    subpaths: [
      {
        closed: true,
        anchors: [
          { x: cx + rx, y: cy, ix: cx + rx, iy: cy - ky, ox: cx + rx, oy: cy + ky, smooth: true },
          { x: cx, y: cy + ry, ix: cx + kx, iy: cy + ry, ox: cx - kx, oy: cy + ry, smooth: true },
          { x: cx - rx, y: cy, ix: cx - rx, iy: cy + ky, ox: cx - rx, oy: cy - ky, smooth: true },
          { x: cx, y: cy - ry, ix: cx - kx, iy: cy - ry, ox: cx + kx, oy: cy - ry, smooth: true },
        ],
      },
    ],
  };
}

export function polygonPath(cx: number, cy: number, r: number, sides: number, star = 0, rotation = -Math.PI / 2): VectorPath {
  const anchors: Anchor[] = [];
  const n = Math.max(3, Math.round(sides));
  for (let i = 0; i < n; i++) {
    const a = rotation + (i / n) * Math.PI * 2;
    anchors.push(corner(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    if (star > 0) {
      const b = a + Math.PI / n;
      const ri = r * (1 - star);
      anchors.push(corner(cx + Math.cos(b) * ri, cy + Math.sin(b) * ri));
    }
  }
  return { subpaths: [{ closed: true, anchors }] };
}

export function linePath(x0: number, y0: number, x1: number, y1: number, weight: number): VectorPath {
  const dx = x1 - x0,
    dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (weight / 2),
    ny = (dx / len) * (weight / 2);
  return { subpaths: [{ closed: true, anchors: [corner(x0 + nx, y0 + ny), corner(x1 + nx, y1 + ny), corner(x1 - nx, y1 - ny), corner(x0 - nx, y0 - ny)] }] };
}

/** Points to a smooth closed or open path (Catmull-Rom → Bézier), for lasso-to-path and the freeform pen. */
export function smoothPath(pts: number[], closed: boolean): VectorPath {
  const n = pts.length / 2;
  const anchors: Anchor[] = [];
  const P = (i: number): [number, number] => {
    const j = closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    return [pts[j * 2]!, pts[j * 2 + 1]!];
  };
  for (let i = 0; i < n; i++) {
    const [x, y] = P(i);
    const [px, py] = P(i - 1);
    const [nx, ny] = P(i + 1);
    const tx = (nx - px) / 6,
      ty = (ny - py) / 6;
    anchors.push({ x, y, ix: x - tx, iy: y - ty, ox: x + tx, oy: y + ty, smooth: true });
  }
  return { subpaths: [{ closed, anchors }] };
}

/** Nearest anchor or handle to a point (within `r`). */
export function hitAnchor(p: VectorPath, x: number, y: number, r: number): { s: number; a: number; part: 'anchor' | 'in' | 'out' } | null {
  let best: { s: number; a: number; part: 'anchor' | 'in' | 'out' } | null = null;
  let bd = r * r;
  p.subpaths.forEach((s, si) =>
    s.anchors.forEach((k, ai) => {
      const tries: ['anchor' | 'in' | 'out', number, number][] = [
        ['anchor', k.x, k.y],
        ['in', k.ix, k.iy],
        ['out', k.ox, k.oy],
      ];
      for (const [part, px, py] of tries) {
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (d <= bd && (part === 'anchor' || px !== k.x || py !== k.y)) {
          bd = d;
          best = { s: si, a: ai, part };
        }
      }
    }),
  );
  return best;
}

/** Point along a polyline (for text on a path): position and angle at distance `d`. */
export function pointAt(pts: number[], d: number): { x: number; y: number; angle: number } | null {
  let acc = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x0 = pts[i]!,
      y0 = pts[i + 1]!,
      x1 = pts[i + 2]!,
      y1 = pts[i + 3]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (acc + len >= d && len > 0) {
      const t = (d - acc) / len;
      return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, angle: Math.atan2(y1 - y0, x1 - x0) };
    }
    acc += len;
  }
  return null;
}

export function polylineLength(pts: number[]): number {
  let acc = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) acc += Math.hypot(pts[i + 2]! - pts[i]!, pts[i + 3]! - pts[i + 1]!);
  return acc;
}
