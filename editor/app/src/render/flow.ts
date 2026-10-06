// Optical flow for slow motion: where each part of one frame has moved to in
// the next. Worked out on small gray copies of the two frames (a pyramid,
// coarse to fine: block matching with a sub-pixel fit, then a median to tidy
// it), and used by the GPU to warp both frames to the moment between them.

/** A gray picture (0–1), row by row. */
export interface Gray {
  w: number;
  h: number;
  data: Float32Array;
}

/** Motion from frame A to frame B, in pixels of the picture it was worked out on (dx, dy per pixel). */
export interface Flow {
  w: number;
  h: number;
  data: Float32Array;
}

export interface FlowOptions {
  /** Half the matched patch's size. */
  patch?: number;
  /** How far each level looks around its guess. */
  search?: number;
  /** Pyramid levels (each half the size of the one above). */
  levels?: number;
}

/** Gray from RGBA bytes. */
export function toGray(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Gray {
  const data = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = (0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!) / 255;
  return { w, h, data };
}

function half(g: Gray): Gray {
  const w = Math.max(1, g.w >> 1);
  const h = Math.max(1, g.h >> 1);
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(g.w - 1, x * 2);
      const y0 = Math.min(g.h - 1, y * 2);
      const x1 = Math.min(g.w - 1, x0 + 1);
      const y1 = Math.min(g.h - 1, y0 + 1);
      data[y * w + x] = (g.data[y0 * g.w + x0]! + g.data[y0 * g.w + x1]! + g.data[y1 * g.w + x0]! + g.data[y1 * g.w + x1]!) / 4;
    }
  return { w, h, data };
}

/** Bilinear read, edges held. */
export function sample(g: Gray, x: number, y: number): number {
  const cx = Math.max(0, Math.min(g.w - 1, x));
  const cy = Math.max(0, Math.min(g.h - 1, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(g.w - 1, x0 + 1);
  const y1 = Math.min(g.h - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const d = g.data;
  const a = d[y0 * g.w + x0]! * (1 - fx) + d[y0 * g.w + x1]! * fx;
  const b = d[y1 * g.w + x0]! * (1 - fx) + d[y1 * g.w + x1]! * fx;
  return a * (1 - fy) + b * fy;
}

const px = (g: Gray, x: number, y: number): number => g.data[Math.max(0, Math.min(g.h - 1, y)) * g.w + Math.max(0, Math.min(g.w - 1, x))]!;

function cost(a: Gray, b: Gray, x: number, y: number, dx: number, dy: number, r: number): number {
  let s = 0;
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) s += Math.abs(px(a, x + i, y + j) - px(b, x + i + dx, y + j + dy));
  return s;
}

function median3(f: Flow): Flow {
  const out = new Float32Array(f.data.length);
  const vx: number[] = [];
  const vy: number[] = [];
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      vx.length = 0;
      vy.length = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const xx = Math.max(0, Math.min(f.w - 1, x + i));
          const yy = Math.max(0, Math.min(f.h - 1, y + j));
          vx.push(f.data[(yy * f.w + xx) * 2]!);
          vy.push(f.data[(yy * f.w + xx) * 2 + 1]!);
        }
      vx.sort((p, q) => p - q);
      vy.sort((p, q) => p - q);
      out[(y * f.w + x) * 2] = vx[4]!;
      out[(y * f.w + x) * 2 + 1] = vy[4]!;
    }
  return { w: f.w, h: f.h, data: out };
}

/** A flow made twice the size (and its motion doubled), for the next level. */
function up(f: Flow, w: number, h: number): Flow {
  const data = new Float32Array(w * h * 2);
  const sx = f.w / w;
  const sy = f.h / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const fx = Math.min(f.w - 1, Math.floor(x * sx));
      const fy = Math.min(f.h - 1, Math.floor(y * sy));
      data[(y * w + x) * 2] = f.data[(fy * f.w + fx) * 2]! / sx;
      data[(y * w + x) * 2 + 1] = f.data[(fy * f.w + fx) * 2 + 1]! / sy;
    }
  return { w, h, data };
}

