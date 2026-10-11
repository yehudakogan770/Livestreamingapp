// Stylize (Emboss, Find Edges, Oil Paint, Solarize, Wind), Pixelate (Mosaic,
// Crystallize, Pointillize, Color Halftone), Render (Clouds, Difference
// Clouds, Lighting Effects, Lens Flare) and Other (Offset, Maximum, Minimum,
// Custom).

import { cloneImg, gaussianBlur, img, sampleBilinear, type Img } from '../img';
import { Rand } from '../brush';
import type { FilterDef } from './types';
import { num, str, bool, col, vec } from './types';

const lumAt = (a: Img, i: number) => 0.299 * a.data[i * 4]! + 0.587 * a.data[i * 4 + 1]! + 0.114 * a.data[i * 4 + 2]!;

export function emboss(a: Img, angle: number, height: number, amount: number): Img {
  const out = cloneImg(a);
  const r = (angle * Math.PI) / 180;
  const dx = Math.cos(r) * height,
    dy = -Math.sin(r) * height;
  const k = amount / 100;
  const s1 = [0, 0, 0, 0],
    s2 = [0, 0, 0, 0];
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      sampleBilinear(a, x + 0.5 + dx, y + 0.5 + dy, s1);
      sampleBilinear(a, x + 0.5 - dx, y + 0.5 - dy, s2);
      const i = (y * a.w + x) * 4;
      const l1 = 0.299 * s1[0]! + 0.587 * s1[1]! + 0.114 * s1[2]!;
      const l2 = 0.299 * s2[0]! + 0.587 * s2[1]! + 0.114 * s2[2]!;
      const v = Math.min(1, Math.max(0, 0.5 + (l1 - l2) * k));
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
    }
  return out;
}

/** Find Edges: dark lines on white where colors change (Sobel, per channel). */
export function findEdges(a: Img): Img {
  const out = cloneImg(a);
  const { w, h } = a;
  const at = (x: number, y: number, c: number) => a.data[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4 + c]!;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        const gx = at(x + 1, y - 1, c) + 2 * at(x + 1, y, c) + at(x + 1, y + 1, c) - at(x - 1, y - 1, c) - 2 * at(x - 1, y, c) - at(x - 1, y + 1, c);
        const gy = at(x - 1, y + 1, c) + 2 * at(x, y + 1, c) + at(x + 1, y + 1, c) - at(x - 1, y - 1, c) - 2 * at(x, y - 1, c) - at(x + 1, y - 1, c);
        out.data[(y * w + x) * 4 + c] = Math.min(1, Math.max(0, 1 - Math.hypot(gx, gy) / 2));
      }
  return out;
}

