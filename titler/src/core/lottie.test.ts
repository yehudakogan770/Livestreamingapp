// Lottie in and out: an After Effects-style file (Bodymovin) opened with its
// layers, keys and easing; every starter template out to Lottie and back
// draws the same pixels.

import { beforeAll, describe, expect, it } from 'vitest';
import { fromLottie, hex, isLottie } from './lottie';
import { toLottie } from './lottieExport';
import { renderFrame, canvasMeasure } from './render';
import { starterTemplates } from './templates';
import { valueAt } from './easing';
import { canvas, diff, env, pixels, preload, registerTestFont, TEST_FONT } from '../test/nodeCanvas';
import type { GroupLayer, Layer, ShapeLayer, TextLayer, TitleProject, Vec2 } from './types';

const brand = { font: TEST_FONT, fontSub: TEST_FONT };

function draw(p: TitleProject, t: number, w = 480, h = 270, b: object | undefined = brand) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D;
  renderFrame(ctx, p, { time: t, env, brand: b, width: w, height: h });
  return c;
}

const px = (c: ReturnType<typeof canvas>, x: number, y: number) => [
  ...(c.getContext('2d') as unknown as CanvasRenderingContext2D).getImageData(x, y, 1, 1).data,
];

/** An animation as After Effects' Bodymovin writes it (trimmed to what is tested). */
const AE = {
  v: '5.7.4',
  fr: 25,
  ip: 0,
  op: 100,
  w: 1280,
  h: 720,
  nm: 'Lower third AE',
  ddd: 0,
  fonts: { list: [{ fName: 'Montserrat-Bold', fFamily: 'Montserrat', fStyle: 'Bold', ascent: 70 }] },
  assets: [
    {
      id: 'comp_0',
      nm: 'Logo pre',
      layers: [
        {
          ddd: 0,
          ind: 1,
          ty: 4,
          nm: 'Dot',
          ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [50, 50, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
          shapes: [
            {
              ty: 'gr',
              it: [
                { ty: 'el', d: 1, s: { a: 0, k: [40, 40] }, p: { a: 0, k: [0, 0] } },
                { ty: 'fl', c: { a: 0, k: [0, 1, 0, 1] }, o: { a: 0, k: 100 }, r: 1 },
                { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
              ],
            },
          ],
          ip: 0,
          op: 100,
          st: 0,
        },
      ],
    },
  ],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 5,
      nm: 'Name',
      parent: 4,
      ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [40, 60, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
      t: {
        d: { k: [{ s: { s: 48, f: 'Montserrat-Bold', t: 'Ada Lovelace', j: 0, tr: 0, lh: 57.6, ls: 0, fc: [1, 1, 1] }, t: 0 }] },
        p: {},
        m: { g: 1, a: { a: 0, k: [0, 0] } },
        a: [],
      },
      ip: 0,
      op: 100,
      st: 0,
    },
    {
      ddd: 0,
      ind: 2,
      ty: 4,
      nm: 'Matte box',
      td: 1,
      ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
      shapes: [
        {
          ty: 'gr',
          it: [
            { ty: 'rc', d: 1, s: { a: 0, k: [300, 720] }, p: { a: 0, k: [150, 360] }, r: { a: 0, k: 0 } },
            { ty: 'fl', c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 100 } },
            { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
          ],
        },
      ],
      ip: 0,
      op: 100,
      st: 0,
    },
    {
      ddd: 0,
      ind: 3,
      ty: 4,
      nm: 'Bar',
      tt: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: {
          s: true,
          x: {
            a: 1,
            k: [
              { i: { x: [0.2], y: [1] }, o: { x: [0.8], y: [0] }, t: 0, s: [-200] },
              { t: 25, s: [100] },
            ],
          },
          y: { a: 0, k: 500 },
        },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 0, k: [100, 100, 100] },
      },
      shapes: [
        {
          ty: 'gr',
          it: [
            { ty: 'rc', d: 1, s: { a: 0, k: [400, 100] }, p: { a: 0, k: [200, 50] }, r: { a: 0, k: 0 } },
            {
              ty: 'gf',
              t: 1,
              s: { a: 0, k: [0, 50] },
              e: { a: 0, k: [400, 50] },
              g: { p: 2, k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1] } },
              o: { a: 0, k: 100 },
              r: 1,
            },
            { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
          ],
        },
      ],
      ip: 0,
      op: 100,
      st: 0,
    },
    {
      ddd: 0,
      ind: 4,
      ty: 3,
      nm: 'Control',
      ks: { o: { a: 0, k: 0 }, r: { a: 0, k: 0 }, p: { a: 0, k: [100, 500, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
      ip: 0,
      op: 100,
      st: 0,
    },
    {
      ddd: 0,
      ind: 5,
      ty: 0,
      nm: 'Logo',
      refId: 'comp_0',
      ks: {
        o: { a: 0, k: 100 },
        r: {
          a: 1,
          k: [
            { i: { x: [0.667], y: [1] }, o: { x: [0.333], y: [0] }, t: 0, s: [0], h: 1 },
            { t: 50, s: [90] },
          ],
        },
        p: { a: 0, k: [1100, 100, 0] },
        a: { a: 0, k: [50, 50, 0] },
        s: { a: 0, k: [100, 100, 100] },
      },
      w: 100,
      h: 100,
      ip: 0,
      op: 100,
      st: 10,
      hasMask: true,
      masksProperties: [
        {
          inv: false,
          mode: 'a',
          pt: {
            a: 0,
            k: {
              i: [
                [0, 0],
                [0, 0],
                [0, 0],
                [0, 0],
              ],
              o: [
                [0, 0],
                [0, 0],
                [0, 0],
                [0, 0],
              ],
              v: [
                [0, 0],
                [100, 0],
                [100, 100],
                [0, 100],
              ],
              c: true,
            },
          },
          o: { a: 0, k: 100 },
          x: { a: 0, k: 0 },
          nm: 'Mask 1',
        },
      ],
      ef: [{ ty: 25, nm: 'Drop Shadow' }],
    },
    {
      ddd: 0,
      ind: 6,
      ty: 1,
      nm: 'Red Solid',
      ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
      sw: 1280,
      sh: 720,
      sc: '#200000',
      ip: 0,
      op: 100,
      st: 0,
    },
  ],
  markers: [
    { tm: 0, cm: 'in', dr: 25 },
    { tm: 75, cm: 'out', dr: 25 },
    { tm: 40, cm: 'Whoosh', dr: 0 },
  ],
};

const find = (ls: Layer[], name: string): Layer | undefined => {
  for (const l of ls) {
    if (l.name === name) return l;
    if (l.type === 'group') {
      const f = find(l.children, name);
      if (f) return f;
    }
  }
  return undefined;
};

beforeAll(async () => {
  registerTestFont();
  for (const p of starterTemplates()) await preload(p);
});

describe('Lottie in', () => {
  it('knows a Lottie file', () => {
    expect(isLottie(AE)).toBe(true);
    expect(isLottie({ format: 'lumora-title' })).toBe(false);
    expect(() => fromLottie({ nope: true })).toThrow(/not a Lottie/);
  });

  it('reads colors as Lottie writes them', () => {
    expect(hex([1, 0, 0, 1])).toBe('#ff0000');
    expect(hex([0, 0, 1], 0.5)).toBe('#0000ff80');
    expect(hex([255, 128, 0])).toBe('#ff8000');
  });

  it('brings over layers, parents, precomps, mattes, masks, keys, easing and markers', () => {
    const { project: p, notes } = fromLottie(AE);
    const c = p.compositions.find((x) => x.id === p.main)!;
    expect([c.width, c.height, c.fps, c.duration]).toEqual([1280, 720, 25, 4]);
    expect(c.markers.inEnd).toBe(1);
    expect(c.markers.outStart).toBe(3);
    expect(c.cues.map((q) => q.name)).toEqual(['Whoosh']);
    expect(c.layers.map((l) => [l.name, l.type])).toEqual([
      ['Name', 'text'],
      ['Matte box', 'shape'],
      ['Bar', 'shape'],
      ['Control', 'null'],
      ['Logo', 'comp'],
      ['Red Solid', 'shape'],
    ]);
    const name = c.layers[0] as TextLayer;
    expect(name.text).toBe('Ada Lovelace');
    expect(name.style.font).toBe('Montserrat');
    expect(name.style.weight).toBe(700);
    expect(name.parent).toBe(c.layers[3]!.id);
    const bar = c.layers[2] as ShapeLayer;
    expect(bar.matte).toEqual({ layer: c.layers[1]!.id, mode: 'alpha' });
    expect(bar.fill?.type).toBe('linear');
    // Split position joined; the easing kept.
    const pos = bar.transform.position;
    expect('k' in pos && pos.k?.length).toBe(2);
    expect(valueAt(pos, 0, [0, 0] as Vec2)).toEqual([-200, 500]);
    expect(valueAt(pos, 1, [0, 0] as Vec2)).toEqual([100, 500]);
    const early = valueAt(pos, 0.25, [0, 0] as Vec2)[0];
    expect(early).toBeGreaterThan(-200);
    expect(early).toBeLessThan(-150); // eased: slow out of the first key (linear would be -125)
    const logo = c.layers[4]!;
    expect(logo.type === 'comp' && logo.offset).toBe(0.4);
    expect(logo.masks?.length).toBe(1);
    const rot = logo.transform.rotation;
    expect('k' in rot && rot.k?.[0]?.hold).toBe(true);
    expect(p.compositions.length).toBe(2);
    expect(notes.join(' ')).toMatch(/effects/i);
  });

  it('draws what After Effects drew', async () => {
    const { project: p } = fromLottie(AE);
    const c = draw(p, 2, 1280, 720, undefined);
    // The bar, through its matte (the left 300 px), from red to blue.
    const left = px(c, 120, 550);
    expect(left[0]).toBeGreaterThan(150);
    expect(left[2]).toBeLessThan(120);
    // Cut away right of the matte: the dark red solid below shows.
    expect(px(c, 380, 550).slice(0, 3)).toEqual([0x20, 0, 0]);
    // The logo's green dot, in its precomp.
    const dot = px(c, 1100, 100);
    expect(dot[1]).toBeGreaterThan(200);
    expect(dot[0]).toBeLessThan(40);
  });
});

describe('Lottie out', () => {
  it('writes a file Lottie players read', () => {
    const p = starterTemplates().find((x) => x.name === 'Name and role')!;
    const { json, notes } = toLottie(p);
    expect(json.v).toBeTruthy();
    expect(json.fr).toBe(p.compositions[0]!.fps);
    expect(Array.isArray(json.layers)).toBe(true);
    expect((json.markers as { cm: string }[]).map((m) => m.cm)).toEqual(expect.arrayContaining(['in', 'out']));
    expect(notes.join(' ')).toMatch(/Fields/);
    expect(isLottie(json)).toBe(true);
  });

  // Every template out and back in draws (nearly) the same pixels at its hold and in the middle of its IN.
  for (const t of starterTemplates()) {
    it(`round trip: ${t.name}`, async () => {
      const ctx = canvas(8, 8).getContext('2d') as unknown as CanvasRenderingContext2D;
      const { json } = toLottie(t, { brand, measure: canvasMeasure(ctx) });
      const back = fromLottie(JSON.parse(JSON.stringify(json))).project;
      await preload(back);
      const c = t.compositions.find((x) => x.id === t.main)!;
      for (const time of [c.markers.inEnd * 0.5, c.markers.inEnd + 0.05]) {
        const a = pixels(draw(t, time));
        const b = pixels(draw(back, time, 480, 270, undefined));
        const d = diff(a, b, 48);
        expect(d, `${t.name} at ${time.toFixed(2)} s`).toBeLessThan(TOLERANCE[t.name] ?? 0.02);
      }
    });
  }
});

/** Templates using what Lottie cannot carry (effects, text animators, crawls) differ more. */
const TOLERANCE: Record<string, number> = {};

describe('shape changes form', () => {
  it('reads path keys and draws between them', () => {
    const sq = (s: number) => ({
      i: [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      o: [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      v: [
        [0, 0],
        [s, 0],
        [s, s],
        [0, s],
      ],
      c: true,
    });
    const json = {
      v: '5.7.4',
      fr: 10,
      ip: 0,
      op: 20,
      w: 200,
      h: 200,
      layers: [
        {
          ty: 4,
          ind: 1,
          ks: {},
          ip: 0,
          op: 20,
          shapes: [
            {
              ty: 'sh',
              ks: {
                a: 1,
                k: [
                  { t: 0, s: [sq(50)], o: { x: [0], y: [0] }, i: { x: [1], y: [1] } },
                  { t: 10, s: [sq(150)] },
                ],
              },
            },
            { ty: 'fl', c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 100 } },
          ],
        },
      ],
    };
    const p = fromLottie(json).project;
    const shape = p.compositions[0]!.layers[0] as ShapeLayer | GroupLayer;
    const s = (shape.type === 'group' ? shape.children[0] : shape) as ShapeLayer;
    expect(s.morph?.length).toBe(2);
    const c = draw(p, 0.5, 200, 200, undefined);
    expect(px(c, 90, 90)[3]).toBe(255);
    expect(px(c, 110, 110)[3]).toBe(0);
    const out = toLottie(p).json;
    const back = fromLottie(out).project;
    const s2 = back.compositions[0]!.layers[0] as ShapeLayer;
    expect(s2.type).toBe('shape');
    expect(s2.morph?.length).toBe(2);
  });
});
