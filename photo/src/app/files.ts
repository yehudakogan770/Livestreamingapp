// Opening, saving and exporting. Every format is listed here with how to
// recognize it, read it and write it.

import { addSession, app, busy, current, toast, bump } from './state';
import { getHost, type FileFilter, type PickedFile } from './host';
import { docFromDecoded } from '../core/doc';
import { readLumphoto, writeLumphoto, lumphotoPreview } from '../core/io/lumphoto';
import { decodePNG, encodePNG, isPNG } from '../core/io/png';
import { decodeTIFF, encodeTIFF, isTIFF } from '../core/io/tiff';
import { decodeWithBrowser, encodeWithBrowser, jpegWithMeta, canEncode } from './decodeBrowser';
import { writeICC, SRGB, convertColor, encode as encodeTrc } from '../core/color';
import { flatten, canvasRect } from './ops/common';
import { resize, type Resample } from '../core/img';
import type { Doc, Rect } from '../core/types';
import type { Decoded } from '../core/io/decoded';
import type { Session } from './session';
import { rememberRecent } from './recent';

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'gif' | 'tiff' | 'bmp' | 'psd' | 'lumphoto';

export const OPEN_FILTERS: FileFilter[] = [
  {
    name: 'Pictures and documents',
    extensions: ['lumphoto', 'psd', 'psb', 'png', 'jpg', 'jpeg', 'jpe', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'dng', 'svg', 'ico'],
  },
  { name: 'Lumora Photo', extensions: ['lumphoto'] },
  { name: 'Photoshop', extensions: ['psd', 'psb'] },
  { name: 'Camera raw (DNG)', extensions: ['dng'] },
];

