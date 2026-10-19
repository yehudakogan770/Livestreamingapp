// Photoshop documents (.psd, and .psb for reading): layers with their blend
// modes, opacity and fill, groups (and pass through), layer masks and vector
// masks, clipping masks, locks and color tags, layer effects, adjustment
// layers, fill layers, shape layers (a fill with a vector mask) and type
// layers (editable text), at 8, 16 and 32 bits, with the color profile,
// resolution, saved selections (alpha channels) and the composite.

import { Reader, Writer, deflate, inflate } from './bytes';
import { packBitsDecode } from './tiff';
import {
  readDescriptor,
  writeDescriptor,
  D,
  get,
  getNum,
  getBool,
  getEnum,
  getObj,
  getText,
  getList,
  readColor,
  colorValue,
  type Descriptor,
  type DValue,
} from './psdDescriptor';
import { textFromEngine, engineData } from './psdText';
import { Raster, TILE } from '../raster';
import { readICC, writeICC, SRGB, type ColorProfile } from '../color';
import { BLEND_MODES, type BlendMode } from '../blend';
import { baseLayer, groupLayer, pixelLayer, uid, allLayers } from '../layers';
import { defaultParams, type AdjustmentType, type ParamsMap, parseCube, writeCube } from '../adjust';
import { defaultStyle, type LayerStyles } from '../styles';
import { corner, type VectorPath, type Anchor } from '../path';
import type {
  AdjustmentLayer,
  Depth,
  Doc,
  FillLayer,
  GroupLayer,
  Layer,
  LayerMask,
  PixelLayer,
  Rect,
  TextLayer,
  ShapeLayer,
  GradientStyle,
  AlphaChannel,
} from '../types';
import type { Gradient } from '../gradient';

const BLEND_KEYS: Record<BlendMode, string> = {
  normal: 'norm',
  dissolve: 'diss',
  darken: 'dark',
  multiply: 'mul ',
  colorBurn: 'idiv',
  linearBurn: 'lbrn',
  darkerColor: 'dkCl',
  lighten: 'lite',
  screen: 'scrn',
  colorDodge: 'div ',
  linearDodge: 'lddg',
  lighterColor: 'lgCl',
  overlay: 'over',
  softLight: 'sLit',
  hardLight: 'hLit',
  vividLight: 'vLit',
  linearLight: 'lLit',
  pinLight: 'pLit',
  hardMix: 'hMix',
  difference: 'diff',
  exclusion: 'smud',
  subtract: 'fsub',
  divide: 'fdiv',
  hue: 'hue ',
  saturation: 'sat ',
  color: 'colr',
  luminosity: 'lum ',
};
const KEY_BLEND = new Map(Object.entries(BLEND_KEYS).map(([k, v]) => [v, k as BlendMode]));

/** Effects descriptors use other names for blend modes. */
const FX_BLEND: Record<BlendMode, string> = {
  normal: 'Nrml',
  dissolve: 'Dslv',
  darken: 'Drkn',
  multiply: 'Mltp',
  colorBurn: 'CBrn',
  linearBurn: 'linearBurn',
  darkerColor: 'darkerColor',
  lighten: 'Lghn',
  screen: 'Scrn',
  colorDodge: 'CDdg',
  linearDodge: 'linearDodge',
  lighterColor: 'lighterColor',
  overlay: 'Ovrl',
  softLight: 'SftL',
  hardLight: 'HrdL',
  vividLight: 'vividLight',
  linearLight: 'linearLight',
  pinLight: 'pinLight',
  hardMix: 'hardMix',
  difference: 'Dfrn',
  exclusion: 'Xclu',
  subtract: 'blendSubtraction',
  divide: 'blendDivide',
  hue: 'H   ',
  saturation: 'Strt',
  color: 'Clr ',
  luminosity: 'Lmns',
};
const FX_BLEND_BACK = new Map(Object.entries(FX_BLEND).map(([k, v]) => [v, k as BlendMode]));

const pad = (n: number, m: number) => (n + m - 1) & ~(m - 1);

// =====================================================================
// Reading
// =====================================================================

interface ChannelInfo {
  id: number;
  len: number;
}

interface Record_ {
  rect: Rect;
  channels: ChannelInfo[];
  blend: BlendMode | 'pass';
  opacity: number;
  clip: boolean;
  flags: number;
  name: string;
  mask: { rect: Rect; color: number; flags: number } | null;
  info: Map<string, Uint8Array>;
  data: Map<number, Float32Array>;
}

function readPascal(r: Reader, align: number): string {
  const n = r.u8();
  const s = r.ascii(n);
  const used = 1 + n;
  r.skip(pad(used, align) - used);
  return s;
}

async function readChannel(r: Reader, w: number, h: number, depth: Depth, len: number, psb: boolean): Promise<Float32Array> {
  const end = r.pos + len;
  const out = new Float32Array(w * h);
  if (len < 2) {
    r.pos = end;
    return out;
  }
  const comp = r.u16();
  const bpc = depth === 8 ? 1 : depth === 16 ? 2 : 4;
  const rowBytes = w * bpc;
  let raw: Uint8Array;
  if (comp === 0) raw = r.take(Math.min(rowBytes * h, end - r.pos));
  else if (comp === 1) {
    const counts: number[] = [];
    for (let y = 0; y < h; y++) counts.push(psb ? r.u32() : r.u16());
    raw = new Uint8Array(rowBytes * h);
    for (let y = 0; y < h; y++) raw.set(packBitsDecode(r.take(counts[y]!), rowBytes), y * rowBytes);
  } else {
    raw = await inflate(r.take(end - r.pos), 'deflate');
    if (comp === 3) {
      // Prediction: differences per row (and for 32-bit, byte planes).
      if (depth === 8) for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) raw[y * w + x] = (raw[y * w + x]! + raw[y * w + x - 1]!) & 255;
      else if (depth === 16) {
        const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        for (let y = 0; y < h; y++)
          for (let x = 1; x < w; x++) dv.setUint16((y * w + x) * 2, (dv.getUint16((y * w + x) * 2) + dv.getUint16((y * w + x - 1) * 2)) & 0xffff);
      } else {
        for (let y = 0; y < h; y++) {
          const row = y * rowBytes;
          for (let x = 1; x < rowBytes; x++) raw[row + x] = (raw[row + x]! + raw[row + x - 1]!) & 255;
          const tmp = raw.slice(row, row + rowBytes);
          for (let x = 0; x < w; x++) for (let b = 0; b < 4; b++) raw[row + x * 4 + b] = tmp[b * w + x]!;
        }
      }
    }
  }
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const n = Math.min(w * h, Math.floor(raw.length / bpc));
  for (let i = 0; i < n; i++) out[i] = depth === 8 ? raw[i]! / 255 : depth === 16 ? dv.getUint16(i * 2) / 65535 : dv.getFloat32(i * 4);
  r.pos = end;
  return out;
}

