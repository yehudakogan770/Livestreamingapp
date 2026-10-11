// Content-aware filling: PatchMatch inpainting (Barnes et al.) solved coarse
// to fine with patch voting (Wexler et al.), as Content-Aware Fill, the Spot
// Healing Brush, the Remove tool and Content-Aware crop use; and the
// healing blend (a smooth membrane carrying the surroundings' color and light
// into copied pixels) the Healing Brush and Patch tool use.

import { Rand } from './brush';

export interface Field {
  w: number;
  h: number;
  /** RGB floats, 3 per pixel. */
  c: Float32Array;
}

const P = 3; // patch radius (7×7 patches)

function downsample(f: Field, hole: Uint8Array, valid: Uint8Array): { f: Field; hole: Uint8Array; valid: Uint8Array } {
  const w = Math.max(1, f.w >> 1),
    h = Math.max(1, f.h >> 1);
  const c = new Float32Array(w * h * 3);
  const nh = new Uint8Array(w * h),
    nv = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0,
        anyHole = 0,
        allValid = 1;
      let a0 = 0,
        a1 = 0,
        a2 = 0;
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 2; i++) {
          const xx = Math.min(f.w - 1, x * 2 + i),
            yy = Math.min(f.h - 1, y * 2 + j);
          const k = yy * f.w + xx;
          if (hole[k]) anyHole = 1;
          if (!valid[k]) allValid = 0;
          if (!hole[k] && valid[k]) {
            a0 += f.c[k * 3]!;
            a1 += f.c[k * 3 + 1]!;
            a2 += f.c[k * 3 + 2]!;
            n++;
          }
        }
      const o = y * w + x;
      nh[o] = anyHole;
      nv[o] = allValid && !anyHole ? 1 : 0;
      if (n) {
        c[o * 3] = a0 / n;
        c[o * 3 + 1] = a1 / n;
        c[o * 3 + 2] = a2 / n;
      }
    }
  return { f: { w, h, c }, hole: nh, valid: nv };
}

/** Fill hole pixels from the known ones by repeated averaging (a rough start for the coarsest level). */
function diffuse(f: Field, hole: Uint8Array): void {
  const known = new Uint8Array(f.w * f.h);
  for (let i = 0; i < known.length; i++) known[i] = hole[i] ? 0 : 1;
  for (let pass = 0; pass < f.w + f.h; pass++) {
    let changed = false;
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        if (known[i]) continue;
        let n = 0;
        const acc = [0, 0, 0];
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= f.w || yy >= f.h) continue;
          const j = yy * f.w + xx;
          if (known[j] !== 1) continue;
          for (let k = 0; k < 3; k++) acc[k]! += f.c[j * 3 + k]!;
          n++;
        }
        if (n) {
          for (let k = 0; k < 3; k++) f.c[i * 3 + k] = acc[k]! / n;
          known[i] = 2;
          changed = true;
        }
      }
    for (let i = 0; i < known.length; i++) if (known[i] === 2) known[i] = 1;
    if (!changed) break;
  }
}

function patchDist(f: Field, ax: number, ay: number, bx: number, by: number, best: number): number {
  let d = 0;
  const { w, h, c } = f;
  for (let j = -P; j <= P; j++) {
    const ya = Math.min(h - 1, Math.max(0, ay + j)),
      yb = Math.min(h - 1, Math.max(0, by + j));
    for (let i = -P; i <= P; i++) {
      const xa = Math.min(w - 1, Math.max(0, ax + i)),
        xb = Math.min(w - 1, Math.max(0, bx + i));
      const pa = (ya * w + xa) * 3,
        pb = (yb * w + xb) * 3;
      const r = c[pa]! - c[pb]!,
        g = c[pa + 1]! - c[pb + 1]!,
        b = c[pa + 2]! - c[pb + 2]!;
      d += r * r + g * g + b * b;
    }
    if (d >= best) return d;
  }
  return d;
}

/**
 * One level: PatchMatch the patches touching the hole to valid source
 * patches, then vote new colors for the hole. `nnf` holds the source center
 * for each pixel (x, y pairs), reused from the coarser level.
 */
