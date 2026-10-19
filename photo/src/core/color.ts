// Color: the document's RGB space (sRGB, Display P3, Adobe RGB, or a matrix
// profile read from a file's embedded ICC), conversions between spaces
// through XYZ (D50, as ICC does), ICC profiles read and written (v2, matrix
// and tone curves), and the HSL / HSB / Lab helpers the tools use.

export type Mat3 = [number, number, number, number, number, number, number, number, number];

export type ToneCurve =
  | { type: 'srgb' }
  | { type: 'gamma'; g: number }
  | { type: 'linear' }
  /** ICC parametric curve (types 0..4: g, a, b, c, d, e, f). */
  | { type: 'para'; fn: number; p: number[] }
  | { type: 'table'; t: number[] };

export interface ColorProfile {
  /** A short id: 'srgb' | 'p3' | 'adobergb' | 'custom'. */
  id: string;
  name: string;
  /** RGB → XYZ (D50), columns are the primaries. */
  toXYZ: Mat3;
  trc: ToneCurve;
  /** The profile as read from a file (kept so it can be embedded again). */
  icc?: Uint8Array;
}

const D50: [number, number, number] = [0.9642, 1.0, 0.8249];
const D65: [number, number, number] = [0.95047, 1.0, 1.08883];

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
  return r;
}

export function inv3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

export function apply3(m: Mat3, v: readonly number[]): [number, number, number] {
  return [m[0] * v[0]! + m[1] * v[1]! + m[2] * v[2]!, m[3] * v[0]! + m[4] * v[1]! + m[5] * v[2]!, m[6] * v[0]! + m[7] * v[1]! + m[8] * v[2]!];
}

const BRADFORD: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];

/** Chromatic adaptation (Bradford) from white `from` to white `to`. */
export function adapt(from: readonly number[], to: readonly number[]): Mat3 {
  const s = apply3(BRADFORD, from),
    d = apply3(BRADFORD, to);
  const diag: Mat3 = [d[0] / s[0], 0, 0, 0, d[1] / s[1], 0, 0, 0, d[2] / s[2]];
  return mul3(inv3(BRADFORD), mul3(diag, BRADFORD));
}

/** RGB → XYZ for primaries (xy) and a white (xy), adapted to D50. */
export function matrixFromPrimaries(r: [number, number], g: [number, number], b: [number, number], w: [number, number]): Mat3 {
  const xyz = (p: [number, number]) => [p[0] / p[1], 1, (1 - p[0] - p[1]) / p[1]];
  const R = xyz(r),
    G = xyz(g),
    B = xyz(b),
    W = xyz(w);
  const P: Mat3 = [R[0]!, G[0]!, B[0]!, R[1]!, G[1]!, B[1]!, R[2]!, G[2]!, B[2]!];
  const S = apply3(inv3(P), W);
  const M: Mat3 = [P[0] * S[0], P[1] * S[1], P[2] * S[2], P[3] * S[0], P[4] * S[1], P[5] * S[2], P[6] * S[0], P[7] * S[1], P[8] * S[2]];
  return mul3(adapt(W, D50), M);
}

const D65xy: [number, number] = [0.3127, 0.329];

export const SRGB: ColorProfile = {
  id: 'srgb',
  name: 'sRGB IEC61966-2.1',
  toXYZ: matrixFromPrimaries([0.64, 0.33], [0.3, 0.6], [0.15, 0.06], D65xy),
  trc: { type: 'srgb' },
};

export const DISPLAY_P3: ColorProfile = {
  id: 'p3',
  name: 'Display P3',
  toXYZ: matrixFromPrimaries([0.68, 0.32], [0.265, 0.69], [0.15, 0.06], D65xy),
  trc: { type: 'srgb' },
};

export const ADOBE_RGB: ColorProfile = {
  id: 'adobergb',
  name: 'Adobe RGB (1998)',
  toXYZ: matrixFromPrimaries([0.64, 0.33], [0.21, 0.71], [0.15, 0.06], D65xy),
  trc: { type: 'gamma', g: 563 / 256 },
};

export const PROFILES: ColorProfile[] = [SRGB, DISPLAY_P3, ADOBE_RGB];

export const profileById = (id: string): ColorProfile => PROFILES.find((p) => p.id === id) ?? SRGB;

// ---- tone curves ----

