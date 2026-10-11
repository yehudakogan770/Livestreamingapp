// The Display P3 profile developed raw files are tagged with.

import { DISPLAY_P3, writeICC } from '../color';

let cached: Uint8Array | null = null;

export function ICC_P3(): Uint8Array {
  if (!cached) cached = writeICC(DISPLAY_P3);
  return cached;
}