function ext(name: string): string {
  return (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
}

function sniff(b: Uint8Array, name: string): string {
  if (isPNG(b)) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53) return 'psd';
  if (b[0] === 0x50 && b[1] === 0x4b) return 'lumphoto';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'webp';
  if (String.fromCharCode(...b.subarray(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...b.subarray(8, 12));
    if (/avif|avis/.test(brand)) return 'avif';
    if (/heic|heix|mif1|msf1|hevc/.test(brand)) return 'heic';
  }
  if (isTIFF(b)) return ext(name) === 'dng' ? 'dng' : 'tiff';
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'ico';
  return ext(name);
}

const MIME: Record<string, string> = { jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp', heic: 'image/heic', ico: 'image/x-icon' };

/** A document from a file's bytes. */
export async function docFromBytes(name: string, bytes: Uint8Array): Promise<Doc> {
  const kind = sniff(bytes, name);
  const base = name.replace(/\.[^.]+$/, '') || 'Untitled';
  let doc: Doc;
  if (kind === 'lumphoto') doc = (await readLumphoto(bytes)).doc;
  else if (kind === 'psd') {
    const { readPSD } = await import('../core/io/psd');
    doc = await readPSD(bytes, base);
  } else if (kind === 'dng') {
    const { decodeDNG } = await import('../core/io/dng');
    const d = await decodeDNG(bytes);
    doc = docFromDecoded(base, d);
  } else if (kind === 'svg') {
    const { docFromSvg } = await import('./svgImport');
    doc = await docFromSvg(base, new TextDecoder().decode(bytes));
  } else {
    let d: Decoded;
    if (kind === 'png') d = await decodePNG(bytes);
    else if (kind === 'tiff') d = await decodeTIFF(bytes);
    else if (kind === 'gif' || kind === 'bmp' || kind === 'jpeg' || kind === 'webp' || kind === 'avif' || kind === 'heic' || kind === 'ico') d = await decodeWithBrowser(bytes, MIME[kind]!);
    else throw new Error(`“${name}” is not a picture Lumora Photo can open.`);
    doc = docFromDecoded(base, d);
  }
  doc.name = kind === 'lumphoto' ? doc.name || base : base;
  doc.format = kind;
  return doc;
}

export async function openPicked(files: PickedFile[]): Promise<void> {
  for (const f of files) {
    try {
      const doc = await busy(`Opening ${f.name}…`, () => docFromBytes(f.name, f.bytes));
      doc.file = f.path ?? f.name;
      const s = addSession(doc);
      s.path = f.path ?? null;
      s.handle = f.handle ?? null;
      if (doc.format === 'lumphoto' || doc.format === 'psd') s.markSaved();
      else s.markSaved();
      if (doc.meta?.notes) toast(doc.meta.notes);
      void rememberRecent(f, doc);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }
}

export async function openDialog(): Promise<void> {
  const files = await getHost().openFiles(OPEN_FILTERS, true);
  await openPicked(files);
}

/** Place a file as a smart object in the current document (File ▸ Place Embedded). */
export async function placeFile(): Promise<void> {
  const s = current();
  if (!s) return openDialog();
  const files = await getHost().openFiles(OPEN_FILTERS.slice(0, 1), false);
  const f = files[0];
  if (!f) return;
  try {
    const { placeBytes } = await import('./place');
    await placeBytes(f.name, f.bytes);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}

// ---- saving ----

const SAVE_FILTERS: Record<string, FileFilter> = {
  lumphoto: { name: 'Lumora Photo', extensions: ['lumphoto'] },
  psd: { name: 'Photoshop', extensions: ['psd'] },
  tiff: { name: 'TIFF', extensions: ['tif', 'tiff'] },
  png: { name: 'PNG', extensions: ['png'] },
  jpeg: { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
  webp: { name: 'WebP', extensions: ['webp'] },
  avif: { name: 'AVIF', extensions: ['avif'] },
  gif: { name: 'GIF', extensions: ['gif'] },
  bmp: { name: 'BMP', extensions: ['bmp'] },
};

/** A small PNG of the whole document (for .lumphoto previews and recent files). */
export async function previewPNG(doc: Doc, max = 512): Promise<Uint8Array> {
  const s = Math.min(1, max / Math.max(doc.width, doc.height));
  const full = flatten(doc, canvasRect(doc));
  const small = s < 1 ? resize({ w: doc.width, h: doc.height, c: 4, data: full }, Math.round(doc.width * s), Math.round(doc.height * s), 'bilinear') : { w: doc.width, h: doc.height, c: 4 as const, data: full };
  const px = to8(doc, small.data, true);
  return encodePNG(small.w, small.h, px, { depth: 8, alpha: true });
}

/** Floats to 8-bit (32-bit documents are encoded with their tone curve first). */
function to8(doc: Doc, px: Float32Array, toSrgb = false): Uint8Array {
  const out = new Uint8Array(px.length);
  const lin = doc.depth === 32;
  const conv = toSrgb && doc.profile.id !== 'srgb';
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i]!,
      g = px[i + 1]!,
      b = px[i + 2]!;
    if (lin) {
      r = encodeTrc(doc.profile.trc, Math.max(0, Math.min(1, r)));
      g = encodeTrc(doc.profile.trc, Math.max(0, Math.min(1, g)));
      b = encodeTrc(doc.profile.trc, Math.max(0, Math.min(1, b)));
    }
    if (conv) [r, g, b] = convertColor([r, g, b], doc.profile, SRGB);
    out[i] = Math.round(Math.min(1, Math.max(0, r)) * 255);
    out[i + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
    out[i + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
    out[i + 3] = Math.round(Math.min(1, Math.max(0, px[i + 3]!)) * 255);
  }
  return out;
}

function to16(px: Float32Array): Uint16Array {
  const out = new Uint16Array(px.length);
  for (let i = 0; i < px.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, px[i]!)) * 65535);
  return out;
}

export async function documentBytes(doc: Doc, format: 'lumphoto' | 'psd'): Promise<Uint8Array> {
  if (format === 'psd') {
    const { writePSD } = await import('../core/io/psd');
    return writePSD(doc, flatten(doc, canvasRect(doc)));
  }
  return writeLumphoto(doc, { preview: await previewPNG(doc) });
}

export async function save(s: Session | null = current(), saveAs = false): Promise<boolean> {
  if (!s) return false;
  const fmt = s.doc.format === 'psd' ? 'psd' : 'lumphoto';
  const known = !saveAs && (s.path || s.handle) && (s.doc.format === 'lumphoto' || s.doc.format === 'psd');
  const name = `${s.doc.name}.${fmt === 'psd' ? 'psd' : 'lumphoto'}`;
  try {
    const bytes = await busy('Saving…', () => documentBytes(s.doc, known ? fmt : 'lumphoto'));
    const res = await getHost().saveFile(known ? name : `${s.doc.name}.lumphoto`, bytes, known ? [SAVE_FILTERS[fmt]!] : [SAVE_FILTERS.lumphoto!, SAVE_FILTERS.psd!], known ? { path: s.path, handle: s.handle } : undefined);
    if (!res) return false;
    s.path = res.path ?? s.path;
    s.handle = res.handle ?? s.handle;
    if (!known) s.doc = { ...s.doc, format: /\.psd$/i.test(res.name) ? 'psd' : 'lumphoto', name: res.name.replace(/\.[^.]+$/, '') || s.doc.name };
    s.markSaved();
    void rememberRecent({ name: res.name, bytes, path: res.path, handle: res.handle }, s.doc);
    bump();
    toast(`Saved ${res.name}.`);
    return true;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
    return false;
  }
}

/** Save As in a chosen format (PSD keeps layers; flat formats save the picture). */
export async function saveAsFormat(format: ExportFormat): Promise<void> {
  const s = current();
  if (!s) return;
  if (format === 'lumphoto' || format === 'psd') {
    try {
      const bytes = await busy('Saving…', () => documentBytes(s.doc, format));
      const res = await getHost().saveFile(`${s.doc.name}.${format}`, bytes, [SAVE_FILTERS[format]!]);
      if (!res) return;
      s.path = res.path ?? null;
      s.handle = res.handle ?? null;
      s.doc = { ...s.doc, format };
      s.markSaved();
      bump();
      toast(`Saved ${res.name}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
    return;
  }
  await exportAs({ format, quality: 0.9, scale: 1, depth: s.doc.depth === 8 ? 8 : 16, embedProfile: true, toSrgb: false, transparency: true, background: [1, 1, 1] });
}

// ---- export ----

export interface ExportOptions {
  format: ExportFormat;
  /** 0..1 */
  quality: number;
  /** Size multiplier (or exact width/height below). */
  scale: number;
  width?: number;
  height?: number;
  resample?: Resample;
  depth: 8 | 16;
  embedProfile: boolean;
  /** Convert to sRGB (for the web). */
  toSrgb: boolean;
  transparency: boolean;
  background: [number, number, number];
  /** Only this part (an artboard or slice). */
  rect?: Rect;
  /** GIF: colors and dithering. */
  colors?: number;
  dither?: boolean;
}

export const EXPORT_LABEL: Record<ExportFormat, string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP', avif: 'AVIF', gif: 'GIF', tiff: 'TIFF', bmp: 'BMP', psd: 'Photoshop', lumphoto: 'Lumora Photo' };

export async function exportFormats(): Promise<ExportFormat[]> {
  const list: ExportFormat[] = ['png', 'jpeg', 'webp', 'gif', 'tiff', 'bmp'];
  if (await canEncode('image/avif')) list.splice(3, 0, 'avif');
  if (!(await canEncode('image/webp'))) list.splice(list.indexOf('webp'), 1);
  return list;
}

/** The exported file's bytes. */
export async function exportBytes(doc: Doc, o: ExportOptions): Promise<Uint8Array> {
  const r = o.rect ?? canvasRect(doc);
  let px = flatten(doc, r);
  let w = r.w,
    h = r.h;
  const tw = o.width ?? Math.max(1, Math.round(r.w * o.scale)),
    th = o.height ?? Math.max(1, Math.round(r.h * o.scale));
  if (tw !== w || th !== h) {
    const res = resize({ w, h, c: 4, data: px }, tw, th, o.resample ?? 'bicubic');
    px = res.data;
    w = tw;
    h = th;
  }
  const lin = doc.depth === 32;
  // Encode linear 32-bit documents with the profile's tone curve.
  if (lin && o.format !== 'tiff')
    for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) px[i + k] = encodeTrc(doc.profile.trc, Math.max(0, Math.min(1, px[i + k]!)));
  let profile = doc.profile;
  if (o.toSrgb && profile.id !== 'srgb') {
    for (let i = 0; i < px.length; i += 4) {
      const c = convertColor([px[i]!, px[i + 1]!, px[i + 2]!], profile, SRGB);
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
    }
    profile = SRGB;
  }
  // No transparency in the format (or not wanted): over the background color.
  const flat = !o.transparency || o.format === 'jpeg' || o.format === 'bmp';
  if (flat)
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3]!;
      for (let k = 0; k < 3; k++) px[i + k] = px[i + k]! * a + o.background[k]! * (1 - a);
      px[i + 3] = 1;
    }
  const icc = o.embedProfile ? writeICC(profile) : undefined;
  const hasAlpha = !flat && px.some((v, i) => (i & 3) === 3 && v < 1);
  switch (o.format) {
    case 'png':
      return encodePNG(w, h, o.depth === 16 ? to16(px) : toBytes(px), { depth: o.depth, alpha: hasAlpha, icc, iccName: profile.name, resolution: doc.resolution });
    case 'tiff':
      return encodeTIFF(w, h, lin ? px : o.depth === 16 ? to16(px) : toBytes(px), { depth: lin ? 32 : o.depth, alpha: hasAlpha, icc, resolution: doc.resolution });
    case 'jpeg': {
      const jpg = await encodeWithBrowser(w, h, new Uint8ClampedArray(toBytes(px).buffer), 'image/jpeg', o.quality);
      return jpegWithMeta(jpg, profile.id === 'srgb' && !o.embedProfile ? null : (icc ?? null), doc.resolution);
    }
    case 'webp':
    case 'avif':
      return encodeWithBrowser(w, h, new Uint8ClampedArray(toBytes(px).buffer), o.format === 'webp' ? 'image/webp' : 'image/avif', o.quality);
    case 'gif': {
      const { encodeGIF } = await import('../core/io/gif');
      return encodeGIF(w, h, toBytes(px), o.colors ?? 256, o.dither ?? true);
    }
    case 'bmp': {
      const { encodeBMP } = await import('../core/io/bmp');
      return encodeBMP(w, h, toBytes(px), doc.resolution);
    }
    default:
      return documentBytes(doc, o.format === 'psd' ? 'psd' : 'lumphoto');
  }
}

function toBytes(px: Float32Array): Uint8Array {
  const out = new Uint8Array(px.length);
  for (let i = 0; i < px.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, px[i]!)) * 255);
  return out;
}

const EXT: Record<ExportFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', avif: 'avif', gif: 'gif', tiff: 'tif', bmp: 'bmp', psd: 'psd', lumphoto: 'lumphoto' };

export async function exportAs(o: ExportOptions, name?: string): Promise<boolean> {
  const s = current();
  if (!s) return false;
  try {
    const bytes = await busy('Exporting…', () => exportBytes(s.doc, o));
    const file = `${name ?? s.doc.name}.${EXT[o.format]}`;
    const res = await getHost().saveFile(file, bytes, [SAVE_FILTERS[o.format] ?? { name: EXPORT_LABEL[o.format], extensions: [EXT[o.format]] }]);
    if (res) toast(`Exported ${res.name}.`);
    return !!res;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
    return false;
  }
}

/** Quick Export as PNG (File ▸ Export ▸ Quick Export). */
export function quickExport(): Promise<boolean> {
  const s = current();
  return exportAs({ format: 'png', quality: 1, scale: 1, depth: 8, embedProfile: true, toSrgb: s?.doc.profile.id !== 'srgb', transparency: true, background: [1, 1, 1] });
}

/** Export every artboard (or slice) as its own file. */
export async function exportParts(kind: 'artboards' | 'slices', o: Omit<ExportOptions, 'rect'>): Promise<void> {
  const s = current();
  if (!s) return;
  const parts = kind === 'artboards' ? s.doc.artboards : s.doc.slices;
  if (!parts.length) {
    toast(kind === 'artboards' ? 'This document has no artboards.' : 'This document has no slices.');
    return;
  }
  const { zip } = await import('../core/io/zip');
  const entries = [];
  for (const p of parts) entries.push({ name: `${p.name}.${EXT[o.format]}`, data: await exportBytes(s.doc, { ...o, rect: p.rect }), store: true });
  const bytes = await zip(entries);
  await getHost().saveFile(`${s.doc.name} ${kind}.zip`, bytes, [{ name: 'Zip', extensions: ['zip'] }]);
}

export { lumphotoPreview, app };
