// Shape layers: rectangles, ellipses, polygons, stars and lines as outlines
// (points), with rounded corners, and trim paths (only part of the outline
// drawn, for shapes that draw themselves on).
import { placeClips } from './edit';
import { current } from './seq';
import { newClip, type Project, type ShapeData } from './types';

export type Pt = [number, number];

export const SHAPE_KINDS: [ShapeData['kind'], string][] = [
  ['rect', 'Rectangle'],
  ['ellipse', 'Ellipse'],
  ['polygon', 'Polygon'],
  ['star', 'Star'],
  ['line', 'Line'],
];

export const DEFAULT_SHAPE: ShapeData = {
  kind: 'rect',
  w: 480,
  h: 280,
  px: 0.5,
  py: 0.5,
  sides: 5,
  inner: 45,
  corner: 0,
  fillOn: true,
  fill: '#4fb3bf',
  strokeOn: false,
  stroke: '#ffffff',
  strokeWidth: 8,
  trimStart: 0,
  trimEnd: 100,
  trimOffset: 0,
};

/** Corners cut back and rounded (a curve through each corner), `r` pixels from it at most. */
export function roundCorners(pts: Pt[], r: number, steps = 6): Pt[] {
  if (r <= 0 || pts.length < 3) return pts;
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i] as Pt;
    const a = pts[(i + n - 1) % n] as Pt;
    const b = pts[(i + 1) % n] as Pt;
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const d = Math.min(r, la / 2, lb / 2);
    if (d <= 0) {
      out.push(p);
      continue;
    }
    const p1: Pt = [p[0] + ((a[0] - p[0]) / la) * d, p[1] + ((a[1] - p[1]) / la) * d];
    const p2: Pt = [p[0] + ((b[0] - p[0]) / lb) * d, p[1] + ((b[1] - p[1]) / lb) * d];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push([u * u * p1[0] + 2 * u * t * p[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * p[1] + t * t * p2[1]]);
    }
  }
  return out;
}

/** A shape's outline around its middle (pixels for a 1080-high frame, times `k`), starting at the top and going clockwise. */
export function shapeOutline(s: ShapeData, k = 1): { pts: Pt[]; closed: boolean } {
  const w = (s.w * k) / 2;
  const h = (s.h * k) / 2;
  if (s.kind === 'line')
    return {
      pts: [
        [-w, 0],
        [w, 0],
      ],
      closed: false,
    };
  if (s.kind === 'ellipse') {
    const n = 96;
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      pts.push([Math.cos(a) * w, Math.sin(a) * h]);
    }
    return { pts, closed: true };
  }
  let pts: Pt[];
  if (s.kind === 'rect')
    pts = [
      [0, -h],
      [w, -h],
      [w, h],
      [-w, h],
      [-w, -h],
    ];
  else {
    const n = Math.max(3, Math.round(s.sides));
    const star = s.kind === 'star';
    const count = star ? n * 2 : n;
    pts = [];
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (i / count) * Math.PI * 2;
      const r = star && i % 2 === 1 ? Math.max(0.01, s.inner / 100) : 1;
      pts.push([Math.cos(a) * w * r, Math.sin(a) * h * r]);
    }
  }
  // A rectangle starts at the middle of its top edge (that point is not a corner).
  const rounded = s.kind === 'rect' ? roundRect(pts, s.corner * k) : roundCorners(pts, s.corner * k);
  return { pts: rounded, closed: true };
}

function roundRect(pts: Pt[], r: number): Pt[] {
  if (r <= 0) return pts;
  // The four corners rounded, starting at the top middle like the sharp one.
  return [pts[0] as Pt, ...roundCorners(pts.slice(1), r)];
}

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The outline's length. */
export function outlineLength(pts: Pt[], closed: boolean): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1] as Pt, pts[i] as Pt);
  if (closed && pts.length > 1) L += dist(pts[pts.length - 1] as Pt, pts[0] as Pt);
  return L;
}

/** The part of an outline from `a` to `b` (0–1 of its length, a < b, both within one lap). */
function piece(pts: Pt[], closed: boolean, a: number, b: number): Pt[] {
  const ring = closed ? [...pts, pts[0] as Pt] : pts;
  const L = outlineLength(pts, closed);
  const from = a * L;
  const to = b * L;
  const out: Pt[] = [];
  let run = 0;
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i - 1] as Pt;
    const q = ring[i] as Pt;
    const len = dist(p, q);
    const s0 = run;
    const s1 = run + len;
    run = s1;
    if (s1 < from || s0 > to || len === 0) continue;
    const at = (s: number): Pt => {
      const t = Math.max(0, Math.min(1, (s - s0) / len));
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    };
    if (!out.length) out.push(at(Math.max(from, s0)));
    out.push(at(Math.min(to, s1)));
  }
  return out;
}

/**
 * Trim paths: the parts of an outline to draw for start and end (percent of its length) moved along by offset
 * (percent; a closed outline wraps round, an open one is cut at its ends).
 */
export function trimOutline(pts: Pt[], closed: boolean, start: number, end: number, offset: number): Pt[][] {
  const lo = Math.max(0, Math.min(100, Math.min(start, end))) / 100;
  const hi = Math.max(0, Math.min(100, Math.max(start, end))) / 100;
  if (hi - lo <= 1e-6) return [];
  if (hi - lo >= 1 - 1e-6 && Math.abs(offset % 100) < 1e-9) return [closed ? [...pts, pts[0] as Pt] : pts];
  const off = offset / 100;
  if (!closed) {
    const a = Math.max(0, lo + off);
    const b = Math.min(1, hi + off);
    return b > a ? [piece(pts, false, a, b)] : [];
  }
  if (hi - lo >= 1 - 1e-6) return [[...pts, pts[0] as Pt]];
  const a = (((lo + off) % 1) + 1) % 1;
  const b = a + (hi - lo);
  if (b <= 1) return [piece(pts, true, a, b)];
  // Across the start of the outline: one line made of the two pieces.
  const first = piece(pts, true, a, 1);
  const second = piece(pts, true, 0, b - 1);
  return [[...first, ...second.slice(1)]];
}

/** A new shape clip at a frame, on the first free video track above V1. */
export function addShape(p: Project, at: number, length: number, kind: ShapeData['kind']): { project: Project; id: string } {
  const s = current(p);
  const video = s.tracks.filter((t) => t.kind === 'video' && !t.captions);
  const free =
    video.slice(1).find((t) => !t.locked && !s.clips.some((c) => c.track === t.id && c.start < at + length && c.start + c.length > at)) ??
    video[video.length - 1];
  if (!free) return { project: p, id: '' };
  const shape: ShapeData = {
    ...DEFAULT_SHAPE,
    kind,
    ...(kind === 'ellipse' || kind === 'polygon' || kind === 'star' ? { w: 360, h: 360 } : {}),
    ...(kind === 'line' ? { w: 600, h: 0, strokeOn: true, fillOn: false } : {}),
  };
  const clip = newClip(free.id, at, length, { kind: 'shape', shape }, SHAPE_KINDS.find((k) => k[0] === kind)?.[1] ?? 'Shape');
  return { project: placeClips(p, [clip], 'overwrite'), id: clip.id };
}
