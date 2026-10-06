// A small MessagePack writer for the frames sent to the native engine
// (compact, and quick to read in Rust). Whole numbers are written as
// integers, others as 64-bit floats; `undefined` object fields are left out.

type Value = null | undefined | boolean | number | string | Uint8Array | Value[] | { [k: string]: Value };

class Writer {
  private buf = new Uint8Array(4096);
  private view = new DataView(this.buf.buffer);
  len = 0;

  private room(n: number) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) {
    this.room(1);
    this.buf[this.len++] = v;
  }
  u16(v: number) {
    this.room(2);
    this.view.setUint16(this.len, v);
    this.len += 2;
  }
  u32(v: number) {
    this.room(4);
    this.view.setUint32(this.len, v);
    this.len += 4;
  }
  f64(v: number) {
    this.room(8);
    this.view.setFloat64(this.len, v);
    this.len += 8;
  }
  bytes(b: Uint8Array) {
    this.room(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

const utf8 = new TextEncoder();

function put(w: Writer, v: Value): void {
  if (v === null || v === undefined) return w.u8(0xc0);
  if (v === true) return w.u8(0xc3);
  if (v === false) return w.u8(0xc2);
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) <= 0xffffffff) {
      if (v >= 0 && v < 128) return w.u8(v);
      if (v < 0 && v >= -32) return w.u8(0xe0 | (v + 32));
      if (v >= 0) {
        if (v < 0x100) return (w.u8(0xcc), w.u8(v));
        if (v < 0x10000) return (w.u8(0xcd), w.u16(v));
        return (w.u8(0xce), w.u32(v));
      }
      if (v >= -0x80000000) {
        w.u8(0xd2);
        return w.u32(v >>> 0);
      }
    }
    w.u8(0xcb);
    return w.f64(v);
  }
  if (typeof v === 'string') {
    const b = utf8.encode(v);
    if (b.length < 32) w.u8(0xa0 | b.length);
    else if (b.length < 0x100) (w.u8(0xd9), w.u8(b.length));
    else if (b.length < 0x10000) (w.u8(0xda), w.u16(b.length));
    else (w.u8(0xdb), w.u32(b.length));
    return w.bytes(b);
  }
  if (v instanceof Uint8Array) {
    if (v.length < 0x100) (w.u8(0xc4), w.u8(v.length));
    else if (v.length < 0x10000) (w.u8(0xc5), w.u16(v.length));
    else (w.u8(0xc6), w.u32(v.length));
    return w.bytes(v);
  }
  if (Array.isArray(v)) {
    if (v.length < 16) w.u8(0x90 | v.length);
    else if (v.length < 0x10000) (w.u8(0xdc), w.u16(v.length));
    else (w.u8(0xdd), w.u32(v.length));
    for (const x of v) put(w, x);
    return;
  }
  const keys = Object.keys(v).filter((k) => v[k] !== undefined);
  if (keys.length < 16) w.u8(0x80 | keys.length);
  else if (keys.length < 0x10000) (w.u8(0xde), w.u16(keys.length));
  else (w.u8(0xdf), w.u32(keys.length));
  for (const k of keys) {
    put(w, k);
    put(w, v[k]);
  }
}

export function pack(v: unknown): Uint8Array {
  const w = new Writer();
  put(w, v as Value);
  return w.done();
}