export function decode(trc: ToneCurve, v: number): number {
  switch (trc.type) {
    case 'srgb':
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    case 'gamma':
      return v <= 0 ? 0 : Math.pow(v, trc.g);
    case 'linear':
      return v;
    case 'para':
      return para(trc.fn, trc.p, v);
    case 'table': {
      const t = trc.t;
      const x = Math.min(1, Math.max(0, v)) * (t.length - 1);
      const i = Math.min(t.length - 2, Math.floor(x));
      const f = x - i;
      return t[i]! * (1 - f) + t[i + 1]! * f;
    }
  }
}

export function encode(trc: ToneCurve, v: number): number {
  switch (trc.type) {
    case 'srgb':
      return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    case 'gamma':
      return v <= 0 ? 0 : Math.pow(v, 1 / trc.g);
    case 'linear':
      return v;
    default: {
      // Invert by bisection (curves are increasing).
      let lo = 0,
        hi = 1;
      for (let i = 0; i < 30; i++) {
        const m = (lo + hi) / 2;
        if (decode(trc, m) < v) lo = m;
        else hi = m;
      }
      return (lo + hi) / 2;
    }
  }
}

function para(fn: number, p: number[], x: number): number {
  const [g = 1, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = p;
  switch (fn) {
    case 0:
      return Math.pow(x, g);
    case 1:
      return x >= -b / a ? Math.pow(a * x + b, g) : 0;
    case 2:
      return x >= -b / a ? Math.pow(a * x + b, g) + c : c;
    case 3:
      return x >= d ? Math.pow(a * x + b, g) : c * x;
    default:
      return x >= d ? Math.pow(a * x + b, g) + e : c * x + f;
  }
}

/** A 1D table of `n` decoded values (the GPU's tone curve). */
export function decodeTable(trc: ToneCurve, n = 4096): Float32Array {
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) t[i] = decode(trc, i / (n - 1));
  return t;
}

/** The matrix taking linear RGB in `from` to linear RGB in `to`. */
export function rgbToRgb(from: ColorProfile, to: ColorProfile): Mat3 {
  return mul3(inv3(to.toXYZ), from.toXYZ);
}

/** Convert one encoded RGB color between profiles (clipped to 0..1 if `clip`). */
export function convertColor(rgb: readonly number[], from: ColorProfile, to: ColorProfile, clip = true): [number, number, number] {
  const m = rgbToRgb(from, to);
  const lin = apply3(m, [decode(from.trc, rgb[0]!), decode(from.trc, rgb[1]!), decode(from.trc, rgb[2]!)]);
  const out = lin.map((v) => encode(to.trc, clip ? Math.min(1, Math.max(0, v)) : v)) as [number, number, number];
  return out;
}

export const sameProfile = (a: ColorProfile, b: ColorProfile) =>
  a.id === b.id && a.id !== 'custom' ? true : a.toXYZ.every((v, i) => Math.abs(v - b.toXYZ[i]!) < 1e-4) && JSON.stringify(a.trc) === JSON.stringify(b.trc);

// ---- ICC ----

const sig = (s: string) => (s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3);

/** Read a matrix/TRC RGB profile. Returns null for profiles it can't use (CMYK, LUT-only). */
export function readICC(bytes: Uint8Array): ColorProfile | null {
  if (bytes.length < 132) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(16) !== sig('RGB ')) return null;
  const count = v.getUint32(128);
  const tags = new Map<number, { off: number; len: number }>();
  for (let i = 0; i < count && 132 + i * 12 + 12 <= bytes.length; i++) {
    const at = 132 + i * 12;
    tags.set(v.getUint32(at), { off: v.getUint32(at + 4), len: v.getUint32(at + 8) });
  }
  const s15 = (o: number) => v.getInt32(o) / 65536;
  const xyz = (name: string): number[] | null => {
    const t = tags.get(sig(name));
    if (!t || t.off + 20 > bytes.length || v.getUint32(t.off) !== sig('XYZ ')) return null;
    return [s15(t.off + 8), s15(t.off + 12), s15(t.off + 16)];
  };
  const curve = (name: string): ToneCurve | null => {
    const t = tags.get(sig(name));
    if (!t || t.off + 12 > bytes.length) return null;
    const type = v.getUint32(t.off);
    if (type === sig('curv')) {
      const n = v.getUint32(t.off + 8);
      if (n === 0) return { type: 'linear' };
      if (n === 1) return { type: 'gamma', g: v.getUint16(t.off + 12) / 256 };
      const tab: number[] = [];
      for (let i = 0; i < n && t.off + 12 + i * 2 + 2 <= bytes.length; i++) tab.push(v.getUint16(t.off + 12 + i * 2) / 65535);
      return { type: 'table', t: tab };
    }
    if (type === sig('para')) {
      const fn = v.getUint16(t.off + 8);
      const nParams = [1, 3, 4, 5, 7][fn] ?? 1;
      const p: number[] = [];
      for (let i = 0; i < nParams; i++) p.push(s15(t.off + 12 + i * 4));
      // A plain gamma or the sRGB curve: use the exact forms.
      if (fn === 0) return { type: 'gamma', g: p[0]! };
      if (fn === 3 && Math.abs(p[0]! - 2.4) < 0.01 && Math.abs(p[1]! - 1 / 1.055) < 0.002 && Math.abs(p[3]! - 1 / 12.92) < 0.002) return { type: 'srgb' };
      return { type: 'para', fn, p };
    }
    return null;
  };
  const r = xyz('rXYZ'),
    g = xyz('gXYZ'),
    b = xyz('bXYZ');
  const trc = curve('rTRC') ?? curve('kTRC');
  if (!r || !g || !b || !trc) return null;
  const toXYZ: Mat3 = [r[0]!, g[0]!, b[0]!, r[1]!, g[1]!, b[1]!, r[2]!, g[2]!, b[2]!];
  const name = readDesc(bytes, v, tags.get(sig('desc'))) ?? 'Embedded profile';
  const known = PROFILES.find((p) => p.toXYZ.every((x, i) => Math.abs(x - toXYZ[i]!) < 0.003) && JSON.stringify(p.trc) === JSON.stringify(trc));
  if (known) return { ...known, icc: bytes.slice() };
  return { id: 'custom', name, toXYZ, trc, icc: bytes.slice() };
}

