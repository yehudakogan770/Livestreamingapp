// Template packs: titles out and back in with what the pack says about
// itself; zips made by other tools (deflated) read too; broken ones refused.

import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PACK_FORMAT, readPack, writePack } from './titlePack';
import { starterTemplates } from './templates';
import { unzip } from './unzip';
import { crc32 } from './zip';

/** A zip with deflated entries, as other tools write them. */
function deflatedZip(files: { name: string; text: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let off = 0;
  for (const f of files) {
    const raw = enc.encode(f.text);
    const data = new Uint8Array(deflateRawSync(raw));
    const name = enc.encode(f.name);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(8, 8, true);
    h.setUint32(14, crc32(raw), true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, raw.length, true);
    h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(10, 8, true);
    c.setUint32(16, crc32(raw), true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, raw.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let k = 0;
  for (const p of all) {
    out.set(p, k);
    k += p.length;
  }
  return out;
}

describe('template packs', () => {
  it('carries titles, thumbnails and what the pack is', async () => {
    const titles = starterTemplates().slice(0, 3);
    const thumb = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const bytes = await writePack({ name: 'News look', author: 'Studio A', version: '1.2.0', license: 'CC-BY-4.0', tags: ['news'] }, titles, [thumb, null, null]);
    const files = await unzip(bytes);
    expect(files[0]!.name).toBe('pack.json');
    expect(files.some((f) => f.name.startsWith('thumbs/'))).toBe(true);
    const back = await readPack(bytes);
    expect(back.info.format).toBe(PACK_FORMAT);
    expect(back.info).toMatchObject({ name: 'News look', author: 'Studio A', version: '1.2.0', license: 'CC-BY-4.0', tags: ['news'] });
    expect(back.titles.map((t) => t.name)).toEqual(titles.map((t) => t.name));
    expect(back.titles[0]!.compositions[0]!.layers.length).toBe(titles[0]!.compositions[0]!.layers.length);
    expect(back.problems).toEqual([]);
  });

  it('keeps titles with the same name apart', async () => {
    const t = starterTemplates()[0]!;
    const back = await readPack(await writePack({ name: 'Twins' }, [t, { ...t, id: 'other' }]));
    expect(back.titles.length).toBe(2);
    expect(back.info.titles.map((x) => x.file)).toEqual(['titles/name-and-role.lumtitle', 'titles/name-and-role-2.lumtitle']);
  });

  it('reads a zip of .lumtitle files made by another tool (deflated, no pack.json)', async () => {
    const t = starterTemplates()[1]!;
    const bytes = deflatedZip([
      { name: 'folder/', text: '' },
      { name: 'folder/a.lumtitle', text: JSON.stringify(t) },
      { name: 'folder/notes.txt', text: 'hello' },
      { name: 'folder/broken.lumtitle', text: '{"nope":1}' },
    ]);
    const back = await readPack(bytes, 'From a zip');
    expect(back.info.name).toBe('From a zip');
    expect(back.titles.map((x) => x.name)).toEqual([t.name]);
    expect(back.problems.length).toBe(1);
  });

  it('refuses what is not a zip', async () => {
    await expect(readPack(new TextEncoder().encode('just text'))).rejects.toThrow(/not a zip/);
    const ok = await writePack({ name: 'x' }, starterTemplates().slice(0, 1));
    await expect(readPack(ok.slice(0, ok.length - 30))).rejects.toThrow();
  });
});