function solveLevel(f: Field, hole: Uint8Array, valid: Uint8Array, nnf: Int32Array, iters: number, rand: Rand): void {
  const { w, h } = f;
  // Source centers: patches entirely in valid pixels.
  const sources: number[] = [];
  const okSrc = new Uint8Array(w * h);
  for (let y = P; y < h - P; y++)
    for (let x = P; x < w - P; x++) {
      let ok = true;
      for (let j = -P; j <= P && ok; j++) for (let i = -P; i <= P; i++) if (!valid[(y + j) * w + x + i]) { ok = false; break; }
      if (ok) {
        okSrc[y * w + x] = 1;
        sources.push(x, y);
      }
    }
  if (!sources.length) {
    // Too little context: keep the diffused colors.
    return;
  }
  // Targets: pixels whose patch overlaps the hole.
  const targets: number[] = [];
  const isT = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let t = false;
      for (let j = -P; j <= P && !t; j++)
        for (let i = -P; i <= P; i++) {
          const xx = x + i,
            yy = y + j;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && hole[yy * w + xx]) {
            t = true;
            break;
          }
        }
      if (t) {
        isT[y * w + x] = 1;
        targets.push(x, y);
      }
    }
  const dist = new Float32Array(w * h);
  const randomSource = (): [number, number] => {
    const k = Math.floor(rand.next() * (sources.length / 2)) * 2;
    return [sources[k]!, sources[k + 1]!];
  };
  for (let t = 0; t < targets.length; t += 2) {
    const x = targets[t]!,
      y = targets[t + 1]!;
    const i = y * w + x;
    let sx = nnf[i * 2]!,
      sy = nnf[i * 2 + 1]!;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h || !okSrc[sy * w + sx]) [sx, sy] = randomSource();
    nnf[i * 2] = sx;
    nnf[i * 2 + 1] = sy;
    dist[i] = patchDist(f, x, y, sx, sy, Infinity);
  }
  for (let it = 0; it < iters; it++) {
    // PatchMatch: propagate and search, alternating scan direction.
    for (let pass = 0; pass < 2; pass++) {
      const fwd = pass === 0;
      const dir = fwd ? -1 : 1;
      const order = fwd ? 1 : -1;
      const n = targets.length / 2;
      for (let q = 0; q < n; q++) {
        const tk = (order > 0 ? q : n - 1 - q) * 2;
        const x = targets[tk]!,
          y = targets[tk + 1]!;
        const i = y * w + x;
        let bx = nnf[i * 2]!,
          by = nnf[i * 2 + 1]!,
          bd = dist[i]!;
        // Propagation from the neighbor already visited.
        for (const [nx, ny] of [
          [x + dir, y],
          [x, y + dir],
        ] as const) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !isT[ny * w + nx]) continue;
          const j = ny * w + nx;
          const cx = nnf[j * 2]! - (nx - x),
            cy = nnf[j * 2 + 1]! - (ny - y);
          if (cx < 0 || cy < 0 || cx >= w || cy >= h || !okSrc[cy * w + cx]) continue;
          const d = patchDist(f, x, y, cx, cy, bd);
          if (d < bd) {
            bd = d;
            bx = cx;
            by = cy;
          }
        }
        // Random search around the best, shrinking.
        for (let r = Math.max(w, h); r >= 1; r = Math.floor(r / 2)) {
          const cx = Math.round(bx + (rand.next() * 2 - 1) * r),
            cy = Math.round(by + (rand.next() * 2 - 1) * r);
          if (cx < 0 || cy < 0 || cx >= w || cy >= h || !okSrc[cy * w + cx]) continue;
          const d = patchDist(f, x, y, cx, cy, bd);
          if (d < bd) {
            bd = d;
            bx = cx;
            by = cy;
          }
        }
        nnf[i * 2] = bx;
        nnf[i * 2 + 1] = by;
        dist[i] = bd;
      }
    }
    // Voting: each hole pixel takes the average of what the patches over it say.
    const acc = new Float32Array(w * h * 3);
    const wsum = new Float32Array(w * h);
    let sigma = 0,
      cnt = 0;
    for (let t = 0; t < targets.length; t += 2) {
      const i = targets[t + 1]! * w + targets[t]!;
      sigma += dist[i]!;
      cnt++;
    }
    sigma = Math.max(1e-6, (sigma / Math.max(1, cnt)) * 0.75);
    for (let t = 0; t < targets.length; t += 2) {
      const x = targets[t]!,
        y = targets[t + 1]!;
      const i = y * w + x;
      const sx = nnf[i * 2]!,
        sy = nnf[i * 2 + 1]!;
      const wt = Math.exp(-dist[i]! / (2 * sigma));
      for (let j = -P; j <= P; j++)
        for (let k = -P; k <= P; k++) {
          const tx = x + k,
            ty = y + j;
          if (tx < 0 || ty < 0 || tx >= w || ty >= h || !hole[ty * w + tx]) continue;
          const sxx = sx + k,
            syy = sy + j;
          const o = ty * w + tx,
            so = (syy * w + sxx) * 3;
          acc[o * 3]! += f.c[so]! * wt;
          acc[o * 3 + 1]! += f.c[so + 1]! * wt;
          acc[o * 3 + 2]! += f.c[so + 2]! * wt;
          wsum[o]! += wt;
        }
    }
    for (let o = 0; o < w * h; o++) {
      if (!hole[o] || wsum[o]! <= 0) continue;
      f.c[o * 3] = acc[o * 3]! / wsum[o]!;
      f.c[o * 3 + 1] = acc[o * 3 + 1]! / wsum[o]!;
      f.c[o * 3 + 2] = acc[o * 3 + 2]! / wsum[o]!;
    }
  }
}

