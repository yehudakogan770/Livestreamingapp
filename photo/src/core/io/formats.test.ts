// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readPSD, writePSD } from './psd';
import { decodeTIFF, encodeTIFF, lzwDecode, packBitsDecode } from './tiff';
import { encodeGIF, medianCut } from './gif';
import { encodeBMP } from './bmp';
import { blankDoc } from '../doc';
import { Raster } from '../raster';
import { groupLayer, pixelLayer, uid, allLayers } from '../layers';
import { defaultParams } from '../adjust';
import { defaultStyle } from '../styles';
import { compositeAll } from '../composite';
import { rectPath } from '../path';
import { parseSvgPath } from '../svgPath';
import { inpaint } from '../inpaint';
import { SRGB } from '../color';
import type { AdjustmentLayer, Doc, FillLayer, GroupLayer, PixelLayer, ShapeLayer } from '../types';

function sampleDoc(): Doc {
  const doc = blankDoc({ name: 'Card', width: 120, height: 80, depth: 8, resolution: 300, profile: SRGB, background: 'white' });
  const red = Raster.filled(8, 4, { x: 10, y: 10, w: 50, h: 40 }, [0.9, 0.1, 0.1, 1]);
  const a: PixelLayer = { ...pixelLayer('Red', red), blend: 'multiply', opacity: 0.75, styles: { dropShadow: defaultStyle('dropShadow') } };
  a.mask = { raster: Raster.filled(8, 1, { x: 0, y: 0, w: 40, h: 80 }, [1]), background: 0, enabled: true, linked: true, density: 1, feather: 0 };
  const blue: PixelLayer = { ...pixelLayer('Blue', Raster.filled(8, 4, { x: 50, y: 30, w: 60, h: 40 }, [0.1, 0.2, 0.9, 0.5])), blend: 'screen' };
  const adj: AdjustmentLayer = { id: uid(), name: 'Levels 1', kind: 'adjust', adjust: 'levels', params: defaultParams('levels'), visible: true, opacity: 1, fill: 1, blend: 'normal', clip: false, locks: {} };
  const fill: FillLayer = { id: uid(), name: 'Color Fill 1', kind: 'fill', content: { type: 'solid', color: [0.2, 0.6, 0.3, 1] }, visible: true, opacity: 0.3, fill: 1, blend: 'normal', clip: false, locks: {} };
  const g: GroupLayer = { ...groupLayer('Group 1', [blue, adj]), passThrough: false };
  doc.layers.push(a, g, fill);
  return doc;
}

describe('PSD', () => {
  it('round trips layers, groups, masks, blend modes, adjustments and fills', async () => {
    const doc = sampleDoc();
    const bytes = await writePSD(doc, compositeAll(doc));
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('8BPS');
    const back = await readPSD(bytes, 'Card');
    expect(back.width).toBe(120);
    expect(back.height).toBe(80);
    expect(Math.round(back.resolution)).toBe(300);
    const names = allLayers(back.layers).map((l) => l.name);
    for (const n of ['Red', 'Group 1', 'Blue', 'Levels 1', 'Color Fill 1']) expect(names).toContain(n);
    const red = allLayers(back.layers).find((l) => l.name === 'Red') as PixelLayer;
    expect(red.kind).toBe('pixel');
    expect(red.blend).toBe('multiply');
    expect(red.opacity).toBeCloseTo(0.75, 2);
    expect(red.mask).toBeTruthy();
    expect(red.styles?.dropShadow?.on).toBe(true);
    const g = back.layers.find((l) => l.name === 'Group 1') as GroupLayer;
    expect(g.kind).toBe('group');
    expect(g.children.map((c) => c.name)).toEqual(['Blue', 'Levels 1']);
    expect(g.children[0]!.blend).toBe('screen');
    expect(g.children[1]!.kind).toBe('adjust');
    const f = back.layers.find((l) => l.name === 'Color Fill 1') as FillLayer;
    expect(f.kind).toBe('fill');
    expect(f.content.type).toBe('solid');
    // Same picture after the trip (8-bit quantization only).
    const x = compositeAll(doc),
      y = compositeAll(back);
    let worst = 0;
    for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(x[i]! - y[i]!));
    expect(worst).toBeLessThan(3 / 255);
  });

  it('keeps 16-bit pixels and shape layers', async () => {
    const doc = blankDoc({ name: 'Deep', width: 64, height: 64, depth: 16, resolution: 72, profile: SRGB, background: 'transparent' });
    const r = Raster.filled(16, 4, { x: 0, y: 0, w: 64, h: 64 }, [0.123, 0.456, 0.789, 1]);
    doc.layers = [pixelLayer('Deep', r)];
    const path = rectPath(8, 8, 30, 20);
    const shape: ShapeLayer = {
      id: uid(), name: 'Rectangle 1', kind: 'shape', path, fillColor: [1, 0.5, 0, 1], stroke: null,
      raster: Raster.filled(8, 4, { x: 8, y: 8, w: 30, h: 20 }, [1, 0.5, 0, 1]),
      visible: true, opacity: 1, fill: 1, blend: 'normal', clip: false, locks: {},
    };
    doc.layers.push(shape);
    const back = await readPSD(await writePSD(doc, compositeAll(doc)));
    expect(back.depth).toBe(16);
    const p = back.layers[0] as PixelLayer;
    const px = p.raster.pixel(20, 20);
    expect(px[0]).toBeCloseTo(0.123, 3);
    expect(px[2]).toBeCloseTo(0.789, 3);
    const s = back.layers[1]!;
    expect(s.kind).toBe('shape');
    if (s.kind === 'shape') expect(s.fillColor![1]).toBeCloseTo(0.5, 2);
  });
});

