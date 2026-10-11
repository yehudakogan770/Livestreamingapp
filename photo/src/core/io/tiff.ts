// TIFF read and write. Reading: little and big endian, strips and tiles,
// no compression, LZW, Deflate and PackBits (with the horizontal and
// floating-point predictors), 1–32 bits, gray, RGB, palette, CMYK (shown as
// RGB), separate planes, alpha, the embedded ICC profile and resolution.
// Writing: 8 or 16 bits or 32-bit float RGB(A), Deflate with a predictor,
// ICC and resolution. The IFD parser is shared with DNG.

import { concat, deflate, inflate, Reader, Writer } from './bytes';
import type { Decoded } from './decoded';

export interface IFDEntry {
  tag: number;
  type: number;
  count: number;
  /** Numbers (for numeric types) or the raw bytes for UNDEFINED / ASCII. */
  values: number[];
  raw: Uint8Array;
}

export type IFD = Map<number, IFDEntry>;

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8 };

export function isTIFF(b: Uint8Array): boolean {
  return (b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42);
}

export function readIFD(r: Reader, at: number): { ifd: IFD; next: number } {
  r.pos = at;
  const n = r.u16();
  const ifd: IFD = new Map();
  for (let i = 0; i < n; i++) {
    const tag = r.u16(),
      type = r.u16(),
      count = r.u32();
    const size = (TYPE_SIZE[type] ?? 1) * count;
    const valuePos = r.pos;
    const off = size > 4 ? r.u32() : valuePos;
    r.pos = valuePos + 4;
    if (off + size > r.bytes.length || size > 256 * 1024 * 1024) continue;
    const save = r.pos;
    const vr = new Reader(r.bytes, r.le, off);
    const values: number[] = [];
    if (type !== 2 && type !== 7 && type !== 1 && type !== 6 && count <= 1 << 20) {
      for (let k = 0; k < count; k++) {
        switch (type) {
          case 3:
            values.push(vr.u16());
            break;
          case 4:
          case 13:
            values.push(vr.u32());
            break;
          case 5:
            values.push(vr.u32() / (vr.u32() || 1));
            break;
          case 8:
            values.push(vr.i16());
            break;
          case 9:
            values.push(vr.i32());
            break;
          case 10: {
            const a = vr.i32(),
              b = vr.i32();
            values.push(a / (b || 1));
            break;
          }
          case 11:
            values.push(vr.f32());
            break;
          case 12:
            values.push(vr.f64());
            break;
          case 16:
            values.push(vr.u64());
            break;
        }
      }
    } else if (type === 1 || type === 6) for (let k = 0; k < Math.min(count, 1 << 20); k++) values.push(type === 6 ? vr.i8() : vr.u8());
    ifd.set(tag, { tag, type, count, values, raw: r.bytes.subarray(off, off + size) });
    r.pos = save;
  }
  const next = r.left >= 4 ? r.u32() : 0;
  return { ifd, next };
}

export const num = (ifd: IFD, tag: number, d = 0): number => ifd.get(tag)?.values[0] ?? d;
export const nums = (ifd: IFD, tag: number): number[] => ifd.get(tag)?.values ?? [];

export function readHeader(bytes: Uint8Array): { r: Reader; first: number } {
  if (!isTIFF(bytes)) throw new Error('This is not a TIFF file.');
  const le = bytes[0] === 0x49;
  const r = new Reader(bytes, le, 4);
  return { r, first: r.u32() };
}

/** All top-level IFDs and the SubIFDs they point to. */
export function allIFDs(bytes: Uint8Array): IFD[] {
  const { r, first } = readHeader(bytes);
  const out: IFD[] = [];
  const seen = new Set<number>();
  const visit = (at: number) => {
    let off = at;
    while (off && !seen.has(off) && off < bytes.length) {
      seen.add(off);
      const { ifd, next } = readIFD(r, off);
      out.push(ifd);
      for (const sub of nums(ifd, 330)) visit(sub);
      // EXIF IFD is not image data.
      off = next;
    }
  };
  visit(first);
  return out;
}

// ---- decompression ----