/** Oil Paint: brush strokes following the picture's flow (Kuwahara along the structure), with bristle relief. */
export function oilPaint(a: Img, stylization: number, cleanliness: number, scale: number, bristle: number, angle: number, shine: number): Img {
  const { w, h } = a;
  const r = Math.max(1, Math.round(stylization * 1.2 * scale));
  // Structure: smoothed luminance gradients.
  const L = img(w, h, 1);
  for (let i = 0; i < w * h; i++) L.data[i] = lumAt(a, i);
  const Ls = gaussianBlur(L, Math.max(0.5, cleanliness / 4));
  // Anisotropic Kuwahara-ish: average over the quadrant with least variance.
  const out = cloneImg(a);
  const quads: [number, number][] = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let best = Infinity;
      let br = 0,
        bg = 0,
        bb = 0;
      for (const [sx, sy] of quads) {
        let mr = 0,
          mg = 0,
          mb = 0,
          v = 0,
          n = 0;
        for (let j = 0; j <= r; j += Math.max(1, r >> 2))
          for (let i = 0; i <= r; i += Math.max(1, r >> 2)) {
            const xx = Math.min(w - 1, Math.max(0, x + sx * i)),
              yy = Math.min(h - 1, Math.max(0, y + sy * j));
            const q = (yy * w + xx) * 4;
            const cr = a.data[q]!,
              cg = a.data[q + 1]!,
              cb = a.data[q + 2]!;
            mr += cr;
            mg += cg;
            mb += cb;
            v += cr * cr + cg * cg + cb * cb;
            n++;
          }
        mr /= n;
        mg /= n;
        mb /= n;
        const variance = v / n - (mr * mr + mg * mg + mb * mb);
        if (variance < best) {
          best = variance;
          br = mr;
          bg = mg;
          bb = mb;
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = br;
      out.data[o + 1] = bg;
      out.data[o + 2] = bb;
    }
  if (shine > 0 || bristle > 0) {
    // Relief from the brush structure, lit from `angle`.
    const ra = (angle * Math.PI) / 180;
    const lx = Math.cos(ra),
      ly = -Math.sin(ra);
    const k = (shine / 10) * 0.6;
    const rand = new Rand(31);
    const bristles = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) bristles[i] = (rand.next() - 0.5) * (bristle / 10) * 0.04;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = Ls.data[i + 1]! - Ls.data[i - 1]!,
          gy = Ls.data[i + w]! - Ls.data[i - w]!;
        const lit = (gx * lx + gy * ly) * k + bristles[i]!;
        for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.min(1, Math.max(0, out.data[i * 4 + c]! + lit));
      }
  }
  return out;
}

export function solarize(a: Img): Img {
  const out = cloneImg(a);
  for (let i = 0; i < out.data.length; i += 4) for (let c = 0; c < 3; c++) {
    const v = a.data[i + c]!;
    out.data[i + c] = v > 0.5 ? 1 - v : v;
  }
  return out;
}

export function wind(a: Img, strength: 'wind' | 'blast' | 'stagger', fromLeft: boolean, seed: number): Img {
  const out = cloneImg(a);
  const { w, h } = a;
  const rand = new Rand(seed);
  const len = strength === 'blast' ? 40 : 20;
  for (let y = 0; y < h; y++) {
    let trail = 0,
      tc = [0, 0, 0];
    for (let k = 0; k < w; k++) {
      const x = fromLeft ? k : w - 1 - k;
      const i = (y * w + x) * 4;
      const l = lumAt(a, y * w + x);
      if (l > 0.55 && rand.next() < (strength === 'stagger' ? 0.15 : 0.3)) {
        trail = len * (0.5 + rand.next());
        tc = [a.data[i]!, a.data[i + 1]!, a.data[i + 2]!];
      }
      if (trail > 0) {
        const f = Math.min(1, trail / len) * 0.8;
        for (let c = 0; c < 3; c++) out.data[i + c] = Math.max(out.data[i + c]!, a.data[i + c]! + (tc[c]! - a.data[i + c]!) * f);
        trail--;
      }
    }
  }
  return out;
}

export function mosaic(a: Img, cell: number, ox = 0, oy = 0): Img {
  const s = Math.max(2, Math.round(cell));
  const out = cloneImg(a);
  const { w, h } = a;
  for (let by = -((oy % s) + s) % s; by < h; by += s)
    for (let bx = -((ox % s) + s) % s; bx < w; bx += s) {
      let r = 0,
        g = 0,
        b = 0,
        al = 0,
        n = 0;
      for (let y = Math.max(0, by); y < Math.min(h, by + s); y++)
        for (let x = Math.max(0, bx); x < Math.min(w, bx + s); x++) {
          const i = (y * w + x) * 4;
          const aa = a.data[i + 3]!;
          r += a.data[i]! * aa;
          g += a.data[i + 1]! * aa;
          b += a.data[i + 2]! * aa;
          al += aa;
          n++;
        }
      for (let y = Math.max(0, by); y < Math.min(h, by + s); y++)
        for (let x = Math.max(0, bx); x < Math.min(w, bx + s); x++) {
          const i = (y * w + x) * 4;
          if (al > 0) {
            out.data[i] = r / al;
            out.data[i + 1] = g / al;
            out.data[i + 2] = b / al;
          }
          out.data[i + 3] = al / n;
        }
    }
  return out;
}

