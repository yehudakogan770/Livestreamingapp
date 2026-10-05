// Color tools that are worked out once, not per pixel: curves and LUT files.

export type CurvePoints = [number, number][];

/** A smooth curve through the points (monotone, so it never overshoots), as 256 steps. */
export function curveTable(points: CurvePoints): Float32Array {
  const pts = [...points].filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  const out = new Float32Array(256);
  if (pts.length < 2) {
    for (let i = 0; i < 256; i++) out[i] = i / 255;
    return out;
  }
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push(((ys[i + 1] as number) - (ys[i] as number)) / Math.max(1e-6, (xs[i + 1] as number) - (xs[i] as number)));
  m.push(d[0] as number);
  for (let i = 1; i < n - 1; i++) {
    const a = d[i - 1] as number;
    const b = d[i] as number;
    m.push(a * b <= 0 ? 0 : (a + b) / 2);
  }
  m.push(d[n - 2] as number);
  for (let i = 0; i < n - 1; i++) {
    const di = d[i] as number;
    if (di === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = (m[i] as number) / di;
    const b = (m[i + 1] as number) / di;
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * di;
      m[i + 1] = t * b * di;
    }
  }
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let k = 0;
    while (k < n - 2 && x > (xs[k + 1] as number)) k++;
    const x0 = xs[k] as number;
    const x1 = xs[k + 1] as number;
    if (x <= x0) {
      out[i] = ys[0] as number;
      continue;
    }
    if (x >= (xs[n - 1] as number)) {
      out[i] = ys[n - 1] as number;
      continue;
    }
    const h = x1 - x0;
    const t = (x - x0) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    out[i] =
      (2 * t3 - 3 * t2 + 1) * (ys[k] as number) +
      (t3 - 2 * t2 + t) * h * (m[k] as number) +
      (-2 * t3 + 3 * t2) * (ys[k + 1] as number) +
      (t3 - t2) * h * (m[k + 1] as number);
    out[i] = Math.max(0, Math.min(1, out[i] as number));
  }
  return out;
}

export interface CurveSet {
  master: CurvePoints;
  r: CurvePoints;
  g: CurvePoints;
  b: CurvePoints;
}

/** The curves as one 256×1 picture: each color through its own curve after the master one. */
export function curvesImage(c: CurveSet): Uint8Array {
  const master = curveTable(c.master);
  const r = curveTable(c.r);
  const g = curveTable(c.g);
  const b = curveTable(c.b);
  const look = (t: Float32Array, x: number) => t[Math.round(Math.max(0, Math.min(1, x)) * 255)] as number;
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const m = master[i] as number;
    out[i * 4] = Math.round(look(r, m) * 255);
    out[i * 4 + 1] = Math.round(look(g, m) * 255);
    out[i * 4 + 2] = Math.round(look(b, m) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

export const flatCurve = (p: CurvePoints): boolean => p.length === 2 && p[0]?.[0] === 0 && p[0]?.[1] === 0 && p[1]?.[0] === 1 && p[1]?.[1] === 1;

export interface Cube {
  size: number;
  /** r fastest, then g, then b (as .cube files list them), RGB 0–1. */
  data: Float32Array;
  title: string;
}

/** Read a .cube LUT file (the kind cameras and colorists share). */
export function parseCube(text: string): Cube {
  let size = 0;
  let title = '';
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = (parts[0] ?? '').toUpperCase();
    if (key === 'TITLE') title = line.slice(5).trim().replace(/^"|"$/g, '');
    else if (key === 'LUT_3D_SIZE') size = Number(parts[1]);
    else if (key === 'LUT_1D_SIZE') throw new Error('This is a 1D LUT. Lumora Edit uses 3D LUTs (.cube with LUT_3D_SIZE).');
    else if (key === 'DOMAIN_MIN') min = parts.slice(1, 4).map(Number);
    else if (key === 'DOMAIN_MAX') max = parts.slice(1, 4).map(Number);
    else if (/^[-+.\d]/.test(key)) for (const v of parts.slice(0, 3)) values.push(Number(v));
  }
  if (!size || size < 2 || size > 128) throw new Error('This LUT file could not be read (no LUT_3D_SIZE).');
  if (values.length < size * size * size * 3) throw new Error('This LUT file is incomplete.');
  const data = new Float32Array(size * size * size * 3);
  for (let i = 0; i < data.length; i++) {
    const c = i % 3;
    const lo = min[c] ?? 0;
    const hi = max[c] ?? 1;
    data[i] = ((values[i] as number) - lo) / (hi - lo || 1);
  }
  return { size, data, title };
}

/** A color wheel's puck (x, y in -1…1) as a red/green/blue push that adds up to nothing. */
export function wheelColor(x: number, y: number): [number, number, number] {
  const angle = Math.atan2(y, x);
  const amount = Math.min(1, Math.hypot(x, y));
  // Red at 0°, green at 120°, blue at 240°: the push toward the puck's color, with the average taken away.
  const r = Math.cos(angle);
  const g = Math.cos(angle - (2 * Math.PI) / 3);
  const b = Math.cos(angle + (2 * Math.PI) / 3);
  return [r * amount, g * amount, b * amount];
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1] as string, 16) / 255, parseInt(m[2] as string, 16) / 255, parseInt(m[3] as string, 16) / 255];
}
