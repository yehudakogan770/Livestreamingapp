// .lumphoto: Lumora Photo's own file. A zip holding
//   document.json   the document (layers, settings, paths, guides, comps…)
//   rasters/N.bin   each raster's tiles, raw at the document's depth
//   profile.icc     the color profile when it is not a built-in one
//   patterns/ID.png the person's own patterns the document uses
//   preview.png     a small picture of the whole (for the start screen)
// Everything a layer is (masks, styles, text, smart objects with their
// filters, adjustment settings) comes back exactly as saved.

import { Raster, keyX, keyY, tileKey, newTileArray, nextVersion, TILE } from '../raster';
import { profileById, readICC, writeICC, type ColorProfile } from '../color';
import type { Doc, Layer } from '../types';
import { allLayers } from '../layers';
import { getPattern, addPattern, userPatterns } from '../patterns';
import { img } from '../img';
import { base64, unbase64, Writer, Reader } from './bytes';
import { zip, unzip, type ZipEntry } from './zip';
import { encodePNG, decodePNG } from './png';

export const LUMPHOTO_VERSION = 1;

/** The raster bytes: "LPRS", depth, channels, tile count, then x, y and the samples of each tile. */
export function rasterBytes(r: Raster): Uint8Array {
  const per = TILE * TILE * r.channels * (r.depth === 8 ? 1 : r.depth === 16 ? 2 : 4);
  const w = new Writer(16 + r.tiles.size * (8 + per), true);
  w.ascii('LPRS').u8(r.depth).u8(r.channels).u16(0).u32(r.tiles.size);
  for (const [k, t] of r.tiles) {
    w.i32(keyX(k)).i32(keyY(k));
    w.bytes(new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength));
  }
  return w.result();
}

export function rasterFromBytes(b: Uint8Array): Raster {
  const r = new Reader(b, true);
  if (r.ascii(4) !== 'LPRS') throw new Error('A layer in this file is damaged.');
  const depth = r.u8() as 8 | 16 | 32;
  const channels = r.u8() as 1 | 4;
  r.u16();
  const count = r.u32();
  if (![8, 16, 32].includes(depth) || (channels !== 1 && channels !== 4)) throw new Error('A layer in this file is damaged.');
  const out = new Raster(depth, channels);
  for (let i = 0; i < count; i++) {
    const tx = r.i32(),
      ty = r.i32();
    const arr = newTileArray(depth, channels);
    const bytes = r.take(arr.byteLength);
    new Uint8Array(arr.buffer).set(bytes);
    out.tiles.set(tileKey(tx, ty), { data: arr, v: nextVersion() });
  }
  return out;
}

interface Packed {
  format: 'lumphoto';
  version: number;
  app: string;
  doc: unknown;
  profile: { id: string; name: string; custom: boolean };
}

/** JSON with rasters and typed arrays swapped for references. */
function packValue(v: unknown, rasters: Map<Raster, number>): unknown {
  if (v instanceof Raster) {
    let id = rasters.get(v);
    if (id === undefined) {
      id = rasters.size;
      rasters.set(v, id);
    }
    return { $raster: id };
  }
  if (v instanceof Float32Array) return { $f32: base64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  if (v instanceof Uint8Array) return { $u8: base64(v) };
  if (Array.isArray(v)) return v.map((x) => packValue(x, rasters));
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = packValue(x, rasters);
    return o;
  }
  return v;
}

function unpackValue(v: unknown, rasters: Map<number, Raster>): unknown {
  if (Array.isArray(v)) return v.map((x) => unpackValue(x, rasters));
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.$raster === 'number') {
      const r = rasters.get(o.$raster);
      if (!r) throw new Error('A layer in this file is missing its pixels.');
      return r;
    }
    if (typeof o.$f32 === 'string') {
      const b = unbase64(o.$f32);
      return new Float32Array(b.buffer, b.byteOffset, b.byteLength >> 2).slice();
    }
    if (typeof o.$u8 === 'string') return unbase64(o.$u8);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) out[k] = unpackValue(x, rasters);
    return out;
  }
  return v;
}

export interface SaveOptions {
  /** A small picture of the whole, as PNG bytes (made by the caller with the GPU). */
  preview?: Uint8Array;
}