/**
 * Fill the hole (mask 1) of a picture from the rest of it. `valid` marks
 * pixels that may be copied from (default: everything outside the hole).
 */
export function inpaint(f: Field, hole: Uint8Array, valid?: Uint8Array, seed = 7, progress?: (p: number) => void): Field {
  const rand = new Rand(seed);
  const v0 = valid ?? new Uint8Array(f.w * f.h).map((_, i) => (hole[i] ? 0 : 1));
  // Pyramid down until the hole is a few pixels across.
  const levels: { f: Field; hole: Uint8Array; valid: Uint8Array }[] = [{ f: { ...f, c: f.c.slice() }, hole, valid: v0 }];
  for (;;) {
    const top = levels[levels.length - 1]!;
    let holeCount = 0;
    for (const v of top.hole) holeCount += v;
    if (top.f.w < 32 || top.f.h < 32 || holeCount < 64) break;
    levels.push(downsample(top.f, top.hole, top.valid));
    if (levels.length > 10) break;
  }
  let nnf: Int32Array | null = null;
  for (let L = levels.length - 1; L >= 0; L--) {
    const lv = levels[L]!;
    const { w, h } = lv.f;
    if (L === levels.length - 1) diffuse(lv.f, lv.hole);
    const next = new Int32Array(w * h * 2).fill(-1);
    if (nnf) {
      // Upsample the coarser field and colors.
      const up = levels[L + 1]!;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const cx = Math.min(up.f.w - 1, x >> 1),
            cy = Math.min(up.f.h - 1, y >> 1);
          const ci = cy * up.f.w + cx;
          const i = y * w + x;
          if (nnf[ci * 2]! >= 0) {
            next[i * 2] = Math.min(w - 1, nnf[ci * 2]! * 2 + (x & 1));
            next[i * 2 + 1] = Math.min(h - 1, nnf[ci * 2 + 1]! * 2 + (y & 1));
          }
          if (lv.hole[i]) for (let k = 0; k < 3; k++) lv.f.c[i * 3 + k] = up.f.c[ci * 3 + k]!;
        }
    }
    const iters = L === 0 ? 3 : L === levels.length - 1 ? 8 : 5;
    solveLevel(lv.f, lv.hole, lv.valid, next, iters, rand);
    nnf = next;
    progress?.(1 - L / levels.length);
  }
  return levels[0]!.f;
}

