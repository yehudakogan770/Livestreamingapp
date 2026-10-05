// The arithmetic of motion tracking, on small gray pictures: picture pyramids,
// the Lucas–Kanade step (where did this patch go?), how alike two patches are
// (normalized cross-correlation), good spots to follow, and the best fit of a
// move + size + turn to points that moved. No browser needed (tests run it).

/** A gray picture: one number per pixel (0–255), rows from the top. */
export interface Gray {
  w: number;
  h: number;
  data: Float32Array;
}

export const gray = (w: number, h: number, data?: ArrayLike<number>): Gray => ({ w, h, data: data ? Float32Array.from(data) : new Float32Array(w * h) });

/** Gray from RGBA pixels (as a canvas gives them). */
export function grayFromRgba(rgba: ArrayLike<number>, w: number, h: number): Gray {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = 0.299 * (rgba[i * 4] as number) + 0.587 * (rgba[i * 4 + 1] as number) + 0.114 * (rgba[i * 4 + 2] as number);
  return { w, h, data: out };
}

/** The value between pixels (pixel centers are whole numbers; outside: the nearest edge). */
export function sample(g: Gray, x: number, y: number): number {
  const xi = Math.max(0, Math.min(g.w - 1, x));
  const yi = Math.max(0, Math.min(g.h - 1, y));
  const x0 = Math.min(g.w - 2, Math.floor(xi));
  const y0 = Math.min(g.h - 2, Math.floor(yi));
  const fx = xi - x0;
  const fy = yi - y0;
  const d = g.data;
  const i = y0 * g.w + x0;
  const a = (d[i] as number) + ((d[i + 1] as number) - (d[i] as number)) * fx;
  const b = (d[i + g.w] as number) + ((d[i + g.w + 1] as number) - (d[i + g.w] as number)) * fx;
  return a + (b - a) * fy;
}

/** Half the size, softened first (the next level of a pyramid). */
export function half(g: Gray): Gray {
  const w = Math.max(1, g.w >> 1);
  const h = Math.max(1, g.h >> 1);
  const out = new Float32Array(w * h);
  const at = (x: number, y: number) => g.data[Math.min(g.h - 1, Math.max(0, y)) * g.w + Math.min(g.w - 1, Math.max(0, x))] as number;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = x * 2;
      const sy = y * 2;
      // A small 4×4 tent filter around the four pixels that make this one.
      let s = 0;
      for (let j = -1; j <= 2; j++) {
        const wy = j === -1 || j === 2 ? 1 : 3;
        for (let i = -1; i <= 2; i++) s += at(sx + i, sy + j) * wy * (i === -1 || i === 2 ? 1 : 3);
      }
      out[y * w + x] = s / 64;
    }
  return { w, h, data: out };
}

/** The picture at full size, half, quarter… (as many levels as asked, while it stays big enough). */
export function pyramid(g: Gray, levels: number): Gray[] {
  const out = [g];
  while (out.length < levels) {
    const last = out[out.length - 1] as Gray;
    if (last.w < 24 || last.h < 24) break;
    out.push(half(last));
  }
  return out;
}

export interface Flow {
  /** Where the point went. */
  x: number;
  y: number;
  /** It could be followed (enough detail, stayed in the picture, settled). */
  ok: boolean;
  /** The smaller eigenvalue of the patch's structure (low: a flat patch, can't be followed). */
  detail: number;
}

/**
 * Pyramidal Lucas–Kanade: where the patch around (x, y) in `a` went in `b`,
 * starting from a guess. `r` is the patch's half-size in pixels.
 */
