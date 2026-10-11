// DNG camera raw: the raw sensor data (uncompressed, lossless JPEG or
// Deflate; strips or tiles), linearized and black/white-levelled, white
// balanced from the camera's As Shot neutral, demosaiced (Malvar–He–Cutler
// for Bayer sensors, a same-color average for others), converted with the
// file's color matrix into Display P3, exposed by the baseline exposure with
// a gentle default tone curve, cropped and turned as the camera says.
// Opens as a 16-bit document; the Camera Raw filter develops it further.

import { allIFDs, nums, num, decompress, readHeader, type IFD } from './tiff';
import { decodeLJ92 } from './ljpeg';
import { inv3, mul3, type Mat3 } from '../color';
import { ICC_P3 } from './dngProfile';
import type { Decoded } from './decoded';

const P3_TO_XYZ_D65: Mat3 = [0.4865709, 0.2656677, 0.1982173, 0.2289746, 0.6917385, 0.0792869, 0.0, 0.0451134, 1.0439444];

export function isDNG(ifds: IFD[]): boolean {
  return ifds.some((d) => d.has(50706));
}

/** The raw sensor values (after decompression), w × h × spp. */
async function readRawPlane(bytes: Uint8Array, le: boolean, ifd: IFD): Promise<{ w: number; h: number; spp: number; data: Float32Array; bps: number }> {
  const W = num(ifd, 256),
    H = num(ifd, 257);
  const spp = num(ifd, 277, 1);
  const bps = num(ifd, 258, 16);
  const comp = num(ifd, 259, 1);
  const tiled = ifd.has(322);
  const tw = tiled ? num(ifd, 322) : W;
  const th = tiled ? num(ifd, 323) : num(ifd, 278, H);
  const offs = tiled ? nums(ifd, 324) : nums(ifd, 273);
  const cnts = tiled ? nums(ifd, 325) : nums(ifd, 279);
  const fmt = num(ifd, 339, 1);
  const data = new Float32Array(W * H * spp);
  const across = Math.ceil(W / tw);
  for (let t = 0; t < offs.length; t++) {
    const bx = tiled ? (t % across) * tw : 0,
      by = tiled ? Math.floor(t / across) * th : t * th;
    const raw = bytes.subarray(offs[t]!, offs[t]! + cnts[t]!);
    if (comp === 7) {
      const lj = decodeLJ92(raw);
      // The JPEG may pack columns as components: its row holds width·components samples.
      const rowSamples = lj.width * lj.components;
      const tileW = tiled ? tw : W;
      const perRow = tileW * spp;
      for (let y = 0; y < lj.height; y++)
        for (let i = 0; i < rowSamples; i++) {
          const k = y * rowSamples + i;
          const ty = Math.floor(k / perRow),
            r = k % perRow;
          const gx = bx + Math.floor(r / spp),
            gy = by + ty;
          if (gx >= W || gy >= H) continue;
          data[(gy * W + gx) * spp + (r % spp)] = lj.data[k]!;
        }
    } else if (comp === 1 || comp === 8) {
      const bw = tw,
        bh = tiled ? th : Math.min(th, H - by);
      const rowBytes = Math.ceil((bw * spp * bps) / 8);
      const buf = await decompress(comp, raw, rowBytes * bh);
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      for (let y = 0; y < bh; y++)
        for (let x = 0; x < bw; x++)
          for (let s = 0; s < spp; s++) {
            const gx = bx + x,
              gy = by + y;
            if (gx >= W || gy >= H) continue;
            const si = (x * spp + s) * bps;
            let v: number;
            const at = y * rowBytes + (si >> 3);
            if (bps === 16) v = fmt === 3 ? 0 : dv.getUint16(at, le);
            else if (bps === 8) v = buf[at]!;
            else if (bps === 32) v = fmt === 3 ? dv.getFloat32(at, le) : dv.getUint32(at, le);
            else {
              // Packed 10/12/14-bit, most significant bit first.
              v = 0;
              for (let k = 0; k < bps; k++) {
                const bit = si + k;
                v = (v << 1) | ((buf[y * rowBytes + (bit >> 3)]! >> (7 - (bit & 7))) & 1);
              }
            }
            data[(gy * W + gx) * spp + s] = v;
          }
    } else throw new Error('This DNG is compressed in a way that cannot be read (lossy DNG).');
  }
  return { w: W, h: H, spp, data, bps };
}

