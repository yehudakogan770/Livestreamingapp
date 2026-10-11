// SVG path data ("M10 10 C…") to vector paths: every command, arcs turned
// into Bézier curves. Used for custom shapes and for reading SVG files.

import type { Anchor, SubPath, VectorPath } from './path';

function arcToBeziers(x1: number, y1: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x2: number, y2: number): number[][] {
  // SVG arc implementation notes (F.6.5): endpoint to center parameterization.
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  const sinp = Math.sin(phi),
    cosp = Math.cos(phi);
  const dx = (x1 - x2) / 2,
    dy = (y1 - y2) / 2;
  const x1p = cosp * dx + sinp * dy,
    y1p = -sinp * dx + cosp * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry,
    cyp = (-coef * ry * x1p) / rx;
  const cx = cosp * cxp - sinp * cyp + (x1 + x2) / 2,
    cy = sinp * cxp + cosp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const d = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return d;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const out: number[][] = [];
  const delta = dt / segs;
  const k = (4 / 3) * Math.tan(delta / 4);
  let t = t1;
  const pt = (a: number) => {
    const x = rx * Math.cos(a),
      y = ry * Math.sin(a);
    return [cx + cosp * x - sinp * y, cy + sinp * x + cosp * y];
  };
  const dv = (a: number) => {
    const x = -rx * Math.sin(a),
      y = ry * Math.cos(a);
    return [cosp * x - sinp * y, sinp * x + cosp * y];
  };
  for (let i = 0; i < segs; i++) {
    const a0 = t,
      a1 = t + delta;
    const p0 = pt(a0),
      p1 = pt(a1),
      d0 = dv(a0),
      d1 = dv(a1);
    out.push([p0[0]! + k * d0[0]!, p0[1]! + k * d0[1]!, p1[0]! - k * d1[0]!, p1[1]! - k * d1[1]!, p1[0]!, p1[1]!]);
    t = a1;
  }
  return out;
}

export function parseSvgPath(d: string): VectorPath {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const subpaths: SubPath[] = [];
  let cur: SubPath | null = null;
  let x = 0,
    y = 0,
    sx = 0,
    sy = 0;
  let lastCtrl: [number, number] | null = null;
  let lastQuad: [number, number] | null = null;
  let i = 0;
  let cmd = '';
  const num = () => parseFloat(tokens[i++] ?? '0');
  const isNum = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]!);
  const start = (nx: number, ny: number) => {
    cur = { anchors: [{ x: nx, y: ny, ix: nx, iy: ny, ox: nx, oy: ny }], closed: false };
    subpaths.push(cur);
  };
  const last = (): Anchor => cur!.anchors[cur!.anchors.length - 1]!;
  const lineTo = (nx: number, ny: number) => {
    if (!cur) start(x, y);
    cur!.anchors.push({ x: nx, y: ny, ix: nx, iy: ny, ox: nx, oy: ny });
  };
  const curveTo = (c1x: number, c1y: number, c2x: number, c2y: number, nx: number, ny: number) => {
    if (!cur) start(x, y);
    const l = last();
    l.ox = c1x;
    l.oy = c1y;
    cur!.anchors.push({ x: nx, y: ny, ix: c2x, iy: c2y, ox: nx, oy: ny });
  };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i]!)) cmd = tokens[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      const cz = cur as SubPath | null;
      if (cz) {
        const a = cz.anchors;
        const f = a[0]!,
          l = a[a.length - 1]!;
        // A closing point on the start merges into it.
        if (a.length > 1 && Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) {
          f.ix = l.ix;
          f.iy = l.iy;
          a.pop();
        }
        cz.closed = true;
      }
      x = sx;
      y = sy;
      cur = null;
      lastCtrl = lastQuad = null;
      continue;
    }
    if (!isNum()) {
      i++;
      continue;
    }
    if (C === 'M') {
      x = (rel ? x : 0) + num();
      y = (rel ? y : 0) + num();
      sx = x;
      sy = y;
      start(x, y);
      cmd = rel ? 'l' : 'L';
      lastCtrl = lastQuad = null;
    } else if (C === 'L') {
      x = (rel ? x : 0) + num();
      y = (rel ? y : 0) + num();
      lineTo(x, y);
      lastCtrl = lastQuad = null;
    } else if (C === 'H') {
      x = (rel ? x : 0) + num();
      lineTo(x, y);
      lastCtrl = lastQuad = null;
    } else if (C === 'V') {
      y = (rel ? y : 0) + num();
      lineTo(x, y);
      lastCtrl = lastQuad = null;
    } else if (C === 'C') {
      const c1x = (rel ? x : 0) + num(),
        c1y = (rel ? y : 0) + num();
      const c2x = (rel ? x : 0) + num(),
        c2y = (rel ? y : 0) + num();
      const nx = (rel ? x : 0) + num(),
        ny = (rel ? y : 0) + num();
      curveTo(c1x, c1y, c2x, c2y, nx, ny);
      lastCtrl = [c2x, c2y];
      lastQuad = null;
      x = nx;
      y = ny;
    } else if (C === 'S') {
      const c1x = lastCtrl ? 2 * x - lastCtrl[0] : x,
        c1y = lastCtrl ? 2 * y - lastCtrl[1] : y;
      const c2x = (rel ? x : 0) + num(),
        c2y = (rel ? y : 0) + num();
      const nx = (rel ? x : 0) + num(),
        ny = (rel ? y : 0) + num();
      curveTo(c1x, c1y, c2x, c2y, nx, ny);
      lastCtrl = [c2x, c2y];
      lastQuad = null;
      x = nx;
      y = ny;
    } else if (C === 'Q' || C === 'T') {
      let qx: number, qy: number;
      if (C === 'Q') {
        qx = (rel ? x : 0) + num();
        qy = (rel ? y : 0) + num();
      } else {
        qx = lastQuad ? 2 * x - lastQuad[0] : x;
        qy = lastQuad ? 2 * y - lastQuad[1] : y;
      }
      const nx = (rel ? x : 0) + num(),
        ny = (rel ? y : 0) + num();
      curveTo(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny);
      lastQuad = [qx, qy];
      lastCtrl = null;
      x = nx;
      y = ny;
    } else if (C === 'A') {
      const rx = num(),
        ry = num(),
        rot = (num() * Math.PI) / 180;
      const large = num() !== 0,
        sweep = num() !== 0;
      const nx = (rel ? x : 0) + num(),
        ny = (rel ? y : 0) + num();
      for (const b of arcToBeziers(x, y, rx, ry, rot, large, sweep, nx, ny)) curveTo(b[0]!, b[1]!, b[2]!, b[3]!, b[4]!, b[5]!);
      lastCtrl = lastQuad = null;
      x = nx;
      y = ny;
    } else i++;
  }
  return { subpaths: subpaths.filter((s) => s.anchors.length > 1 || s.closed) };
}