describe('TIFF', () => {
  it('round trips 8 and 16-bit with LZW and Deflate', async () => {
    const w = 33,
      h = 17;
    const px8 = new Uint8Array(w * h * 4);
    for (let i = 0; i < px8.length; i++) px8[i] = (i * 13) % 256;
    for (const compression of ['lzw', 'deflate', 'none'] as const) {
      const d = await decodeTIFF(await encodeTIFF(w, h, px8, { depth: 8, alpha: true, compress: compression !== 'none' }));
      expect(d.width).toBe(w);
      expect([...d.data]).toEqual([...px8]);
    }
    const px16 = new Uint16Array(w * h * 4);
    for (let i = 0; i < px16.length; i++) px16[i] = (i * 977) % 65536;
    const d = await decodeTIFF(await encodeTIFF(w, h, px16, { depth: 16, alpha: true, compress: true }));
    expect(d.depth).toBe(16);
    expect([...d.data]).toEqual([...px16]);
  });

  it('decodes PackBits and LZW streams', () => {
    // PackBits: 3 literal bytes, then 4 repeats of 0xAA.
    expect([...packBitsDecode(new Uint8Array([2, 1, 2, 3, 0xfd, 0xaa]), 7)]).toEqual([1, 2, 3, 0xaa, 0xaa, 0xaa, 0xaa]);
    expect(lzwDecode(new Uint8Array(0), 0).length).toBe(0);
  });
});

describe('GIF and BMP', () => {
  it('writes valid GIF and BMP headers', () => {
    const w = 20,
      h = 10;
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) px.set([i % 255, (i * 3) % 255, 40, 255], i * 4);
    const gif = encodeGIF(w, h, px, 64);
    expect(new TextDecoder().decode(gif.subarray(0, 6))).toBe('GIF89a');
    expect(gif[gif.length - 1]).toBe(0x3b);
    const bmp = encodeBMP(w, h, px, 72);
    expect(String.fromCharCode(bmp[0]!, bmp[1]!)).toBe('BM');
    const view = new DataView(bmp.buffer, bmp.byteOffset);
    expect(view.getUint32(2, true)).toBe(bmp.length);
    expect(view.getInt32(18, true)).toBe(w);
  });

  it('picks a palette that covers the colors', () => {
    const px = new Uint8Array(4 * 4);
    px.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    const pal = medianCut(px, 4);
    expect(pal.length).toBeLessThanOrEqual(4);
    for (const c of [[255, 0, 0], [0, 255, 0], [0, 0, 255]]) {
      const best = Math.min(...pal.map((p) => Math.abs(p[0]! - c[0]!) + Math.abs(p[1]! - c[1]!) + Math.abs(p[2]! - c[2]!)));
      expect(best).toBeLessThan(10);
    }
  });
});

describe('SVG paths', () => {
  it('parses absolute and relative commands', () => {
    const p = parseSvgPath('M10 10 h20 v20 H10 Z m40 0 c0 10 10 10 10 0 z');
    expect(p.subpaths.length).toBe(2);
    expect(p.subpaths[0]!.anchors.length).toBe(4);
    expect(p.subpaths[0]!.closed).toBe(true);
    const a = p.subpaths[0]!.anchors[2]!;
    expect([a.x, a.y]).toEqual([30, 30]);
    expect(p.subpaths[1]!.anchors[0]!.x).toBe(50);
  });
});

describe('content-aware fill', () => {
  it('fills a hole from a repeating texture', () => {
    const w = 48,
      h = 48;
    const data = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = (Math.floor(x / 4) + Math.floor(y / 4)) % 2;
        data.set([v, v, v], (y * w + x) * 3);
      }
    const hole = new Uint8Array(w * h);
    for (let y = 18; y < 30; y++) for (let x = 18; x < 30; x++) hole[y * w + x] = 1;
    const out = inpaint({ w, h, c: data }, hole);
    // Every filled value is near 0 or 1 (copied texture, not a smear).
    let smeared = 0;
    for (let i = 0; i < w * h; i++) if (hole[i]) {
      const v = out.c[i * 3]!;
      if (v > 0.25 && v < 0.75) smeared++;
    }
    expect(smeared).toBeLessThan(30);
  });
});