/** Malvar–He–Cutler demosaicing for a 2×2 Bayer pattern (`cfa[y%2][x%2]` = 0 R, 1 G, 2 B). */
function demosaicMHC(m: Float32Array, w: number, h: number, cfa: number[][]): Float32Array {
  const out = new Float32Array(w * h * 3);
  const at = (x: number, y: number) => m[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = cfa[y & 1]![x & 1]!;
      const v = at(x, y);
      const o = (y * w + x) * 3;
      out[o + c] = v;
      const cross = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1);
      const diag = at(x - 1, y - 1) + at(x + 1, y - 1) + at(x - 1, y + 1) + at(x + 1, y + 1);
      const far = at(x - 2, y) + at(x + 2, y) + at(x, y - 2) + at(x, y + 2);
      const farH = at(x - 2, y) + at(x + 2, y),
        farV = at(x, y - 2) + at(x, y + 2);
      if (c === 1) {
        // Green pixel: red and blue from the row or the column.
        const rowColor = cfa[y & 1]![(x + 1) & 1]!;
        const colColor = cfa[(y + 1) & 1]![x & 1]!;
        const horiz = (5 * v - farH + 0.5 * farV - diag + 4 * (at(x - 1, y) + at(x + 1, y))) / 8;
        const vert = (5 * v - farV + 0.5 * farH - diag + 4 * (at(x, y - 1) + at(x, y + 1))) / 8;
        out[o + rowColor] = horiz;
        out[o + colColor] = vert;
      } else {
        out[o + 1] = (4 * v - far + 2 * cross) / 8;
        const other = c === 0 ? 2 : 0;
        out[o + other] = (6 * v - 1.5 * far + 2 * diag) / 8;
      }
    }
  return out;
}

/** Any other pattern: each color averaged from the same-color pixels around. */
function demosaicGeneric(m: Float32Array, w: number, h: number, cfa: number[][], ph: number, pw: number): Float32Array {
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sum = [0, 0, 0],
        n = [0, 0, 0];
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const c = cfa[((yy % ph) + ph) % ph]![((xx % pw) + pw) % pw]!;
          const wt = dx === 0 && dy === 0 ? 4 : 1 / (Math.abs(dx) + Math.abs(dy));
          sum[c]! += m[yy * w + xx]! * wt;
          n[c]! += wt;
        }
      for (let c = 0; c < 3; c++) out[(y * w + x) * 3 + c] = n[c]! ? sum[c]! / n[c]! : 0;
    }
  return out;
}

