// The unified engine's graphics wire format (crates/live-engine/src/overlay.rs):
// each record is one plane of a screen and the rectangles of it that changed.
//
//   message := "LOV1" count:u16 record*
//   record  := op:u8 screen:u8 name_len:u16 name:utf8 w:u32 h:u32 at:u64 n:u32
//              (x:u32 y:u32 rw:u32 rh:u32){n} pixels
//   op      := 1 patch | 2 clear | 3 reset the screen
//
// Little endian; pixels are straight-alpha RGBA rows (as getImageData gives them).

import type { ScreenId } from './types/ScreenId';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type WireRecord =
  | { op: 'patch'; screen: ScreenId; name: string; w: number; h: number; at: number; rects: { rect: Rect; pixels: Uint8Array | Uint8ClampedArray }[] }
  | { op: 'clear'; screen: ScreenId; name: string; w: number; h: number; at: number }
  | { op: 'reset'; screen: ScreenId; at: number };

const SCREEN: Record<ScreenId, number> = { live: 0, back: 1, monitor: 2 };
const OP = { patch: 1, clear: 2, reset: 3 } as const;

/** One message carrying `records`. */
export function encodeWire(records: WireRecord[]): Uint8Array {
  const names = records.map((r) => new TextEncoder().encode(r.op === 'reset' ? '' : r.name));
  let size = 6;
  records.forEach((r, i) => {
    size += 1 + 1 + 2 + names[i]!.length + 4 + 4 + 8 + 4;
    if (r.op === 'patch') for (const { rect } of r.rects) size += 16 + rect.w * rect.h * 4;
  });
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([0x4c, 0x4f, 0x56, 0x31], 0);
  view.setUint16(4, records.length, true);
  let at = 6;
  records.forEach((r, i) => {
    const name = names[i]!;
    view.setUint8(at, OP[r.op]);
    view.setUint8(at + 1, SCREEN[r.screen]);
    view.setUint16(at + 2, name.length, true);
    at += 4;
    out.set(name, at);
    at += name.length;
    const [w, h] = r.op === 'reset' ? [0, 0] : [r.w, r.h];
    view.setUint32(at, w, true);
    view.setUint32(at + 4, h, true);
    view.setBigUint64(at + 8, BigInt(Math.max(0, Math.round(r.at))), true);
    const rects = r.op === 'patch' ? r.rects : [];
    view.setUint32(at + 16, rects.length, true);
    at += 20;
    for (const { rect } of rects) {
      view.setUint32(at, rect.x, true);
      view.setUint32(at + 4, rect.y, true);
      view.setUint32(at + 8, rect.w, true);
      view.setUint32(at + 12, rect.h, true);
      at += 16;
    }
    for (const { rect, pixels } of rects) {
      const n = rect.w * rect.h * 4;
      out.set(pixels.subarray(0, n), at);
      at += n;
    }
  });
  return out;
}

/** The pixels of `rect` out of a whole `width`-wide RGBA image (rows copied as they are). */
export function cutRect(image: Uint8ClampedArray | Uint8Array, width: number, rect: Rect): Uint8Array {
  if (rect.x === 0 && rect.w === width) return new Uint8Array(image.buffer, image.byteOffset + rect.y * width * 4, rect.w * rect.h * 4);
  const out = new Uint8Array(rect.w * rect.h * 4);
  for (let row = 0; row < rect.h; row++) {
    const start = ((rect.y + row) * width + rect.x) * 4;
    out.set(image.subarray(start, start + rect.w * 4), row * rect.w * 4);
  }
  return out;
}
