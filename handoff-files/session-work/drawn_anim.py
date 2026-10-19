import sys
root = sys.argv[1]


def edit(path, pairs):
    p = root + '/' + path
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (path, a[:70])
        s = s.replace(a, b, 1)
    open(p, 'w').write(s)


edit('editor/app/src/render/drawnmask.ts', [
    ("""/** A drawn mask's shape from its settings (null: fewer than three points). */
export function drawnShape(d: Record<string, unknown> | undefined): DrawnShape | null {
  const pts = Array.isArray(d?.points) ? (d.points as unknown[]) : [];
  const points = pts.filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && Number.isFinite(x)));
  if (points.length < 3) return null;
  const aspect = typeof d?.aspect === 'number' && d.aspect > 0.1 && d.aspect < 10 ? d.aspect : 16 / 9;
  return { points, aspect };
}""", """const pointList = (v: unknown): [number, number][] =>
  (Array.isArray(v) ? v : []).filter(
    (p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && Number.isFinite(x)),
  );

/** An animated drawn mask's shapes: the shape at frames of its clip, in time order. */
export interface ShapeKey {
  t: number;
  points: [number, number][];
}

export function shapeKeys(d: Record<string, unknown> | undefined): ShapeKey[] {
  const keys = Array.isArray(d?.keys) ? (d.keys as unknown[]) : [];
  return keys
    .filter((k): k is { t: number; points: unknown } => !!k && typeof k === 'object' && typeof (k as { t?: unknown }).t === 'number')
    .map((k) => ({ t: k.t, points: pointList(k.points) }))
    .filter((k) => k.points.length > 0)
    .sort((a, b) => a.t - b.t);
}

/** The points at a frame of the clip: between two shapes of the same number of points, part way; otherwise the last one before. */
export function pointsAt(d: Record<string, unknown> | undefined, local: number): [number, number][] {
  const keys = shapeKeys(d);
  if (!keys.length) return pointList(d?.points);
  const first = keys[0] as ShapeKey;
  if (local <= first.t) return first.points;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i] as ShapeKey;
    if (local > b.t) continue;
    const a = keys[i - 1] as ShapeKey;
    if (a.points.length !== b.points.length || b.t === a.t) return a.points;
    const k = (local - a.t) / (b.t - a.t);
    return a.points.map(([x, y], j) => {
      const [x2, y2] = b.points[j] as [number, number];
      return [x + (x2 - x) * k, y + (y2 - y) * k];
    });
  }
  return (keys[keys.length - 1] as ShapeKey).points;
}

/** The shape at a frame of the clip with a key there set to `points` (made, or changed). */
export function withKey(d: Record<string, unknown> | undefined, local: number, points: [number, number][]): ShapeKey[] {
  const keys = shapeKeys(d).filter((k) => k.t !== local);
  return [...keys, { t: local, points }].sort((a, b) => a.t - b.t);
}

/** A drawn mask's shape at a frame of its clip (null: fewer than three points). */
export function drawnShape(d: Record<string, unknown> | undefined, local = 0): DrawnShape | null {
  const points = pointsAt(d, local);
  if (points.length < 3) return null;
  const aspect = typeof d?.aspect === 'number' && d.aspect > 0.1 && d.aspect < 10 ? d.aspect : 16 / 9;
  return { points, aspect };
}"""),
])

edit('editor/app/src/vision/mattes.ts', [
    ("""    const shape = drawnShape(e.d);""", """    const shape = drawnShape(e.d, layer.local);"""),
])
