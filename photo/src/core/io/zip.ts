// ZIP files (the .lumphoto container, batch outputs): writing with deflate
// (or stored for data that is compressed already) and reading stored and
// deflated entries (archives up to 4 GB).

import { concat, crc32, deflate, inflate, Writer } from './bytes';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** Store without compressing (PNG, JPEG). */
  store?: boolean;
}

export async function zip(entries: ZipEntry[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central = new Writer(1024, true);
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    let body = e.data;
    let method = 0;
    if (!e.store && e.data.length > 64) {
      const z = await deflate(e.data, 'deflate-raw');
      if (z.length < e.data.length) {
        body = z;
        method = 8;
      }
    }
    const local = new Writer(30 + name.length, true);
    local.u32(0x04034b50).u16(20).u16(0x0800).u16(method).u16(0).u16(0x21).u32(crc).u32(body.length).u32(e.data.length).u16(name.length).u16(0).bytes(name);
    parts.push(local.result(), body);
    central.u32(0x02014b50).u16(20).u16(20).u16(0x0800).u16(method).u16(0).u16(0x21).u32(crc).u32(body.length).u32(e.data.length).u16(name.length).u16(0).u16(0).u16(0).u16(0).u32(0).u32(offset).bytes(name);
    offset += 30 + name.length + body.length;
    if (offset > 0xfffffff0) throw new Error('This file is larger than 4 GB, which a .zip without ZIP64 cannot hold.');
  }
  const cd = central.result();
  const end = new Writer(22, true);
  end.u32(0x06054b50).u16(0).u16(0).u16(entries.length).u16(entries.length).u32(cd.length).u32(offset).u16(0);
  return concat([...parts, cd, end.result()]);
}

const MAX_ENTRIES = 100000;

export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
  if (count > MAX_ENTRIES) throw new Error('This zip file has too many entries.');
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new Error('This file is damaged.');
    const method = view.getUint16(at + 10, true);
    const csize = view.getUint32(at + 20, true);
    const nlen = view.getUint16(at + 28, true);
    const xlen = view.getUint16(at + 30, true);
    const clen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nlen));
    at += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new Error('This file is damaged.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + csize > bytes.length) throw new Error('This file is cut short.');
    const raw = bytes.subarray(start, start + csize);
    if (method === 0) out.set(name, raw.slice());
    else if (method === 8) out.set(name, await inflate(raw, 'deflate-raw'));
    else throw new Error(`“${name}” is compressed in a way that cannot be read.`);
  }
  return out;
}
