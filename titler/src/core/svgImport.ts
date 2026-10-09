// SVG in as real shapes (Figma's "Copy as SVG", Illustrator, Inkscape,
// icon sets): paths, rectangles, circles, ellipses, lines, polygons and
// groups become shape layers you can edit and animate, with their fills,
// gradients, strokes and transforms. Text becomes text layers.

import { uid } from './build';
import { textStyle } from './build';
import { ellipsePath, rectPath } from './paths';
import { mul, apply, type Mat, IDENTITY } from './matrix';
import type { GroupLayer, Layer, Paint, PathData, PathVertex, ShapeLayer, Stroke, TextLayer, Transform, Vec2 } from './types';

export interface SvgImport {
  layers: Layer[];
  width: number;
  height: number;
  notes: string[];
}

const STILL: Transform = { anchor: { v: [0, 0] }, position: { v: [0, 0] }, scale: { v: [100, 100] }, rotation: { v: 0 }, opacity: { v: 100 } };

// ---- path data ----

type Cmd = { c: string; a: number[] };

function tokens(d: string): Cmd[] {
  const out: Cmd[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let cur: Cmd | null = null;
  for (const m of d.matchAll(re)) {
    if (m[1]) {
      cur = { c: m[1], a: [] };
      out.push(cur);
    } else if (cur) cur.a.push(Number(m[2]));
  }
  return out;
}

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** An SVG arc as cubic curves (from the SVG spec's endpoint-to-center conversion). */
function arcToCubics(x1: number, y1: number, rx: number, ry: number, phi: number, large: number, sweep: number, x2: number, y2: number): [Vec2, Vec2, Vec2][] {
  if (rx === 0 || ry === 0)
    return [
      [
        [x1, y1],
        [x2, y2],
        [x2, y2],
      ],
    ];
  const sinP = Math.sin((phi * Math.PI) / 180);
  const cosP = Math.cos((phi * Math.PI) / 180);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const step = dt / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const pt = (t: number): Vec2 => [cx + rx * Math.cos(t) * cosP - ry * Math.sin(t) * sinP, cy + rx * Math.cos(t) * sinP + ry * Math.sin(t) * cosP];
  const dv = (t: number): Vec2 => [-rx * Math.sin(t) * cosP - ry * Math.cos(t) * sinP, -rx * Math.sin(t) * sinP + ry * Math.cos(t) * cosP];
  const out: [Vec2, Vec2, Vec2][] = [];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * step;
    const b = a + step;
    const p0 = pt(a);
    const p3 = pt(b);
    const d0 = dv(a);
    const d3 = dv(b);
    out.push([[p0[0] + k * d0[0], p0[1] + k * d0[1]], [p3[0] - k * d3[0], p3[1] - k * d3[1]], p3]);
  }
  return out;
}

/** An SVG path's "d" as outlines (absolute points, in the element's space). */
export function parsePathD(d: string): PathData[] {
  const out: PathData[] = [];
  let cur: PathData | null = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC: Vec2 | null = null;
  let lastQ: Vec2 | null = null;
  const start = (px: number, py: number) => {
    cur = { closed: false, v: [{ p: [px, py] }] };
    out.push(cur);
  };
  const lastV = (): PathVertex => cur!.v[cur!.v.length - 1]!;
  const cubic = (c1: Vec2, c2: Vec2, p: Vec2) => {
    if (!cur) start(x, y);
    const lv = lastV();
    lv.o = [c1[0] - lv.p[0], c1[1] - lv.p[1]];
    cur!.v.push({ p, i: [c2[0] - p[0], c2[1] - p[1]] });
  };
  const line = (p: Vec2) => {
    if (!cur) start(x, y);
    cur!.v.push({ p });
  };
  for (const { c, a } of tokens(d)) {
    const up = c.toUpperCase();
    const rel = c !== up;
    const n = ARGS[up] ?? 0;
    const groups = n === 0 ? [[]] : Array.from({ length: Math.max(1, Math.floor(a.length / n)) }, (_, k) => a.slice(k * n, k * n + n));
    groups.forEach((g, gi) => {
      if (n && g.length < n) return;
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      let cmd = up;
      if (cmd === 'M' && gi > 0) cmd = 'L';
      switch (cmd) {
        case 'M':
          x = g[0]! + ox;
          y = g[1]! + oy;
          sx = x;
          sy = y;
          start(x, y);
          lastC = lastQ = null;
          break;
        case 'L':
          x = g[0]! + ox;
          y = g[1]! + oy;
          line([x, y]);
          lastC = lastQ = null;
          break;
        case 'H':
          x = g[0]! + (rel ? x : 0);
          line([x, y]);
          lastC = lastQ = null;
          break;
        case 'V':
          y = g[0]! + (rel ? y : 0);
          line([x, y]);
          lastC = lastQ = null;
          break;
        case 'C': {
          const c1: Vec2 = [g[0]! + ox, g[1]! + oy];
          const c2: Vec2 = [g[2]! + ox, g[3]! + oy];
          x = g[4]! + ox;
          y = g[5]! + oy;
          cubic(c1, c2, [x, y]);
          lastC = c2;
          lastQ = null;
          break;
        }
        case 'S': {
          const c1: Vec2 = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
          const c2: Vec2 = [g[0]! + ox, g[1]! + oy];
          x = g[2]! + ox;
          y = g[3]! + oy;
          cubic(c1, c2, [x, y]);
          lastC = c2;
          lastQ = null;
          break;
        }
        case 'Q':
        case 'T': {
          const q: Vec2 = cmd === 'Q' ? [g[0]! + ox, g[1]! + oy] : lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
          const p: Vec2 = cmd === 'Q' ? [g[2]! + ox, g[3]! + oy] : [g[0]! + ox, g[1]! + oy];
          cubic([x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)], [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])], p);
          x = p[0];
          y = p[1];
          lastQ = q;
          lastC = null;
          break;
        }
        case 'A': {
          const p: Vec2 = [g[5]! + ox, g[6]! + oy];
          for (const [c1, c2, e] of arcToCubics(x, y, g[0]!, g[1]!, g[2]!, g[3]!, g[4]!, p[0], p[1])) cubic(c1, c2, e);
          x = p[0];
          y = p[1];
          lastC = lastQ = null;
          break;
        }
        case 'Z':
          if (cur) {
            const c0 = cur as PathData;
            // A closing point on the start is the start.
            const first = c0.v[0]!;
            const last = c0.v[c0.v.length - 1]!;
            if (c0.v.length > 1 && Math.hypot(last.p[0] - first.p[0], last.p[1] - first.p[1]) < 1e-6) {
              if (last.i) first.i = last.i;
              c0.v.pop();
            }
            c0.closed = true;
          }
          x = sx;
          y = sy;
          cur = null;
          lastC = lastQ = null;
          break;
      }
    });
  }
  return out.filter((p) => p.v.length > 1);
}

