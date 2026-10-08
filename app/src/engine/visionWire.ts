// The vision worker's messages with the unified engine
// (crates/live-engine/src/vision.rs): small frames of the cameras that use
// background removal, blur behind people or auto-framing come in; each
// camera's person mask, the shot auto-framing aims for and the pictures
// behind (and in front of) the people go back.
//
//   frames  := "LVF1" count:u16 (id_len:u16 id:utf8 seq:u64 w:u32 h:u32 rgba{w*h*4})*
//   results := "LVR1" count:u16 result*
//   result  := id_len:u16 id:utf8 flags:u8
//              [mask: w:u16 h:u16 bytes{w*h}]       (flags & 1; else no mask)
//              [shot: cx:f32 cy:f32 zoom:f32]       (flags & 2; else wide)
//              [back: w:u16 h:u16 rgba{w*h*4}]      (flags & 4: 0 × 0 clears it)
//              [front: w:u16 h:u16 rgba{w*h*4}]     (flags & 8: 0 × 0 clears it)
//
// Little endian.

import type { Shot } from './vision';

export interface VisionFrame {
  id: string;
  seq: number;
  w: number;
  h: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

export interface VisionImage {
  w: number;
  h: number;
  rgba: Uint8Array | Uint8ClampedArray;
}

export interface VisionOut {
  id: string;
  /** The person mask, a byte a spot (null: none now — the picture shows as it is). */
  mask: { w: number; h: number; data: Uint8Array } | null;
  /** Where auto-framing aims (null: wide). */
  shot: Shot | null;
  /** The picture behind the people: null clears it, undefined leaves it as it is. */
  back?: VisionImage | null;
  /** A virtual set's desk in front of them (the same). */
  front?: VisionImage | null;
}

/** Read the engine's frames (an empty message is no frames). */
export function decodeFrames(buf: ArrayBuffer | Uint8Array): VisionFrame[] {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 6) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'LVF1') throw new Error('Not a vision frame message.');
  const count = view.getUint16(4, true);
  const out: VisionFrame[] = [];
  let at = 6;
  const need = (n: number) => {
    if (at + n > bytes.length) throw new Error('The vision frames ended too soon.');
  };
  for (let i = 0; i < count; i++) {
    need(2);
    const len = view.getUint16(at, true);
    at += 2;
    need(len + 16);
    const id = new TextDecoder().decode(bytes.subarray(at, at + len));
    at += len;
    const seq = Number(view.getBigUint64(at, true));
    const w = view.getUint32(at + 8, true);
    const h = view.getUint32(at + 12, true);
    at += 16;
    need(w * h * 4);
    out.push({ id, seq, w, h, rgba: new Uint8ClampedArray(bytes.subarray(at, at + w * h * 4)) });
    at += w * h * 4;
  }
  return out;
}

/** One message carrying `results`. */
export function encodeResults(results: VisionOut[]): Uint8Array {
  const ids = results.map((r) => new TextEncoder().encode(r.id));
  let size = 6;
  results.forEach((r, i) => {
    size += 2 + ids[i]!.length + 1;
    if (r.mask) size += 4 + r.mask.w * r.mask.h;
    if (r.shot) size += 12;
    for (const p of [r.back, r.front]) if (p !== undefined) size += 4 + (p ? p.w * p.h * 4 : 0);
  });
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([0x4c, 0x56, 0x52, 0x31], 0);
  view.setUint16(4, results.length, true);
  let at = 6;
  const image = (w: number, h: number, px: Uint8Array | Uint8ClampedArray | null, bpp: number) => {
    view.setUint16(at, w, true);
    view.setUint16(at + 2, h, true);
    at += 4;
    if (px && w && h) {
      out.set(px.subarray(0, w * h * bpp), at);
      at += w * h * bpp;
    }
  };
  results.forEach((r, i) => {
    const id = ids[i]!;
    view.setUint16(at, id.length, true);
    out.set(id, at + 2);
    at += 2 + id.length;
    out[at++] = (r.mask ? 1 : 0) | (r.shot ? 2 : 0) | (r.back !== undefined ? 4 : 0) | (r.front !== undefined ? 8 : 0);
    if (r.mask) image(r.mask.w, r.mask.h, r.mask.data, 1);
    if (r.shot) {
      view.setFloat32(at, r.shot.cx, true);
      view.setFloat32(at + 4, r.shot.cy, true);
      view.setFloat32(at + 8, r.shot.zoom, true);
      at += 12;
    }
    for (const p of [r.back, r.front]) if (p !== undefined) image(p?.w ?? 0, p?.h ?? 0, p?.rgba ?? null, 4);
  });
  return out;
}
