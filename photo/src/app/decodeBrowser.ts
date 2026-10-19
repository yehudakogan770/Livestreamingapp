// Pictures the browser decodes (JPEG, WebP, AVIF, GIF, BMP, ICO, and HEIC
// where the system supports it), read without the browser's color
// conversion so the embedded ICC profile can be used; and encoders that use
// the browser (JPEG, WebP, AVIF).

import type { Decoded } from '../core/io/decoded';
import { readICC } from '../core/color';
import { concat } from '../core/io/bytes';

/** The ICC profile inside a JPEG (APP2 ICC_PROFILE segments, in order). */
export function jpegICC(b: Uint8Array): Uint8Array | undefined {
  if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  const parts: { seq: number; data: Uint8Array }[] = [];
  let i = 2;
  while (i + 4 < b.length) {
    if (b[i] !== 0xff) break;
    const marker = b[i + 1]!;
    if (marker === 0xda || marker === 0xd9) break;
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (marker === 0xe2 && len > 16) {
      const sig = String.fromCharCode(...b.subarray(i + 4, i + 15));
      if (sig === 'ICC_PROFILE') parts.push({ seq: b[i + 16]!, data: b.subarray(i + 18, i + 2 + len) });
    }
    i += 2 + len;
  }
  if (!parts.length) return undefined;
  parts.sort((a, c) => a.seq - c.seq);
  return concat(parts.map((p) => p.data));
}

/** The JPEG's pixels per inch (JFIF density), if set. */
export function jpegDPI(b: Uint8Array): number | undefined {
  if (b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff || b[3] !== 0xe0) return undefined;
  if (String.fromCharCode(...b.subarray(6, 10)) !== 'JFIF') return undefined;
  const unit = b[13]!;
  const x = (b[14]! << 8) | b[15]!;
  if (unit === 1) return x;
  if (unit === 2) return Math.round(x * 2.54);
  return undefined;
}

/** The ICC profile inside a WebP (the ICCP chunk). */
export function webpICC(b: Uint8Array): Uint8Array | undefined {
  if (String.fromCharCode(...b.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...b.subarray(8, 12)) !== 'WEBP') return undefined;
  let i = 12;
  while (i + 8 <= b.length) {
    const id = String.fromCharCode(...b.subarray(i, i + 4));
    const len = b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | (b[i + 7]! << 24);
    if (id === 'ICCP') return b.slice(i + 8, i + 8 + len);
    i += 8 + len + (len & 1);
  }
  return undefined;
}

export async function decodeWithBrowser(bytes: Uint8Array, mime: string): Promise<Decoded> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const icc = mime === 'image/jpeg' ? jpegICC(bytes) : mime === 'image/webp' ? webpICC(bytes) : undefined;
  // Our own color management when the profile is one we can use; else let the browser convert to sRGB.
  const usable = icc ? !!readICC(icc) : true;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { colorSpaceConversion: usable ? 'none' : 'default', premultiplyAlpha: 'none', imageOrientation: 'from-image' });
  } catch {
    if (mime === 'image/heic' || mime === 'image/heif')
      throw new Error('HEIC pictures can be opened where the system can read them (Safari on a Mac). Save it as JPEG or PNG first.');
    throw new Error('This picture could not be read. It may be damaged, or in a format this browser cannot open.');
  }
  const w = bmp.width,
    h = bmp.height;
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const data = ctx.getImageData(0, 0, w, h).data;
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4)
    if (data[i]! < 255) {
      hasAlpha = true;
      break;
    }
  const notes: string[] = [];
  if (icc && !usable) notes.push('Its color profile was converted to sRGB as it was opened.');
  return {
    width: w,
    height: h,
    depth: 8,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    icc: usable ? icc : undefined,
    resolution: mime === 'image/jpeg' ? jpegDPI(bytes) : undefined,
    hasAlpha,
    notes,
  };
}

const supported = new Map<string, boolean>();

/** Can this browser write the format with a canvas? */
export async function canEncode(mime: string): Promise<boolean> {
  if (supported.has(mime)) return supported.get(mime)!;
  let ok = false;
  try {
    const c = new OffscreenCanvas(2, 2);
    c.getContext('2d');
    const b = await c.convertToBlob({ type: mime });
    ok = b.type === mime;
  } catch {
    ok = false;
  }
  supported.set(mime, ok);
  return ok;
}

/** Encode 8-bit RGBA with the browser (JPEG, WebP, AVIF). */
export async function encodeWithBrowser(w: number, h: number, rgba: Uint8ClampedArray, mime: string, quality: number): Promise<Uint8Array> {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  const b = await c.convertToBlob({ type: mime, quality });
  if (b.type !== mime) throw new Error(`This browser cannot save ${mime.replace('image/', '').toUpperCase()} files.`);
  return new Uint8Array(await b.arrayBuffer());
}

/** Put an ICC profile and a resolution into a JPEG the browser made. */
export function jpegWithMeta(jpg: Uint8Array, icc: Uint8Array | null, dpi: number | null): Uint8Array {
  if (jpg[0] !== 0xff || jpg[1] !== 0xd8) return jpg;
  const out = jpg.slice();
  // JFIF density.
  if (dpi && out[2] === 0xff && out[3] === 0xe0 && String.fromCharCode(...out.subarray(6, 10)) === 'JFIF') {
    out[13] = 1;
    out[14] = (dpi >> 8) & 255;
    out[15] = dpi & 255;
    out[16] = (dpi >> 8) & 255;
    out[17] = dpi & 255;
  }
  if (!icc) return out;
  // APP2 segments of up to 65519 bytes of profile each, after APP0.
  const chunk = 65519;
  const n = Math.ceil(icc.length / chunk);
  const segs: Uint8Array[] = [];
  for (let k = 0; k < n; k++) {
    const part = icc.subarray(k * chunk, (k + 1) * chunk);
    const len = part.length + 16;
    const seg = new Uint8Array(2 + len);
    seg[0] = 0xff;
    seg[1] = 0xe2;
    seg[2] = len >> 8;
    seg[3] = len & 255;
    seg.set(new TextEncoder().encode('ICC_PROFILE'), 4);
    seg[15] = 0;
    seg[16] = k + 1;
    seg[17] = n;
    seg.set(part, 18);
    segs.push(seg);
  }
  let at = 2;
  if (out[2] === 0xff && out[3] === 0xe0) at = 4 + ((out[4]! << 8) | out[5]!);
  return concat([out.subarray(0, at), ...segs, out.subarray(at)]);
}