/** The motion from A to B: a point at (x, y) in A is at (x + dx, y + dy) in B. */
export function opticalFlow(a: Gray, b: Gray, o: FlowOptions = {}): Flow {
  const r = o.patch ?? 3;
  const search = o.search ?? 2;
  const pa: Gray[] = [a];
  const pb: Gray[] = [b];
  const levels = o.levels ?? 3;
  while (pa.length < levels && (pa[pa.length - 1] as Gray).w >= 32 && (pa[pa.length - 1] as Gray).h >= 24) {
    pa.push(half(pa[pa.length - 1] as Gray));
    pb.push(half(pb[pb.length - 1] as Gray));
  }
  let flow: Flow | null = null;
  for (let l = pa.length - 1; l >= 0; l--) {
    const A = pa[l] as Gray;
    const B = pb[l] as Gray;
    const guess: Flow = flow ? up(flow, A.w, A.h) : { w: A.w, h: A.h, data: new Float32Array(A.w * A.h * 2) };
    const out = new Float32Array(A.w * A.h * 2);
    // A little preference for the guess, so flat areas don't wander.
    const bias = 0.004 * (2 * r + 1) ** 2;
    for (let y = 0; y < A.h; y++)
      for (let x = 0; x < A.w; x++) {
        const gx = Math.round(guess.data[(y * A.w + x) * 2]!);
        const gy = Math.round(guess.data[(y * A.w + x) * 2 + 1]!);
        let best = Infinity;
        let bx = gx;
        let by = gy;
        for (let dy = gy - search; dy <= gy + search; dy++)
          for (let dx = gx - search; dx <= gx + search; dx++) {
            const c = cost(A, B, x, y, dx, dy, r) + bias * (Math.abs(dx - gx) + Math.abs(dy - gy));
            if (c < best) {
              best = c;
              bx = dx;
              by = dy;
            }
          }
        // Sub-pixel: a parabola through the costs either side.
        const fit = (m: number, c0: number, p: number) => {
          const d = m - 2 * c0 + p;
          return d > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (m - p)) / d)) : 0;
        };
        const c0 = cost(A, B, x, y, bx, by, r);
        const sx = fit(cost(A, B, x, y, bx - 1, by, r), c0, cost(A, B, x, y, bx + 1, by, r));
        const sy = fit(cost(A, B, x, y, bx, by - 1, r), c0, cost(A, B, x, y, bx, by + 1, r));
        out[(y * A.w + x) * 2] = bx + sx;
        out[(y * A.w + x) * 2 + 1] = by + sy;
      }
    flow = median3({ w: A.w, h: A.h, data: out });
  }
  return flow as Flow;
}

/**
 * The picture at `t` (0 = A, 1 = B) between two frames, warped along the flow (what the GPU program does):
 * A looked up where the point came from, B where it is going, mixed by how near each is.
 */
export function interpolate(a: Gray, b: Gray, f: Flow, t: number): Gray {
  const data = new Float32Array(a.w * a.h);
  const sx = f.w / a.w;
  const sy = f.h / a.h;
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const fx = Math.min(f.w - 1, Math.floor(x * sx));
      const fy = Math.min(f.h - 1, Math.floor(y * sy));
      const dx = f.data[(fy * f.w + fx) * 2]! / sx;
      const dy = f.data[(fy * f.w + fx) * 2 + 1]! / sy;
      data[y * a.w + x] = sample(a, x - t * dx, y - t * dy) * (1 - t) + sample(b, x + (1 - t) * dx, y + (1 - t) * dy) * t;
    }
  return { w: a.w, h: a.h, data };
}

/** The small size flow is worked out at for a picture (about 128 across). */
export function flowSize(w: number, h: number, across = 128): [number, number] {
  const k = Math.min(1, across / Math.max(1, w));
  return [Math.max(8, Math.round(w * k)), Math.max(8, Math.round(h * k))];
}
