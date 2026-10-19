// PNG read and write, done here rather than by the browser so 16-bit images
// keep their 16 bits, the embedded ICC profile is read and written, and the
// resolution (pHYs) comes along. Every color type and bit depth, palettes
// with transparency, and interlaced (Adam7) files are read.

import { concat, crc32, deflate, inflate, Reader, Writer } from './bytes';
import type { Decoded } from './decoded';

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export function isPNG(b: Uint8Array): boolean {
  return SIG.every((v, i) => b[i] === v);
}

export async function decodePNG(bytes: Uint8Array): Promise<Decoded> {
  if (!isPNG(bytes)) throw new Error('This is not a PNG file.');
  const r = new Reader(bytes, false, 8);
  let width = 0,
    height = 0,
    bitDepth = 8,
    colorType = 6,
    interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let icc: Uint8Array | undefined;
  let resolution: number | undefined;
  while (r.left >= 12) {
    const len = r.u32();
    const type = r.ascii(4);
    const data = r.take(len);
    r.skip(4);
    if (type === 'IHDR') {
      const h = new Reader(data);
      width = h.u32();
      height = h.u32();
      bitDepth = h.u8();
      colorType = h.u8();
      h.u8();
      h.u8();
      interlace = h.u8();
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'iCCP') {
      const nul = data.indexOf(0);
      if (nul > 0 && nul + 2 <= data.length) {
        try {
          icc = await inflate(data.subarray(nul + 2), 'deflate');
        } catch {
          icc = undefined;
        }
      }
    } else if (type === 'pHYs' && data.length >= 9) {
      const p = new Reader(data);
      const ppx = p.u32();
      p.u32();
      if (p.u8() === 1) resolution = Math.round(ppx * 0.0254);
    } else if (type === 'IEND') break;
  }
  if (!width || !height) throw new Error('This PNG has no size.');
  if (width * height > 400_000_000) throw new Error('This PNG is too large to open.');
  const raw = await inflate(concat(idat), 'deflate');
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4;
  const bpp = Math.max(1, (channels * bitDepth) >> 3);
  const out16 = bitDepth === 16;
  const data = out16 ? new Uint16Array(width * height * 4) : new Uint8Array(width * height * 4);
  const maxv = out16 ? 65535 : 255;

  const passes = interlace
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]];
  let at = 0;
  for (const [x0, y0, dx, dy] of passes as [number, number, number, number][]) {
    const pw = Math.ceil((width - x0) / dx),
      ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * channels * bitDepth) / 8);
    let prev = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      if (at + 1 + stride > raw.length) throw new Error('This PNG is cut short.');
      const filter = raw[at++]!;
      const line = raw.slice(at, at + stride);
      at += stride;
      unfilter(filter, line, prev, bpp);
      prev = line;
      const yy = y0 + y * dy;
      for (let x = 0; x < pw; x++) {
        const xx = x0 + x * dx;
        const o = (yy * width + xx) * 4;
        const sample = (i: number): number => {
          if (bitDepth === 16) return (line[i * 2]! << 8) | line[i * 2 + 1]!;
          if (bitDepth === 8) return line[i]!;
          const perByte = 8 / bitDepth;
          const byte = line[Math.floor(i / perByte)]!;
          const shift = 8 - bitDepth * ((i % perByte) + 1);
          return (byte >> shift) & ((1 << bitDepth) - 1);
        };
        const scaleSmall = (v: number) => (bitDepth < 8 ? Math.round((v * 255) / ((1 << bitDepth) - 1)) : v);
        if (colorType === 3) {
          const idx = sample(x);
          data[o] = palette ? palette[idx * 3]! : 0;
          data[o + 1] = palette ? palette[idx * 3 + 1]! : 0;
          data[o + 2] = palette ? palette[idx * 3 + 2]! : 0;
          data[o + 3] = trns && idx < trns.length ? trns[idx]! : 255;
        } else if (colorType === 0 || colorType === 4) {
          const g = scaleSmall(sample(x * channels));
          data[o] = data[o + 1] = data[o + 2] = g;
          let a = colorType === 4 ? sample(x * channels + 1) : maxv;
          if (colorType === 0 && trns && trns.length >= 2) {
            const tv = (trns[0]! << 8) | trns[1]!;
            if (sample(x) === tv) a = 0;
          }
          data[o + 3] = a;
        } else {
          const R = sample(x * channels),
            G = sample(x * channels + 1),
            B = sample(x * channels + 2);
          data[o] = R;
          data[o + 1] = G;
          data[o + 2] = B;
          let a = colorType === 6 ? sample(x * channels + 3) : maxv;
          if (colorType === 2 && trns && trns.length >= 6) {
            const t = new Reader(trns);
            if (R === t.u16() && G === t.u16() && B === t.u16()) a = 0;
          }
          data[o + 3] = a;
        }
      }
    }
  }
  const hasAlpha = colorType === 4 || colorType === 6 || !!trns;
  return { width, height, depth: out16 ? 16 : 8, data, icc, resolution, hasAlpha, gray: colorType === 0 || colorType === 4 };
}