async function readLayerInfo(r: Reader, end: number, depth: Depth, psb: boolean): Promise<{ records: Record_[]; mergedAlpha: boolean }> {
  let count = r.i16();
  const mergedAlpha = count < 0;
  count = Math.abs(count);
  const records: Record_[] = [];
  for (let i = 0; i < count; i++) {
    const top = r.i32(),
      left = r.i32(),
      bottom = r.i32(),
      right = r.i32();
    const nch = r.u16();
    const channels: ChannelInfo[] = [];
    for (let c = 0; c < nch; c++) channels.push({ id: r.i16(), len: psb ? r.u64() : r.u32() });
    if (r.ascii(4) !== '8BIM') throw new Error('This PSD file is damaged (a layer record).');
    const bk = r.ascii(4);
    const opacity = r.u8() / 255;
    const clip = r.u8() === 1;
    const flags = r.u8();
    r.u8();
    const extraLen = r.u32();
    const extraEnd = r.pos + extraLen;
    let mask: Record_['mask'] = null;
    const mlen = r.u32();
    if (mlen >= 20) {
      const mt = r.i32(),
        ml = r.i32(),
        mb = r.i32(),
        mr = r.i32();
      const color = r.u8();
      const mflags = r.u8();
      mask = { rect: { x: ml, y: mt, w: mr - ml, h: mb - mt }, color, flags: mflags };
      r.skip(mlen - 18);
    } else r.skip(mlen);
    r.skip(r.u32());
    let name = readPascal(r, 4);
    const info = new Map<string, Uint8Array>();
    while (r.pos + 12 <= extraEnd) {
      const sig = r.ascii(4);
      if (sig !== '8BIM' && sig !== '8B64') break;
      const key = r.ascii(4);
      const big = psb && ['LMsk', 'Lr16', 'Lr32', 'Layr', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD'].includes(key);
      const len = big ? r.u64() : r.u32();
      info.set(key, r.take(Math.min(len, extraEnd - r.pos)).slice());
    }
    r.pos = extraEnd;
    const luni = info.get('luni');
    if (luni) {
      const lr = new Reader(luni);
      const n = lr.u32();
      let s = '';
      for (let k = 0; k < n; k++) {
        const c = lr.u16();
        if (c) s += String.fromCharCode(c);
      }
      name = s;
    }
    records.push({
      rect: { x: left, y: top, w: right - left, h: bottom - top },
      channels,
      blend: bk === 'pass' ? 'pass' : (KEY_BLEND.get(bk) ?? 'normal'),
      opacity,
      clip,
      flags,
      name,
      mask,
      info,
      data: new Map(),
    });
  }
  for (const rec of records) {
    for (const ch of rec.channels) {
      const isMask = ch.id === -2 || ch.id === -3;
      const rr = isMask && rec.mask ? rec.mask.rect : rec.rect;
      if (rr.w <= 0 || rr.h <= 0) {
        r.skip(ch.len);
        continue;
      }
      rec.data.set(ch.id, await readChannel(r, rr.w, rr.h, depth, ch.len, psb));
    }
  }
  r.pos = end;
  return { records, mergedAlpha };
}

function rasterFrom(rec: Record_, depth: Depth): Raster {
  const { rect } = rec;
  if (rect.w <= 0 || rect.h <= 0) return new Raster(depth, 4);
  const n = rect.w * rect.h;
  const px = new Float32Array(n * 4);
  const R = rec.data.get(0),
    G = rec.data.get(1),
    B = rec.data.get(2),
    A = rec.data.get(-1);
  const gray = !G && !B;
  for (let i = 0; i < n; i++) {
    const r = R?.[i] ?? 0;
    px[i * 4] = r;
    px[i * 4 + 1] = gray ? r : (G?.[i] ?? 0);
    px[i * 4 + 2] = gray ? r : (B?.[i] ?? 0);
    px[i * 4 + 3] = A ? A[i]! : 1;
  }
  return Raster.fromFloats(depth, 4, rect, px);
}

function maskFrom(rec: Record_): LayerMask | undefined {
  if (!rec.mask) return undefined;
  const m = rec.data.get(-2);
  const bg = rec.mask.color / 255;
  let raster = new Raster(8, 1);
  if (m && rec.mask.rect.w > 0 && rec.mask.rect.h > 0) raster = Raster.fromFloats(8, 1, rec.mask.rect, m);
  // Inside the mask's rectangle the data counts; outside it, the default color — fill the
  // rectangle's tiles explicitly so the background only applies beyond it.
  return { raster, background: bg, enabled: (rec.mask.flags & 2) === 0, linked: (rec.mask.flags & 1) === 0, density: 1, feather: 0 };
}

function readVectorPath(b: Uint8Array, W: number, H: number): { path: VectorPath; enabled: boolean } | null {
  const r = new Reader(b);
  r.u32();
  const flags = r.u32();
  const subpaths: VectorPath['subpaths'] = [];
  let cur: { anchors: Anchor[]; closed: boolean } | null = null;
  const fix = () => {
    const v = r.i32();
    return v / 0x1000000;
  };
  while (r.left >= 26) {
    const sel = r.u16();
    if (sel === 0 || sel === 3) {
      r.u16();
      r.skip(22);
      cur = { anchors: [], closed: sel === 0 };
      subpaths.push(cur);
    } else if (sel === 1 || sel === 2 || sel === 4 || sel === 5) {
      const iy = fix() * H,
        ix = fix() * W,
        y = fix() * H,
        x = fix() * W,
        oy = fix() * H,
        ox = fix() * W;
      cur?.anchors.push({ x, y, ix, iy, ox, oy, smooth: sel === 1 || sel === 4 });
    } else r.skip(24);
  }
  if (!subpaths.length) return null;
  return { path: { subpaths }, enabled: (flags & 4) === 0 };
}

function readStyles(b: Uint8Array): LayerStyles | undefined {
  const r = new Reader(b);
  r.u32();
  r.u32();
  const d = readDescriptor(r);
  const st: LayerStyles = { visible: getBool(d, 'masterFXSwitch', true) };
  const blendOf = (o: Descriptor | undefined) => FX_BLEND_BACK.get(getEnum(o, 'Md  ', 'Nrml')) ?? 'normal';
  const op = (o: Descriptor | undefined) => getNum(o, 'Opct', 100) / 100;
  const ds = getObj(d, 'DrSh');
  if (ds)
    st.dropShadow = {
      on: getBool(ds, 'enab', true),
      blend: blendOf(ds),
      color: readColor(getObj(ds, 'Clr ')),
      opacity: op(ds),
      angle: getNum(ds, 'lagl', 120),
      distance: getNum(ds, 'Dstn', 5),
      spread: getNum(ds, 'Ckmt', 0) / 100,
      size: getNum(ds, 'blur', 5),
      knockout: getBool(ds, 'layerConceals', true),
    };
  const is = getObj(d, 'IrSh');
  if (is)
    st.innerShadow = {
      on: getBool(is, 'enab', true),
      blend: blendOf(is),
      color: readColor(getObj(is, 'Clr ')),
      opacity: op(is),
      angle: getNum(is, 'lagl', 120),
      distance: getNum(is, 'Dstn', 5),
      spread: getNum(is, 'Ckmt', 0) / 100,
      size: getNum(is, 'blur', 5),
    };
  const og = getObj(d, 'OrGl');
  if (og)
    st.outerGlow = {
      on: getBool(og, 'enab', true),
      blend: blendOf(og),
      color: readColor(getObj(og, 'Clr ')),
      opacity: op(og),
      spread: getNum(og, 'Ckmt', 0) / 100,
      size: getNum(og, 'blur', 5),
    };
  const ig = getObj(d, 'IrGl');
  if (ig)
    st.innerGlow = {
      on: getBool(ig, 'enab', true),
      blend: blendOf(ig),
      color: readColor(getObj(ig, 'Clr ')),
      opacity: op(ig),
      spread: getNum(ig, 'Ckmt', 0) / 100,
      size: getNum(ig, 'blur', 5),
      source: getEnum(ig, 'glwS') === 'SrcC' ? 'center' : 'edge',
    };
  const bv = getObj(d, 'ebbl');
  if (bv) {
    const sty = getEnum(bv, 'bvlS', 'InrB');
    st.bevel = {
      on: getBool(bv, 'enab', true),
      style: sty === 'OtrB' ? 'outer' : sty === 'Embs' ? 'emboss' : sty === 'PlEb' ? 'pillow' : 'inner',
      depth: getNum(bv, 'srgR', 100) / 100,
      direction: getEnum(bv, 'bvlD', 'In  ') === 'Out ' ? 'down' : 'up',
      size: getNum(bv, 'blur', 5),
      soften: getNum(bv, 'Sftn', 0),
      angle: getNum(bv, 'lagl', 120),
      altitude: getNum(bv, 'Lald', 30),
      highlightBlend: FX_BLEND_BACK.get(getEnum(bv, 'hglM', 'Scrn')) ?? 'screen',
      highlightColor: readColor(getObj(bv, 'hglC')),
      highlightOpacity: getNum(bv, 'hglO', 75) / 100,
      shadowBlend: FX_BLEND_BACK.get(getEnum(bv, 'sdwM', 'Mltp')) ?? 'multiply',
      shadowColor: readColor(getObj(bv, 'sdwC')),
      shadowOpacity: getNum(bv, 'sdwO', 75) / 100,
    };
  }
  const sa = getObj(d, 'ChFX');
  if (sa)
    st.satin = {
      on: getBool(sa, 'enab', true),
      blend: blendOf(sa),
      color: readColor(getObj(sa, 'Clr ')),
      opacity: op(sa),
      angle: getNum(sa, 'lagl', 19),
      distance: getNum(sa, 'Dstn', 11),
      size: getNum(sa, 'blur', 14),
      invert: getBool(sa, 'Invr', true),
    };
  const co = getObj(d, 'SoFi');
  if (co) st.colorOverlay = { on: getBool(co, 'enab', true), blend: blendOf(co), color: readColor(getObj(co, 'Clr ')), opacity: op(co) };
  const go = getObj(d, 'GrFl');
  if (go) {
    const t = getEnum(go, 'Type', 'Lnr ');
    st.gradientOverlay = {
      on: getBool(go, 'enab', true),
      blend: blendOf(go),
      opacity: op(go),
      gradient: readGradient(getObj(go, 'Grad')),
      style: gradStyle(t),
      angle: getNum(go, 'Angl', 90),
      scale: getNum(go, 'Scl ', 100) / 100,
      reverse: getBool(go, 'Rvrs'),
    };
  }
  const fr = getObj(d, 'FrFX');
  if (fr) {
    const pos = getEnum(fr, 'Styl', 'OutF');
    st.stroke = {
      on: getBool(fr, 'enab', true),
      blend: blendOf(fr),
      color: readColor(getObj(fr, 'Clr ')),
      opacity: op(fr),
      size: getNum(fr, 'Sz  ', 3),
      position: pos === 'InsF' ? 'inside' : pos === 'CtrF' ? 'center' : 'outside',
    };
  }
  return st;
}

const gradStyle = (t: string): GradientStyle =>
  t === 'Rdl ' ? 'radial' : t === 'Angl' ? 'angle' : t === 'Rflc' ? 'reflected' : t === 'Dmnd' ? 'diamond' : 'linear';
const gradType = (s: GradientStyle) => ({ linear: 'Lnr ', radial: 'Rdl ', angle: 'Angl', reflected: 'Rflc', diamond: 'Dmnd' })[s];

function readGradient(g: Descriptor | undefined): Gradient {
  const stops = getList(g, 'Clrs').map((v) => (v.t === 'Objc' ? v.d : undefined));
  const trns = getList(g, 'Trns').map((v) => (v.t === 'Objc' ? v.d : undefined));
  return {
    name: getText(g, 'Nm  ', 'Gradient'),
    stops: stops.map((s) => ({ pos: getNum(s, 'Lctn') / 4096, color: readColor(getObj(s, 'Clr ')), mid: getNum(s, 'Mdpn', 50) / 100 })),
    alphas: trns.length
      ? trns.map((s) => ({ pos: getNum(s, 'Lctn') / 4096, alpha: getNum(s, 'Opct', 100) / 100, mid: getNum(s, 'Mdpn', 50) / 100 }))
      : [
          { pos: 0, alpha: 1 },
          { pos: 1, alpha: 1 },
        ],
  };
}

function readAdjustment(key: string, b: Uint8Array): { type: AdjustmentType; params: ParamsMap[AdjustmentType] } | null {
  const r = new Reader(b);
  try {
    switch (key) {
      case 'levl': {
        r.u16();
        const p = defaultParams('levels');
        const ch = ['rgb', 'r', 'g', 'b'] as const;
        for (const k of ch) {
          const inB = r.u16(),
            inW = r.u16(),
            outB = r.u16(),
            outW = r.u16(),
            gamma = r.u16() / 100;
          p[k] = { inBlack: inB / 255, inWhite: inW / 255, outBlack: outB / 255, outWhite: outW / 255, gamma: gamma || 1 };
        }
        return { type: 'levels', params: p };
      }
      case 'curv': {
        r.u8();
        r.u16();
        const bits = r.u32();
        const p = defaultParams('curves');
        const ch = ['rgb', 'r', 'g', 'b'] as const;
        for (let c = 0; c < 32; c++) {
          if (!(bits & (1 << c))) continue;
          const n = r.u16();
          const pts: [number, number][] = [];
          for (let k = 0; k < n; k++) {
            const out = r.u16(),
              inp = r.u16();
            pts.push([inp / 255, out / 255]);
          }
          if (c < 4) p[ch[c]!] = pts;
        }
        return { type: 'curves', params: p };
      }
      case 'expA': {
        r.u16();
        return { type: 'exposure', params: { exposure: r.f32(), offset: r.f32(), gamma: r.f32() || 1 } };
      }
      case 'hue2': {
        r.u16();
        const colorize = r.u8() === 1;
        r.u8();
        const cH = r.i16(),
          cS = r.i16(),
          cL = r.i16();
        const mH = r.i16(),
          mS = r.i16(),
          mL = r.i16();
        const p = defaultParams('hueSaturation');
        p.colorize = colorize;
        p.colorizeHue = (cH + 360) % 360;
        p.colorizeSat = cS;
        p.colorizeLight = cL;
        p.master = { hue: mH, sat: mS, light: mL };
        for (const k of ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'] as const) {
          const span = [r.i16(), r.i16(), r.i16(), r.i16()] as [number, number, number, number];
          p.ranges[k] = { span: span.map((v) => (v + 360) % 360) as [number, number, number, number], hue: r.i16(), sat: r.i16(), light: r.i16() };
        }
        return { type: 'hueSaturation', params: p };
      }
      case 'blnc': {
        const rd = () => [r.i16(), r.i16(), r.i16()] as [number, number, number];
        const shadows = rd(),
          midtones = rd(),
          highlights = rd();
        return { type: 'colorBalance', params: { shadows, midtones, highlights, preserve: r.u8() === 1 } };
      }
      case 'nvrt':
        return { type: 'invert', params: {} };
      case 'post':
        return { type: 'posterize', params: { levels: r.u16() } };
      case 'thrs':
        return { type: 'threshold', params: { level: r.u16() } };
      case 'brit':
        return { type: 'brightnessContrast', params: { brightness: r.i16(), contrast: r.i16(), legacy: true } };
      case 'CgEd': {
        r.u32();
        const d = readDescriptor(r);
        return { type: 'brightnessContrast', params: { brightness: getNum(d, 'Brgh'), contrast: getNum(d, 'Cntr'), legacy: getBool(d, 'useLegacy') } };
      }
      case 'vibA': {
        r.u32();
        const d = readDescriptor(r);
        return { type: 'vibrance', params: { vibrance: getNum(d, 'vibrance'), saturation: getNum(d, 'Strt') } };
      }
      case 'blwh': {
        r.u32();
        const d = readDescriptor(r);
        const tint = readColor(getObj(d, 'tintColor'));
        const hsl = rgbHue(tint);
        return {
          type: 'blackWhite',
          params: {
            reds: getNum(d, 'Rd  ', 40),
            yellows: getNum(d, 'Yllw', 60),
            greens: getNum(d, 'Grn ', 40),
            cyans: getNum(d, 'Cyn ', 60),
            blues: getNum(d, 'Bl  ', 20),
            magentas: getNum(d, 'Mgnt', 80),
            tint: getBool(d, 'useTint'),
            tintHue: hsl[0],
            tintSat: hsl[1],
          },
        };
      }
      case 'phfl': {
        const ver = r.u16();
        let color: [number, number, number] = [0.925, 0.541, 0];
        if (ver === 3) {
          // Lab-ish X, Y, Z as 32-bit: approximate through the color picker values.
          r.i32();
          r.i32();
          r.i32();
        } else {
          const space = r.u16();
          const a = r.u16() / 65535,
            bb = r.u16() / 65535,
            c = r.u16() / 65535;
          r.u16();
          if (space === 0) color = [a, bb, c];
        }
        const density = r.u32() / 100;
        return { type: 'photoFilter', params: { color, density, preserve: r.u8() === 1 } };
      }
      case 'mixr': {
        r.u16();
        const mono = r.u16() === 1;
        const row = () => {
          const v = [r.i16(), r.i16(), r.i16(), r.i16(), r.i16()];
          return [v[0]!, v[1]!, v[2]!, v[4]!] as [number, number, number, number];
        };
        return { type: 'channelMixer', params: { r: row(), g: row(), b: row(), mono } };
      }
      case 'selc': {
        r.u16();
        const relative = r.u16() === 0;
        r.skip(8);
        const p = defaultParams('selectiveColor');
        p.relative = relative;
        for (const k of ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'] as const)
          p.ranges[k] = { c: r.i16(), m: r.i16(), y: r.i16(), k: r.i16() };
        return { type: 'selectiveColor', params: p };
      }
      case 'grdm': {
        r.u16();
        const reverse = r.u8() === 1;
        r.u8();
        const nlen = r.u32();
        r.skip(nlen * 2);
        const nc = r.u16();
        const stops: Gradient['stops'] = [];
        for (let k = 0; k < nc; k++) {
          const loc = r.u32(),
            mid = r.u32();
          r.u16();
          const c = [r.u16() / 65535, r.u16() / 65535, r.u16() / 65535] as [number, number, number];
          r.u16();
          r.u16();
          stops.push({ pos: loc / 4096, color: c, mid: mid / 100 });
        }
        const nt = r.u16();
        const alphas: Gradient['alphas'] = [];
        for (let k = 0; k < nt; k++) {
          const loc = r.u32(),
            mid = r.u32();
          alphas.push({ pos: loc / 4096, alpha: r.u16() / 255, mid: mid / 100 });
        }
        return { type: 'gradientMap', params: { gradient: { name: 'Gradient', stops, alphas }, reverse } };
      }
      case 'clrL': {
        r.u16();
        r.u32();
        const d = readDescriptor(r);
        const data = get(d, 'LUT3DFileData');
        if (data?.t === 'tdta') {
          try {
            return { type: 'colorLookup', params: { lut: parseCube(new TextDecoder().decode(data.v), getText(d, 'LUT3DFileName', 'LUT')) } };
          } catch {
            return { type: 'colorLookup', params: { lut: null } };
          }
        }
        return { type: 'colorLookup', params: { lut: null } };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function rgbHue(c: [number, number, number]): [number, number] {
  const mx = Math.max(...c),
    mn = Math.min(...c);
  const d = mx - mn;
  if (d === 0) return [0, 0];
  let h = mx === c[0] ? (c[1] - c[2]) / d + (c[1] < c[2] ? 6 : 0) : mx === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
  h *= 60;
  const l = (mx + mn) / 2;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  return [Math.round(h), Math.round(s * 100)];
}

const ADJ_KEYS = ['levl', 'curv', 'expA', 'hue2', 'blnc', 'nvrt', 'post', 'thrs', 'CgEd', 'brit', 'vibA', 'blwh', 'phfl', 'mixr', 'selc', 'grdm', 'clrL'];

function layerFromRecord(rec: Record_, doc: { width: number; height: number; depth: Depth }, notes: Set<string>): Layer {
  const base = {
    ...baseLayer(rec.name || 'Layer'),
    opacity: rec.opacity,
    blend: (rec.blend === 'pass' ? 'normal' : rec.blend) as BlendMode,
    clip: rec.clip,
    visible: (rec.flags & 2) === 0,
  };
  const iOpa = rec.info.get('iOpa');
  if (iOpa) base.fill = iOpa[0]! / 255;
  const lspf = rec.info.get('lspf');
  if (lspf) {
    const v = new Reader(lspf).u32();
    base.locks = { transparency: !!(v & 1), pixels: !!(v & 2), position: !!(v & 4), all: v === 0x80000000 || (v & 0x80000000) !== 0 };
  }
  if (rec.flags & 1) base.locks = { ...base.locks, transparency: true };
  const lclr = rec.info.get('lclr');
  if (lclr) {
    const tags = ['none', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'gray'] as const;
    base.tag = tags[new Reader(lclr).u16()] ?? 'none';
  }
  const mask = maskFrom(rec);
  if (mask) base.mask = mask;
  const vm = rec.info.get('vmsk') ?? rec.info.get('vsms');
  const vpath = vm ? readVectorPath(vm, doc.width, doc.height) : null;
  const fx = rec.info.get('lfx2');
  if (fx) {
    try {
      base.styles = readStyles(fx);
    } catch {
      notes.add('Some layer effects could not be read.');
    }
  }
  // Adjustment layers.
  for (const k of ADJ_KEYS) {
    const b = rec.info.get(k);
    if (!b) continue;
    const a = readAdjustment(k, b);
    if (a) return { ...base, kind: 'adjust', adjust: a.type, params: a.params } as AdjustmentLayer;
  }
  // Fill layers (and shape layers: a fill with a vector mask).
  const soco = rec.info.get('SoCo');
  const gdfl = rec.info.get('GdFl');
  if (soco || gdfl) {
    let content: FillLayer['content'];
    if (soco) {
      const r = new Reader(soco);
      r.u32();
      content = { type: 'solid', color: [...readColor(getObj(readDescriptor(r), 'Clr ')), 1] };
    } else {
      const r = new Reader(gdfl!);
      r.u32();
      const d = readDescriptor(r);
      content = {
        type: 'gradient',
        gradient: readGradient(getObj(d, 'Grad')),
        angle: getNum(d, 'Angl', 90),
        scale: getNum(d, 'Scl ', 100) / 100,
        style: gradStyle(getEnum(d, 'Type', 'Lnr ')),
        reverse: getBool(d, 'Rvrs'),
        ox: 0,
        oy: 0,
      };
    }
    if (vpath && content.type === 'solid') {
      const shape: ShapeLayer = { ...base, kind: 'shape', path: vpath.path, fillColor: content.color, stroke: null, raster: rasterFrom(rec, doc.depth) };
      const vstk = rec.info.get('vstk');
      if (vstk) {
        try {
          const r = new Reader(vstk);
          r.u32();
          const d = readDescriptor(r);
          if (getBool(d, 'strokeEnabled', true)) {
            const align = getEnum(d, 'strokeStyleLineAlignment', 'strokeStyleAlignInside');
            const sc = getObj(getObj(d, 'strokeStyleContent'), 'Clr ');
            shape.stroke = {
              color: [...readColor(sc), 1],
              width: getNum(d, 'strokeStyleLineWidth', 1),
              align: align.includes('Outside') ? 'outside' : align.includes('Center') ? 'center' : 'inside',
              cap: 'butt',
              join: 'miter',
              dash: [],
            };
          }
          if (!getBool(d, 'fillEnabled', true)) shape.fillColor = null;
        } catch {
          /* default stroke */
        }
      }
      return shape;
    }
    const fill: FillLayer = { ...base, kind: 'fill', content };
    if (vpath) fill.vmask = { path: vpath.path, enabled: vpath.enabled, feather: 0 };
    return fill;
  }
  if (rec.info.has('PtFl')) notes.add('Pattern fill layers were opened as pixels.');
  // Type layers: editable text with Photoshop's own drawing kept until edited.
  const tysh = rec.info.get('TySh');
  const raster = rasterFrom(rec, doc.depth);
  if (tysh) {
    try {
      const r = new Reader(tysh);
      r.u16();
      const tr = [r.f64(), r.f64(), r.f64(), r.f64(), r.f64(), r.f64()];
      r.u16();
      r.u32();
      const td = readDescriptor(r);
      const ed = get(td, 'EngineData');
      const bounds = getObj(td, 'bounds');
      const isBox =
        getEnum(td, 'textGridding', '') !== '' &&
        (() => {
          const shapes = new TextDecoder('latin1').decode(ed?.t === 'tdta' ? ed.v.subarray(0, 20000) : new Uint8Array());
          return /\/ShapeType 1/.test(shapes);
        })();
      const box =
        isBox && bounds ? { left: getNum(bounds, 'Left'), top: getNum(bounds, 'Top '), right: getNum(bounds, 'Rght'), bottom: getNum(bounds, 'Btom') } : null;
      if (ed?.t === 'tdta') {
        const model = textFromEngine(ed.v, tr, box);
        if (model) return { ...base, kind: 'text', text: model, raster } as TextLayer;
      }
    } catch {
      notes.add('A type layer could not be read as text; it opened as pixels.');
    }
  }
  if (rec.info.has('SoLd') || rec.info.has('PlLd')) notes.add('Smart objects opened as pixels.');
  const p: PixelLayer = { ...base, kind: 'pixel', raster };
  if (vpath) p.vmask = { path: vpath.path, enabled: vpath.enabled, feather: 0 };
  return p;
}

export async function readPSD(bytes: Uint8Array, name = 'Untitled'): Promise<Doc> {
  const r = new Reader(bytes);
  if (r.ascii(4) !== '8BPS') throw new Error('This is not a Photoshop file.');
  const version = r.u16();
  const psb = version === 2;
  r.skip(6);
  const nch = r.u16();
  const H = r.u32(),
    W = r.u32();
  const bits = r.u16();
  const mode = r.u16();
  if (mode !== 3 && mode !== 1)
    throw new Error(
      mode === 4
        ? 'This Photoshop file is CMYK; Lumora Photo opens RGB and grayscale files. Convert it to RGB in Photoshop first.'
        : 'This Photoshop file’s color mode is not supported (RGB and grayscale are).',
    );
  if (bits !== 8 && bits !== 16 && bits !== 32) throw new Error('This Photoshop file’s bit depth is not supported.');
  const depth = bits as Depth;
  r.skip(r.u32());
  // Image resources.
  const resEnd = r.pos + r.u32() + 4;
  let resolution = 72;
  let icc: Uint8Array | undefined;
  const alphaNames: string[] = [];
  while (r.pos + 12 <= resEnd) {
    if (r.ascii(4) !== '8BIM') break;
    const id = r.u16();
    readPascal(r, 2);
    const size = r.u32();
    const data = r.take(size);
    if (size & 1) r.skip(1);
    if (id === 1005 && size >= 16) resolution = Math.round(new Reader(data).u32() / 65536);
    else if (id === 1039) icc = data.slice();
    else if (id === 1045) {
      const rr = new Reader(data);
      while (rr.left >= 4) {
        const n = rr.u32();
        let s = '';
        for (let k = 0; k < n && rr.left >= 2; k++) {
          const c = rr.u16();
          if (c) s += String.fromCharCode(c);
        }
        alphaNames.push(s);
      }
    }
  }
  r.pos = resEnd;
  // Layer and mask information.
  const lmLen = psb ? r.u64() : r.u32();
  const lmEnd = r.pos + lmLen;
  let records: Record_[] = [];
  let mergedAlpha = false;
  if (lmLen > 0) {
    const liLen = psb ? r.u64() : r.u32();
    const liEnd = r.pos + liLen;
    if (liLen > 0) ({ records, mergedAlpha } = await readLayerInfo(r, liEnd, depth, psb));
    r.pos = liEnd;
    // Global layer mask info.
    if (r.pos + 4 <= lmEnd) r.skip(r.u32());
    // 16- and 32-bit documents keep their layers in Lr16 / Lr32.
    while (r.pos + 12 <= lmEnd && !records.length) {
      const sig = r.ascii(4);
      if (sig !== '8BIM' && sig !== '8B64') break;
      const key = r.ascii(4);
      const len =
        psb && ['Lr16', 'Lr32', 'Layr', 'LMsk', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD'].includes(key) ? r.u64() : r.u32();
      const end = r.pos + len;
      if (key === 'Lr16' || key === 'Lr32' || key === 'Layr') ({ records, mergedAlpha } = await readLayerInfo(r, end, depth, psb));
      r.pos = pad(end, 4) <= lmEnd ? end : end;
    }
  }
  r.pos = lmEnd;
  const notes = new Set<string>();
  // Build the tree: bottom to top, section dividers open and close groups.
  const stack: Layer[][] = [[]];
  for (const rec of records) {
    const lsct = rec.info.get('lsct') ?? rec.info.get('lsdk');
    const sect = lsct ? new Reader(lsct).u32() : 0;
    if (sect === 3) {
      stack.push([]);
      continue;
    }
    if (sect === 1 || sect === 2) {
      const kids = stack.length > 1 ? stack.pop()! : [];
      let blend: BlendMode | 'pass' = rec.blend;
      if (lsct && lsct.length >= 12 && new TextDecoder('latin1').decode(lsct.subarray(4, 8)) === '8BIM') {
        const bk = new TextDecoder('latin1').decode(lsct.subarray(8, 12));
        blend = bk === 'pass' ? 'pass' : (KEY_BLEND.get(bk) ?? 'normal');
      }
      const g: GroupLayer = {
        ...groupLayer(rec.name || 'Group', kids),
        opacity: rec.opacity,
        visible: (rec.flags & 2) === 0,
        open: sect === 1,
        passThrough: blend === 'pass',
        blend: blend === 'pass' ? 'normal' : blend,
        clip: rec.clip,
      };
      const m = maskFrom(rec);
      if (m) g.mask = m;
      const fx = rec.info.get('lfx2');
      if (fx) {
        try {
          g.styles = readStyles(fx);
        } catch {
          /* no effects */
        }
      }
      stack[stack.length - 1]!.push(g);
      continue;
    }
    stack[stack.length - 1]!.push(layerFromRecord(rec, { width: W, height: H, depth }, notes));
  }
  while (stack.length > 1) {
    const kids = stack.pop()!;
    stack[stack.length - 1]!.push(groupLayer('Group', kids));
  }
  let layers = stack[0]!;
  // The composite: used when there are no layers, and for saved selections.
  const comp = r.u16();
  const channels: AlphaChannel[] = [];
  const planes: Float32Array[] = [];
  const bpc = depth === 8 ? 1 : depth === 16 ? 2 : 4;
  try {
    if (comp === 1) {
      const counts: number[] = [];
      for (let k = 0; k < H * nch; k++) counts.push(psb ? r.u32() : r.u16());
      for (let c = 0; c < nch; c++) {
        const p = new Float32Array(W * H);
        const rowBytes = W * bpc;
        for (let y = 0; y < H; y++) {
          const row = packBitsDecode(r.take(counts[c * H + y]!), rowBytes);
          const dv = new DataView(row.buffer, row.byteOffset, row.byteLength);
          for (let x = 0; x < W; x++) p[y * W + x] = depth === 8 ? row[x]! / 255 : depth === 16 ? dv.getUint16(x * 2) / 65535 : dv.getFloat32(x * 4);
        }
        planes.push(p);
      }
    } else if (comp === 0) {
      for (let c = 0; c < nch; c++) {
        const raw = r.take(W * H * bpc);
        const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        const p = new Float32Array(W * H);
        for (let i = 0; i < W * H; i++) p[i] = depth === 8 ? raw[i]! / 255 : depth === 16 ? dv.getUint16(i * 2) / 65535 : dv.getFloat32(i * 4);
        planes.push(p);
      }
    } else if (comp === 2 || comp === 3) {
      const all = await inflate(r.take(r.left), 'deflate');
      for (let c = 0; c < nch; c++) {
        const p = new Float32Array(W * H);
        const dv = new DataView(all.buffer, all.byteOffset + c * W * H * bpc, W * H * bpc);
        for (let i = 0; i < W * H; i++) p[i] = depth === 8 ? dv.getUint8(i) / 255 : depth === 16 ? dv.getUint16(i * 2) / 65535 : dv.getFloat32(i * 4);
        planes.push(p);
      }
    }
  } catch {
    notes.add('The flattened picture inside the file could not be read; the layers were used.');
  }
  const colorCh = mode === 1 ? 1 : 3;
  if (!layers.length && planes.length >= colorCh) {
    const px = new Float32Array(W * H * 4);
    const alpha = planes.length > colorCh && mergedAlpha ? planes[colorCh] : null;
    for (let i = 0; i < W * H; i++) {
      px[i * 4] = planes[0]![i]!;
      px[i * 4 + 1] = planes[colorCh === 1 ? 0 : 1]![i]!;
      px[i * 4 + 2] = planes[colorCh === 1 ? 0 : 2]![i]!;
      px[i * 4 + 3] = alpha ? alpha[i]! : 1;
    }
    layers = [{ ...pixelLayer('Background', Raster.fromFloats(depth, 4, { x: 0, y: 0, w: W, h: H }, px)), locks: { position: true } }];
  }
  // Saved selections: the composite's extra channels.
  const firstExtra = colorCh + (mergedAlpha || (records.length > 0 && planes.length > colorCh && alphaNames.length < planes.length - colorCh) ? 1 : 0);
  for (let c = firstExtra; c < planes.length; c++) {
    const p = planes[c]!;
    channels.push({
      id: uid('c'),
      name: alphaNames[c - firstExtra] ?? `Alpha ${c - firstExtra + 1}`,
      raster: Raster.fromFloats(8, 1, { x: 0, y: 0, w: W, h: H }, p),
      visible: false,
      color: [1, 0, 0, 0.5],
    });
  }
  let profile: ColorProfile = SRGB;
  if (icc) profile = readICC(icc) ?? SRGB;
  if (icc && !readICC(icc)) notes.add('Its color profile could not be used; the colors are read as sRGB.');
  if (depth === 32 && profile.trc.type !== 'linear') profile = { ...profile };
  return {
    id: uid('doc'),
    name,
    width: W,
    height: H,
    depth,
    profile,
    resolution,
    layers,
    selection: null,
    channels,
    paths: [],
    guides: [],
    comps: [],
    artboards: [],
    slices: [],
    meta: notes.size ? { notes: [...notes].join(' ') } : undefined,
  };
}

// =====================================================================
// Writing
// =====================================================================

function packBits(row: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  const n = row.length;
  while (i < n) {
    // A run of 3+ equal bytes?
    let run = 1;
    while (i + run < n && run < 128 && row[i + run] === row[i]) run++;
    if (run >= 3) {
      out.push(257 - run, row[i]!);
      i += run;
      continue;
    }
    // Literals until the next run of 3.
    const start = i;
    let lit = 0;
    while (i < n && lit < 128) {
      if (i + 2 < n && row[i] === row[i + 1] && row[i] === row[i + 2]) break;
      i++;
      lit++;
    }
    out.push(lit - 1);
    for (let k = start; k < start + lit; k++) out.push(row[k]!);
  }
  return Uint8Array.from(out);
}

function channelBytes(values: Float32Array, w: number, h: number, depth: Depth): Uint8Array {
  const bpc = depth === 8 ? 1 : depth === 16 ? 2 : 4;
  const raw = new Uint8Array(w * h * bpc);
  const dv = new DataView(raw.buffer);
  for (let i = 0; i < w * h; i++) {
    const v = values[i]!;
    if (depth === 8) raw[i] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    else if (depth === 16) dv.setUint16(i * 2, Math.round(Math.min(1, Math.max(0, v)) * 65535));
    else dv.setFloat32(i * 4, v);
  }
  return raw;
}

/** A channel's data block: compression (RLE for 8/16-bit, raw for 32-bit) then the data. */
function encodeChannel(values: Float32Array, w: number, h: number, depth: Depth): Uint8Array {
  const raw = channelBytes(values, w, h, depth);
  const bpc = depth === 8 ? 1 : depth === 16 ? 2 : 4;
  const wr = new Writer(raw.length + 1024);
  if (depth === 32 || w * h === 0) {
    wr.u16(0).bytes(raw);
    return wr.result();
  }
  wr.u16(1);
  const rows: Uint8Array[] = [];
  for (let y = 0; y < h; y++) rows.push(packBits(raw.subarray(y * w * bpc, (y + 1) * w * bpc)));
  for (const r of rows) wr.u16(r.length);
  for (const r of rows) wr.bytes(r);
  return wr.result();
}

function infoBlock(w: Writer, key: string, data: Uint8Array): void {
  w.ascii('8BIM').ascii(key);
  const len = pad(data.length, 4);
  w.u32(len)
    .bytes(data)
    .zeros(len - data.length);
}

function unicodeName(s: string): Uint8Array {
  const w = new Writer(8 + s.length * 2);
  w.u32(s.length + 1);
  for (let i = 0; i < s.length; i++) w.u16(s.charCodeAt(i));
  w.u16(0);
  return w.result();
}

function descriptorBlock(d: Descriptor, version = 16, prefix: number[] = []): Uint8Array {
  const w = new Writer(1024);
  for (const p of prefix) w.u32(p);
  w.u32(version);
  writeDescriptor(w, d);
  return w.result();
}

function gradientValue(g: Gradient): DValue {
  return D.obj('Grdn', [
    ['Nm  ', D.text(g.name)],
    ['GrdF', D.en('GrdF', 'CstS')],
    ['Intr', D.num(4096)],
    [
      'Clrs',
      D.list(
        g.stops.map((s) =>
          D.obj('Clrt', [
            ['Clr ', colorValue(s.color)],
            ['Type', D.en('Clry', 'UsrS')],
            ['Lctn', D.long(Math.round(s.pos * 4096))],
            ['Mdpn', D.long(Math.round((s.mid ?? 0.5) * 100))],
          ]),
        ),
      ),
    ],
    [
      'Trns',
      D.list(
        g.alphas.map((s) =>
          D.obj('TrnS', [
            ['Opct', D.unit('#Prc', s.alpha * 100)],
            ['Lctn', D.long(Math.round(s.pos * 4096))],
            ['Mdpn', D.long(Math.round((s.mid ?? 0.5) * 100))],
          ]),
        ),
      ),
    ],
  ]);
}

function stylesDescriptor(st: LayerStyles): Descriptor {
  const items: [string, DValue][] = [
    ['Scl ', D.unit('#Prc', 100)],
    ['masterFXSwitch', D.bool(st.visible !== false)],
  ];
  const md = (b: BlendMode) => D.en('BlnM', FX_BLEND[b]);
  const pc = (v: number) => D.unit('#Prc', v * 100);
  const px = (v: number) => D.unit('#Pxl', v);
  if (st.dropShadow) {
    const s = st.dropShadow;
    items.push([
      'DrSh',
      D.obj('DrSh', [
        ['enab', D.bool(s.on)],
        ['Md  ', md(s.blend)],
        ['Clr ', colorValue(s.color)],
        ['Opct', pc(s.opacity)],
        ['uglg', D.bool(false)],
        ['lagl', D.unit('#Ang', s.angle)],
        ['Dstn', px(s.distance)],
        ['Ckmt', px(s.spread * 100)],
        ['blur', px(s.size)],
        ['Nose', pc(0)],
        ['AntA', D.bool(false)],
        ['layerConceals', D.bool(s.knockout !== false)],
      ]),
    ]);
  }
  if (st.innerShadow) {
    const s = st.innerShadow;
    items.push([
      'IrSh',
      D.obj('IrSh', [
        ['enab', D.bool(s.on)],
        ['Md  ', md(s.blend)],
        ['Clr ', colorValue(s.color)],
        ['Opct', pc(s.opacity)],
        ['uglg', D.bool(false)],
        ['lagl', D.unit('#Ang', s.angle)],
        ['Dstn', px(s.distance)],
        ['Ckmt', px(s.spread * 100)],
        ['blur', px(s.size)],
        ['Nose', pc(0)],
        ['AntA', D.bool(false)],
      ]),
    ]);
  }
  if (st.outerGlow) {
    const s = st.outerGlow;
    items.push([
      'OrGl',
      D.obj('OrGl', [
        ['enab', D.bool(s.on)],
        ['Md  ', md(s.blend)],
        ['Clr ', colorValue(s.color)],
        ['Opct', pc(s.opacity)],
        ['GlwT', D.en('BETE', 'SfBL')],
        ['Ckmt', px(s.spread * 100)],
        ['blur', px(s.size)],
        ['Nose', pc(0)],
        ['ShdN', pc(0)],
        ['AntA', D.bool(false)],
        ['Inpr', pc(50)],
      ]),
    ]);
  }
  if (st.innerGlow) {
    const s = st.innerGlow;
    items.push([
      'IrGl',
      D.obj('IrGl', [
        ['enab', D.bool(s.on)],
        ['Md  ', md(s.blend)],
        ['Clr ', colorValue(s.color)],
        ['Opct', pc(s.opacity)],
        ['GlwT', D.en('BETE', 'SfBL')],
        ['Ckmt', px(s.spread * 100)],
        ['blur', px(s.size)],
        ['ShdN', pc(0)],
        ['Nose', pc(0)],
        ['AntA', D.bool(false)],
        ['glwS', D.en('IGSr', s.source === 'center' ? 'SrcC' : 'SrcE')],
        ['Inpr', pc(50)],
      ]),
    ]);
  }
  if (st.bevel) {
    const s = st.bevel;
    items.push([
      'ebbl',
      D.obj('ebbl', [
        ['enab', D.bool(s.on)],
        ['hglM', md(s.highlightBlend)],
        ['hglC', colorValue(s.highlightColor)],
        ['hglO', pc(s.highlightOpacity)],
        ['sdwM', md(s.shadowBlend)],
        ['sdwC', colorValue(s.shadowColor)],
        ['sdwO', pc(s.shadowOpacity)],
        ['bvlT', D.en('bvlT', 'SfBL')],
        ['bvlS', D.en('BESl', s.style === 'outer' ? 'OtrB' : s.style === 'emboss' ? 'Embs' : s.style === 'pillow' ? 'PlEb' : 'InrB')],
        ['uglg', D.bool(false)],
        ['lagl', D.unit('#Ang', s.angle)],
        ['Lald', D.unit('#Ang', s.altitude)],
        ['srgR', pc(s.depth)],
        ['blur', px(s.size)],
        ['bvlD', D.en('BESs', s.direction === 'down' ? 'Out ' : 'In  ')],
        ['Sftn', px(s.soften)],
      ]),
    ]);
  }
  if (st.satin) {
    const s = st.satin;
    items.push([
      'ChFX',
      D.obj('ChFX', [
        ['enab', D.bool(s.on)],
        ['Md  ', md(s.blend)],
        ['Clr ', colorValue(s.color)],
        ['AntA', D.bool(true)],
        ['Invr', D.bool(s.invert)],
        ['Opct', pc(s.opacity)],
        ['lagl', D.unit('#Ang', s.angle)],
        ['Dstn', px(s.distance)],
        ['blur', px(s.size)],
      ]),
    ]);
  }
  if (st.colorOverlay) {
    const s = st.colorOverlay;
    items.push([
      'SoFi',
      D.obj('SoFi', [
        ['enab', D.bool(s.on)],
        ['Md  ', md(s.blend)],
        ['Opct', pc(s.opacity)],
        ['Clr ', colorValue(s.color)],
      ]),
    ]);
  }
  if (st.gradientOverlay) {
    const s = st.gradientOverlay;
    items.push([
      'GrFl',
      D.obj('GrFl', [
        ['enab', D.bool(s.on)],
        ['Md  ', md(s.blend)],
        ['Opct', pc(s.opacity)],
        ['Grad', gradientValue(s.gradient)],
        ['Angl', D.unit('#Ang', s.angle)],
        ['Type', D.en('GrdT', gradType(s.style))],
        ['Rvrs', D.bool(s.reverse)],
        ['Algn', D.bool(true)],
        ['Scl ', pc(s.scale)],
        [
          'Ofst',
          D.obj('Pnt ', [
            ['Hrzn', D.unit('#Prc', 0)],
            ['Vrtc', D.unit('#Prc', 0)],
          ]),
        ],
      ]),
    ]);
  }
  if (st.stroke) {
    const s = st.stroke;
    items.push([
      'FrFX',
      D.obj('FrFX', [
        ['enab', D.bool(s.on)],
        ['Styl', D.en('FStl', s.position === 'inside' ? 'InsF' : s.position === 'center' ? 'CtrF' : 'OutF')],
        ['PntT', D.en('FrFl', 'SClr')],
        ['Md  ', md(s.blend)],
        ['Opct', pc(s.opacity)],
        ['Sz  ', px(s.size)],
        ['Clr ', colorValue(s.color)],
      ]),
    ]);
  }
  return { name: '', cls: 'null', items };
}

function adjustmentBlock(l: AdjustmentLayer): [string, Uint8Array] | null {
  const w = new Writer(512);
  switch (l.adjust) {
    case 'levels': {
      const p = l.params as ParamsMap['levels'];
      w.u16(2);
      const sets = [p.rgb, p.r, p.g, p.b];
      for (let i = 0; i < 29; i++) {
        const c = sets[i] ?? { inBlack: 0, inWhite: 1, outBlack: 0, outWhite: 1, gamma: 1 };
        w.u16(Math.round(c.inBlack * 255))
          .u16(Math.round(c.inWhite * 255))
          .u16(Math.round(c.outBlack * 255))
          .u16(Math.round(c.outWhite * 255))
          .u16(Math.round(c.gamma * 100));
      }
      return ['levl', w.result()];
    }
    case 'curves': {
      const p = l.params as ParamsMap['curves'];
      w.u8(0).u16(1).u32(0b1111);
      for (const pts of [p.rgb, p.r, p.g, p.b]) {
        w.u16(pts.length);
        for (const [x, y] of pts) w.u16(Math.round(y * 255)).u16(Math.round(x * 255));
      }
      return ['curv', w.result()];
    }
    case 'exposure': {
      const p = l.params as ParamsMap['exposure'];
      w.u16(1).f32(p.exposure).f32(p.offset).f32(p.gamma);
      return ['expA', w.result()];
    }
    case 'hueSaturation': {
      const p = l.params as ParamsMap['hueSaturation'];
      w.u16(2)
        .u8(p.colorize ? 1 : 0)
        .u8(0);
      w.i16(Math.round(p.colorizeHue > 180 ? p.colorizeHue - 360 : p.colorizeHue))
        .i16(Math.round(p.colorizeSat))
        .i16(Math.round(p.colorizeLight));
      w.i16(Math.round(p.master.hue)).i16(Math.round(p.master.sat)).i16(Math.round(p.master.light));
      for (const k of ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'] as const) {
        const r = p.ranges[k];
        for (const v of r.span) w.i16(Math.round(v));
        w.i16(Math.round(r.hue)).i16(Math.round(r.sat)).i16(Math.round(r.light));
      }
      return ['hue2', w.result()];
    }
    case 'colorBalance': {
      const p = l.params as ParamsMap['colorBalance'];
      for (const t of [p.shadows, p.midtones, p.highlights]) for (const v of t) w.i16(Math.round(v));
      w.u8(p.preserve ? 1 : 0);
      return ['blnc', w.result()];
    }
    case 'invert':
      return ['nvrt', new Uint8Array(0)];
    case 'posterize':
      w.u16((l.params as ParamsMap['posterize']).levels).u16(0);
      return ['post', w.result()];
    case 'threshold':
      w.u16((l.params as ParamsMap['threshold']).level).u16(0);
      return ['thrs', w.result()];
    case 'brightnessContrast': {
      const p = l.params as ParamsMap['brightnessContrast'];
      return [
        'CgEd',
        descriptorBlock({
          name: '',
          cls: 'null',
          items: [
            ['Vrsn', D.long(1)],
            ['Brgh', D.long(Math.round(p.brightness))],
            ['Cntr', D.long(Math.round(p.contrast))],
            ['means', D.long(127)],
            ['Lab ', D.bool(false)],
            ['useLegacy', D.bool(p.legacy)],
            ['Auto', D.bool(false)],
          ],
        }),
      ];
    }
    case 'vibrance': {
      const p = l.params as ParamsMap['vibrance'];
      return [
        'vibA',
        descriptorBlock({
          name: '',
          cls: 'null',
          items: [
            ['vibrance', D.long(Math.round(p.vibrance))],
            ['Strt', D.long(Math.round(p.saturation))],
          ],
        }),
      ];
    }
    case 'blackWhite': {
      const p = l.params as ParamsMap['blackWhite'];
      const h = p.tintHue / 360,
        s = p.tintSat / 100;
      const tint = [
        0.5 + s * 0.5 * Math.cos(h * 2 * Math.PI),
        0.5 + s * 0.5 * Math.cos((h - 1 / 3) * 2 * Math.PI),
        0.5 + s * 0.5 * Math.cos((h - 2 / 3) * 2 * Math.PI),
      ];
      return [
        'blwh',
        descriptorBlock({
          name: '',
          cls: 'null',
          items: [
            ['Rd  ', D.long(p.reds)],
            ['Yllw', D.long(p.yellows)],
            ['Grn ', D.long(p.greens)],
            ['Cyn ', D.long(p.cyans)],
            ['Bl  ', D.long(p.blues)],
            ['Mgnt', D.long(p.magentas)],
            ['useTint', D.bool(p.tint)],
            ['tintColor', colorValue(tint)],
            ['bwPresetKind', D.long(1)],
            ['blackAndWhitePresetFileName', D.text('')],
          ],
        }),
      ];
    }
    case 'photoFilter': {
      const p = l.params as ParamsMap['photoFilter'];
      w.u16(2).u16(0);
      for (const v of p.color) w.u16(Math.round(v * 65535));
      w.u16(0);
      w.u32(Math.round(p.density * 100)).u8(p.preserve ? 1 : 0);
      return ['phfl', w.result()];
    }
    case 'channelMixer': {
      const p = l.params as ParamsMap['channelMixer'];
      w.u16(1).u16(p.mono ? 1 : 0);
      for (const row of [p.r, p.g, p.b]) w.i16(row[0]).i16(row[1]).i16(row[2]).i16(0).i16(row[3]);
      w.zeros(10);
      return ['mixr', w.result()];
    }
    case 'selectiveColor': {
      const p = l.params as ParamsMap['selectiveColor'];
      w.u16(1)
        .u16(p.relative ? 0 : 1)
        .zeros(8);
      for (const k of ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'] as const) {
        const c = p.ranges[k];
        w.i16(c.c).i16(c.m).i16(c.y).i16(c.k);
      }
      return ['selc', w.result()];
    }
    case 'gradientMap': {
      const p = l.params as ParamsMap['gradientMap'];
      const g = p.gradient;
      w.u16(1)
        .u8(p.reverse ? 1 : 0)
        .u8(0);
      w.bytes(unicodeName(g.name));
      w.u16(g.stops.length);
      for (const s of g.stops) {
        w.u32(Math.round(s.pos * 4096))
          .u32(Math.round((s.mid ?? 0.5) * 100))
          .u16(0);
        for (const v of s.color) w.u16(Math.round(v * 65535));
        w.u16(0).u16(0);
      }
      w.u16(g.alphas.length);
      for (const a of g.alphas)
        w.u32(Math.round(a.pos * 4096))
          .u32(Math.round((a.mid ?? 0.5) * 100))
          .u16(Math.round(a.alpha * 255));
      w.u16(2).u16(4096).u16(32).u16(0).u32(0).u16(0).u16(1).u32(2048).u16(3).u16(0).u16(0).u16(0).u16(0).u16(65535).u16(65535).u16(65535).u16(65535).u16(0);
      return ['grdm', w.result()];
    }
    case 'colorLookup': {
      const p = l.params as ParamsMap['colorLookup'];
      if (!p.lut) return null;
      const cube = new TextEncoder().encode(writeCube(p.lut));
      return [
        'clrL',
        descriptorBlock(
          {
            name: '',
            cls: 'null',
            items: [
              ['lookupType', D.en('colorLookupType', '3DLUT')],
              ['Nm  ', D.text(p.lut.name)],
              ['Dthr', D.bool(true)],
              ['LUTFormat', D.en('LUTFormatType', 'LUTFormatCUBE')],
              ['LUT3DFileData', { t: 'tdta', v: cube }],
              ['LUT3DFileName', D.text(`${p.lut.name}.cube`)],
            ],
          },
          16,
          [1 << 16],
        ),
      ];
    }
  }
  return null;
}

function vectorMaskBlock(p: VectorPath, W: number, H: number, enabled: boolean): Uint8Array {
  const w = new Writer(1024);
  w.u32(3).u32(enabled ? 0 : 4);
  const rec = (sel: number, f: (w: Writer) => void) => {
    const start = w.pos;
    w.u16(sel);
    f(w);
    while (w.pos - start < 26) w.u8(0);
  };
  rec(6, () => {});
  rec(8, (ww) => ww.u16(0));
  const fix = (v: number) => Math.round(v * 0x1000000);
  for (const sp of p.subpaths) {
    rec(sp.closed ? 0 : 3, (ww) => ww.u16(sp.anchors.length));
    for (const a of sp.anchors) {
      const sel = sp.closed ? (a.smooth ? 1 : 2) : a.smooth ? 4 : 5;
      rec(sel, (ww) => {
        ww.i32(fix(a.iy / H))
          .i32(fix(a.ix / W))
          .i32(fix(a.y / H))
          .i32(fix(a.x / W))
          .i32(fix(a.oy / H))
          .i32(fix(a.ox / W));
      });
    }
  }
  return w.result();
}

interface OutRecord {
  rect: Rect;
  channels: { id: number; data: Uint8Array }[];
  blend: string;
  opacity: number;
  clip: boolean;
  flags: number;
  name: string;
  mask: { rect: Rect; color: number; flags: number } | null;
  info: [string, Uint8Array][];
}

function rasterChannels(raster: Raster, depth: Depth, docW: number, docH: number): { rect: Rect; channels: { id: number; data: Uint8Array }[] } {
  // Photoshop layers live within the canvas here (pixels outside it are cut).
  const b = raster.contentBounds();
  const r = b ? clipRect(b, docW, docH) : null;
  if (!r) return { rect: { x: 0, y: 0, w: 0, h: 0 }, channels: [-1, 0, 1, 2].map((id) => ({ id, data: Uint8Array.of(0, 0) })) };
  const px = raster.read(r);
  const n = r.w * r.h;
  const plane = (k: number) => {
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = px[i * 4 + k]!;
    return p;
  };
  return { rect: r, channels: [-1, 0, 1, 2].map((id) => ({ id, data: encodeChannel(plane(id === -1 ? 3 : id), r.w, r.h, depth) })) };
}

function clipRect(r: Rect, W: number, H: number): Rect | null {
  const x = Math.max(0, r.x),
    y = Math.max(0, r.y);
  const x1 = Math.min(W, r.x + r.w),
    y1 = Math.min(H, r.y + r.h);
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null;
}

function baseInfo(l: Layer, id: number): [string, Uint8Array][] {
  const info: [string, Uint8Array][] = [['luni', unicodeName(l.name)]];
  const idw = new Writer(4);
  idw.u32(id);
  info.push(['lyid', idw.result()]);
  if (l.fill < 1) info.push(['iOpa', Uint8Array.of(Math.round(l.fill * 255), 0, 0, 0)]);
  const lk = l.locks;
  const lv = (lk.transparency ? 1 : 0) | (lk.pixels ? 2 : 0) | (lk.position ? 4 : 0) | (lk.all ? 0x80000000 : 0);
  if (lv) {
    const w = new Writer(4);
    w.u32(lv);
    info.push(['lspf', w.result()]);
  }
  if (l.tag && l.tag !== 'none') {
    const w = new Writer(8);
    w.u16(['none', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'gray'].indexOf(l.tag)).u16(0).u16(0).u16(0);
    info.push(['lclr', w.result()]);
  }
  if (l.styles) info.push(['lfx2', descriptorBlock(stylesDescriptor(l.styles), 16, [0])]);
  return info;
}

function maskRecord(l: Layer, depth: Depth, W: number, H: number): { mask: OutRecord['mask']; channel: { id: number; data: Uint8Array } | null } {
  if (!l.mask) return { mask: null, channel: null };
  const m = l.mask;
  const b = m.raster.tileBounds();
  const r = b ? clipRect(b, W, H) : null;
  const color = Math.round(m.background * 255);
  const flags = (m.enabled ? 0 : 2) | (m.linked ? 0 : 1);
  if (!r) return { mask: { rect: { x: 0, y: 0, w: 0, h: 0 }, color, flags }, channel: { id: -2, data: Uint8Array.of(0, 0) } };
  const v = m.raster.read(r, undefined, -1);
  for (let i = 0; i < v.length; i++) if (v[i] === -1) v[i] = m.background;
  return { mask: { rect: r, color, flags }, channel: { id: -2, data: encodeChannel(v, r.w, r.h, depth) } };
}

/** Write a PSD. `composite` is the flattened picture (RGBA floats, document size). */
export async function writePSD(doc: Doc, composite: Float32Array): Promise<Uint8Array> {
  const W = doc.width,
    H = doc.height,
    depth = doc.depth;
  const out: OutRecord[] = [];
  let nextId = 1;
  const emit = (l: Layer) => {
    const id = nextId++;
    const info = baseInfo(l, id);
    const flagsBase = 8 | (l.visible ? 0 : 2) | (l.locks.transparency ? 1 : 0);
    if (l.kind === 'group') {
      // Divider below the children, the group itself above them.
      out.push({
        rect: { x: 0, y: 0, w: 0, h: 0 },
        channels: [-1, 0, 1, 2].map((cid) => ({ id: cid, data: Uint8Array.of(0, 0) })),
        blend: 'norm',
        opacity: 1,
        clip: false,
        flags: 8 | 16 | 2,
        name: '</Layer group>',
        mask: null,
        info: [['lsct', Uint8Array.of(0, 0, 0, 3)]],
      });
      for (const c of l.children) emit(c);
      const bk = l.passThrough ? 'pass' : BLEND_KEYS[l.blend];
      const lsct = new Writer(12);
      lsct
        .u32(l.open ? 1 : 2)
        .ascii('8BIM')
        .ascii(bk);
      const mr = maskRecord(l, 8, W, H);
      out.push({
        rect: { x: 0, y: 0, w: 0, h: 0 },
        channels: [...[-1, 0, 1, 2].map((cid) => ({ id: cid, data: Uint8Array.of(0, 0) })), ...(mr.channel ? [mr.channel] : [])],
        blend: bk,
        opacity: l.opacity,
        clip: l.clip,
        flags: flagsBase | 16,
        name: l.name,
        mask: mr.mask,
        info: [...info, ['lsct', lsct.result()]],
      });
      return;
    }
    let rect: Rect = { x: 0, y: 0, w: 0, h: 0 };
    let channels: { id: number; data: Uint8Array }[] = [-1, 0, 1, 2].map((cid) => ({ id: cid, data: Uint8Array.of(0, 0) }));
    if (l.kind === 'adjust') {
      const blk = adjustmentBlock(l);
      if (blk) info.push(blk);
    } else if (l.kind === 'fill') {
      if (l.content.type === 'solid') info.push(['SoCo', descriptorBlock({ name: '', cls: 'null', items: [['Clr ', colorValue(l.content.color)]] })]);
      else if (l.content.type === 'gradient') {
        const c = l.content;
        info.push([
          'GdFl',
          descriptorBlock({
            name: '',
            cls: 'null',
            items: [
              ['Grad', gradientValue(c.gradient)],
              ['Angl', D.unit('#Ang', c.angle)],
              ['Type', D.en('GrdT', gradType(c.style))],
              ['Rvrs', D.bool(c.reverse)],
              ['Algn', D.bool(true)],
              ['Scl ', D.unit('#Prc', c.scale * 100)],
              [
                'Ofst',
                D.obj('Pnt ', [
                  ['Hrzn', D.unit('#Prc', (c.ox / W) * 100)],
                  ['Vrtc', D.unit('#Prc', (c.oy / H) * 100)],
                ]),
              ],
            ],
          }),
        ]);
      } else {
        // Patterns are not written as pattern fills (Photoshop keeps patterns elsewhere): pixels instead.
        info.push(['SoCo', descriptorBlock({ name: '', cls: 'null', items: [['Clr ', colorValue([0.5, 0.5, 0.5])]] })]);
      }
    } else {
      const raster = 'raster' in l ? l.raster : new Raster(depth, 4);
      const rc = rasterChannels(raster.depth === depth ? raster : raster.convert(depth), depth, W, H);
      rect = rc.rect;
      channels = rc.channels;
      if (l.kind === 'shape') {
        // A shape layer: a solid fill with a vector mask (and its stroke), as Photoshop stores it.
        info.push(['SoCo', descriptorBlock({ name: '', cls: 'null', items: [['Clr ', colorValue(l.fillColor ?? [0, 0, 0, 1])]] })]);
        info.push(['vmsk', vectorMaskBlock(l.path, W, H, true)]);
        const s = l.stroke;
        info.push([
          'vstk',
          descriptorBlock({
            name: '',
            cls: 'strokeStyle',
            items: [
              ['strokeStyleVersion', D.long(2)],
              ['strokeEnabled', D.bool(!!s)],
              ['fillEnabled', D.bool(!!l.fillColor)],
              ['strokeStyleLineWidth', D.unit('#Pxl', s?.width ?? 1)],
              [
                'strokeStyleLineAlignment',
                D.en(
                  'strokeStyleLineAlignment',
                  s?.align === 'outside' ? 'strokeStyleAlignOutside' : s?.align === 'center' ? 'strokeStyleAlignCenter' : 'strokeStyleAlignInside',
                ),
              ],
              ['strokeStyleOpacity', D.unit('#Prc', 100)],
              ['strokeStyleContent', D.obj('solidColorLayer', [['Clr ', colorValue(s?.color ?? [0, 0, 0])]])],
            ],
          }),
        ]);
      } else if (l.kind === 'text') {
        const t = l.text;
        const rot = (t.rotation * Math.PI) / 180;
        const tw = new Writer(4096);
        tw.u16(1);
        let ox = t.x,
          oy = t.y;
        if (t.mode === 'box' && t.box) {
          ox = t.x;
          oy = t.y;
        }
        for (const v of [Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), ox, oy]) tw.f64(v);
        tw.u16(50).u32(16);
        const box = t.mode === 'box' && t.box;
        writeDescriptor(tw, {
          name: '',
          cls: 'TxLr',
          items: [
            [
              'Txt ',
              D.text(
                t.runs
                  .map((r) => r.text)
                  .join('')
                  .replace(/\n/g, '\r'),
              ),
            ],
            ['textGridding', D.en('textGridding', 'None')],
            ['Ornt', D.en('Ornt', 'Hrzn')],
            ['AntA', D.en('Annt', t.antialias === 'none' ? 'Anno' : t.antialias === 'sharp' ? 'antiAliasSharp' : 'AnSm')],
            [
              'bounds',
              D.obj('bounds', [
                ['Left', D.unit('#Pnt', 0)],
                ['Top ', D.unit('#Pnt', box ? 0 : -t.base.size)],
                ['Rght', D.unit('#Pnt', box ? t.box!.w : 100)],
                ['Btom', D.unit('#Pnt', box ? t.box!.h : t.base.size * 0.3)],
              ]),
            ],
            ['TextIndex', D.long(0)],
            ['EngineData', { t: 'tdta', v: engineData(t) }],
          ],
        });
        tw.u16(1).u32(16);
        writeDescriptor(tw, {
          name: '',
          cls: 'warp',
          items: [
            ['warpStyle', D.en('warpStyle', 'warpNone')],
            ['warpValue', D.num(0)],
            ['warpPerspective', D.num(0)],
            ['warpPerspectiveOther', D.num(0)],
            ['warpRotate', D.en('Ornt', 'Hrzn')],
          ],
        });
        tw.f64(rect.x)
          .f64(rect.y)
          .f64(rect.x + rect.w)
          .f64(rect.y + rect.h);
        info.push(['TySh', tw.result()]);
      }
    }
    if (l.vmask && l.kind !== 'shape') info.push(['vmsk', vectorMaskBlock(l.vmask.path, W, H, l.vmask.enabled)]);
    const mr = maskRecord(l, 8, W, H);
    if (mr.channel) channels = [...channels, mr.channel];
    const irrelevant = l.kind === 'adjust' || l.kind === 'fill' ? 16 : 0;
    out.push({
      rect,
      channels,
      blend: BLEND_KEYS[l.blend],
      opacity: l.opacity,
      clip: l.clip,
      flags: flagsBase | irrelevant,
      name: l.name,
      mask: mr.mask,
      info,
    });
  };
  for (const l of doc.layers) emit(l);
  // Masks are always 8-bit here; Photoshop stores mask data at the document's depth.
  if (depth !== 8) {
    for (const r of out) {
      const mc = r.channels.find((c) => c.id === -2);
      if (mc && r.mask && r.mask.rect.w > 0) {
        // Re-encode at the document's depth from the 8-bit values.
        const l = findByName(doc.layers, r.name);
        if (l?.mask) {
          const v = l.mask.raster.read(r.mask.rect, undefined, -1);
          for (let i = 0; i < v.length; i++) if (v[i] === -1) v[i] = l.mask.background;
          mc.data = encodeChannel(v, r.mask.rect.w, r.mask.rect.h, depth);
        }
      }
    }
  }
  // ---- the layer info section ----
  const li = new Writer(1 << 20);
  const hasAlpha = (() => {
    for (let i = 3; i < composite.length; i += 4) if (composite[i]! < 1) return true;
    return false;
  })();
  li.i16(hasAlpha ? -out.length : out.length);
  for (const r of out) {
    li.i32(r.rect.y)
      .i32(r.rect.x)
      .i32(r.rect.y + r.rect.h)
      .i32(r.rect.x + r.rect.w);
    li.u16(r.channels.length);
    for (const c of r.channels) li.i16(c.id).u32(c.data.length);
    li.ascii('8BIM')
      .ascii(r.blend)
      .u8(Math.round(r.opacity * 255))
      .u8(r.clip ? 1 : 0)
      .u8(r.flags)
      .u8(0);
    const extra = new Writer(1024);
    if (r.mask)
      extra
        .u32(20)
        .i32(r.mask.rect.y)
        .i32(r.mask.rect.x)
        .i32(r.mask.rect.y + r.mask.rect.h)
        .i32(r.mask.rect.x + r.mask.rect.w)
        .u8(r.mask.color)
        .u8(r.mask.flags)
        .u16(0);
    else extra.u32(0);
    // Blending ranges: everything blends (the defaults).
    extra.u32(40);
    for (let i = 0; i < 10; i++) extra.u16(0).u16(0xffff);
    const nm = new TextEncoder().encode(r.name.replace(/[^\x20-\x7e]/g, '?').slice(0, 255));
    extra
      .u8(nm.length)
      .bytes(nm)
      .zeros(pad(nm.length + 1, 4) - nm.length - 1);
    for (const [k, data] of r.info) infoBlock(extra, k, data);
    const eb = extra.result();
    li.u32(eb.length).bytes(eb);
  }
  for (const r of out) for (const c of r.channels) li.bytes(c.data);
  const liBytes = li.result();
  const liPadded = pad(liBytes.length, 4);
  // ---- the file ----
  const extraAlpha = doc.channels.length;
  const nch = 3 + (hasAlpha ? 1 : 0) + extraAlpha;
  const w = new Writer(1 << 22);
  w.ascii('8BPS').u16(1).zeros(6).u16(nch).u32(H).u32(W).u16(depth).u16(3);
  w.u32(0);
  // Image resources.
  const res = new Writer(4096);
  const resource = (id: number, data: Uint8Array) => {
    res.ascii('8BIM').u16(id).u16(0).u32(data.length).bytes(data);
    if (data.length & 1) res.u8(0);
  };
  const ri = new Writer(16);
  ri.u32(Math.round(doc.resolution * 65536))
    .u16(1)
    .u16(1)
    .u32(Math.round(doc.resolution * 65536))
    .u16(1)
    .u16(1);
  resource(1005, ri.result());
  resource(1039, writeICC(doc.profile));
  if (extraAlpha) {
    const names = new Writer(256);
    for (const c of doc.channels) {
      names.u32(c.name.length + 1);
      for (let i = 0; i < c.name.length; i++) names.u16(c.name.charCodeAt(i));
      names.u16(0);
    }
    resource(1045, names.result());
  }
  const resBytes = res.result();
  w.u32(resBytes.length).bytes(resBytes);
  // Layer and mask info: 8-bit documents in the standard section, deeper ones in Lr16 / Lr32.
  if (depth === 8) {
    w.u32(4 + liPadded + 4);
    w.u32(liPadded)
      .bytes(liBytes)
      .zeros(liPadded - liBytes.length);
    w.u32(0);
  } else {
    const key = depth === 16 ? 'Lr16' : 'Lr32';
    const blockLen = 12 + liPadded;
    w.u32(4 + 4 + blockLen);
    w.u32(0);
    w.u32(0);
    w.ascii('8BIM')
      .ascii(key)
      .u32(liPadded)
      .bytes(liBytes)
      .zeros(liPadded - liBytes.length);
  }
  // The composite (RLE, or raw at 32-bit).
  const n = W * H;
  const planes: Float32Array[] = [];
  for (let c = 0; c < 3 + (hasAlpha ? 1 : 0); c++) {
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = composite[i * 4 + c]!;
    planes.push(p);
  }
  for (const ch of doc.channels) planes.push(ch.raster.read({ x: 0, y: 0, w: W, h: H }));
  if (depth === 32) {
    w.u16(0);
    for (const p of planes) w.bytes(channelBytes(p, W, H, depth));
  } else {
    w.u16(1);
    const bpc = depth === 8 ? 1 : 2;
    const rows: Uint8Array[] = [];
    for (const p of planes) {
      const raw = channelBytes(p, W, H, depth);
      for (let y = 0; y < H; y++) rows.push(packBits(raw.subarray(y * W * bpc, (y + 1) * W * bpc)));
    }
    for (const r of rows) w.u16(r.length);
    for (const r of rows) w.bytes(r);
  }
  return w.result();
}

function findByName(layers: Layer[], name: string): Layer | undefined {
  return allLayers(layers).find((l) => l.name === name);
}

export { deflate, TILE, defaultStyle, corner };
