// Making documents: new blank ones, and ones opened from decoded pictures.

import { Raster } from './raster';
import { SRGB, readICC, type ColorProfile } from './color';
import { pixelLayer, uid } from './layers';
import type { Depth, Doc, RGBA } from './types';
import type { Decoded } from './io/decoded';

export type Background = 'white' | 'black' | 'transparent' | 'color';

export interface NewDocOptions {
  name: string;
  width: number;
  height: number;
  depth: Depth;
  resolution: number;
  profile: ColorProfile;
  background: Background;
  color?: RGBA;
}

export const MAX_SIDE = 30000;

export function blankDoc(o: NewDocOptions): Doc {
  const w = Math.max(1, Math.min(MAX_SIDE, Math.round(o.width))),
    h = Math.max(1, Math.min(MAX_SIDE, Math.round(o.height)));
  const doc: Doc = {
    id: uid('doc'),
    name: o.name,
    width: w,
    height: h,
    depth: o.depth,
    profile: o.profile,
    resolution: o.resolution,
    layers: [],
    selection: null,
    channels: [],
    paths: [],
    guides: [],
    comps: [],
    artboards: [],
    slices: [],
  };
  if (o.background === 'transparent') {
    doc.layers.push(pixelLayer('Layer 1', new Raster(o.depth, 4)));
  } else {
    const c: RGBA = o.background === 'white' ? [1, 1, 1, 1] : o.background === 'black' ? [0, 0, 0, 1] : (o.color ?? [1, 1, 1, 1]);
    const fill = Raster.filled(o.depth, 4, { x: 0, y: 0, w, h }, c);
    const bg = { ...pixelLayer('Background', fill), locks: { position: true } };
    doc.layers.push(bg);
  }
  return doc;
}

/** A document from a decoded picture: one layer ("Background" when opaque). */
export function docFromDecoded(name: string, d: Decoded, depthOverride?: Depth): Doc {
  const depth: Depth = depthOverride ?? d.depth;
  let profile: ColorProfile = SRGB;
  const notes: string[] = [...(d.notes ?? [])];
  if (d.icc) {
    const p = readICC(d.icc);
    if (p) profile = p;
    else notes.push('Its embedded color profile is not an RGB matrix profile, so the colors are read as sRGB.');
  }
  const raster = rasterFromDecoded(d, depth);
  const layer = d.hasAlpha ? pixelLayer('Layer 0', raster) : { ...pixelLayer('Background', raster), locks: { position: true } };
  return {
    id: uid('doc'),
    name,
    width: d.width,
    height: d.height,
    depth,
    profile,
    resolution: d.resolution ?? 72,
    layers: [layer],
    selection: null,
    channels: [],
    paths: [],
    guides: [],
    comps: [],
    artboards: [],
    slices: [],
    meta: notes.length ? { notes: notes.join('\n') } : undefined,
  };
}

/** Decoded RGBA into a raster at the document's depth (quick paths when depths match). */
export function rasterFromDecoded(d: Decoded, depth: Depth, x = 0, y = 0): Raster {
  const r = new Raster(depth, 4);
  const rows = 256;
  const scale = d.depth === 8 ? 1 / 255 : d.depth === 16 ? 1 / 65535 : 1;
  for (let y0 = 0; y0 < d.height; y0 += rows) {
    const hh = Math.min(rows, d.height - y0);
    const n = d.width * hh * 4;
    const f = new Float32Array(n);
    const base = y0 * d.width * 4;
    const src = d.data;
    for (let i = 0; i < n; i++) f[i] = src[base + i]! * scale;
    r.write({ x, y: y + y0, w: d.width, h: hh }, f, null, true);
  }
  r.prune();
  return r;
}
