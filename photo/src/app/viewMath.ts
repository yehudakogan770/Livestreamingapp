// The view transform: document pixels ↔ screen (CSS) pixels, with zoom,
// rotation and flip around the document's center.

import type { ViewState } from './session';

/** Affine [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Affine = [number, number, number, number, number, number];

export function docToScreenMatrix(v: ViewState, docW: number, docH: number): Affine {
  const r = (v.rotation * Math.PI) / 180;
  const cos = Math.cos(r) * v.zoom,
    sin = Math.sin(r) * v.zoom;
  const fx = v.flip ? -1 : 1;
  // screen = R · F · (p − c) · zoom + (cx, cy)
  const a = cos * fx,
    b = sin * fx,
    c = -sin,
    d = cos;
  const ox = docW / 2,
    oy = docH / 2;
  return [a, b, c, d, v.cx - (a * ox + c * oy), v.cy - (b * ox + d * oy)];
}

export function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c || 1e-12;
  const ia = d / det,
    ib = -b / det,
    ic = -c / det,
    id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function multiply(m: Affine, n: Affine): Affine {
  // m ∘ n
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** The view that fits the document in a box (with a margin). */
export function fitView(docW: number, docH: number, boxW: number, boxH: number, margin = 40): ViewState {
  const z = Math.min((boxW - margin * 2) / docW, (boxH - margin * 2) / docH);
  return { zoom: Math.max(0.01, Math.min(z, 64)), cx: boxW / 2, cy: boxH / 2, rotation: 0, flip: false };
}

/** Zoom by `factor` keeping the screen point (sx, sy) over the same document point. */
export function zoomAt(v: ViewState, factor: number, sx: number, sy: number, min = 0.01, max = 64): ViewState {
  const z = Math.max(min, Math.min(max, v.zoom * factor));
  const k = z / v.zoom;
  return { ...v, zoom: z, cx: sx + (v.cx - sx) * k, cy: sy + (v.cy - sy) * k };
}

/** Photoshop's zoom steps. */
export const ZOOM_STEPS = [
  0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 32, 64,
];

export function nextZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z * 1.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  return [...ZOOM_STEPS].reverse().find((s) => s < z / 1.001) ?? ZOOM_STEPS[0]!;
}

export function zoomLabel(z: number): string {
  const p = z * 100;
  return p >= 10 ? `${Math.round(p * 10) / 10}%` : `${Math.round(p * 100) / 100}%`;
}