function unfilter(f: number, line: Uint8Array, prev: Uint8Array, bpp: number): void {
  const n = line.length;
  switch (f) {
    case 0:
      return;
    case 1:
      for (let i = bpp; i < n; i++) line[i] = (line[i]! + line[i - bpp]!) & 255;
      return;
    case 2:
      for (let i = 0; i < n; i++) line[i] = (line[i]! + prev[i]!) & 255;
      return;
    case 3:
      for (let i = 0; i < n; i++) line[i] = (line[i]! + (((i >= bpp ? line[i - bpp]! : 0) + prev[i]!) >> 1)) & 255;
      return;
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp]! : 0,
          b = prev[i]!,
          c = i >= bpp ? prev[i - bpp]! : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        line[i] = (line[i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      return;
    default:
      throw new Error('This PNG uses an unknown filter.');
  }
}

function chunk(w: Writer, type: string, data: Uint8Array): void {
  w.u32(data.length);
  const td = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) td[i] = type.charCodeAt(i);
  td.set(data, 4);
  w.bytes(td);
  w.u32(crc32(td));
}

export interface EncodePNGOptions {
  /** 8 or 16 bits per channel. */
  depth: 8 | 16;
  /** Leave alpha out (RGB) when the image is opaque. */
  alpha: boolean;
  icc?: Uint8Array;
  iccName?: string;
  resolution?: number;
}

/**
 * Write a PNG from RGBA samples (Uint8Array for 8-bit, Uint16Array for
 * 16-bit, interleaved RGBA).
 */
export async function encodePNG(width: number, height: number, rgba: Uint8Array | Uint16Array, o: EncodePNGOptions): Promise<Uint8Array> {
  const is16 = o.depth === 16;
  const ch = o.alpha ? 4 : 3;
  const bps = is16 ? 2 : 1;
  const stride = width * ch * bps;
  const bpp = ch * bps;
  const raw = new Uint8Array((stride + 1) * height);
  let line = new Uint8Array(stride),
    prev = new Uint8Array(stride);
  const cand = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];
  for (let y = 0; y < height; y++) {
    // The row's bytes.
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < ch; c++) {
        const v = rgba[(y * width + x) * 4 + c]!;
        if (is16) {
          line[(x * ch + c) * 2] = v >> 8;
          line[(x * ch + c) * 2 + 1] = v & 255;
        } else line[x * ch + c] = v;
      }
    }
    // Pick the filter with the smallest sum of absolute values (the usual heuristic).
    let best = 0,
      bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f]!;
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp]! : 0,
          b = prev[i]!,
          c = i >= bpp ? prev[i - bpp]! : 0;
        let v: number;
        if (f === 0) v = line[i]!;
        else if (f === 1) v = line[i]! - a;
        else if (f === 2) v = line[i]! - b;
        else if (f === 3) v = line[i]! - ((a + b) >> 1);
        else {
          const p = a + b - c;
          const pa = Math.abs(p - a),
            pb = Math.abs(p - b),
            pc = Math.abs(p - c);
          v = line[i]! - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        v &= 255;
        out[i] = v;
        sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    // Recompute the chosen filter fully (the loop above may have stopped early).
    const chosen = cand[best]!;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp]! : 0,
        b = prev[i]!,
        c = i >= bpp ? prev[i - bpp]! : 0;
      let v: number;
      if (best === 0) v = line[i]!;
      else if (best === 1) v = line[i]! - a;
      else if (best === 2) v = line[i]! - b;
      else if (best === 3) v = line[i]! - ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v = line[i]! - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      chosen[i] = v & 255;
    }
    raw[y * (stride + 1)] = best;
    raw.set(chosen, y * (stride + 1) + 1);
    const t = prev;
    prev = line;
    line = t;
  }
  const w = new Writer(raw.length / 2 + 1024);
  w.bytes(new Uint8Array(SIG));
  const ihdr = new Writer(13);
  ihdr
    .u32(width)
    .u32(height)
    .u8(o.depth)
    .u8(o.alpha ? 6 : 2)
    .u8(0)
    .u8(0)
    .u8(0);
  chunk(w, 'IHDR', ihdr.result());
  if (o.icc) {
    const name = new TextEncoder().encode((o.iccName ?? 'ICC profile').replace(/[^\x20-\x7e]/g, '').slice(0, 79) || 'ICC profile');
    const z = await deflate(o.icc, 'deflate');
    chunk(w, 'iCCP', concat([name, new Uint8Array([0, 0]), z]));
  }
  if (o.resolution) {
    const p = new Writer(9);
    const ppm = Math.round(o.resolution / 0.0254);
    p.u32(ppm).u32(ppm).u8(1);
    chunk(w, 'pHYs', p.result());
  }
  chunk(w, 'IDAT', await deflate(raw, 'deflate'));
  chunk(w, 'IEND', new Uint8Array(0));
  return w.result();
}
