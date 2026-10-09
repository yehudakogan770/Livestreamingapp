// Shapes as bezier paths: rectangles, rounded rectangles, ellipses and drawn
// paths; trimming a path (draw only part of its outline).

import type { PathData, PathVertex, Vec2 } from './types';

/** The part of a 2D canvas context paths are drawn with. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void;
  closePath(): void;
}

const K = 0.5522847498; // circle by four cubic curves

export function rectPath(w: number, h: number, r: number): PathData {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr <= 0)
    return {
      closed: true,
      v: [{ p: [0, 0] }, { p: [w, 0] }, { p: [w, h] }, { p: [0, h] }],
    };
  const c = rr * K;
  return {
    closed: true,
    v: [
      { p: [rr, 0], i: [-c, 0] },
      { p: [w - rr, 0], o: [c, 0] },
      { p: [w, rr], i: [0, -c] },
      { p: [w, h - rr], o: [0, c] },
      { p: [w - rr, h], i: [c, 0] },
      { p: [rr, h], o: [-c, 0] },
      { p: [0, h - rr], i: [0, c] },
      { p: [0, rr], o: [0, -c] },
    ],
  };
}

/**
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

export function ellipsePath(w: number, h: number): PathData {
  const rx = w / 2;
  const ry = h / 2;
  const cx = rx * K;
  const cy = ry * K;
  return {
    closed: true,
    v: [
      { p: [rx, 0], i: [-cx, 0], o: [cx, 0] },
      { p: [w, ry], i: [0, -cy], o: [0, cy] },
      { p: [rx, h], i: [cx, 0], o: [-cx, 0] },
      { p: [0, ry], i: [0, cy], o: [0, -cy] },
    ],
  };
}

type Seg = [Vec2, Vec2, Vec2, Vec2];

/** The path's curves, each from a vertex to the next (and back to the first if closed). */
export function segments(path: PathData): Seg[] {
  const v = path.v;
  const out: Seg[] = [];
  const n = v.length;
  const count = path.closed ? n : n - 1;
  for (let k = 0; k < count; k++) {
    const a = v[k]!;
    const b = v[(k + 1) % n]!;
    out.push([a.p, add(a.p, a.o), add(b.p, b.i), b.p]);
  }
  return out;
}

const add = (p: Vec2, d: Vec2 | undefined): Vec2 => (d ? [p[0] + d[0], p[1] + d[1]] : p);

/** Draw a path into a canvas path (no beginPath). */
export function tracePath(sink: PathSink, path: PathData): void {
  const v = path.v;
  if (!v.length) return;
  sink.moveTo(v[0]!.p[0], v[0]!.p[1]);
  for (const [, c1, c2, p] of segments(path)) sink.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p[0], p[1]);
  if (path.closed) sink.closePath();
}

const bez = (a: number, b: number, c: number, d: number, s: number) => {
  const u = 1 - s;
  return u * u * u * a + 3 * u * u * s * b + 3 * u * s * s * c + s * s * s * d;
};

/** The path as a list of points (for trimming and hit tests). */
export function flatten(path: PathData, perSeg = 24): Vec2[] {
  const segs = segments(path);
  if (!segs.length) return path.v.map((x) => x.p);
  const out: Vec2[] = [segs[0]![0]];
  for (const [a, b, c, d] of segs) {
    const straight = a === b && c === d;
    const n = straight ? 1 : perSeg;
    for (let k = 1; k <= n; k++) {
      const s = k / n;
      out.push([bez(a[0], b[0], c[0], d[0], s), bez(a[1], b[1], c[1], d[1], s)]);
    }
  }
  return out;
}

/** Trim a path: draw from `start` to `end` percent of its length, moved along by `offset` percent. */
export function traceTrimmed(sink: PathSink, path: PathData, start: number, end: number, offset: number): void {
  const pts = flatten(path);
  if (pts.length < 2) return;
  const lens = [0];
  for (let k = 1; k < pts.length; k++) lens.push(lens[k - 1]! + Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]));
  const total = lens[lens.length - 1]!;
  if (total <= 0) return;
  let s = Math.min(start, end) / 100;
  let e = Math.max(start, end) / 100;
  if (e - s >= 1) {
    tracePath(sink, path);
    return;
  }
  if (e - s <= 0) return;
  const o = (((offset / 100) % 1) + 1) % 1;
  s += o;
  e += o;
  const pointAt = (d: number): Vec2 => {
    let k = 1;
    while (k < lens.length - 1 && lens[k]! < d) k++;
    const l0 = lens[k - 1]!;
    const f = lens[k]! > l0 ? (d - l0) / (lens[k]! - l0) : 0;
    const a = pts[k - 1]!;
    const b = pts[k]!;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  };
  const piece = (from: number, to: number) => {
    const d0 = from * total;
    const d1 = to * total;
    const p0 = pointAt(d0);
    sink.moveTo(p0[0], p0[1]);
    for (let k = 1; k < lens.length; k++) if (lens[k]! > d0 && lens[k]! < d1) sink.lineTo(pts[k]![0], pts[k]![1]);
    const p1 = pointAt(d1);
    sink.lineTo(p1[0], p1[1]);
  };
  if (e <= 1) piece(s, e);
  else if (s >= 1) piece(s - 1, e - 1);
  else {
    piece(s, 1);
    piece(0, e - 1);
  }
}

/** The bounding box of a path's points. */
export function pathBounds(path: PathData): { x: number; y: number; w: number; h: number } {
  const pts = flatten(path, 8);
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A smooth vertex (pen tool drag): tangents both ways along the drag. */
export const smoothVertex = (p: Vec2, drag: Vec2): PathVertex => ({ p, o: drag, i: [-drag[0], -drag[1]] });

/** An SVG path "d" for a PathData (exports, previews). */
export function svgPathD(path: PathData): string {
  const v = path.v;
  if (!v.length) return '';
  const f = (n: number) => Math.round(n * 100) / 100;
  let d = `M${f(v[0]!.p[0])} ${f(v[0]!.p[1])}`;
  for (const [, c1, c2, p] of segments(path)) d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p[0])} ${f(p[1])}`;
  return path.closed ? `${d} Z` : d;
}