export function lzwDecode(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let op = 0;
  const dictStart = new Int32Array(4096),
    dictLen = new Int32Array(4096);
  const buf = new Uint8Array(1 << 24 > expected * 2 ? expected * 2 + 4096 : 1 << 24);
  let bufLen = 0;
  // Dictionary entries live in `buf` (start, length).
  const reset = () => {
    bufLen = 0;
    for (let i = 0; i < 256; i++) {
      buf[bufLen] = i;
      dictStart[i] = bufLen++;
      dictLen[i] = 1;
    }
  };
  reset();
  let next = 258,
    width = 9;
  let bitPos = 0;
  const readCode = () => {
    let v = 0;
    for (let i = 0; i < width; i++) {
      const byte = src[(bitPos + i) >> 3] ?? 0;
      v = (v << 1) | ((byte >> (7 - ((bitPos + i) & 7))) & 1);
    }
    bitPos += width;
    return v;
  };
  let prev = -1;
  const total = src.length * 8;
  while (bitPos + width <= total && op < expected) {
    const code = readCode();
    if (code === 257) break;
    if (code === 256) {
      reset();
      next = 258;
      width = 9;
      prev = -1;
      continue;
    }
    let start: number, len: number;
    if (code < next) {
      start = dictStart[code]!;
      len = dictLen[code]!;
      for (let i = 0; i < len && op < expected; i++) out[op++] = buf[start + i]!;
      if (prev >= 0 && next < 4096 && bufLen + dictLen[prev]! + 1 < buf.length) {
        const ps = dictStart[prev]!,
          pl = dictLen[prev]!;
        dictStart[next] = bufLen;
        for (let i = 0; i < pl; i++) buf[bufLen++] = buf[ps + i]!;
        buf[bufLen++] = buf[start]!;
        dictLen[next++] = pl + 1;
      }
    } else {
      if (prev < 0) break;
      const ps = dictStart[prev]!,
        pl = dictLen[prev]!;
      if (bufLen + pl + 1 >= buf.length) break;
      dictStart[next] = bufLen;
      for (let i = 0; i < pl; i++) buf[bufLen++] = buf[ps + i]!;
      buf[bufLen++] = buf[ps]!;
      dictLen[next] = pl + 1;
      start = dictStart[next]!;
      len = dictLen[next]!;
      next++;
      for (let i = 0; i < len && op < expected; i++) out[op++] = buf[start + i]!;
    }
    prev = code;
    // Early change: TIFF widens one code early.
    if (next + 1 >= 1 << width && width < 12) width++;
  }
  return out;
}

export function packBitsDecode(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let i = 0,
    o = 0;
  while (i < src.length && o < expected) {
    const n = (src[i++]! << 24) >> 24;
    if (n >= 0) {
      for (let k = 0; k <= n && o < expected; k++) out[o++] = src[i++]!;
    } else if (n !== -128) {
      const v = src[i++]!;
      for (let k = 0; k < 1 - n && o < expected; k++) out[o++] = v;
    }
  }
  return out;
}

export async function decompress(compression: number, data: Uint8Array, expected: number): Promise<Uint8Array> {
  switch (compression) {
    case 1:
      return data;
    case 5:
      return lzwDecode(data, expected);
    case 8:
    case 32946:
      return inflate(data, 'deflate');
    case 32773:
      return packBitsDecode(data, expected);
    default:
      throw new Error(`This TIFF uses a compression (${compression}) that can't be read.`);
  }
}

// ---- reading ----

export async function decodeTIFF(bytes: Uint8Array): Promise<Decoded> {
  const ifds = allIFDs(bytes);
  // The main image: the largest full-resolution image IFD.
  const candidates = ifds.filter((d) => d.has(256) && d.has(257) && (num(d, 254) & 1) === 0 && num(d, 262, 2) !== 32803 && num(d, 262, 2) !== 34892);
  const ifd = candidates.sort((a, b) => num(b, 256) * num(b, 257) - num(a, 256) * num(a, 257))[0] ?? ifds[0];
  if (!ifd) throw new Error('This TIFF has no picture.');
  const { r } = readHeader(bytes);
  return decodeImageIFD(bytes, r.le, ifd);
}

