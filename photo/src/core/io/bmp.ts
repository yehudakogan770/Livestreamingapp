// BMP writing: 24-bit, or 32-bit with alpha (BITMAPV4HEADER) when the
// picture has see-through pixels.

import { Writer } from './bytes';

export function encodeBMP(width: number, height: number, rgba: Uint8Array, resolution = 72): Uint8Array {
  let alpha = false;
  for (let i = 3; i < rgba.length; i += 4)
    if (rgba[i]! < 255) {
      alpha = true;
      break;
    }
  const bpp = alpha ? 32 : 24;
  const rowBytes = alpha ? width * 4 : (width * 3 + 3) & ~3;
  const headerSize = alpha ? 108 : 40;
  const dataOff = 14 + headerSize;
  const size = dataOff + rowBytes * height;
  const ppm = Math.round(resolution / 0.0254);
  const w = new Writer(size, true);
  w.ascii('BM').u32(size).u32(0).u32(dataOff);
  w.u32(headerSize).i32(width).i32(height).u16(1).u16(bpp).u32(alpha ? 3 : 0).u32(rowBytes * height).i32(ppm).i32(ppm).u32(0).u32(0);
  if (alpha) {
    w.u32(0x00ff0000).u32(0x0000ff00).u32(0x000000ff).u32(0xff000000);
    w.ascii('BGRs');
    w.zeros(36 + 12);
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      w.u8(rgba[i + 2]!).u8(rgba[i + 1]!).u8(rgba[i]!);
      if (alpha) w.u8(rgba[i + 3]!);
    }
    if (!alpha) w.zeros(rowBytes - width * 3);
  }
  return w.result();
}