/** Crystallize / Pointillize: Voronoi cells around jittered points (seeded on the whole-picture grid). */
export function crystallize(a: Img, cell: number, pointillize: boolean, bg: [number, number, number], ox = 0, oy = 0): Img {
  const s = Math.max(3, Math.round(cell));
  const out = cloneImg(a);
  const { w, h } = a;
  const pt = (gx: number, gy: number): [number, number] => {
    const r = new Rand((gx * 73856093) ^ (gy * 19349663) ^ 0x5bd1e995);
    return [gx * s + r.next() * s, gy * s + r.next() * s];
  };
  const colorAt = (px: number, py: number): number[] => {
    const x = Math.min(w - 1, Math.max(0, Math.floor(px - ox))),
      y = Math.min(h - 1, Math.max(0, Math.floor(py - oy)));
    const i = (y * w + x) * 4;
    return [a.data[i]!, a.data[i + 1]!, a.data[i + 2]!];
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const X = x + ox,
        Y = y + oy;
      const gx = Math.floor(X / s),
        gy = Math.floor(Y / s);
      let bd = Infinity,
        bp: [number, number] = [X, Y];
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const p = pt(gx + i, gy + j);
          const d = (p[0] - X) ** 2 + (p[1] - Y) ** 2;
          if (d < bd) {
            bd = d;
            bp = p;
          }
        }
      const c = colorAt(bp[0], bp[1]);
      const o = (y * w + x) * 4;
      if (pointillize) {
        const r = s * 0.42;
        const cov = Math.min(1, Math.max(0, r - Math.sqrt(bd) + 0.5));
        for (let k = 0; k < 3; k++) out.data[o + k] = c[k]! * cov + bg[k]! * (1 - cov);
      } else for (let k = 0; k < 3; k++) out.data[o + k] = c[k]!;
    }
  return out;
}

/** Color Halftone: each channel as dots on its own screen angle. */
export function colorHalftone(a: Img, maxRadius: number, angles: [number, number, number], ox = 0, oy = 0): Img {
  const out = cloneImg(a);
  const { w, h } = a;
  const cell = Math.max(4, maxRadius * 2);
  for (let c = 0; c < 3; c++) {
    const r = (angles[c]! * Math.PI) / 180;
    const cs = Math.cos(r),
      sn = Math.sin(r);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const X = x + ox,
          Y = y + oy;
        // Into the screen's rotated grid.
        const u = X * cs + Y * sn,
          v = -X * sn + Y * cs;
        const cu = (Math.floor(u / cell) + 0.5) * cell,
          cv = (Math.floor(v / cell) + 0.5) * cell;
        // The cell's center back in image space; its value sets the dot size.
        const cx = cu * cs - cv * sn - ox,
          cy = cu * sn + cv * cs - oy;
        const sx = Math.min(w - 1, Math.max(0, Math.floor(cx))),
          sy = Math.min(h - 1, Math.max(0, Math.floor(cy)));
        const ink = 1 - a.data[(sy * w + sx) * 4 + c]!;
        const rad = Math.sqrt(ink) * cell * 0.7071;
        const d = Math.hypot(u - cu, v - cv);
        const cov = Math.min(1, Math.max(0, rad - d + 0.5));
        out.data[(y * w + x) * 4 + c] = 1 - cov;
      }
  }
  return out;
}