function readDesc(bytes: Uint8Array, v: DataView, t: { off: number; len: number } | undefined): string | null {
  if (!t || t.off + 12 > bytes.length) return null;
  const type = v.getUint32(t.off);
  if (type === sig('desc')) {
    const n = v.getUint32(t.off + 8);
    const s = bytes.subarray(t.off + 12, Math.min(bytes.length, t.off + 12 + n));
    return new TextDecoder('latin1').decode(s).replace(/\0+$/, '');
  }
  if (type === sig('mluc')) {
    const recs = v.getUint32(t.off + 8);
    if (recs < 1) return null;
    const len = v.getUint32(t.off + 20),
      off = v.getUint32(t.off + 24);
    const s = bytes.subarray(t.off + off, Math.min(bytes.length, t.off + off + len));
    let out = '';
    for (let i = 0; i + 1 < s.length; i += 2) out += String.fromCharCode((s[i]! << 8) | s[i + 1]!);
    return out.replace(/\0+$/, '');
  }
  return null;
}

/** An ICC v2 profile (matrix and tone curves) for `p`, to embed in saved files. */
export function writeICC(p: ColorProfile): Uint8Array {
  if (p.icc) return p.icc;
  const tags: { sig: string; data: Uint8Array }[] = [];
  const enc = new TextEncoder();
  const descTag = (s: string) => {
    const a = enc.encode(s);
    const d = new Uint8Array(12 + a.length + 1 + 12 + 67);
    const v = new DataView(d.buffer);
    v.setUint32(0, sig('desc'));
    v.setUint32(8, a.length + 1);
    d.set(a, 12);
    return d;
  };
  const textTag = (s: string) => {
    const a = enc.encode(s);
    const d = new Uint8Array(8 + a.length + 1);
    new DataView(d.buffer).setUint32(0, sig('text'));
    d.set(a, 8);
    return d;
  };
  const xyzTag = (x: number, y: number, z: number) => {
    const d = new Uint8Array(20);
    const v = new DataView(d.buffer);
    v.setUint32(0, sig('XYZ '));
    v.setInt32(8, Math.round(x * 65536));
    v.setInt32(12, Math.round(y * 65536));
    v.setInt32(16, Math.round(z * 65536));
    return d;
  };
  const curveTag = (trc: ToneCurve) => {
    if (trc.type === 'gamma') {
      const d = new Uint8Array(14);
      const v = new DataView(d.buffer);
      v.setUint32(0, sig('curv'));
      v.setUint32(8, 1);
      v.setUint16(12, Math.round(trc.g * 256));
      return d;
    }
    if (trc.type === 'linear') {
      const d = new Uint8Array(12);
      new DataView(d.buffer).setUint32(0, sig('curv'));
      return d;
    }
    if (trc.type === 'srgb') {
      const d = new Uint8Array(12 + 5 * 4);
      const v = new DataView(d.buffer);
      v.setUint32(0, sig('para'));
      v.setUint16(8, 3);
      [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045].forEach((x, i) => v.setInt32(12 + i * 4, Math.round(x * 65536)));
      return d;
    }
    const n = 1024;
    const d = new Uint8Array(12 + n * 2);
    const v = new DataView(d.buffer);
    v.setUint32(0, sig('curv'));
    v.setUint32(8, n);
    for (let i = 0; i < n; i++) v.setUint16(12 + i * 2, Math.round(Math.min(1, Math.max(0, decode(trc, i / (n - 1)))) * 65535));
    return d;
  };
  const m = p.toXYZ;
  tags.push({ sig: 'desc', data: descTag(p.name) });
  tags.push({ sig: 'cprt', data: textTag('No copyright, use freely') });
  tags.push({ sig: 'wtpt', data: xyzTag(D50[0], D50[1], D50[2]) });
  tags.push({ sig: 'rXYZ', data: xyzTag(m[0], m[3], m[6]) });
  tags.push({ sig: 'gXYZ', data: xyzTag(m[1], m[4], m[7]) });
  tags.push({ sig: 'bXYZ', data: xyzTag(m[2], m[5], m[8]) });
  const curve = curveTag(p.trc);
  tags.push({ sig: 'rTRC', data: curve }, { sig: 'gTRC', data: curve }, { sig: 'bTRC', data: curve });
  // Layout: header, tag table, then data (4-byte aligned; the three curves share one copy).
  let at = 128 + 4 + tags.length * 12;
  const offsets: number[] = [];
  const seen = new Map<Uint8Array, number>();
  const blobs: { off: number; data: Uint8Array }[] = [];
  for (const t of tags) {
    const prev = seen.get(t.data);
    if (prev !== undefined) {
      offsets.push(prev);
      continue;
    }
    at = (at + 3) & ~3;
    offsets.push(at);
    seen.set(t.data, at);
    blobs.push({ off: at, data: t.data });
    at += t.data.length;
  }
  const size = (at + 3) & ~3;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  v.setUint32(0, size);
  v.setUint32(4, sig('lcms'));
  v.setUint32(8, 0x02100000);
  v.setUint32(12, sig('mntr'));
  v.setUint32(16, sig('RGB '));
  v.setUint32(20, sig('XYZ '));
  v.setUint16(24, 2026);
  v.setUint16(26, 1);
  v.setUint16(28, 1);
  v.setUint32(36, sig('acsp'));
  v.setInt32(68, Math.round(D50[0] * 65536));
  v.setInt32(72, Math.round(D50[1] * 65536));
  v.setInt32(76, Math.round(D50[2] * 65536));
  v.setUint32(128, tags.length);
  tags.forEach((t, i) => {
    v.setUint32(132 + i * 12, sig(t.sig));
    v.setUint32(136 + i * 12, offsets[i]!);
    v.setUint32(140 + i * 12, t.data.length);
  });
  for (const b of blobs) out.set(b.data, b.off);
  return out;
}

