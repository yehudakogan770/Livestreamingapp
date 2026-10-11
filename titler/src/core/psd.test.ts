// Photoshop files: layers read with their place, size, opacity, blend mode,
// visibility and names (Unicode too), RLE and raw pictures, groups as
// groups; brought in as a title whose pictures are PNGs inside it.

import { describe, expect, it } from 'vitest';
import { readPsd, unpackBits } from './psd';
import { psdProject } from '../designer/importing';
import { readImport } from '../designer/importing';

interface TestLayer {
  name: string;
  rect: [number, number, number, number]; // top, left, bottom, right
  color?: [number, number, number, number];
  opacity?: number;
  hidden?: boolean;
  blend?: string;
  rle?: boolean;
  section?: number;
  unicode?: string;
}

/** PackBits: everything as repeats of one value (good enough for flat colors). */
function packRow(v: number, n: number): number[] {
  const out: number[] = [];
  while (n > 0) {
    const k = Math.min(128, n);
    if (k === 1) out.push(0, v);
    else out.push(257 - k, v);
    n -= k;
  }
  return out;
}

/** A small layered PSD, 8-bit RGB. */
function writePsd(width: number, height: number, layers: TestLayer[]): Uint8Array {
  const b: number[] = [];
  const u8 = (n: number) => b.push(n & 255);
  const u16 = (n: number) => b.push((n >> 8) & 255, n & 255);
  const u32 = (n: number) => b.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  const str = (s: string) => [...s].forEach((c) => b.push(c.charCodeAt(0)));
  str('8BPS');
  u16(1);
  for (let i = 0; i < 6; i++) u8(0);
  u16(4);
  u32(height);
  u32(width);
  u16(8);
  u16(3);
  u32(0); // color mode
  u32(0); // resources
  const recs: number[][] = [];
  const datas: number[][][] = [];
  for (const l of layers) {
    const [top, left, bottom, right] = l.rect;
    const w = right - left;
    const h = bottom - top;
    const chans: number[][] = [];
    const color = l.color ?? [0, 0, 0, 255];
    for (const [ci, id] of [
      [3, -1],
      [0, 0],
      [1, 1],
      [2, 2],
    ] as const) {
      const v = color[ci]!;
      const d: number[] = [];
      const p16 = (n: number) => d.push((n >> 8) & 255, n & 255);
      if (w <= 0 || h <= 0) p16(0);
      else if (l.rle) {
        p16(1);
        const rows = Array.from({ length: h }, () => packRow(v, w));
        rows.forEach((r) => p16(r.length));
        rows.forEach((r) => d.push(...r));
      } else {
        p16(0);
        for (let k = 0; k < w * h; k++) d.push(v);
      }
      chans.push([id, ...d]);
    }
    datas.push(chans.map((c) => c.slice(1)));
    const r: number[] = [];
    const ru16 = (n: number) => r.push((n >> 8) & 255, n & 255);
    const ru32 = (n: number) => r.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
    const rstr = (s: string) => [...s].forEach((c) => r.push(c.charCodeAt(0)));
    ru32(top);
    ru32(left);
    ru32(bottom);
    ru32(right);
    ru16(4);
    chans.forEach((c) => {
      ru16(c[0]! & 0xffff);
      ru32(c.length - 1);
    });
    rstr('8BIM');
    rstr(l.blend ?? 'norm');
    r.push(l.opacity ?? 255, 0, l.hidden ? 2 : 0, 0);
    const extra: number[] = [];
    const e32 = (n: number) => extra.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
    e32(0); // mask
    e32(0); // blending ranges
    const name = l.name.slice(0, 31);
    extra.push(name.length, ...[...name].map((c) => c.charCodeAt(0)));
    while ((name.length + 1) % 4 && extra.length % 4) extra.push(0);
    while (extra.length % 4) extra.push(0);
    if (l.section !== undefined) {
      [...'8BIMlsct'].forEach((c) => extra.push(c.charCodeAt(0)));
      e32(4);
      e32(l.section);
    }
    if (l.unicode) {
      [...'8BIMluni'].forEach((c) => extra.push(c.charCodeAt(0)));
      const body: number[] = [];
      body.push(0, 0, 0, l.unicode.length);
      for (const ch of l.unicode) body.push((ch.charCodeAt(0) >> 8) & 255, ch.charCodeAt(0) & 255);
      if (body.length % 2) body.push(0);
      e32(body.length);
      extra.push(...body);
    }
    ru32(extra.length);
    r.push(...extra);
    recs.push(r);
  }
  const info: number[] = [];
  info.push((layers.length >> 8) & 255, layers.length & 255);
  recs.forEach((r) => info.push(...r));
  datas.forEach((chans) => chans.forEach((d) => info.push(...d)));
  if (info.length % 2) info.push(0);
  u32(info.length + 4 + 4);
  u32(info.length);
  b.push(...info);
  u32(0); // global mask info
  return new Uint8Array(b);
}