export function lucasKanade(pa: Gray[], pb: Gray[], x: number, y: number, r = 7, guess: [number, number] = [x, y], iters = 30): Flow {
  const levels = Math.min(pa.length, pb.length);
  // The guessed move, at the top level.
  let gx = (guess[0] - x) / 2 ** (levels - 1);
  let gy = (guess[1] - y) / 2 ** (levels - 1);
  let detail = 0;
  let ok = true;
  for (let L = levels - 1; L >= 0; L--) {
    const A = pa[L] as Gray;
    const B = pb[L] as Gray;
    const k = 2 ** L;
    const px = x / k;
    const py = y / k;
    // The patch's gradients and structure (once per level).
    const n = (2 * r + 1) ** 2;
    const ix = new Float32Array(n);
    const iy = new Float32Array(n);
    const iv = new Float32Array(n);
    let gxx = 0;
    let gxy = 0;
    let gyy = 0;
    let m = 0;
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) {
        const sx = px + i;
        const sy = py + j;
        const dx = (sample(A, sx + 1, sy) - sample(A, sx - 1, sy)) / 2;
        const dy = (sample(A, sx, sy + 1) - sample(A, sx, sy - 1)) / 2;
        ix[m] = dx;
        iy[m] = dy;
        iv[m] = sample(A, sx, sy);
        gxx += dx * dx;
        gxy += dx * dy;
        gyy += dy * dy;
        m++;
      }
    const det = gxx * gyy - gxy * gxy;
    const tr = gxx + gyy;
    const minEig = (tr - Math.sqrt(Math.max(0, tr * tr - 4 * det))) / 2 / n;
    if (L === 0) detail = minEig;
    if (det < 1e-6) {
      ok = false;
      gx *= 2;
      gy *= 2;
      continue;
    }
    let dx = 0;
    let dy = 0;
    for (let it = 0; it < iters; it++) {
      let bx = 0;
      let by = 0;
      m = 0;
      for (let j = -r; j <= r; j++)
        for (let i = -r; i <= r; i++) {
          const diff = (iv[m] as number) - sample(B, px + i + gx + dx, py + j + gy + dy);
          bx += diff * (ix[m] as number);
          by += diff * (iy[m] as number);
          m++;
        }
      const sx = (gyy * bx - gxy * by) / det;
      const sy = (gxx * by - gxy * bx) / det;
      dx += sx;
      dy += sy;
      if (sx * sx + sy * sy < 1e-4) break;
    }
    if (L > 0) {
      gx = 2 * (gx + dx);
      gy = 2 * (gy + dy);
    } else {
      gx += dx;
      gy += dy;
    }
  }
  const nx = x + gx;
  const ny = y + gy;
  const g0 = pb[0] as Gray;
  if (nx < 0 || ny < 0 || nx > g0.w - 1 || ny > g0.h - 1 || !Number.isFinite(nx) || !Number.isFinite(ny)) ok = false;
  return { x: nx, y: ny, ok, detail };
}

/** The patch around a point (2r + 1 square), read between pixels. */
export function patch(g: Gray, x: number, y: number, r: number): Float32Array {
  const out = new Float32Array((2 * r + 1) ** 2);
  let m = 0;
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) out[m++] = sample(g, x + i, y + j);
  return out;
}

/** How alike two patches are, ignoring brightness and contrast: 1 the same, 0 unrelated, -1 opposite. */
export function ncc(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i] as number;
    mb += b[i] as number;
  }
  ma /= n;
  mb /= n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const x = (a[i] as number) - ma;
    const y = (b[i] as number) - mb;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  if (aa < 1e-6 || bb < 1e-6) return aa < 1e-6 && bb < 1e-6 ? 1 : 0;
  return ab / Math.sqrt(aa * bb);
}

/**
 * Search near a guess for where a template matches best (whole pixels, then
 * a parabola between neighbors for a part of a pixel). For moves too big or
 * too odd for Lucas–Kanade.
 */
