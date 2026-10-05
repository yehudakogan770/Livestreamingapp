// Mattes: for each spot of a clip's picture, how much of it is "in" (0–255).
// Here: growing or shrinking one, softening its edge, turning it inside out,
// packing it small for the disk, and picking a region by its color (the way
// "Select object" works when the AI model can't run).

/** A matte the shape of the clip's picture (rows from the top). */
export interface Matte {
  w: number;
  h: number;
  data: Uint8Array;
}

export interface MatteLook {
  /** Soft edge, in 1/1080ths of the picture's height. */
  feather: number;
  /** Grow (positive) or shrink (negative), in 1/1080ths of the picture's height. */
  expand: number;
  invert: boolean;
}

/** The biggest (or smallest) value in a sliding window along a line, in one pass. */
function slide(src: Uint8Array, dst: Uint8Array, start: number, stride: number, n: number, r: number, max: boolean) {
  const q = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const v = (i: number) => src[start + i * stride] as number;
  const better = (a: number, b: number) => (max ? a >= b : a <= b);
  let next = 0;
  for (let i = 0; i < n; i++) {
    // Bring in everything up to i + r.
    while (next <= Math.min(n - 1, i + r)) {
      while (tail > head && better(v(next), v(q[tail - 1] as number))) tail--;
      q[tail++] = next++;
    }
    while ((q[head] as number) < i - r) head++;
    dst[start + i * stride] = v(q[head] as number);
  }
}

/** Grow (max) or shrink (min) by a square of half-size r. */
function square(m: Matte, r: number, max: boolean): Matte {
  if (r <= 0) return m;
  const tmp = new Uint8Array(m.data.length);
  const out = new Uint8Array(m.data.length);
  for (let y = 0; y < m.h; y++) slide(m.data, tmp, y * m.w, 1, m.w, r, max);
  for (let x = 0; x < m.w; x++) slide(tmp, out, x, m.w, m.h, r, max);
  return { w: m.w, h: m.h, data: out };
}

/** Grow (max) or shrink (min) by a diamond of radius r (a plus shape, again and again). */
function diamond(m: Matte, r: number, max: boolean): Matte {
  let cur = m.data;
  const { w, h } = m;
  for (let k = 0; k < r; k++) {
    const out = new Uint8Array(cur.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let v = cur[i] as number;
        const take = (j: number) => {
          const o = cur[j] as number;
          if (max ? o > v : o < v) v = o;
        };
        if (x > 0) take(i - 1);
        if (x < w - 1) take(i + 1);
        if (y > 0) take(i - w);
        if (y < h - 1) take(i + w);
        out[i] = v;
      }
    cur = out;
  }
  return { w, h, data: cur };
}

/**
 * Grow (r > 0) or shrink (r < 0) the matte by about r pixels in every
 * direction: an octagon, close to round (a square then a diamond).
 */
export function expand(m: Matte, r: number): Matte {
  const a = Math.abs(r);
  if (a < 0.5) return m;
  const max = r > 0;
  return diamond(square(m, Math.round(a * 0.414), max), Math.round(a * 0.586), max);
}

/** A box blur along lines (running sums; the edges are held). */
function boxLines(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, across: boolean) {
  const n = across ? w : h;
  const lines = across ? h : w;
  const stride = across ? 1 : w;
  const span = 2 * r + 1;
  for (let l = 0; l < lines; l++) {
    const start = across ? l * w : l;
    const at = (i: number) => src[start + Math.max(0, Math.min(n - 1, i)) * stride] as number;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += at(i);
    for (let i = 0; i < n; i++) {
      dst[start + i * stride] = sum / span;
      sum += at(i + r + 1) - at(i - r);
    }
  }
}

