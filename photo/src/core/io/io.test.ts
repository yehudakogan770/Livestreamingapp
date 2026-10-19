// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decodePNG, encodePNG } from './png';
import { zip, unzip } from './zip';
import { readLumphoto, writeLumphoto } from './lumphoto';
import { blankDoc } from '../doc';
import { ADOBE_RGB, DISPLAY_P3, SRGB, readICC, writeICC, convertColor, decode, encode } from '../color';
import { Raster } from '../raster';
import { pixelLayer, groupLayer, uid } from '../layers';
import { defaultParams } from '../adjust';
import { defaultStyle } from '../styles';
import type { AdjustmentLayer, Doc, PixelLayer } from '../types';
import { compositeAll } from '../composite';

describe('PNG', () => {
  it('round trips 8-bit RGBA with its profile and resolution', async () => {
    const w = 37,
      h = 23;
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < px.length; i++) px[i] = (i * 7) % 256;
    const bytes = await encodePNG(w, h, px, { depth: 8, alpha: true, icc: writeICC(DISPLAY_P3), iccName: 'Display P3', resolution: 300 });
    const d = await decodePNG(bytes);
    expect(d.width).toBe(w);
    expect(d.height).toBe(h);
    expect(d.depth).toBe(8);
    expect([...d.data]).toEqual([...px]);
    expect(d.resolution).toBe(300);
    expect(readICC(d.icc!)!.id).toBe('p3');
  });

  it('keeps 16 bits', async () => {
    const w = 9,
      h = 5;
    const px = new Uint16Array(w * h * 4);
    for (let i = 0; i < px.length; i++) px[i] = (i * 1013) % 65536;
    for (let i = 3; i < px.length; i += 4) px[i] = 65535;
    const d = await decodePNG(await encodePNG(w, h, px, { depth: 16, alpha: false }));
    expect(d.depth).toBe(16);
    expect([...d.data]).toEqual([...px]);
    expect(d.hasAlpha).toBe(false);
  });
});

describe('ICC', () => {
  it('writes profiles that read back as themselves', () => {
    for (const p of [SRGB, DISPLAY_P3, ADOBE_RGB]) {
      const back = readICC(writeICC(p))!;
      expect(back.id).toBe(p.id);
      for (let i = 0; i < 9; i++) expect(back.toXYZ[i]).toBeCloseTo(p.toXYZ[i]!, 3);
    }
  });

  it('converts colors between spaces through XYZ', () => {
    // sRGB red is inside P3: it becomes less saturated there.
    const p3 = convertColor([1, 0, 0], SRGB, DISPLAY_P3);
    expect(p3[0]).toBeLessThan(1);
    expect(p3[1]).toBeGreaterThan(0.1);
    const back = convertColor(p3, DISPLAY_P3, SRGB);
    expect(back[0]).toBeCloseTo(1, 3);
    expect(back[1]).toBeCloseTo(0, 3);
    // White stays white.
    expect(convertColor([1, 1, 1], SRGB, ADOBE_RGB).map((v) => +v.toFixed(3))).toEqual([1, 1, 1]);
    expect(encode(SRGB.trc, decode(SRGB.trc, 0.5))).toBeCloseTo(0.5, 6);
  });
});

describe('zip', () => {
  it('stores and deflates entries', async () => {
    const big = new TextEncoder().encode('lumora '.repeat(2000));
    const z = await zip([
      { name: 'a.txt', data: big },
      { name: 'b.bin', data: new Uint8Array([1, 2, 3]), store: true },
    ]);
    expect(z.length).toBeLessThan(big.length / 4);
    const files = await unzip(z);
    expect(new TextDecoder().decode(files.get('a.txt')!)).toBe('lumora '.repeat(2000));
    expect([...files.get('b.bin')!]).toEqual([1, 2, 3]);
  });
});

describe('.lumphoto', () => {
  it('saves and opens a layered document exactly', async () => {
    const doc: Doc = blankDoc({ name: 'Poster', width: 300, height: 200, depth: 16, resolution: 300, profile: ADOBE_RGB, background: 'white' });
    const paint = Raster.filled(16, 4, { x: 20, y: 30, w: 100, h: 50 }, [0.2, 0.4, 0.6, 0.5]);
    const layer: PixelLayer = { ...pixelLayer('Paint', paint), blend: 'multiply', opacity: 0.8, styles: { dropShadow: defaultStyle('dropShadow') } };
    layer.mask = { raster: Raster.filled(8, 1, { x: 0, y: 0, w: 60, h: 200 }, [1]), background: 0, enabled: true, linked: true, density: 1, feather: 0 };
    const adj: AdjustmentLayer = {
      id: uid(),
      name: 'Curves 1',
      kind: 'adjust',
      adjust: 'curves',
      params: defaultParams('curves'),
      visible: true,
      opacity: 1,
      fill: 1,
      blend: 'normal',
      clip: false,
      locks: {},
    };
    doc.layers.push(groupLayer('Group 1', [layer, adj]));
    doc.guides.push({ id: 'g', axis: 'x', at: 150 });
    const bytes = await writeLumphoto(doc);
    const { doc: back } = await readLumphoto(bytes);
    expect(back.width).toBe(300);
    expect(back.depth).toBe(16);
    expect(back.profile.id).toBe('adobergb');
    expect(back.resolution).toBe(300);
    expect(back.guides).toEqual(doc.guides);
    const g = back.layers[1]!;
    expect(g.kind).toBe('group');
    if (g.kind !== 'group') return;
    const p = g.children[0] as PixelLayer;
    expect(p.blend).toBe('multiply');
    expect(p.opacity).toBe(0.8);
    expect(p.styles?.dropShadow?.on).toBe(true);
    expect(p.raster.depth).toBe(16);
    expect([...p.raster.pixel(50, 40)].map((v) => +v.toFixed(4))).toEqual([0.2, 0.4, 0.6, 0.5]);
    expect(p.mask!.raster.pixel(30, 30)[0]).toBe(1);
    expect(g.children[1]!.kind).toBe('adjust');
    // The composite is the same.
    const a = compositeAll(doc),
      b = compositeAll(back);
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
    expect(worst).toBeLessThan(1e-6);
  });
});
