// Reading .zip files (template packs, also zipped by other tools): stored
// and deflated entries.

export interface UnzipEntry {
  name: string;
  data: Uint8Array;
}

const MAX_ENTRIES = 5000;
const MAX_TOTAL = 512 * 1024 * 1024;

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read compressed zip files.');
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(data);
      c.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files in a .zip (folders left out). */
export async function unzip(bytes: Uint8Array): Promise<UnzipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end of central directory record: the last 22+ bytes.
  let eocd = -1;
  for (let k = bytes.length - 22; k >= Math.max(0, bytes.length - 65557); k--) {
    if (view.getUint32(k, true) === 0x06054b50) {
      eocd = k;
      break;
    }
  }
  if (eocd < 0) throw new Error('This is not a zip file.');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  if (count > MAX_ENTRIES) throw new Error('This zip file has too many files.');
  const dec = new TextDecoder();
  const out: UnzipEntry[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new Error('This zip file is damaged.');
    const method = view.getUint16(at + 10, true);
    const csize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nlen = view.getUint16(at + 28, true);
    const xlen = view.getUint16(at + 30, true);
    const clen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nlen));
    at += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    total += size;
    if (total > MAX_TOTAL) throw new Error('This zip file is too large.');
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new Error('This zip file is damaged.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + csize);
    if (method === 0) out.push({ name, data: raw.slice() });
    else if (method === 8) out.push({ name, data: await inflate(raw) });
    else throw new Error(`“${name}” is compressed in a way that cannot be read.`);
  }
  return out;
}
