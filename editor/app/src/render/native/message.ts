// The binary message for one frame: `[u32 header length][MessagePack header][pixels]`.
// The engine reads it in crates/studio-engine/src/plan.rs.
import { pack } from './msgpack';
import type { Recorded } from './record';

export type UploadKind = 'straight' | 'raw' | 'alpha';

export interface Upload {
  id: string;
  w: number;
  h: number;
  /** Depth of a 3D picture (a LUT), 0 for a flat one. */
  d: number;
  kind: UploadKind;
  data: Uint8Array;
}

export function encodeFrame(frame: number, rec: Recorded, uploads: Upload[], free: string[], now: boolean): Uint8Array {
  let at = 0;
  const list = uploads.map((u) => {
    const e = { id: u.id, w: u.w, h: u.h, d: u.d, kind: u.kind, at, len: u.data.length };
    at += u.data.length;
    return e;
  });
  const header = pack({
    frame,
    w: rec.w,
    h: rec.h,
    background: rec.background,
    out: rec.out,
    passes: rec.passes,
    videos: rec.videos,
    uploads: list,
    free,
    now,
  });
  const out = new Uint8Array(4 + header.length + at);
  new DataView(out.buffer).setUint32(0, header.length, true);
  out.set(header, 4);
  let p = 4 + header.length;
  for (const u of uploads) {
    out.set(u.data, p);
    p += u.data.length;
  }
  return out;
}