export function matchTemplate(g: Gray, tpl: Float32Array, r: number, x: number, y: number, search: number, step = 1): { x: number; y: number; score: number } {
  let best = { x, y, score: -2 };
  const scores = new Map<string, number>();
  const at = (cx: number, cy: number) => {
    const k = `${cx},${cy}`;
    let s = scores.get(k);
    if (s === undefined) {
      s = ncc(tpl, patch(g, cx, cy, r));
      scores.set(k, s);
    }
    return s;
  };
  for (let j = -search; j <= search; j += step)
    for (let i = -search; i <= search; i += step) {
      const s = at(x + i, y + j);
      if (s > best.score) best = { x: x + i, y: y + j, score: s };
    }
  if (step > 1) {
    const fine = matchTemplate(g, tpl, r, best.x, best.y, step, 1);
    return fine.score >= best.score ? fine : best;
  }
  // A part of a pixel: the top of a parabola through the neighbors.
  const peak = (m: number, c: number, p: number) => {
    const d = m - 2 * c + p;
    return Math.abs(d) < 1e-9 ? 0 : Math.max(-0.5, Math.min(0.5, (m - p) / (2 * d)));
  };
  const c = best.score;
  return {
    x: best.x + peak(at(best.x - 1, best.y), c, at(best.x + 1, best.y)),
    y: best.y + peak(at(best.x, best.y - 1), c, at(best.x, best.y + 1)),
    score: c,
  };
}

/** Spots with detail in every direction (corners), best first, kept apart from each other. */
export function goodFeatures(g: Gray, inside: (x: number, y: number) => boolean, max = 40, minDist = 6, r = 2): [number, number][] {
  const found: [number, number, number][] = [];
  const w = g.w;
  const d = g.data;
  const edge = r + 2;
  for (let y = edge; y < g.h - edge; y += 2)
    for (let x = edge; x < w - edge; x += 2) {
      if (!inside(x, y)) continue;
      let gxx = 0;
      let gxy = 0;
      let gyy = 0;
      for (let j = -r; j <= r; j++)
        for (let i = -r; i <= r; i++) {
          const k = (y + j) * w + x + i;
          const dx = ((d[k + 1] as number) - (d[k - 1] as number)) / 2;
          const dy = ((d[k + w] as number) - (d[k - w] as number)) / 2;
          gxx += dx * dx;
          gxy += dx * dy;
          gyy += dy * dy;
        }
      const tr = gxx + gyy;
      const det = gxx * gyy - gxy * gxy;
      const minEig = (tr - Math.sqrt(Math.max(0, tr * tr - 4 * det))) / 2;
      if (minEig > 1) found.push([x, y, minEig]);
    }
  found.sort((a, b) => b[2] - a[2]);
  const top = found[0]?.[2] ?? 0;
  const out: [number, number][] = [];
  for (const [x, y, s] of found) {
    if (s < top * 0.02) break;
    if (out.some(([ox, oy]) => (ox - x) ** 2 + (oy - y) ** 2 < minDist * minDist)) continue;
    out.push([x, y]);
    if (out.length >= max) break;
  }
  return out;
}

/** A move + size + turn: x' = a·x − b·y + tx, y' = b·x + a·y + ty. */
export interface Similarity {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

export const applySim = (s: Similarity, x: number, y: number): [number, number] => [s.a * x - s.b * y + s.tx, s.b * x + s.a * y + s.ty];
export const simScale = (s: Similarity): number => Math.hypot(s.a, s.b);
/** Degrees (positive: clockwise on screen, where down is positive). */
export const simAngle = (s: Similarity): number => (Math.atan2(s.b, s.a) * 180) / Math.PI;

/** The move + size + turn that best takes points `from` to `to` (least squares; null with fewer than 2 points). */
export function fitSimilarity(from: [number, number][], to: [number, number][], weights?: number[]): Similarity | null {
  const n = Math.min(from.length, to.length);
  let sw = 0;
  let fx = 0;
  let fy = 0;
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < n; i++) {
    const w = weights ? (weights[i] as number) : 1;
    if (w <= 0) continue;
    const f = from[i] as [number, number];
    const t = to[i] as [number, number];
    sw += w;
    fx += w * f[0];
    fy += w * f[1];
    tx += w * t[0];
    ty += w * t[1];
  }
  if (sw <= 0) return null;
  fx /= sw;
  fy /= sw;
  tx /= sw;
  ty /= sw;
  let sxx = 0;
  let a = 0;
  let b = 0;
  let used = 0;
  for (let i = 0; i < n; i++) {
    const w = weights ? (weights[i] as number) : 1;
    if (w <= 0) continue;
    used++;
    const f = from[i] as [number, number];
    const t = to[i] as [number, number];
    const x = f[0] - fx;
    const y = f[1] - fy;
    const u = t[0] - tx;
    const v = t[1] - ty;
    sxx += w * (x * x + y * y);
    a += w * (x * u + y * v);
    b += w * (x * v - y * u);
  }
  if (used < 2 || sxx < 1e-9) return null;
  a /= sxx;
  b /= sxx;
  // The centers line up: t = A·f + T.
  return { a, b, tx: tx - (a * fx - b * fy), ty: ty - (b * fx + a * fy) };
}