export async function decodeDNG(bytes: Uint8Array): Promise<Decoded> {
  const { r } = readHeader(bytes);
  const le = r.le;
  const ifds = allIFDs(bytes);
  const main = ifds[0]!;
  if (!isDNG(ifds)) throw new Error('This file is a TIFF, not a DNG.');
  const raws = ifds.filter((d) => (num(d, 254) & 1) === 0 && (num(d, 262) === 32803 || num(d, 262) === 34892));
  const ifd = raws.sort((a, b) => num(b, 256) * num(b, 257) - num(a, 256) * num(a, 257))[0];
  if (!ifd) throw new Error('This DNG has no raw picture.');
  const photo = num(ifd, 262);
  const plane = await readRawPlane(bytes, le, ifd);
  let { w, h } = plane;
  const spp = plane.spp;
  // Linearize, black and white levels.
  const lin = nums(ifd, 50712);
  const blackDim = nums(ifd, 50713);
  const blacks = nums(ifd, 50714);
  const white = nums(ifd, 50717);
  const bh = blackDim[0] ?? 1,
    bw = blackDim[1] ?? 1;
  const d = plane.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let s = 0; s < spp; s++) {
        const i = (y * w + x) * spp + s;
        let v = d[i]!;
        if (lin.length) v = lin[Math.min(lin.length - 1, Math.max(0, Math.round(v)))]!;
        const bl = blacks.length ? (blacks[((y % bh) * bw + (x % bw)) * (blacks.length >= bh * bw * spp ? spp : 1) + (blacks.length >= bh * bw * spp ? s : 0)] ?? blacks[0]!) : 0;
        const wl = white[s] ?? white[0] ?? (2 ** plane.bps - 1);
        d[i] = Math.max(0, (v - bl) / Math.max(1, wl - bl));
      }
  // Active area.
  const aa = nums(ifd, 50829);
  let ox = 0,
    oy = 0;
  if (aa.length === 4) {
    oy = aa[0]!;
    ox = aa[1]!;
  }
  // White balance: As Shot Neutral (camera values for gray).
  const neutral = nums(main, 50728);
  const ncam = 3;
  const mulv = neutral.length >= 3 ? neutral.slice(0, 3).map((v) => 1 / Math.max(1e-6, v)) : [1, 1, 1];
  const mn = Math.min(...mulv);
  for (let k = 0; k < 3; k++) mulv[k] = mulv[k]! / mn;
  // Demosaic.
  let rgbCam: Float32Array;
  if (photo === 32803) {
    const dim = nums(ifd, 33421);
    const pat = nums(ifd, 33422);
    const ph = dim[0] ?? 2,
      pw = dim[1] ?? 2;
    const cfa: number[][] = [];
    for (let y = 0; y < ph; y++) {
      cfa.push([]);
      for (let x = 0; x < pw; x++) cfa[y]!.push(pat[y * pw + x] ?? 1);
    }
    // Shift the pattern by the active area's origin.
    const shifted = cfa.map((_, y) => cfa[y]!.map((__, x) => cfa[(y + oy) % ph]![(x + ox) % pw]!));
    // White balance on the mosaic.
    const aw = aa.length === 4 ? aa[3]! - aa[1]! : w,
      ah = aa.length === 4 ? aa[2]! - aa[0]! : h;
    const mosaic = new Float32Array(aw * ah);
    for (let y = 0; y < ah; y++)
      for (let x = 0; x < aw; x++) {
        const c = shifted[y % ph]![x % pw]!;
        mosaic[y * aw + x] = Math.min(1, d[(y + oy) * w + x + ox]! * mulv[c]!);
      }
    rgbCam = ph === 2 && pw === 2 ? demosaicMHC(mosaic, aw, ah, shifted) : demosaicGeneric(mosaic, aw, ah, shifted, ph, pw);
    w = aw;
    h = ah;
  } else {
    // Linear raw: already three colors per pixel.
    rgbCam = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) rgbCam[i * 3 + c] = d[i * spp + Math.min(spp - 1, c)]! * mulv[c]!;
  }
  // Camera → Display P3 (the color matrix nearest daylight).
  const ill1 = num(main, 50778),
    ill2 = num(main, 50779);
  const cm1 = nums(main, 50721),
    cm2 = nums(main, 50722);
  const cm = (ill2 === 21 || ill2 === 23 ? cm2 : ill1 === 21 || ill1 === 23 ? cm1 : cm2.length ? cm2 : cm1).slice(0, 9);
  let M: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (cm.length === 9 && ncam === 3) {
    const camXyz = cm as Mat3;
    const camRgb = mul3(camXyz, P3_TO_XYZ_D65);
    // Rows to 1 (white stays white after white balance).
    for (let rr = 0; rr < 3; rr++) {
      const s = camRgb[rr * 3]! + camRgb[rr * 3 + 1]! + camRgb[rr * 3 + 2]!;
      for (let c = 0; c < 3; c++) camRgb[rr * 3 + c] = camRgb[rr * 3 + c]! / (s || 1);
    }
    M = inv3(camRgb);
  }
  // Exposure and a gentle default tone (as raw developers start from).
  const be = num(main, 50730, 0);
  const ev = Math.pow(2, be + 0.25);
  const tone = (v: number) => {
    const x = Math.max(0, v * ev);
    // Highlight shoulder then the display curve.
    const sh = x <= 0.8 ? x : 0.8 + (1 - Math.exp(-(x - 0.8) * 2.5)) * 0.2;
    const e = sh <= 0.0031308 ? sh * 12.92 : 1.055 * Math.pow(sh, 1 / 2.4) - 0.055;
    // Slight S for contrast.
    return Math.min(1, Math.max(0, e + 0.06 * Math.sin((e - 0.5) * Math.PI) * 0.5 + 0.03 * Math.sin(e * Math.PI)));
  };
  // Default crop.
  const co = nums(ifd, 50719),
    cs = nums(ifd, 50720);
  let cx = 0,
    cy = 0,
    cw = w,
    ch = h;
  if (co.length === 2 && cs.length === 2) {
    cx = Math.round(co[0]!);
    cy = Math.round(co[1]!);
    cw = Math.min(w - cx, Math.round(cs[0]!));
    ch = Math.min(h - cy, Math.round(cs[1]!));
  }
  const out16 = new Uint16Array(cw * ch * 4);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const i = ((y + cy) * w + (x + cx)) * 3;
      const r0 = rgbCam[i]!,
        g0 = rgbCam[i + 1]!,
        b0 = rgbCam[i + 2]!;
      const o = (y * cw + x) * 4;
      out16[o] = Math.round(tone(M[0] * r0 + M[1] * g0 + M[2] * b0) * 65535);
      out16[o + 1] = Math.round(tone(M[3] * r0 + M[4] * g0 + M[5] * b0) * 65535);
      out16[o + 2] = Math.round(tone(M[6] * r0 + M[7] * g0 + M[8] * b0) * 65535);
      out16[o + 3] = 65535;
    }
  // Orientation (EXIF): turn as the camera was held.
  const orient = num(main, 274, 1);
  const turned = orientImage(out16, cw, ch, orient);
  return { width: turned.w, height: turned.h, depth: 16, data: turned.data, icc: ICC_P3(), hasAlpha: false, notes: [] };
}

function orientImage(d: Uint16Array, w: number, h: number, o: number): { w: number; h: number; data: Uint16Array } {
  if (o === 1 || o < 1 || o > 8) return { w, h, data: d };
  const swap = o >= 5;
  const W = swap ? h : w,
    H = swap ? w : h;
  const out = new Uint16Array(W * H * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let nx = x,
        ny = y;
      switch (o) {
        case 2:
          nx = w - 1 - x;
          break;
        case 3:
          nx = w - 1 - x;
          ny = h - 1 - y;
          break;
        case 4:
          ny = h - 1 - y;
          break;
        case 5:
          nx = y;
          ny = x;
          break;
        case 6:
          nx = h - 1 - y;
          ny = x;
          break;
        case 7:
          nx = h - 1 - y;
          ny = w - 1 - x;
          break;
        case 8:
          nx = y;
          ny = w - 1 - x;
          break;
      }
      out.set(d.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (ny * W + nx) * 4);
    }
  return { w: W, h: H, data: out };
}
