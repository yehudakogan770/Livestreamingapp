// GIF writing: colors reduced to a palette (median cut in RGB, weighted by
// how often colors appear), optional Floyd–Steinberg dithering, one
// transparent color for see-through pixels, LZW-compressed.

import { Writer } from './bytes';

interface Box {
  colors: Uint32Array;
  counts: Uint32Array;
}

/** A palette of up to `n` colors by median cut (pixels sampled for speed). */
export function medianCut(rgba: Uint8Array, n: number): number[][] {
  const hist = new Map<number, number>();
  // The true colors summed per bucket, so palette entries are exact averages.
  const sums = new Map<number, [number, number, number]>();
  const step = Math.max(1, Math.floor(rgba.length / 4 / 300000));
  for (let i = 0; i < rgba.length; i += 4 * step) {
    if (rgba[i + 3]! < 128) continue;
    // 5 bits per channel.
    const k = ((rgba[i]! >> 3) << 10) | ((rgba[i + 1]! >> 3) << 5) | (rgba[i + 2]! >> 3);
    hist.set(k, (hist.get(k) ?? 0) + 1);
    let sum = sums.get(k);
    if (!sum) sums.set(k, (sum = [0, 0, 0]));
    sum[0] += rgba[i]!;
    sum[1] += rgba[i + 1]!;
    sum[2] += rgba[i + 2]!;
  }
  if (!hist.size) return [[0, 0, 0]];
  const keys = new Uint32Array(hist.keys()),
    counts = new Uint32Array(hist.values());
  let boxes: Box[] = [{ colors: keys, counts }];
  const ch = (k: number, c: number) => (k >> (10 - c * 5)) & 31;
  while (boxes.length < n) {
    // Split the box with the most pixels × widest range.
    let bi = -1,
      bestScore = -1,
      bestC = 0;
    boxes.forEach((b, i) => {
      if (b.colors.length < 2) return;
      let total = 0;
      for (const c of b.counts) total += c;
      for (let c = 0; c < 3; c++) {
        let lo = 31,
          hi = 0;
        for (const k of b.colors) {
          const v = ch(k, c);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        const score = (hi - lo) * Math.sqrt(total);
        if (score > bestScore) {
          bestScore = score;
          bi = i;
          bestC = c;
        }
      }
    });
    if (bi < 0 || bestScore <= 0) break;
    const b = boxes[bi]!;
    const order = [...b.colors.keys()].sort((x, y) => ch(b.colors[x]!, bestC) - ch(b.colors[y]!, bestC));
    let total = 0;
    for (const c of b.counts) total += c;
    let acc = 0,
      cut = 1;
    for (let j = 0; j < order.length; j++) {
      acc += b.counts[order[j]!]!;
      if (acc >= total / 2) {
        cut = Math.min(order.length - 1, Math.max(1, j + 1));
        break;
      }
    }
    const a = order.slice(0, cut),
      c2 = order.slice(cut);
    boxes = [
      ...boxes.slice(0, bi),
      { colors: Uint32Array.from(a, (i) => b.colors[i]!), counts: Uint32Array.from(a, (i) => b.counts[i]!) },
      { colors: Uint32Array.from(c2, (i) => b.colors[i]!), counts: Uint32Array.from(c2, (i) => b.counts[i]!) },
      ...boxes.slice(bi + 1),
    ];
  }
  return boxes.map((b) => {
    let r = 0,
      g = 0,
      bl = 0,
      t = 0;
    b.colors.forEach((k, i) => {
      const sum = sums.get(k)!;
      r += sum[0];
      g += sum[1];
      bl += sum[2];
      t += b.counts[i]!;
    });
    return [Math.round(r / t), Math.round(g / t), Math.round(bl / t)];
  });
}

function lzw(indices: Uint8Array, minCode: number): Uint8Array {
  const w = new Writer(indices.length + 1024);
  const clear = 1 << minCode,
    eoi = clear + 1;
  let codeSize = minCode + 1;
  let dict = new Map<number, number>();
  let next = eoi + 1;
  let bits = 0,
    nbits = 0;
  const bytes: number[] = [];
  const emit = (code: number) => {
    bits |= code << nbits;
    nbits += codeSize;
    while (nbits >= 8) {
      bytes.push(bits & 255);
      bits >>>= 8;
      nbits -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0]!;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!;
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      codeSize = minCode + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (nbits > 0) bytes.push(bits & 255);
  // Sub-blocks of up to 255 bytes.
  for (let i = 0; i < bytes.length; i += 255) {
    const n = Math.min(255, bytes.length - i);
    w.u8(n);
    for (let k = 0; k < n; k++) w.u8(bytes[i + k]!);
  }
  w.u8(0);
  return w.result();
}

export function encodeGIF(width: number, height: number, rgba: Uint8Array, colors = 256, dither = true): Uint8Array {
  let transparent = false;
  for (let i = 3; i < rgba.length; i += 4)
    if (rgba[i]! < 128) {
      transparent = true;
      break;
    }
  const n = Math.max(2, Math.min(256, colors)) - (transparent ? 1 : 0);
  const pal = medianCut(rgba, n);
  if (transparent) pal.push([0, 0, 0]);
  const tIndex = transparent ? pal.length - 1 : -1;
  let size = 2,
    bits = 1;
  while (size < pal.length) {
    size *= 2;
    bits++;
  }
  // Nearest palette entry (cached by 5-bit color).
  const cache = new Int16Array(32768).fill(-1);
  const nearest = (r: number, g: number, b: number) => {
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const c = cache[k]!;
    if (c >= 0) return c;
    let best = 0,
      bd = Infinity;
    for (let i = 0; i < pal.length; i++) {
      if (i === tIndex) continue;
      const p = pal[i]!;
      const d = (p[0]! - r) ** 2 * 2 + (p[1]! - g) ** 2 * 4 + (p[2]! - b) ** 2 * 3;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    cache[k] = best;
    return best;
  };
  const idx = new Uint8Array(width * height);
  const err = dither ? new Float32Array(width * height * 3) : null;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (rgba[i * 4 + 3]! < 128) {
        idx[i] = tIndex;
        continue;
      }
      let r = rgba[i * 4]!,
        g = rgba[i * 4 + 1]!,
        b = rgba[i * 4 + 2]!;
      if (err) {
        r = Math.min(255, Math.max(0, Math.round(r + err[i * 3]!)));
        g = Math.min(255, Math.max(0, Math.round(g + err[i * 3 + 1]!)));
        b = Math.min(255, Math.max(0, Math.round(b + err[i * 3 + 2]!)));
      }
      const k = nearest(r, g, b);
      idx[i] = k;
      if (err) {
        const p = pal[k]!;
        const e = [r - p[0]!, g - p[1]!, b - p[2]!];
        const spread = (dx: number, dy: number, f: number) => {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || xx >= width || yy >= height) return;
          const j = (yy * width + xx) * 3;
          for (let c = 0; c < 3; c++) err[j + c]! += e[c]! * f;
        };
        spread(1, 0, 7 / 16);
        spread(-1, 1, 3 / 16);
        spread(0, 1, 5 / 16);
        spread(1, 1, 1 / 16);
      }
    }
  const w = new Writer(width * height + 2048, true);
  w.ascii('GIF89a')
    .u16(width)
    .u16(height)
    .u8(0x80 | ((bits - 1) << 4) | (bits - 1))
    .u8(0)
    .u8(0);
  for (let i = 0; i < size; i++) {
    const p = pal[i] ?? [0, 0, 0];
    w.u8(p[0]!).u8(p[1]!).u8(p[2]!);
  }
  if (transparent) w.u8(0x21).u8(0xf9).u8(4).u8(1).u16(0).u8(tIndex).u8(0);
  w.u8(0x2c).u16(0).u16(0).u16(width).u16(height).u8(0);
  const minCode = Math.max(2, bits);
  w.u8(minCode);
  w.bytes(lzw(idx, minCode));
  w.u8(0x3b);
  return w.result();
}