/** Tiling value noise (Clouds) in fg/bg colors; seeded so bands and repeats agree. */
export function clouds(w: number, h: number, fg: [number, number, number], bgc: [number, number, number], seed: number, difference: Img | null, W: number, H: number, ox = 0, oy = 0): Img {
  const out = img(w, h, 4);
  const hash = (x: number, y: number, o: number) => {
    let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(o + seed * 31, 2246822519)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const base = Math.max(W, H) / 4;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0,
        amp = 0.5,
        f = 1 / base;
      for (let o = 0; o < 8; o++) {
        const fx = (x + ox) * f,
          fy = (y + oy) * f;
        const ix = Math.floor(fx),
          iy = Math.floor(fy);
        const tx = fx - ix,
          ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx),
          sy = ty * ty * (3 - 2 * ty);
        const n0 = hash(ix, iy, o) * (1 - sx) + hash(ix + 1, iy, o) * sx;
        const n1 = hash(ix, iy + 1, o) * (1 - sx) + hash(ix + 1, iy + 1, o) * sx;
        v += (n0 * (1 - sy) + n1 * sy) * amp;
        amp /= 2;
        f *= 2;
      }
      v = Math.min(1, Math.max(0, (v - 0.5) * 1.4 + 0.5));
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const cv = bgc[c]! + (fg[c]! - bgc[c]!) * v;
        out.data[i + c] = difference ? Math.abs(difference.data[i + c]! - cv) : cv;
      }
      out.data[i + 3] = difference ? difference.data[i + 3]! : 1;
    }
  return out;
}

/** Lighting Effects: a spot, point or infinite light over the picture, optionally embossed by luminance. */
export function lighting(a: Img, kind: 'spot' | 'point' | 'infinite', color: [number, number, number], intensity: number, ambient: number, gloss: number, cx: number, cy: number, radius: number, angle: number, height: number, W: number, H: number, ox = 0, oy = 0): Img {
  const out = cloneImg(a);
  const { w, h } = a;
  const R = (radius / 100) * Math.max(W, H);
  const ang = (angle * Math.PI) / 180;
  const ld = [Math.cos(ang), -Math.sin(ang)];
  const amb = ambient / 100;
  const inten = intensity / 50;
  const hk = height / 50;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const X = x + ox,
        Y = y + oy;
      // Surface normal from luminance (texture channel).
      let nx = 0,
        ny = 0;
      if (hk) {
        const l = lumAt(a, i);
        const lr = x < w - 1 ? lumAt(a, i + 1) : l,
          ld2 = y < h - 1 ? lumAt(a, i + w) : l;
        nx = (l - lr) * hk * 4;
        ny = (l - ld2) * hk * 4;
      }
      const nz = 1;
      const nl = Math.hypot(nx, ny, nz);
      let lx: number, ly: number, lz: number, fall: number;
      if (kind === 'infinite') {
        lx = ld[0]!;
        ly = ld[1]!;
        lz = 0.7;
        fall = 1;
      } else {
        const dx = cx * W - X,
          dy = cy * H - Y;
        const dist = Math.hypot(dx, dy);
        lx = dx;
        ly = dy;
        lz = R * 0.5;
        if (kind === 'spot') {
          // An elliptical pool of light along the angle.
          const u = (-dx * ld[0]! - dy * ld[1]!) / (R * 1.4),
            v = (dx * ld[1]! - dy * ld[0]!) / (R * 0.7);
          fall = Math.max(0, 1 - Math.hypot(u, v));
          fall = fall * fall * (3 - 2 * fall);
        } else fall = Math.max(0, 1 - dist / R) ** 1.5;
      }
      const ll = Math.hypot(lx, ly, lz) || 1;
      const diff = Math.max(0, (nx * lx + ny * ly + nz * lz) / (nl * ll));
      const spec = Math.pow(diff, 8 + gloss) * (gloss / 100);
      for (let c = 0; c < 3; c++) {
        const base = a.data[i * 4 + c]!;
        const light = amb + diff * fall * inten * color[c]!;
        out.data[i * 4 + c] = Math.min(1, Math.max(0, base * light + spec * fall * color[c]!));
      }
    }
  return out;
}

