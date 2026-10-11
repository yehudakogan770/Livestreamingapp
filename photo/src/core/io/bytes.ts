// Byte helpers for the file readers and writers: compression through the
// platform's (De)CompressionStream, CRC-32, Adler-32, and growable writers.

type Format = 'deflate' | 'deflate-raw' | 'gzip';

async function pipe(data: Uint8Array, t: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const src = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(data);
      c.close();
    },
  });
  const out = src.pipeThrough(t as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  const reader = out.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.length;
  }
  return concat(parts, n);
}

export function deflate(data: Uint8Array, format: Format = 'deflate'): Promise<Uint8Array> {
  return pipe(data, new CompressionStream(format) as unknown as TransformStream<Uint8Array, Uint8Array>);
}

export function inflate(data: Uint8Array, format: Format = 'deflate'): Promise<Uint8Array> {
  return pipe(data, new DecompressionStream(format) as unknown as TransformStream<Uint8Array, Uint8Array>);
}

export function concat(parts: Uint8Array[], total?: number): Uint8Array {
  const n = total ?? parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, start = 0xffffffff): number {
  let c = start;
  for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A growable big- or little-endian byte writer. */
export class Writer {
  private buf: Uint8Array;
  private view: DataView;
  pos = 0;
  readonly le: boolean;

  constructor(size = 1 << 16, littleEndian = false) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
    this.le = littleEndian;
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.pos));
    this.buf = b;
    this.view = new DataView(b.buffer);
  }

  u8(v: number): this {
    this.ensure(1);
    this.buf[this.pos++] = v & 255;
    return this;
  }
  i8(v: number): this {
    this.ensure(1);
    this.view.setInt8(this.pos++, v);
    return this;
  }
  u16(v: number): this {
    this.ensure(2);
    this.view.setUint16(this.pos, v, this.le);
    this.pos += 2;
    return this;
  }
  i16(v: number): this {
    this.ensure(2);
    this.view.setInt16(this.pos, v, this.le);
    this.pos += 2;
    return this;
  }
  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.pos, v >>> 0, this.le);
    this.pos += 4;
    return this;
  }
  i32(v: number): this {
    this.ensure(4);
    this.view.setInt32(this.pos, v, this.le);
    this.pos += 4;
    return this;
  }
  u64(v: number): this {
    this.ensure(8);
    this.view.setUint32(this.le ? this.pos + 4 : this.pos, Math.floor(v / 4294967296), this.le);
    this.view.setUint32(this.le ? this.pos : this.pos + 4, v >>> 0, this.le);
    this.pos += 8;
    return this;
  }
  f32(v: number): this {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, this.le);
    this.pos += 4;
    return this;
  }
  f64(v: number): this {
    this.ensure(8);
    this.view.setFloat64(this.pos, v, this.le);
    this.pos += 8;
    return this;
  }
  bytes(b: Uint8Array): this {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
    return this;
  }
  ascii(s: string): this {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
    return this;
  }
  zeros(n: number): this {
    this.ensure(n);
    this.buf.fill(0, this.pos, this.pos + n);
    this.pos += n;
    return this;
  }
  /** Patch a u32 written earlier. */
  setU32(at: number, v: number): void {
    this.view.setUint32(at, v >>> 0, this.le);
  }
  setU16(at: number, v: number): void {
    this.view.setUint16(at, v, this.le);
  }
  setU64(at: number, v: number): void {
    this.view.setUint32(this.le ? at + 4 : at, Math.floor(v / 4294967296), this.le);
    this.view.setUint32(this.le ? at : at + 4, v >>> 0, this.le);
  }
  /** Pad to a multiple of n. */
  align(n: number): this {
    while (this.pos % n) this.u8(0);
    return this;
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

/** A bounds-checked reader. */
export class Reader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  pos: number;
  le: boolean;

  constructor(bytes: Uint8Array, littleEndian = false, pos = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.le = littleEndian;
    this.pos = pos;
  }

  get left(): number {
    return this.bytes.length - this.pos;
  }

  need(n: number): void {
    if (n < 0 || this.pos + n > this.bytes.length) throw new Error('The file ends early (it may be damaged or cut short).');
  }
  u8(): number {
    this.need(1);
    return this.bytes[this.pos++]!;
  }
  i8(): number {
    this.need(1);
    return this.view.getInt8(this.pos++);
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, this.le);
    this.pos += 2;
    return v;
  }
  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, this.le);
    this.pos += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, this.le);
    this.pos += 4;
    return v;
  }
  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, this.le);
    this.pos += 4;
    return v;
  }
  u64(): number {
    this.need(8);
    const hi = this.view.getUint32(this.le ? this.pos + 4 : this.pos, this.le);
    const lo = this.view.getUint32(this.le ? this.pos : this.pos + 4, this.le);
    this.pos += 8;
    return hi * 4294967296 + lo;
  }
  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, this.le);
    this.pos += 4;
    return v;
  }
  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, this.le);
    this.pos += 8;
    return v;
  }
  take(n: number): Uint8Array {
    this.need(n);
    const v = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  ascii(n: number): string {
    return String.fromCharCode(...this.take(n));
  }
  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }
}

export function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unbase64(s: string): Uint8Array {
  const b = atob(s);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