export async function decodeImageIFD(bytes: Uint8Array, le: boolean, ifd: IFD): Promise<Decoded> {
  const W = num(ifd, 256),
    H = num(ifd, 257);
  if (!W || !H) throw new Error('This TIFF has no size.');
  if (W * H > 400_000_000) throw new Error('This TIFF is too large to open.');
  const bps = num(ifd, 258, 1);
  const spp = num(ifd, 277, 1);
  const photo = num(ifd, 262, spp >= 3 ? 2 : 1);
  const comp = num(ifd, 259, 1);
  const planar = num(ifd, 284, 1);
  const predictor = num(ifd, 317, 1);
  const fmt = num(ifd, 339, 1);
  const extra = nums(ifd, 338);
  const tiled = ifd.has(322);
  const tw = tiled ? num(ifd, 322) : W;
  const th = tiled ? num(ifd, 323) : num(ifd, 278, H);
  const offsets = tiled ? nums(ifd, 324) : nums(ifd, 273);
  const counts = tiled ? nums(ifd, 325) : nums(ifd, 279);
  const planes = planar === 2 ? spp : 1;
  const sampPerBlock = planar === 2 ? 1 : spp;
  const out16 = bps > 8 || fmt === 3;
  const isFloat = fmt === 3;
  // Values as floats 0..1 (or as stored for float data), spp per pixel.
  const vals = new Float32Array(W * H * spp);
  const across = Math.ceil(W / tw),
    down = Math.ceil(H / th);
  const blocksPerPlane = tiled ? across * down : Math.ceil(H / th);
  const maxv = isFloat ? 1 : (2 ** bps) - 1;
  for (let p = 0; p < planes; p++) {
    for (let b = 0; b < blocksPerPlane; b++) {
      const idx = p * blocksPerPlane + b;
      const off = offsets[idx],
        cnt = counts[idx];
      if (off === undefined || cnt === undefined) continue;
      const bx = tiled ? (b % across) * tw : 0;
      const by = tiled ? Math.floor(b / across) * th : b * th;
      const bw = tw,
        bh = tiled ? th : Math.min(th, H - by);
      const rowBytes = Math.ceil((bw * sampPerBlock * bps) / 8);
      const expected = rowBytes * bh;
      let raw = await decompress(comp, bytes.subarray(off, off + cnt), expected);
      if (raw.length < expected) {
        const pad = new Uint8Array(expected);
        pad.set(raw);
        raw = pad;
      }
      // Predictors.
      if (predictor === 2 || predictor === 3) raw = unpredict(raw, predictor, bw, bh, sampPerBlock, bps, le);
      const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      for (let y = 0; y < bh; y++) {
        const gy = by + y;
        if (gy >= H) break;
        for (let x = 0; x < bw; x++) {
          const gx = bx + x;
          if (gx >= W) continue;
          for (let s = 0; s < sampPerBlock; s++) {
            const si = (x * sampPerBlock + s) * bps;
            let v: number;
            const byte = y * rowBytes + (si >> 3);
            if (bps === 8) v = raw[byte]!;
            else if (bps === 16) v = isFloat ? halfToFloat(dv.getUint16(byte, le)) : dv.getUint16(byte, le);
            else if (bps === 32) v = isFloat ? dv.getFloat32(byte, le) : dv.getUint32(byte, le);
            else if (bps < 8) v = (raw[byte]! >> (8 - bps - (si & 7))) & ((1 << bps) - 1);
            else {
              // 10/12/14-bit packed.
              v = 0;
              for (let k = 0; k < bps; k++) {
                const bit = si + k;
                v = (v << 1) | ((raw[y * rowBytes + (bit >> 3)]! >> (7 - (bit & 7))) & 1);
              }
            }
            const ch = planar === 2 ? p : s;
            vals[(gy * W + gx) * spp + ch] = isFloat ? v : v / maxv;
          }
        }
      }
    }
  }
  // To RGBA.
  const depth = isFloat && bps === 32 ? 32 : out16 ? 16 : 8;
  const n = W * H;
  const data = depth === 32 ? new Float32Array(n * 4) : depth === 16 ? new Uint16Array(n * 4) : new Uint8Array(n * 4);
  const scale = depth === 32 ? 1 : depth === 16 ? 65535 : 255;
  const put = (i: number, r: number, g: number, b: number, a: number) => {
    if (depth === 32) {
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = a;
    } else {
      data[i * 4] = Math.round(Math.min(1, Math.max(0, r)) * scale);
      data[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, g)) * scale);
      data[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, b)) * scale);
      data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, a)) * scale);
    }
  };
  const cmap = nums(ifd, 320);
  const alphaIdx = photo === 2 ? (spp > 3 ? 3 : -1) : photo === 5 ? (spp > 4 ? 4 : -1) : spp > 1 ? 1 : -1;
  const assoc = extra[0] === 1;
  for (let i = 0; i < n; i++) {
    const o = i * spp;
    let a = alphaIdx >= 0 ? vals[o + alphaIdx]! : 1;
    if (alphaIdx < 0) a = 1;
    let r: number, g: number, b: number;
    if (photo === 2) [r, g, b] = [vals[o]!, vals[o + 1]!, vals[o + 2]!];
    else if (photo === 3) {
      const k = Math.round(vals[o]! * maxv);
      const N = cmap.length / 3;
      r = (cmap[k] ?? 0) / 65535;
      g = (cmap[N + k] ?? 0) / 65535;
      b = (cmap[2 * N + k] ?? 0) / 65535;
    } else if (photo === 5) {
      const c = vals[o]!,
        m = vals[o + 1]!,
        yy = vals[o + 2]!,
        k = vals[o + 3]!;
      [r, g, b] = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - yy) * (1 - k)];
    } else {
      const v = photo === 0 ? 1 - vals[o]! : vals[o]!;
      r = g = b = v;
    }
    if (assoc && a > 0) {
      r /= a;
      g /= a;
      b /= a;
    }
    put(i, r, g, b, a);
  }
  const icc = ifd.get(34675)?.raw;
  const xres = num(ifd, 282, 0),
    unit = num(ifd, 296, 2);
  const resolution = xres ? Math.round(unit === 3 ? xres * 2.54 : xres) : undefined;
  const notes: string[] = [];
  if (photo === 5) notes.push('This CMYK TIFF was converted to RGB.');
  return { width: W, height: H, depth: depth as 8 | 16 | 32, data, icc: icc ? icc.slice() : undefined, resolution, hasAlpha: alphaIdx >= 0, gray: photo <= 1, notes };
}