describe('Photoshop files', () => {
  it('unpacks PackBits runs and literals', () => {
    const out = new Uint8Array(8);
    unpackBits(new Uint8Array([2, 1, 2, 3, 0xfd, 9, 0, 7]), out);
    expect([...out]).toEqual([1, 2, 3, 9, 9, 9, 9, 7]);
  });

  it('reads layers bottom to top as front first, with their settings and groups', () => {
    const bytes = writePsd(200, 100, [
      { name: 'Back', rect: [0, 0, 100, 200], color: [20, 30, 40, 255], rle: true },
      { name: '</Layer group>', rect: [0, 0, 0, 0], section: 3 },
      { name: 'Bar', rect: [60, 10, 90, 110], color: [200, 30, 30, 255], opacity: 128, blend: 'mul ' },
      { name: 'Note', rect: [5, 5, 15, 25], color: [255, 255, 255, 255], hidden: true, rle: true },
      { name: 'Lower third', rect: [0, 0, 0, 0], section: 1 },
      { name: 'x', unicode: 'Logo é', rect: [10, 150, 40, 190], color: [0, 128, 255, 200] },
    ]);
    const psd = readPsd(bytes);
    expect([psd.width, psd.height]).toEqual([200, 100]);
    expect(psd.layers.map((l) => l.name)).toEqual(['Logo é', 'Lower third', 'Back']);
    const logo = psd.layers[0]!;
    expect(logo.kind === 'image' && [logo.left, logo.top, logo.width, logo.height]).toEqual([150, 10, 40, 30]);
    expect(logo.kind === 'image' && [...logo.rgba.slice(0, 4)]).toEqual([0, 128, 255, 200]);
    const group = psd.layers[1]!;
    expect(group.kind).toBe('group');
    if (group.kind !== 'group') return;
    expect(group.children.map((l) => l.name)).toEqual(['Note', 'Bar']);
    const [note, bar] = group.children as Extract<(typeof group.children)[number], { kind: 'image' }>[];
    expect(note!.visible).toBe(false);
    expect([...note!.rgba.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect(bar!.opacity).toBe(128);
    expect(bar!.blend).toBe('multiply');
    const back = psd.layers[2]!;
    expect(back.kind === 'image' && [...back.rgba.slice(-4)]).toEqual([20, 30, 40, 255]);
  });

  it('opens as a title: pictures in place, inside the title, group and settings kept', async () => {
    const bytes = writePsd(320, 180, [
      { name: 'Box', rect: [100, 20, 160, 220], color: [10, 10, 10, 230], rle: true },
      { name: 'Accent', rect: [100, 16, 160, 20], color: [220, 40, 40, 255], opacity: 204 },
    ]);
    const got = await readImport('Lower third.psd', bytes);
    expect(got.kind).toBe('project');
    if (got.kind !== 'project') return;
    const { project } = got;
    expect(project.name).toBe('Lower third');
    const c = project.compositions[0]!;
    expect([c.width, c.height]).toEqual([320, 180]);
    expect(c.layers.map((l) => l.name)).toEqual(['Accent', 'Box']);
    const accent = c.layers[0]!;
    expect(accent.type).toBe('image');
    if (accent.type !== 'image') return;
    expect(accent.transform.position).toEqual({ v: [16, 100] });
    expect(accent.size).toEqual([4, 60]);
    expect(accent.transform.opacity).toEqual({ v: 80 });
    const asset = project.assets.find((a) => a.id === accent.asset)!;
    expect(asset.src.startsWith('data:image/png;base64,')).toBe(true);
    // A real PNG.
    const png = Uint8Array.from(atob(asset.src.split(',')[1]!), (ch) => ch.charCodeAt(0));
    expect([...png.slice(1, 4)].map((n) => String.fromCharCode(n)).join('')).toBe('PNG');
  });

  it('says plainly what it cannot read', () => {
    const bytes = writePsd(10, 10, []);
    bytes[23] = 24; // 24 bits a channel
    expect(() => readPsd(bytes)).toThrow(/bits a channel/);
    expect(() => readPsd(new Uint8Array(40))).toThrow(/not a Photoshop file/);
  });

  it('a flat Photoshop file brings in nothing, and says so', async () => {
    const flat = writePsd(50, 50, []);
    const r = await psdProject(flat, 'Flat');
    expect(r.project.compositions[0]!.layers).toHaveLength(0);
  });
});