export function lensFlare(a: Img, cx: number, cy: number, brightness: number, W: number, H: number, ox = 0, oy = 0): Img {
  const out = cloneImg(a);
  const { w, h } = a;
  const X0 = cx * W,
    Y0 = cy * H;
  const k = brightness / 100;
  const size = Math.max(W, H);
  // A bright core, a soft halo, and ghosts along the line through the center.
  const ghosts = [
    { t: 0.6, r: 0.03, c: [0.6, 0.8, 1], a: 0.18 },
    { t: 1.1, r: 0.05, c: [1, 0.7, 0.4], a: 0.12 },
    { t: 1.5, r: 0.09, c: [0.5, 1, 0.6], a: 0.08 },
  ];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const X = x + ox,
        Y = y + oy;
      const d = Math.hypot(X - X0, Y - Y0) / size;
      const core = Math.exp(-d * d * 4000) * 1.2 + Math.exp(-d * d * 120) * 0.35;
      const ring = Math.exp(-((d - 0.07) ** 2) * 6000) * 0.12;
      const i = (y * w + x) * 4;
      let add = [core + ring, core + ring * 0.8, core * 0.9 + ring * 0.6];
      for (const g of ghosts) {
        const gx = X0 + (W / 2 - X0) * g.t * 2,
          gy = Y0 + (H / 2 - Y0) * g.t * 2;
        const gd = Math.hypot(X - gx, Y - gy) / size;
        const v = Math.max(0, 1 - gd / g.r) * g.a;
        add = add.map((s, c) => s + v * g.c[c]!);
      }
      for (let c = 0; c < 3; c++) out.data[i + c] = Math.min(1, out.data[i + c]! + add[c]! * k);
    }
  return out;
}

export function offset(a: Img, dx: number, dy: number, mode: 'transparent' | 'repeat' | 'wrap'): Img {
  const out = img(a.w, a.h, 4);
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      let sx = x - dx,
        sy = y - dy;
      if (mode === 'wrap') {
        sx = ((sx % a.w) + a.w) % a.w;
        sy = ((sy % a.h) + a.h) % a.h;
      } else if (mode === 'repeat') {
        sx = Math.min(a.w - 1, Math.max(0, sx));
        sy = Math.min(a.h - 1, Math.max(0, sy));
      } else if (sx < 0 || sy < 0 || sx >= a.w || sy >= a.h) continue;
      out.data.set(a.data.subarray((sy * a.w + sx) * 4, (sy * a.w + sx) * 4 + 4), (y * a.w + x) * 4);
    }
  return out;
}

/** Maximum (spread light) or Minimum (spread dark) over a radius. */
export function maxMin(a: Img, radius: number, max: boolean): Img {
  const r = Math.max(1, Math.round(radius));
  const pass = (src: Float32Array, horiz: boolean) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < a.h; y++)
      for (let x = 0; x < a.w; x++)
        for (let c = 0; c < 4; c++) {
          let v = max ? -Infinity : Infinity;
          for (let k = -r; k <= r; k++) {
            const xx = horiz ? Math.min(a.w - 1, Math.max(0, x + k)) : x,
              yy = horiz ? y : Math.min(a.h - 1, Math.max(0, y + k));
            const s = src[(yy * a.w + xx) * 4 + c]!;
            v = max ? Math.max(v, s) : Math.min(v, s);
          }
          out[(y * a.w + x) * 4 + c] = v;
        }
    return out;
  };
  return { ...a, data: pass(pass(a.data, true), false) };
}

export function customKernel(a: Img, k: number[], scale: number, off: number): Img {
  const out = cloneImg(a);
  const sc = scale || 1;
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++)
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let j = -2; j <= 2; j++)
          for (let i = -2; i <= 2; i++) {
            const kv = k[(j + 2) * 5 + (i + 2)] ?? 0;
            if (!kv) continue;
            const xx = Math.min(a.w - 1, Math.max(0, x + i)),
              yy = Math.min(a.h - 1, Math.max(0, y + j));
            acc += a.data[(yy * a.w + xx) * 4 + c]! * kv;
          }
        out.data[(y * a.w + x) * 4 + c] = Math.min(1, Math.max(0, acc / sc + off / 255));
      }
  return out;
}

