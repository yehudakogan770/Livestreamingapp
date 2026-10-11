// What every image reader hands back: interleaved RGBA at 8, 16 or 32 bits.

import type { Depth } from '../types';

export interface Decoded {
  width: number;
  height: number;
  depth: Depth;
  /** RGBA interleaved: Uint8Array (8-bit), Uint16Array (16-bit) or Float32Array (32-bit). */
  data: Uint8Array | Uint16Array | Float32Array | Uint8ClampedArray;
  icc?: Uint8Array;
  /** Pixels per inch. */
  resolution?: number;
  hasAlpha: boolean;
  gray?: boolean;
  /** Extra things a reader noticed (shown once after opening). */
  notes?: string[];
}

/** Float RGBA 0..1 from any decoded data. */
export function toFloat(d: Decoded): Float32Array {
  if (d.data instanceof Float32Array) return d.data;
  const s = d.depth === 16 ? 1 / 65535 : 1 / 255;
  const out = new Float32Array(d.data.length);
  for (let i = 0; i < out.length; i++) out[i] = d.data[i]! * s;
  return out;
}