function halfToFloat(h: number): number {
  const s = (h & 0x8000) >> 15,
    e = (h & 0x7c00) >> 10,
    f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

function unpredict(raw: Uint8Array, predictor: number, w: number, h: number, spp: number, bps: number, le: boolean): Uint8Array {
  const out = raw.slice();
  const rowBytes = (w * spp * bps) / 8;
  if (predictor === 2) {
    const dv = new DataView(out.buffer);
    for (let y = 0; y < h; y++) {
      const row = y * rowBytes;
      if (bps === 8) for (let i = spp; i < w * spp; i++) out[row + i] = (out[row + i]! + out[row + i - spp]!) & 255;
      else if (bps === 16) for (let i = spp; i < w * spp; i++) dv.setUint16(row + i * 2, (dv.getUint16(row + i * 2, le) + dv.getUint16(row + (i - spp) * 2, le)) & 0xffff, le);
      else if (bps === 32) for (let i = spp; i < w * spp; i++) dv.setUint32(row + i * 4, (dv.getUint32(row + i * 4, le) + dv.getUint32(row + (i - spp) * 4, le)) >>> 0, le);
    }
    return out;
  }
  // Floating point predictor: bytes were split by significance per row.
  const bytesPer = bps / 8;
  for (let y = 0; y < h; y++) {
    const row = y * rowBytes;
    for (let i = 1; i < rowBytes; i++) out[row + i] = (out[row + i]! + out[row + i - 1]!) & 255;
    const tmp = out.slice(row, row + rowBytes);
    const n = w * spp;
    for (let i = 0; i < n; i++)
      for (let b = 0; b < bytesPer; b++) {
        // Stored big-endian byte planes.
        const src = tmp[b * n + i]!;
        const dst = le ? row + i * bytesPer + (bytesPer - 1 - b) : row + i * bytesPer + b;
        out[dst] = src;
      }
  }
  return out;
}

// ---- writing ----

export interface EncodeTIFFOptions {
  depth: 8 | 16 | 32;
  alpha: boolean;
  icc?: Uint8Array;
  resolution?: number;
  compress?: boolean;
}

/** RGBA in (Uint8Array, Uint16Array or Float32Array). */
export async function encodeTIFF(w: number, h: number, rgba: Uint8Array | Uint16Array | Float32Array, o: EncodeTIFFOptions): Promise<Uint8Array> {
  const spp = o.alpha ? 4 : 3;
  const bps = o.depth;
  const bytesPer = bps / 8;
  const rowBytes = w * spp * bytesPer;
  const rowsPerStrip = Math.max(1, Math.floor(262144 / rowBytes));
  const strips: Uint8Array[] = [];
  for (let y0 = 0; y0 < h; y0 += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, h - y0);
    const buf = new Uint8Array(rows * rowBytes);
    const dv = new DataView(buf.buffer);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < spp; c++) {
          const v = rgba[((y0 + y) * w + x) * 4 + c]!;
          const at = y * rowBytes + (x * spp + c) * bytesPer;
          if (bps === 8) buf[at] = v;
          else if (bps === 16) dv.setUint16(at, v, true);
          else dv.setFloat32(at, v, true);
        }
    if (o.compress !== false && bps !== 32) {
      // Horizontal differencing, then deflate.
      for (let y = 0; y < rows; y++) {
        if (bps === 8) for (let i = w * spp - 1; i >= spp; i--) buf[y * rowBytes + i] = (buf[y * rowBytes + i]! - buf[y * rowBytes + i - spp]!) & 255;
        else
          for (let i = w * spp - 1; i >= spp; i--) {
            const a = y * rowBytes + i * 2,
              b = y * rowBytes + (i - spp) * 2;
            dv.setUint16(a, (dv.getUint16(a, true) - dv.getUint16(b, true)) & 0xffff, true);
          }
      }
      strips.push(await deflate(buf, 'deflate'));
    } else if (o.compress !== false) strips.push(await deflate(buf, 'deflate'));
    else strips.push(buf);
  }
  const compressed = o.compress !== false;
  const entries: { tag: number; type: number; values: number[] | Uint8Array }[] = [];
  const add = (tag: number, type: number, values: number[] | Uint8Array) => entries.push({ tag, type, values });
  add(254, 4, [0]);
  add(256, 4, [w]);
  add(257, 4, [h]);
  add(258, 3, new Array(spp).fill(bps));
  add(259, 3, [compressed ? 8 : 1]);
  add(262, 3, [2]);
  add(273, 4, new Array(strips.length).fill(0));
  add(277, 3, [spp]);
  add(278, 4, [rowsPerStrip]);
  add(279, 4, strips.map((s) => s.length));
  add(282, 5, [o.resolution ?? 72]);
  add(283, 5, [o.resolution ?? 72]);
  add(284, 3, [1]);
  add(296, 3, [2]);
  add(305, 2, new TextEncoder().encode('Lumora Photo\0'));
  if (compressed && bps !== 32) add(317, 3, [2]);
  if (o.alpha) add(338, 3, [2]);
  add(339, 3, new Array(spp).fill(bps === 32 ? 3 : 1));
  if (o.icc) add(34675, 7, o.icc);
  entries.sort((a, b) => a.tag - b.tag);
  const w8 = new Writer(1 << 16, true);
  w8.ascii('II').u16(42).u32(8);
  // IFD, then out-of-line values, then strips.
  const ifdSize = 2 + entries.length * 12 + 4;
  let extraAt = 8 + ifdSize;
  const extras: { at: number; bytes: Uint8Array }[] = [];
  const valueBytes = (e: (typeof entries)[number]): Uint8Array => {
    if (e.values instanceof Uint8Array) return e.values;
    const ww = new Writer(64, true);
    for (const v of e.values) {
      if (e.type === 3) ww.u16(v);
      else if (e.type === 4) ww.u32(v);
      else if (e.type === 5) ww.u32(Math.round(v * 1000)).u32(1000);
    }
    return ww.result();
  };
  const placed = entries.map((e) => {
    const b = valueBytes(e);
    if (b.length > 4) {
      const at = extraAt;
      extras.push({ at, bytes: b });
      extraAt += b.length + (b.length & 1);
      return { e, b, at };
    }
    return { e, b, at: -1 };
  });
  // Strip offsets are known once the extras are placed.
  let stripAt = extraAt;
  const stripOffsets = strips.map((s) => {
    const at = stripAt;
    stripAt += s.length;
    return at;
  });
  const so = placed.find((p) => p.e.tag === 273)!;
  const sob = new Writer(64, true);
  for (const v of stripOffsets) sob.u32(v);
  so.b = sob.result();
  if (so.at >= 0) extras.find((x) => x.at === so.at)!.bytes = so.b;
  w8.u16(entries.length);
  for (const p of placed) {
    const count = p.e.values instanceof Uint8Array ? p.e.values.length : p.e.values.length;
    w8.u16(p.e.tag).u16(p.e.type).u32(count);
    if (p.at >= 0) w8.u32(p.at);
    else {
      const four = new Uint8Array(4);
      four.set(p.b.subarray(0, 4));
      w8.bytes(four);
    }
  }
  w8.u32(0);
  for (const x of extras) {
    w8.bytes(x.bytes);
    if (x.bytes.length & 1) w8.u8(0);
  }
  return concat([w8.result(), ...strips]);
}