// ---- small color helpers (0..1) ----

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

export function rgbToHsb(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsbToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s),
    q = v * (1 - f * s),
    t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

/** sRGB (encoded) → CIE Lab (D50). */
export function rgbToLab(r: number, g: number, b: number, p: ColorProfile = SRGB): [number, number, number] {
  const [X, Y, Z] = apply3(p.toXYZ, [decode(p.trc, r), decode(p.trc, g), decode(p.trc, b)]);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(X / D50[0]),
    fy = f(Y / D50[1]),
    fz = f(Z / D50[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb(L: number, a: number, bb: number, p: ColorProfile = SRGB): [number, number, number] {
  const fy = (L + 16) / 116,
    fx = fy + a / 500,
    fz = fy - bb / 200;
  const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const xyz = [inv(fx) * D50[0], inv(fy) * D50[1], inv(fz) * D50[2]];
  const lin = apply3(inv3(p.toXYZ), xyz);
  return lin.map((v) => encode(p.trc, Math.min(1, Math.max(0, v)))) as [number, number, number];
}

/** Rec. 601 luma as Photoshop uses for Luminosity and the rest. */
export const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;

export function hex(c: readonly number[]): string {
  const h = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(c[0]!)}${h(c[1]!)}${h(c[2]!)}`;
}

export function parseHex(s: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  let t = m[1]!;
  if (t.length === 3) t = t[0]! + t[0] + t[1] + t[1] + t[2] + t[2];
  return [parseInt(t.slice(0, 2), 16) / 255, parseInt(t.slice(2, 4), 16) / 255, parseInt(t.slice(4, 6), 16) / 255];
}

/** CMYK (naive, for the color picker's numbers) from RGB. */
export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}

export function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
}

export { D50, D65 };