export async function writeLumphoto(doc: Doc, o: SaveOptions = {}): Promise<Uint8Array> {
  const rasters = new Map<Raster, number>();
  const { profile, file: _f, id: _i, ...rest } = doc;
  const packedDoc = packValue({ ...rest, selection: doc.selection ? { mask: doc.selection.mask, bounds: doc.selection.bounds } : null }, rasters);
  const custom = profile.id === 'custom' || !!profile.icc;
  const head: Packed = { format: 'lumphoto', version: LUMPHOTO_VERSION, app: 'Lumora Photo', doc: packedDoc, profile: { id: profile.id, name: profile.name, custom } };
  const entries: ZipEntry[] = [{ name: 'document.json', data: new TextEncoder().encode(JSON.stringify(head)) }];
  for (const [r, id] of rasters) entries.push({ name: `rasters/${id}.bin`, data: rasterBytes(r) });
  if (custom) entries.push({ name: 'profile.icc', data: writeICC(profile) });
  // The person's own patterns this document uses.
  const used = new Set<string>();
  for (const l of allLayers(doc.layers)) {
    if (l.kind === 'fill' && l.content.type === 'pattern') used.add(l.content.pattern);
    if (l.styles?.patternOverlay) used.add(l.styles.patternOverlay.pattern);
  }
  for (const p of userPatterns()) {
    if (!used.has(p.id)) continue;
    const px = new Uint8Array(p.img.w * p.img.h * 4);
    for (let i = 0; i < px.length; i++) px[i] = Math.round(Math.min(1, Math.max(0, p.img.data[i]!)) * 255);
    entries.push({ name: `patterns/${encodeURIComponent(p.id)}.png`, data: await encodePNG(p.img.w, p.img.h, px, { depth: 8, alpha: true }), store: true });
    entries.push({ name: `patterns/${encodeURIComponent(p.id)}.txt`, data: new TextEncoder().encode(p.name) });
  }
  if (o.preview) entries.push({ name: 'preview.png', data: o.preview, store: true });
  return zip(entries);
}

export async function readLumphoto(bytes: Uint8Array): Promise<{ doc: Doc; preview?: Uint8Array }> {
  const files = await unzip(bytes);
  const json = files.get('document.json');
  if (!json) throw new Error('This is not a Lumora Photo file.');
  const head = JSON.parse(new TextDecoder().decode(json)) as Packed;
  if (head.format !== 'lumphoto') throw new Error('This is not a Lumora Photo file.');
  if (head.version > LUMPHOTO_VERSION) throw new Error('This file was saved by a newer Lumora Photo. Update to open it.');
  const rasters = new Map<number, Raster>();
  for (const [name, data] of files) {
    const m = /^rasters\/(\d+)\.bin$/.exec(name);
    if (m) rasters.set(Number(m[1]), rasterFromBytes(data));
  }
  for (const [name, data] of files) {
    const m = /^patterns\/(.+)\.png$/.exec(name);
    if (!m) continue;
    const id = decodeURIComponent(m[1]!);
    if (getPattern(id).id === id) continue;
    const d = await decodePNG(data);
    const p = img(d.width, d.height, 4);
    for (let i = 0; i < p.data.length; i++) p.data[i] = d.data[i]! / (d.depth === 16 ? 65535 : 255);
    const label = files.get(`patterns/${m[1]}.txt`);
    addPattern(label ? new TextDecoder().decode(label) : 'Pattern', p, id);
  }
  const d = unpackValue(head.doc, rasters) as Omit<Doc, 'profile' | 'id'>;
  let profile: ColorProfile = profileById(head.profile.id);
  if (head.profile.custom) {
    const icc = files.get('profile.icc');
    const read = icc ? readICC(icc) : null;
    if (read) profile = read;
  }
  const doc: Doc = {
    ...d,
    id: `doc-${Date.now().toString(36)}`,
    profile,
    channels: d.channels ?? [],
    paths: d.paths ?? [],
    guides: d.guides ?? [],
    comps: d.comps ?? [],
    artboards: d.artboards ?? [],
    slices: d.slices ?? [],
    layers: (d.layers ?? []) as Layer[],
  };
  return { doc, preview: files.get('preview.png') };
}

/** Just the preview picture (the start screen's recent files). */
export async function lumphotoPreview(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    return (await unzip(bytes)).get('preview.png') ?? null;
  } catch {
    return null;
  }
}