export const STYLIZE_FILTERS: FilterDef[] = [
  {
    id: 'emboss',
    name: 'Emboss',
    menu: 'Stylize',
    params: [
      { key: 'angle', label: 'Angle', type: 'angle', def: 135 },
      { key: 'height', label: 'Height', type: 'number', min: 1, max: 100, def: 3, unit: 'px' },
      { key: 'amount', label: 'Amount', type: 'number', min: 1, max: 500, def: 100, unit: '%' },
    ],
    run: (a, p) => emboss(a, num(p, 'angle', 135), num(p, 'height', 3), num(p, 'amount', 100)),
    reach: (p) => Math.ceil(num(p, 'height', 3)) + 2,
    dialog: true,
    smart: true,
  },
  { id: 'findEdges', name: 'Find Edges', menu: 'Stylize', params: [], run: (a) => findEdges(a), reach: () => 2, smart: true },
  {
    id: 'oilPaint',
    name: 'Oil Paint',
    menu: 'Stylize',
    params: [
      { key: 'stylization', label: 'Stylization', type: 'number', min: 0.1, max: 10, step: 0.1, def: 4 },
      { key: 'cleanliness', label: 'Cleanliness', type: 'number', min: 0, max: 10, step: 0.1, def: 5 },
      { key: 'scale', label: 'Scale', type: 'number', min: 0.1, max: 10, step: 0.1, def: 1 },
      { key: 'bristle', label: 'Bristle Detail', type: 'number', min: 0, max: 10, step: 0.1, def: 3 },
      { key: 'angle', label: 'Lighting Angle', type: 'angle', def: 300 },
      { key: 'shine', label: 'Shine', type: 'number', min: 0, max: 10, step: 0.1, def: 1.5 },
    ],
    run: (a, p) => oilPaint(a, num(p, 'stylization', 4), num(p, 'cleanliness', 5), num(p, 'scale', 1), num(p, 'bristle', 3), num(p, 'angle', 300), num(p, 'shine', 1.5)),
    reach: (p) => Math.ceil(num(p, 'stylization', 4) * 1.2 * num(p, 'scale', 1)) + 20,
    dialog: true,
    smart: true,
  },
  { id: 'solarize', name: 'Solarize', menu: 'Stylize', params: [], run: (a) => solarize(a), reach: () => 0, smart: true },
  {
    id: 'wind',
    name: 'Wind',
    menu: 'Stylize',
    params: [
      {
        key: 'method',
        label: 'Method',
        type: 'select',
        options: [
          ['wind', 'Wind'],
          ['blast', 'Blast'],
          ['stagger', 'Stagger'],
        ],
        def: 'wind',
      },
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        options: [
          ['right', 'From the Right'],
          ['left', 'From the Left'],
        ],
        def: 'right',
      },
    ],
    run: (a, p) => wind(a, str(p, 'method', 'wind') as 'wind', str(p, 'direction', 'right') === 'left', 7),
    reach: () => Infinity,
    dialog: true,
    smart: true,
  },
  {
    id: 'mosaic',
    name: 'Mosaic',
    menu: 'Pixelate',
    params: [{ key: 'cell', label: 'Cell Size', type: 'number', min: 2, max: 200, def: 10, unit: 'square' }],
    run: (a, p, c) => mosaic(a, num(p, 'cell', 10), c.ox ?? 0, c.oy ?? 0),
    reach: (p) => Math.ceil(num(p, 'cell', 10)),
    dialog: true,
    smart: true,
  },
  {
    id: 'crystallize',
    name: 'Crystallize',
    menu: 'Pixelate',
    params: [{ key: 'cell', label: 'Cell Size', type: 'number', min: 3, max: 300, def: 10 }],
    run: (a, p, c) => crystallize(a, num(p, 'cell', 10), false, [1, 1, 1], c.ox ?? 0, c.oy ?? 0),
    reach: (p) => Math.ceil(num(p, 'cell', 10)) * 2,
    dialog: true,
    smart: true,
  },
  {
    id: 'pointillize',
    name: 'Pointillize',
    menu: 'Pixelate',
    params: [
      { key: 'cell', label: 'Cell Size', type: 'number', min: 3, max: 300, def: 6 },
      { key: 'bg', label: 'Background', type: 'color', def: [1, 1, 1] },
    ],
    run: (a, p, c) => crystallize(a, num(p, 'cell', 6), true, col(p, 'bg'), c.ox ?? 0, c.oy ?? 0),
    reach: (p) => Math.ceil(num(p, 'cell', 6)) * 2,
    dialog: true,
    smart: true,
  },
  {
    id: 'colorHalftone',
    name: 'Color Halftone',
    menu: 'Pixelate',
    params: [
      { key: 'radius', label: 'Max. Radius', type: 'number', min: 4, max: 127, def: 8, unit: 'px' },
      { key: 'c1', label: 'Channel 1 angle', type: 'number', min: 0, max: 360, def: 108, unit: '°' },
      { key: 'c2', label: 'Channel 2 angle', type: 'number', min: 0, max: 360, def: 162, unit: '°' },
      { key: 'c3', label: 'Channel 3 angle', type: 'number', min: 0, max: 360, def: 90, unit: '°' },
    ],
    run: (a, p, c) => colorHalftone(a, num(p, 'radius', 8), [num(p, 'c1', 108), num(p, 'c2', 162), num(p, 'c3', 90)], c.ox ?? 0, c.oy ?? 0),
    reach: (p) => Math.ceil(num(p, 'radius', 8)) * 3,
    dialog: true,
    smart: true,
  },
  {
    id: 'clouds',
    name: 'Clouds',
    menu: 'Render',
    params: [
      { key: 'fg', label: 'Foreground', type: 'color', def: [0, 0, 0] },
      { key: 'bg', label: 'Background', type: 'color', def: [1, 1, 1] },
      { key: 'seed', label: 'Variation', type: 'seed', def: 1 },
    ],
    run: (a, p, c) => clouds(a.w, a.h, col(p, 'fg', [0, 0, 0]), col(p, 'bg'), num(p, 'seed', 1), null, c.width, c.height, c.ox ?? 0, c.oy ?? 0),
    reach: () => 0,
    smart: true,
  },
  {
    id: 'differenceClouds',
    name: 'Difference Clouds',
    menu: 'Render',
    params: [
      { key: 'fg', label: 'Foreground', type: 'color', def: [0, 0, 0] },
      { key: 'bg', label: 'Background', type: 'color', def: [1, 1, 1] },
      { key: 'seed', label: 'Variation', type: 'seed', def: 1 },
    ],
    run: (a, p, c) => clouds(a.w, a.h, col(p, 'fg', [0, 0, 0]), col(p, 'bg'), num(p, 'seed', 1), a, c.width, c.height, c.ox ?? 0, c.oy ?? 0),
    reach: () => 0,
    smart: true,
  },
  {
    id: 'lighting',
    name: 'Lighting Effects',
    menu: 'Render',
    params: [
      {
        key: 'kind',
        label: 'Light',
        type: 'select',
        options: [
          ['spot', 'Spot'],
          ['point', 'Point'],
          ['infinite', 'Infinite'],
        ],
        def: 'spot',
      },
      { key: 'center', label: 'Position', type: 'point', def: [0.5, 0.45] },
      { key: 'color', label: 'Color', type: 'color', def: [1, 1, 1] },
      { key: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 100, def: 45 },
      { key: 'radius', label: 'Size', type: 'number', min: 5, max: 200, def: 60, unit: '%' },
      { key: 'angle', label: 'Angle', type: 'angle', def: 300 },
      { key: 'ambience', label: 'Ambience', type: 'number', min: 0, max: 100, def: 25, unit: '%' },
      { key: 'gloss', label: 'Gloss', type: 'number', min: 0, max: 100, def: 10 },
      { key: 'height', label: 'Texture Height', type: 'number', min: 0, max: 100, def: 0 },
    ],
    run: (a, p, c) => {
      const [u, v] = vec(p, 'center', [0.5, 0.45]);
      return lighting(a, str(p, 'kind', 'spot') as 'spot', col(p, 'color'), num(p, 'intensity', 45), num(p, 'ambience', 25), num(p, 'gloss', 10), u, v, num(p, 'radius', 60), num(p, 'angle', 300), num(p, 'height'), c.width, c.height, c.ox ?? 0, c.oy ?? 0);
    },
    reach: () => 2,
    dialog: true,
    smart: true,
  },
  {
    id: 'lensFlare',
    name: 'Lens Flare',
    menu: 'Render',
    params: [
      { key: 'center', label: 'Flare Center', type: 'point', def: [0.3, 0.3] },
      { key: 'brightness', label: 'Brightness', type: 'number', min: 10, max: 300, def: 100, unit: '%' },
    ],
    run: (a, p, c) => {
      const [u, v] = vec(p, 'center', [0.3, 0.3]);
      return lensFlare(a, u, v, num(p, 'brightness', 100), c.width, c.height, c.ox ?? 0, c.oy ?? 0);
    },
    reach: () => 0,
    dialog: true,
    smart: true,
  },
  {
    id: 'offset',
    name: 'Offset',
    menu: 'Other',
    params: [
      { key: 'dx', label: 'Horizontal', type: 'number', min: -30000, max: 30000, def: 0, unit: 'px' },
      { key: 'dy', label: 'Vertical', type: 'number', min: -30000, max: 30000, def: 0, unit: 'px' },
      {
        key: 'mode',
        label: 'Undefined Areas',
        type: 'select',
        options: [
          ['transparent', 'Set to Transparent'],
          ['repeat', 'Repeat Edge Pixels'],
          ['wrap', 'Wrap Around'],
        ],
        def: 'wrap',
      },
    ],
    run: (a, p) => offset(a, Math.round(num(p, 'dx')), Math.round(num(p, 'dy')), str(p, 'mode', 'wrap') as 'wrap'),
    reach: () => Infinity,
    dialog: true,
    smart: true,
  },
  {
    id: 'maximum',
    name: 'Maximum',
    menu: 'Other',
    params: [{ key: 'radius', label: 'Radius', type: 'number', min: 1, max: 500, def: 1, unit: 'px' }],
    run: (a, p) => maxMin(a, num(p, 'radius', 1), true),
    reach: (p) => Math.ceil(num(p, 'radius', 1)) + 1,
    dialog: true,
    smart: true,
  },
  {
    id: 'minimum',
    name: 'Minimum',
    menu: 'Other',
    params: [{ key: 'radius', label: 'Radius', type: 'number', min: 1, max: 500, def: 1, unit: 'px' }],
    run: (a, p) => maxMin(a, num(p, 'radius', 1), false),
    reach: (p) => Math.ceil(num(p, 'radius', 1)) + 1,
    dialog: true,
    smart: true,
  },
  {
    id: 'custom',
    name: 'Custom',
    menu: 'Other',
    params: [
      { key: 'center', label: 'Center weight', type: 'number', min: -999, max: 999, def: 5 },
      { key: 'ring', label: 'Neighbor weight', type: 'number', min: -999, max: 999, def: -1 },
      { key: 'scale', label: 'Scale', type: 'number', min: 1, max: 9999, def: 1 },
      { key: 'offset', label: 'Offset', type: 'number', min: -9999, max: 9999, def: 0 },
    ],
    run: (a, p) => {
      const k = new Array(25).fill(0) as number[];
      k[12] = num(p, 'center', 5);
      for (const i of [7, 11, 13, 17]) k[i] = num(p, 'ring', -1);
      return customKernel(a, k, num(p, 'scale', 1), num(p, 'offset'));
    },
    reach: () => 3,
    dialog: true,
    smart: true,
  },
];

export { bool };
