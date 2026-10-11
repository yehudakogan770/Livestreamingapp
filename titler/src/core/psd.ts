// Photoshop files (.psd) read into layers: each pixel layer with its place,
// size, opacity, blend mode and whether it is shown, and layer groups as
// groups. 8 and 16 bits a channel, RGB and grayscale; raw and RLE data.
// Layer masks, effects and adjustment layers are not read (the notes say
// so); text and smart objects come in as the pictures Photoshop keeps of them.

export type PsdBlend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'add';

export type PsdNode =
  | {
      kind: 'image';
      name: string;
      left: number;
      top: number;
      width: number;
      height: number;
      /** RGBA, 8 bits a channel, width × height. */
      rgba: Uint8ClampedArray;
      opacity: number;
      visible: boolean;
      blend: PsdBlend;
    }
  | { kind: 'group'; name: string; children: PsdNode[]; opacity: number; visible: boolean; blend: PsdBlend };

export interface PsdFile {
  width: number;
  height: number;
  /** Front first (the top layer in Photoshop first). */
  layers: PsdNode[];
  notes: string[];
}

const BLENDS: Record<string, PsdBlend> = {
  norm: 'normal',
  pass: 'normal',
  'mul ': 'multiply',
  scrn: 'screen',
  over: 'overlay',
  dark: 'darken',
  lite: 'lighten',
  lddg: 'add',
};

export const isPsd = (b: Uint8Array) => b.length > 26 && b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53;