/** A fit that ignores points that don't agree with the rest (things passing in front, lost spots). */
export function robustSimilarity(from: [number, number][], to: [number, number][]): { sim: Similarity; inliers: boolean[] } | null {
  let weights = from.map(() => 1);
  let sim = fitSimilarity(from, to, weights);
  if (!sim) return null;
  for (let round = 0; round < 3; round++) {
    const s = sim;
    const res = from.map(([x, y], i) => {
      const [px, py] = applySim(s, x, y);
      const t = to[i] as [number, number];
      return Math.hypot(px - t[0], py - t[1]);
    });
    const sorted = [...res].sort((p, q) => p - q);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const limit = Math.max(0.75, median * 2.5);
    weights = res.map((r) => (r <= limit ? 1 : 0));
    const next = fitSimilarity(from, to, weights);
    if (!next) break;
    sim = next;
  }
  return { sim, inliers: weights.map((w) => w > 0) };
}

/**
 * Line a whole region up exactly (Gauss–Newton on a move + size + turn): the
 * region's look is `tpl` at spots `pts` (in the region's own terms); `sim`
 * takes those spots into `img`. Gives the improved fit and how alike they are.
 */
export function alignSimilarity(img: Gray, pts: [number, number][], tpl: Float32Array, sim: Similarity, iters = 12): { sim: Similarity; score: number } {
  let s = { ...sim };
  const n = pts.length;
  const cur = new Float32Array(n);
  for (let it = 0; it < iters; it++) {
    // The normal equations of the four numbers.
    const H = new Float64Array(16);
    const g = new Float64Array(4);
    for (let i = 0; i < n; i++) {
      const [px, py] = pts[i] as [number, number];
      const [x, y] = applySim(s, px, py);
      const ix = (sample(img, x + 1, y) - sample(img, x - 1, y)) / 2;
      const iy = (sample(img, x, y + 1) - sample(img, x, y - 1)) / 2;
      const j = [ix * px + iy * py, -ix * py + iy * px, ix, iy];
      const r = (tpl[i] as number) - sample(img, x, y);
      for (let a = 0; a < 4; a++) {
        g[a] = (g[a] as number) + (j[a] as number) * r;
        for (let b = 0; b < 4; b++) H[a * 4 + b] = (H[a * 4 + b] as number) + (j[a] as number) * (j[b] as number);
      }
    }
    const d = solve4(H, g);
    if (!d) break;
    s = { a: s.a + (d[0] as number), b: s.b + (d[1] as number), tx: s.tx + (d[2] as number), ty: s.ty + (d[3] as number) };
    if (Math.abs(d[2] as number) + Math.abs(d[3] as number) < 1e-3 && Math.abs(d[0] as number) + Math.abs(d[1] as number) < 1e-5) break;
  }
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[i] as [number, number];
    const [x, y] = applySim(s, px, py);
    cur[i] = sample(img, x, y);
  }
  return { sim: s, score: ncc(tpl, cur) };
}

/** Solve a 4 × 4 system (Gaussian elimination); null when it has no single answer. */
function solve4(H: Float64Array, g: Float64Array): number[] | null {
  const m = [0, 1, 2, 3].map((r) => [H[r * 4] as number, H[r * 4 + 1] as number, H[r * 4 + 2] as number, H[r * 4 + 3] as number, g[r] as number]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    if (Math.abs(m[p]![c]!) < 1e-12) return null;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const k = m[r]![c]! / m[c]![c]!;
      for (let q = c; q < 5; q++) m[r]![q] = m[r]![q]! - k * m[c]![q]!;
    }
  }
  return m.map((row, i) => row[4]! / row[i]!);
}