/** Soften: three box blurs, close to a bell-shaped (Gaussian) blur with this spread (pixels). */
export function blur(m: Matte, sigma: number): Matte {
  if (sigma < 0.25) return m;
  // Three boxes of half-size r spread values by sqrt(r(r + 1)) (their variances add up).
  const r = Math.max(1, Math.round((Math.sqrt(1 + 4 * sigma * sigma) - 1) / 2));
  const a = Float32Array.from(m.data);
  const b = new Float32Array(a.length);
  for (let k = 0; k < 3; k++) {
    boxLines(a, b, m.w, m.h, r, true);
    boxLines(b, a, m.w, m.h, r, false);
  }
  const out = new Uint8Array(a.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(a[i] as number);
  return { w: m.w, h: m.h, data: out };
}

export function invert(m: Matte): Matte {
  const out = new Uint8Array(m.data.length);
  for (let i = 0; i < out.length; i++) out[i] = 255 - (m.data[i] as number);
  return { w: m.w, h: m.h, data: out };
}

/** Pixels of the matte for an amount in 1/1080ths of the picture's height. */
export const toMattePixels = (m: Matte, amount: number): number => (amount * m.h) / 1080;

/** The matte as the settings ask: grown or shrunk, softened, turned inside out. */
export function finish(m: Matte, look: MatteLook): Matte {
  let out = expand(m, toMattePixels(m, look.expand));
  // The soft edge spans about the feather amount: two spreads each way.
  out = blur(out, toMattePixels(m, look.feather) / 2);
  return look.invert ? invert(out) : out;
}

// ---------------------------------------------------------------------------
// Packing mattes for the disk: runs of the same value (mattes are mostly all
// in or all out, so they become very small).

export function pack(m: Matte): Uint8Array {
  const out: number[] = [];
  const d = m.data;
  let i = 0;
  while (i < d.length) {
    const v = d[i] as number;
    let n = 1;
    while (i + n < d.length && d[i + n] === v && n < 255) n++;
    out.push(n, v);
    i += n;
  }
  return Uint8Array.from(out);
}

export function unpack(bytes: Uint8Array, w: number, h: number): Matte | null {
  const data = new Uint8Array(w * h);
  let o = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const n = bytes[i] as number;
    if (o + n > data.length) return null;
    data.fill(bytes[i + 1] as number, o, o + n);
    o += n;
  }
  return o === data.length ? { w, h, data } : null;
}

// ---------------------------------------------------------------------------
// "Select object" without the AI model: the connected region whose color is
// close to the color where you clicked.

/** RGBA pixels → a matte of the region connected to (x, y) with a color within `tolerance` (0–100) of it there. */
export function floodSelect(rgba: ArrayLike<number>, w: number, h: number, x: number, y: number, tolerance: number): Matte {
  const data = new Uint8Array(w * h);
  const sx = Math.max(0, Math.min(w - 1, Math.round(x)));
  const sy = Math.max(0, Math.min(h - 1, Math.round(y)));
  // The color picked: an average of a few pixels around the click (one noisy pixel shouldn't decide).
  let r0 = 0;
  let g0 = 0;
  let b0 = 0;
  let n = 0;
  for (let j = -2; j <= 2; j++)
    for (let i = -2; i <= 2; i++) {
      const px = Math.max(0, Math.min(w - 1, sx + i));
      const py = Math.max(0, Math.min(h - 1, sy + j));
      const k = (py * w + px) * 4;
      r0 += rgba[k] as number;
      g0 += rgba[k + 1] as number;
      b0 += rgba[k + 2] as number;
      n++;
    }
  r0 /= n;
  g0 /= n;
  b0 /= n;
  const limit = (Math.max(1, Math.min(100, tolerance)) / 100) * 255;
  const near = (i: number) => {
    const k = i * 4;
    return Math.hypot((rgba[k] as number) - r0, (rgba[k + 1] as number) - g0, (rgba[k + 2] as number) - b0) <= limit;
  };
  const stack = [sy * w + sx];
  data[sy * w + sx] = 255;
  while (stack.length) {
    const i = stack.pop() as number;
    const px = i % w;
    const py = (i - px) / w;
    const visit = (j: number) => {
      if (data[j] === 0 && near(j)) {
        data[j] = 255;
        stack.push(j);
      }
    };
    if (px > 0) visit(i - 1);
    if (px < w - 1) visit(i + 1);
    if (py > 0) visit(i - w);
    if (py < h - 1) visit(i + w);
  }
  return { w, h, data };
}