class Reader {
  pos = 0;
  private v: DataView;
  constructor(private b: Uint8Array) {
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  need(n: number) {
    if (this.pos + n > this.b.length) throw new Error('This Photoshop file is cut short.');
  }
  u8() {
    this.need(1);
    return this.b[this.pos++]!;
  }
  u16() {
    this.need(2);
    const n = this.v.getUint16(this.pos);
    this.pos += 2;
    return n;
  }
  i16() {
    this.need(2);
    const n = this.v.getInt16(this.pos);
    this.pos += 2;
    return n;
  }
  u32() {
    this.need(4);
    const n = this.v.getUint32(this.pos);
    this.pos += 4;
    return n;
  }
  i32() {
    this.need(4);
    const n = this.v.getInt32(this.pos);
    this.pos += 4;
    return n;
  }
  str(n: number) {
    this.need(n);
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.b[this.pos + i]!);
    this.pos += n;
    return s;
  }
  bytes(n: number) {
    this.need(n);
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  skip(n: number) {
    this.need(n);
    this.pos += n;
  }
}

interface LayerRec {
  name: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  channels: { id: number; length: number }[];
  blend: PsdBlend;
  blendKey: string;
  opacity: number;
  clipping: boolean;
  visible: boolean;
  /** 0 a layer, 1 or 2 a group (open, closed), 3 the end of a group. */
  section: number;
  adjustment: boolean;
  hasMask: boolean;
  /** A text layer (it comes in as the picture Photoshop keeps of it). */
  text: boolean;
}

/** Keys of the extra layer information that make a layer an adjustment or fill layer. */
const ADJUSTMENTS = new Set(['levl', 'curv', 'brit', 'blnc', 'hue2', 'hue ', 'selc', 'mixr', 'grdm', 'phfl', 'expA', 'vibA', 'nvrt', 'thrs', 'post', 'clrL', 'SoCo', 'GdFl', 'PtFl', 'blwh']);

export function readPsd(bytes: Uint8Array): PsdFile {
  if (!isPsd(bytes)) throw new Error('This is not a Photoshop file.');
  const r = new Reader(bytes);
  r.skip(4);
  const version = r.u16();
  if (version !== 1) throw new Error('Large-document Photoshop files (.psb) cannot be read; save it as .psd.');
  r.skip(6);
  r.u16(); // channels of the merged picture
  const height = r.u32();
  const width = r.u32();
  const depth = r.u16();
  const mode = r.u16();
  if (depth !== 8 && depth !== 16) throw new Error(`Photoshop files of ${depth} bits a channel cannot be read; save it in 8 bits.`);
  if (mode !== 3 && mode !== 1) throw new Error('Only RGB and grayscale Photoshop files can be read; change the mode to RGB in Photoshop.');
  if (!width || !height || width > 30000 || height > 30000) throw new Error('This Photoshop file has a size that cannot be read.');
  r.skip(r.u32()); // color mode data
  r.skip(r.u32()); // image resources
  const notes = new Set<string>();
  const layerAndMask = r.u32();
  const end = r.pos + layerAndMask;
  if (!layerAndMask) return { width, height, layers: [], notes: ['The file has no layers (only a flat picture), so nothing was brought in.'] };
  const infoLength = r.u32();
  const infoEnd = r.pos + infoLength;
  if (!infoLength) return { width, height, layers: [], notes: ['The file has no layers (only a flat picture), so nothing was brought in.'] };
  const count = Math.abs(r.i16());
  const records: LayerRec[] = [];
  for (let i = 0; i < count; i++) records.push(readRecord(r, notes));
  // The pictures, layer after layer, channel after channel.
  const bpc = depth / 8;
  const pictures: (Uint8ClampedArray | null)[] = [];
  for (const rec of records) {
    const w = rec.right - rec.left;
    const h = rec.bottom - rec.top;
    const rgba = w > 0 && h > 0 && w * h <= 40_000_000 ? new Uint8ClampedArray(w * h * 4) : null;
    if (rgba) for (let k = 3; k < rgba.length; k += 4) rgba[k] = 255;
    for (const ch of rec.channels) {
      const start = r.pos;
      const after = start + ch.length;
      // A layer mask has its own size: not read.
      if (ch.id < -1 || !rgba) {
        r.pos = after;
        continue;
      }
      const data = channelData(r, ch.length, w, h, bpc);
      r.pos = after;
      const slot = ch.id === -1 ? 3 : mode === 1 ? -1 : ch.id;
      if (data)
        for (let k = 0, n = w * h; k < n; k++) {
          const v = data[k]!;
          if (slot === -1) rgba[k * 4] = rgba[k * 4 + 1] = rgba[k * 4 + 2] = v;
          else if (slot >= 0 && slot <= 3) rgba[k * 4 + slot] = v;
        }
    }
    pictures.push(rgba);
  }
  r.pos = Math.min(infoEnd, end);
  // Bottom to top in the file; groups open at their end marker and close at the group's own record.
  const stack: PsdNode[][] = [[]];
  records.forEach((rec, i) => {
    if (rec.section === 3) {
      stack.push([]);
      return;
    }
    if (rec.section === 1 || rec.section === 2) {
      const children = stack.length > 1 ? stack.pop()! : [];
      stack[stack.length - 1]!.unshift({ kind: 'group', name: rec.name, children, opacity: rec.opacity, visible: rec.visible, blend: rec.blend });
      return;
    }
    if (rec.adjustment) {
      notes.add('Adjustment and fill layers are left out.');
      return;
    }
    const rgba = pictures[i];
    if (!rgba) return;
    if (rec.clipping) notes.add('Clipping masks are left out: clipped layers show whole.');
    if (rec.hasMask) notes.add('Layer masks are left out.');
    if (rec.text) notes.add('Text layers come in as pictures; type them again with the text tool to make them fields.');
    stack[stack.length - 1]!.unshift({
      kind: 'image',
      name: rec.name,
      left: rec.left,
      top: rec.top,
      width: rec.right - rec.left,
      height: rec.bottom - rec.top,
      rgba,
      opacity: rec.opacity,
      visible: rec.visible,
      blend: rec.blend,
    });
  });
  while (stack.length > 1) {
    const kids = stack.pop()!;
    stack[stack.length - 1]!.unshift(...kids);
  }
  if (depth === 16) notes.add('16-bit colors are brought in as 8 bits.');
  return { width, height, layers: stack[0]!, notes: [...notes] };
}

function readRecord(r: Reader, notes: Set<string>): LayerRec {
  const top = r.i32();
  const left = r.i32();
  const bottom = r.i32();
  const right = r.i32();
  const n = r.u16();
  const channels: { id: number; length: number }[] = [];
  for (let i = 0; i < n; i++) channels.push({ id: r.i16(), length: r.u32() });
  if (r.str(4) !== '8BIM') throw new Error('This Photoshop file could not be read (a layer is damaged).');
  const blendKey = r.str(4);
  const opacity = r.u8();
  const clipping = r.u8() === 1;
  const flags = r.u8();
  r.u8();
  const extra = r.u32();
  const extraEnd = r.pos + extra;
  const maskLength = r.u32();
  r.skip(maskLength);
  r.skip(r.u32()); // blending ranges
  const nameLength = r.u8();
  let name = r.str(nameLength);
  // The Pascal string is padded to a multiple of 4 bytes (its length byte included).
  const padded = Math.ceil((nameLength + 1) / 4) * 4;
  r.skip(padded - nameLength - 1);
  let section = 0;
  let adjustment = false;
  let text = false;
  while (r.pos + 12 <= extraEnd) {
    const sig = r.str(4);
    if (sig !== '8BIM' && sig !== '8B64') break;
    const key = r.str(4);
    const len = r.u32();
    const at = r.pos;
    if (key === 'luni' && len >= 4) {
      const chars = r.u32();
      let s = '';
      for (let i = 0; i < chars && r.pos + 2 <= at + len; i++) s += String.fromCharCode(r.u16());
      name = s.replace(/\0+$/, '') || name;
    } else if ((key === 'lsct' || key === 'lsdk') && len >= 4) section = r.u32();
    else if (ADJUSTMENTS.has(key)) adjustment = true;
    else if (key === 'TySh' || key === 'tySh') text = true;
    else if (key === 'lfx2' || key === 'lrFX') notes.add('Layer styles (shadows, strokes, glows) are left out; add them again as effects.');
    r.pos = at + len + (len % 2);
  }
  r.pos = extraEnd;
  if (/^<\/Layer (group|set)>$/i.test(name)) section = section || 3;
  return {
    name: name.trim() || 'Layer',
    top,
    left,
    bottom,
    right,
    channels,
    blend: BLENDS[blendKey] ?? 'normal',
    blendKey,
    opacity,
    clipping,
    visible: (flags & 2) === 0,
    section,
    adjustment,
    hasMask: maskLength > 0 && channels.some((c) => c.id === -2),
    text,
  };
}

/** One channel's values (8 bits), raw or RLE (PackBits) compressed; 16-bit values keep their high byte. */
function channelData(r: Reader, length: number, w: number, h: number, bpc: number): Uint8Array | null {
  if (length < 2) return null;
  const compression = r.u16();
  const n = w * h;
  const rowBytes = w * bpc;
  if (compression === 0) {
    const raw = r.bytes(Math.min(length - 2, n * bpc));
    if (bpc === 1) return raw;
    const out = new Uint8Array(n);
    for (let k = 0; k < n && k * 2 < raw.length; k++) out[k] = raw[k * 2]!;
    return out;
  }
  if (compression === 1) {
    const counts: number[] = [];
    for (let y = 0; y < h; y++) counts.push(r.u16());
    const out = new Uint8Array(n);
    const row = new Uint8Array(rowBytes);
    for (let y = 0; y < h; y++) {
      const src = r.bytes(counts[y]!);
      unpackBits(src, row);
      if (bpc === 1) out.set(row.subarray(0, w), y * w);
      else for (let x = 0; x < w; x++) out[y * w + x] = row[x * 2]!;
    }
    return out;
  }
  // ZIP-compressed channels (rare in .psd): not read.
  return null;
}

/** PackBits: a run length byte, then that many literal bytes or one byte repeated. */
export function unpackBits(src: Uint8Array, out: Uint8Array): void {
  let i = 0;
  let o = 0;
  while (i < src.length && o < out.length) {
    const n = src[i++]!;
    if (n < 128) {
      for (let k = 0; k <= n && o < out.length; k++) out[o++] = src[i++] ?? 0;
    } else if (n > 128) {
      const v = src[i++] ?? 0;
      for (let k = 0; k < 257 - n && o < out.length; k++) out[o++] = v;
    }
  }
}