/** Built-in custom shapes (Custom Shape tool), 100 × 100 units. */
export const CUSTOM_SHAPES: { id: string; name: string; d: string }[] = [
  { id: 'heart', name: 'Heart', d: 'M50 88 C20 66 4 48 4 30 C4 16 15 6 28 6 C38 6 46 12 50 21 C54 12 62 6 72 6 C85 6 96 16 96 30 C96 48 80 66 50 88 Z' },
  { id: 'star5', name: 'Star', d: 'M50 4 L62 38 L98 38 L69 59 L80 94 L50 73 L20 94 L31 59 L2 38 L38 38 Z' },
  { id: 'arrow', name: 'Arrow', d: 'M4 38 L60 38 L60 16 L96 50 L60 84 L60 62 L4 62 Z' },
  { id: 'bubble', name: 'Speech Bubble', d: 'M10 10 L90 10 Q96 10 96 16 L96 62 Q96 68 90 68 L40 68 L22 88 L26 68 L10 68 Q4 68 4 62 L4 16 Q4 10 10 10 Z' },
  { id: 'check', name: 'Check Mark', d: 'M8 54 L22 40 L40 58 L80 16 L94 30 L40 86 Z' },
  { id: 'ring', name: 'Ring', d: 'M50 4 A46 46 0 1 1 49.99 4 Z M50 22 A28 28 0 1 0 50.01 22 Z' },
  { id: 'banner', name: 'Banner', d: 'M4 24 L96 24 L84 50 L96 76 L4 76 L16 50 Z' },
  { id: 'badge', name: 'Badge', d: 'M50 2 L61 14 L77 10 L80 26 L95 33 L88 48 L96 62 L82 70 L80 86 L64 84 L50 96 L36 84 L20 86 L18 70 L4 62 L12 48 L5 33 L20 26 L23 10 L39 14 Z' },
  { id: 'cross', name: 'Plus', d: 'M38 4 L62 4 L62 38 L96 38 L96 62 L62 62 L62 96 L38 96 L38 62 L4 62 L4 38 L38 38 Z' },
  { id: 'chevron', name: 'Chevron', d: 'M8 8 L52 8 L92 50 L52 92 L8 92 L48 50 Z' },
];