// ---- styles and transforms ----

function parseTransform(t: string | null): Mat {
  if (!t) return IDENTITY;
  let m: Mat = IDENTITY;
  for (const f of t.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = f[2]!
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    let n: Mat = IDENTITY;
    switch (f[1]) {
      case 'matrix':
        n = [a[0] ?? 1, a[1] ?? 0, a[2] ?? 0, a[3] ?? 1, a[4] ?? 0, a[5] ?? 0];
        break;
      case 'translate':
        n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case 'scale':
        n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180;
        const c = Math.cos(r);
        const s = Math.sin(r);
        const cx = a[1] ?? 0;
        const cy = a[2] ?? 0;
        n = mul(mul([1, 0, 0, 1, cx, cy], [c, s, -s, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'skewX':
        n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = mul(m, n);
  }
  return m;
}

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  gray: '#808080',
  grey: '#808080',
  orange: '#ffa500',
  none: 'none',
  transparent: 'none',
};

function color(v: string | null | undefined, opacity = 1): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (s === 'none' || s === 'transparent') return null;
  let hex = NAMED[s] ?? s;
  const rgb = /^rgba?\(([^)]+)\)$/.exec(hex);
  if (rgb) {
    const p = rgb[1]!.split(/[\s,/]+/).filter(Boolean);
    const ch = (x: string) => (x.endsWith('%') ? (Number(x.slice(0, -1)) / 100) * 255 : Number(x));
    const a = p[3] !== undefined ? (p[3].endsWith('%') ? Number(p[3].slice(0, -1)) / 100 : Number(p[3])) : 1;
    hex =
      '#' +
      [ch(p[0]!), ch(p[1]!), ch(p[2]!)]
        .map((x) =>
          Math.round(Math.max(0, Math.min(255, x)))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
    opacity *= a;
  }
  if (/^#[0-9a-f]{3}$/.test(hex)) hex = '#' + [...hex.slice(1)].map((c) => c + c).join('');
  if (!/^#[0-9a-f]{6}$/.test(hex)) return '#000000';
  return opacity < 0.999
    ? hex +
        Math.round(Math.max(0, opacity) * 255)
          .toString(16)
          .padStart(2, '0')
    : hex;
}

interface Inherited {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  fillOpacity: number;
  strokeOpacity: number;
  fillRule: 'nonzero' | 'evenodd';
  join?: Stroke['join'];
  cap?: Stroke['cap'];
}

function attr(el: Element, name: string): string | null {
  const style = el.getAttribute('style');
  if (style) {
    const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(style);
    if (m) return m[1]!.trim();
  }
  return el.getAttribute(name);
}

function inherit(el: Element, up: Inherited): Inherited {
  const sw = attr(el, 'stroke-width');
  const lj = attr(el, 'stroke-linejoin');
  const lc = attr(el, 'stroke-linecap');
  const fr = attr(el, 'fill-rule');
  return {
    fill: attr(el, 'fill') ?? up.fill,
    stroke: attr(el, 'stroke') ?? up.stroke,
    strokeWidth: sw !== null ? parseFloat(sw) || 0 : up.strokeWidth,
    fillOpacity: attr(el, 'fill-opacity') !== null ? Number(attr(el, 'fill-opacity')) : up.fillOpacity,
    strokeOpacity: attr(el, 'stroke-opacity') !== null ? Number(attr(el, 'stroke-opacity')) : up.strokeOpacity,
    fillRule: fr === 'evenodd' ? 'evenodd' : fr === 'nonzero' ? 'nonzero' : up.fillRule,
    join: lj === 'round' || lj === 'bevel' || lj === 'miter' ? lj : up.join,
    cap: lc === 'round' || lc === 'square' || lc === 'butt' ? lc : up.cap,
  };
}

const movePath = (p: PathData, m: Mat): PathData => ({
  closed: p.closed,
  v: p.v.map((v) => {
    const pt = apply(m, v.p);
    const out: PathVertex = { p: pt };
    // Tangents move with the matrix but not its translation.
    const lin = (d: Vec2): Vec2 => [m[0] * d[0] + m[2] * d[1], m[1] * d[0] + m[3] * d[1]];
    if (v.i) out.i = lin(v.i);
    if (v.o) out.o = lin(v.o);
    return out;
  }),
});

/** Read an SVG document's text into shape layers (in its own pixels, viewBox from 0,0). */
export function fromSvg(text: string): SvgImport {
  if (typeof DOMParser === 'undefined') throw new Error('SVG cannot be read here.');
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('This is not an SVG drawing.');
  const notes = new Set<string>();
  const vb = (svg.getAttribute('viewBox') ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const width = vb.length === 4 ? vb[2]! : parseFloat(svg.getAttribute('width') ?? '') || 100;
  const height = vb.length === 4 ? vb[3]! : parseFloat(svg.getAttribute('height') ?? '') || 100;
  const root: Mat = vb.length === 4 ? [1, 0, 0, 1, -vb[0]!, -vb[1]!] : IDENTITY;
  const grads = new Map<string, Element>();
  for (const g of [...doc.getElementsByTagName('linearGradient'), ...doc.getElementsByTagName('radialGradient')]) if (g.id) grads.set(g.id, g);

  const paintOf = (v: string | null, opacity: number, box: { x: number; y: number; w: number; h: number }): Paint | null => {
    if (!v) return null;
    const ref = /url\(\s*#([^)\s]+)\s*\)/.exec(v);
    if (ref) {
      const g = grads.get(ref[1]!);
      if (!g) return null;
      let stopsEl = [...g.getElementsByTagName('stop')];
      const href = g.getAttribute('href') ?? g.getAttribute('xlink:href');
      if (!stopsEl.length && href) stopsEl = [...(grads.get(href.replace('#', ''))?.getElementsByTagName('stop') ?? [])];
      const stops = stopsEl.map((s) => {
        const off = s.getAttribute('offset') ?? '0';
        const at = off.endsWith('%') ? Number(off.slice(0, -1)) / 100 : Number(off);
        const so = attr(s, 'stop-opacity');
        return {
          at: Math.max(0, Math.min(1, at || 0)),
          color: color(attr(s, 'stop-color') ?? '#000000', (so !== null ? Number(so) : 1) * opacity) ?? '#00000000',
        };
      });
      if (g.nodeName.toLowerCase() === 'radialgradient') return { type: 'radial', stops };
      const num = (n: string, d: number) => {
        const a = g.getAttribute(n);
        if (a === null) return d;
        return a.endsWith('%') ? Number(a.slice(0, -1)) / 100 : Number(a);
      };
      const user = g.getAttribute('gradientUnits') === 'userSpaceOnUse';
      let x1 = num('x1', 0);
      let y1 = num('y1', 0);
      let x2 = num('x2', 1);
      let y2 = num('y2', 0);
      if (!user) {
        x1 = box.x + x1 * box.w;
        x2 = box.x + x2 * box.w;
        y1 = box.y + y1 * box.h;
        y2 = box.y + y2 * box.h;
      }
      const angle = Math.round(((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 90 + 360) % 360);
      return { type: 'linear', angle, stops };
    }
    const c = color(v, opacity);
    return c ? { type: 'solid', color: c } : null;
  };

  const shapeFrom = (el: Element, paths: PathData[], st: Inherited, m: Mat, opacity: number): ShapeLayer | null => {
    if (!paths.length) return null;
    const moved = paths.map((p) => movePath(p, m));
    // Into the layer's own space: its top left at the layer's position.
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of moved)
      for (const v of p.v) {
        x0 = Math.min(x0, v.p[0]);
        y0 = Math.min(y0, v.p[1]);
        x1 = Math.max(x1, v.p[0]);
        y1 = Math.max(y1, v.p[1]);
      }
    const local = moved.map((p) => ({ ...p, v: p.v.map((v) => ({ ...v, p: [v.p[0] - x0, v.p[1] - y0] as Vec2 })) }));
    const box = { x: 0, y: 0, w: x1 - x0, h: y1 - y0 };
    const fill = paintOf(st.fill ?? '#000000', st.fillOpacity, box);
    const strokePaint = st.stroke ? paintOf(st.stroke, st.strokeOpacity, box) : null;
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const stroke: Stroke | null =
      strokePaint && st.strokeWidth > 0
        ? { paint: strokePaint, width: st.strokeWidth * scale, ...(st.join ? { join: st.join } : {}), ...(st.cap ? { cap: st.cap } : {}) }
        : null;
    if (!fill && !stroke) return null;
    return {
      id: uid(),
      name: el.getAttribute('id') || el.getAttribute('data-name') || el.nodeName,
      visible: true,
      start: 0,
      end: 10,
      transform: { ...STILL, position: { v: [x0, y0] }, opacity: { v: Math.round(opacity * 100) } },
      type: 'shape',
      shape: 'path',
      size: { v: [100, 100] },
      roundness: { v: 0 },
      path: local[0]!,
      ...(local.length > 1 ? { subpaths: local.slice(1) } : {}),
      ...(st.fillRule === 'evenodd' ? { fillRule: 'evenodd' as const } : {}),
      fill,
      stroke,
    };
  };

  const nums = (el: Element, ...names: string[]) => names.map((n) => parseFloat(el.getAttribute(n) ?? '0') || 0);

  const walk = (el: Element, up: Inherited, m: Mat): Layer[] => {
    const out: Layer[] = [];
    for (const child of [...el.children]) {
      const tag = child.nodeName.toLowerCase().replace(/^svg:/, '');
      if (['defs', 'title', 'desc', 'metadata', 'style', 'lineargradient', 'radialgradient', 'clippath', 'mask', 'filter', 'symbol'].includes(tag)) {
        if (tag === 'clippath' || tag === 'mask') notes.add('Clip paths and masks are left out (add the Titler’s own masks).');
        if (tag === 'filter') notes.add('SVG filters (shadows, blur) are left out (add the Titler’s own effects).');
        continue;
      }
      if (attr(child, 'display') === 'none' || attr(child, 'visibility') === 'hidden') continue;
      const st = inherit(child, up);
      const mm = mul(m, parseTransform(child.getAttribute('transform')));
      const op = attr(child, 'opacity') !== null ? Number(attr(child, 'opacity')) : 1;
      let paths: PathData[] = [];
      switch (tag) {
        case 'g':
        case 'a':
        case 'svg': {
          const kids = walk(child, st, mm);
          if (!kids.length) break;
          const g: GroupLayer = {
            id: uid(),
            name: child.getAttribute('id') || child.getAttribute('data-name') || 'Group',
            visible: true,
            start: 0,
            end: 10,
            transform: { ...STILL, opacity: { v: Math.round(op * 100) } },
            type: 'group',
            children: kids,
          };
          out.push(kids.length === 1 && op >= 0.999 ? kids[0]! : g);
          continue;
        }
        case 'path':
          paths = parsePathD(child.getAttribute('d') ?? '');
          break;
        case 'rect': {
          const [x, y, w, h, rx0, ry0] = nums(child, 'x', 'y', 'width', 'height', 'rx', 'ry');
          const r = Math.min((rx0 || ry0) ?? 0, w! / 2, h! / 2);
          const p = rectPath(w!, h!, r);
          paths = [{ ...p, v: p.v.map((v) => ({ ...v, p: [v.p[0] + x!, v.p[1] + y!] as Vec2 })) }];
          break;
        }
        case 'circle':
        case 'ellipse': {
          const [cx, cy, r, rx, ry] = nums(child, 'cx', 'cy', 'r', 'rx', 'ry');
          const ex = tag === 'circle' ? r! : rx!;
          const ey = tag === 'circle' ? r! : ry!;
          const p = ellipsePath(ex * 2, ey * 2);
          paths = [{ ...p, v: p.v.map((v) => ({ ...v, p: [v.p[0] + cx! - ex, v.p[1] + cy! - ey] as Vec2 })) }];
          break;
        }
        case 'line': {
          const [x1, y1, x2, y2] = nums(child, 'x1', 'y1', 'x2', 'y2');
          paths = [{ closed: false, v: [{ p: [x1!, y1!] }, { p: [x2!, y2!] }] }];
          break;
        }
        case 'polyline':
        case 'polygon': {
          const n = (child.getAttribute('points') ?? '')
            .split(/[\s,]+/)
            .filter(Boolean)
            .map(Number);
          const v: PathVertex[] = [];
          for (let k = 0; k + 1 < n.length; k += 2) v.push({ p: [n[k]!, n[k + 1]!] });
          paths = v.length > 1 ? [{ closed: tag === 'polygon', v }] : [];
          break;
        }
        case 'text': {
          const words = (child.textContent ?? '').trim();
          if (!words) break;
          const size = parseFloat(attr(child, 'font-size') ?? '16') || 16;
          const [x, y] = nums(child, 'x', 'y');
          const at = apply(mm, [x!, y!]);
          const fill = color(st.fill ?? '#000000') ?? '#000000';
          const weight = Number(attr(child, 'font-weight')) || (attr(child, 'font-weight') === 'bold' ? 700 : 400);
          const t: TextLayer = {
            id: uid(),
            name: words.slice(0, 30),
            visible: true,
            start: 0,
            end: 10,
            transform: { ...STILL, position: { v: [at[0], at[1] - size * 0.95] } },
            type: 'text',
            text: words,
            style: textStyle({
              font: (attr(child, 'font-family') ?? 'Inter').split(',')[0]!.replace(/['"]/g, '').trim() || 'Inter',
              weight,
              size,
              fill: { type: 'solid', color: fill },
              vAlign: 'top',
              lineHeight: 1.2,
            }),
            box: [Math.ceil(words.length * size * 0.62 + size), Math.ceil(size * 1.4)],
            wrap: false,
            fit: 'none',
          };
          out.push(t);
          continue;
        }
        case 'image':
          notes.add('Pictures inside the SVG are left out (add them as picture layers).');
          continue;
        case 'use':
          notes.add('Reused symbols (<use>) are left out.');
          continue;
        default:
          continue;
      }
      const s = shapeFrom(child, paths, st, mm, op);
      if (s) out.push(s);
    }
    return out;
  };
  const top = walk(svg, inherit(svg, { fill: '#000000', stroke: null, strokeWidth: 1, fillOpacity: 1, strokeOpacity: 1, fillRule: 'nonzero' }), root);
  // Front first, like the Titler's layer list (SVG draws later elements on top).
  const reverse = (ls: Layer[]): Layer[] => ls.reverse().map((l) => (l.type === 'group' ? { ...l, children: reverse(l.children) } : l));
  return { layers: reverse(top), width, height, notes: [...notes] };
}

/** Layers (and those in their groups) shown from 0 to `end` seconds. */
export function spanning(layers: Layer[], end: number): Layer[] {
  return layers.map((l) => ({ ...l, start: 0, end, ...(l.type === 'group' ? { children: spanning(l.children, end) } : {}) }) as Layer);
}