/**
 * The healing blend: `src` pixels placed into the hole get the surroundings'
 * color and light — the difference (target − source) at the hole's edge is
 * spread smoothly over the inside (pull–push membrane, then relaxation).
 */
export function healBlend(target: Field, src: Field, hole: Uint8Array): Field {
  const { w, h } = target;
  const n = w * h;
  // Difference known on the hole's border (and outside it).
  const d = new Float32Array(n * 3);
  const known = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (hole[i]) continue;
    known[i] = 1;
    for (let k = 0; k < 3; k++) d[i * 3 + k] = target.c[i * 3 + k]! - src.c[i * 3 + k]!;
  }
  const filled = pullPush(d, known, w, h);
  // Relax (Laplace) a few times inside the hole for a smoother membrane.
  for (let it = 0; it < 40; it++) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!hole[i]) continue;
        for (let k = 0; k < 3; k++) {
          let s = 0,
            c = 0;
          if (x > 0) (s += filled[(i - 1) * 3 + k]!), c++;
          if (x < w - 1) (s += filled[(i + 1) * 3 + k]!), c++;
          if (y > 0) (s += filled[(i - w) * 3 + k]!), c++;
          if (y < h - 1) (s += filled[(i + w) * 3 + k]!), c++;
          filled[i * 3 + k] = s / c;
        }
      }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) out[i * 3 + k] = hole[i] ? Math.min(1, Math.max(0, src.c[i * 3 + k]! + filled[i * 3 + k]!)) : target.c[i * 3 + k]!;
  return { w, h, c: out };
}

/** Pull–push interpolation: values where `known` > 0 spread smoothly everywhere else. */
export function pullPush(v: Float32Array, known: Float32Array, w: number, h: number): Float32Array {
  if (w <= 1 && h <= 1) return v.slice();
  const cw = Math.max(1, (w + 1) >> 1),
    ch = Math.max(1, (h + 1) >> 1);
  const cv = new Float32Array(cw * ch * 3),
    ck = new Float32Array(cw * ch);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const k = known[i]!;
      if (k <= 0) continue;
      const o = (y >> 1) * cw + (x >> 1);
      ck[o]! += k;
      for (let c = 0; c < 3; c++) cv[o * 3 + c]! += v[i * 3 + c]! * k;
    }
  for (let o = 0; o < cw * ch; o++) if (ck[o]! > 0) for (let c = 0; c < 3; c++) cv[o * 3 + c] = cv[o * 3 + c]! / ck[o]!;
  for (let o = 0; o < cw * ch; o++) ck[o] = Math.min(1, ck[o]!);
  const coarse = cw === w && ch === h ? cv : pullPush(cv, ck, cw, ch);
  const out = v.slice();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const k = Math.min(1, known[i]!);
      if (k >= 1) continue;
      // Bilinear from the coarser level.
      const fx = (x + 0.5) / 2 - 0.5,
        fy = (y + 0.5) / 2 - 0.5;
      const x0 = Math.max(0, Math.min(cw - 1, Math.floor(fx))),
        y0 = Math.max(0, Math.min(ch - 1, Math.floor(fy)));
      const x1 = Math.min(cw - 1, x0 + 1),
        y1 = Math.min(ch - 1, y0 + 1);
      const tx = Math.min(1, Math.max(0, fx - x0)),
        ty = Math.min(1, Math.max(0, fy - y0));
      for (let c = 0; c < 3; c++) {
        const a = coarse[(y0 * cw + x0) * 3 + c]! * (1 - tx) + coarse[(y0 * cw + x1) * 3 + c]! * tx;
        const b = coarse[(y1 * cw + x0) * 3 + c]! * (1 - tx) + coarse[(y1 * cw + x1) * 3 + c]! * tx;
        out[i * 3 + c] = v[i * 3 + c]! * k + (a * (1 - ty) + b * ty) * (1 - k);
      }
    }
  return out;
}
