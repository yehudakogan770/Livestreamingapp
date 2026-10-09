// Combined shapes (boolean), more than one fill, and components (a
// composition used several times, each copy with its own field values).

import { beforeAll, describe, expect, it } from 'vitest';
import { newComposition, newCompLayer, newGroup, newProject, newShape } from './build';
import { renderFrame } from './render';
import { toLottie } from './lottieExport';
import { fromLottie } from './lottie';
import { canvas, env, registerTestFont, TEST_FONT } from '../test/nodeCanvas';
import type { GroupLayer, ShapeLayer, TitleProject } from './types';

const brand = { font: TEST_FONT, fontSub: TEST_FONT };

function draw(p: TitleProject, w = 200, h = 200) {
  const c = canvas(w, h);
  renderFrame(c.getContext('2d') as unknown as CanvasRenderingContext2D, p, { time: 1, env, brand, width: w, height: h });
  return c;
}
const px = (c: ReturnType<typeof canvas>, x: number, y: number) => [
  ...(c.getContext('2d') as unknown as CanvasRenderingContext2D).getImageData(x, y, 1, 1).data,
];

function scene(combine: GroupLayer['combine']) {
  const p = newProject('Combine', 200, 200);
  const c = p.compositions[0]!;
  const base = newShape(c, 'rect', [20, 20], [160, 160], '#ff0000');
  const hole = newShape(c, 'ellipse', [60, 60], [80, 80], '#0000ff');
  const g = { ...newGroup(c, [hole, base]), combine };
  c.layers = [g];
  return p;
}

beforeAll(() => registerTestFont());

describe('combined shapes', () => {
  it('subtract cuts the front shape out of the back one', () => {
    const c = draw(scene('subtract'));
    expect(px(c, 100, 100)[3]).toBe(0);
    expect(px(c, 30, 30).slice(0, 4)).toEqual([255, 0, 0, 255]);
  });

  it('intersect keeps only where they overlap; exclude only where they do not', () => {
    const i = draw(scene('intersect'));
    expect(px(i, 100, 100)[3]).toBe(255);
    expect(px(i, 30, 30)[3]).toBe(0);
    const x = draw(scene('exclude'));
    expect(px(x, 100, 100)[3]).toBe(0);
    expect(px(x, 30, 30)[3]).toBe(255);
  });

  it('union and off draw both', () => {
    for (const mode of ['union', null] as const) {
      const c = draw(scene(mode));
      expect(px(c, 100, 100)[3]).toBe(255);
      expect(px(c, 30, 30)[3]).toBe(255);
    }
  });
});

describe('more than one fill', () => {
  it('draws each fill over the one before, and keeps them through Lottie', () => {
    const p = newProject('Fills', 200, 200);
    const c = p.compositions[0]!;
    const s: ShapeLayer = { ...newShape(c, 'rect', [0, 0], [200, 200], '#ff0000'), extraFills: [{ type: 'solid', color: '#0000ff80' }] };
    c.layers = [s];
    const got = px(draw(p), 100, 100);
    expect(got[0]).toBeGreaterThan(100);
    expect(got[2]).toBeGreaterThan(100);
    const back = fromLottie(toLottie(p).json).project.compositions[0]!.layers[0] as ShapeLayer;
    expect(back.fill).toEqual({ type: 'solid', color: '#ff0000' });
    expect(back.extraFills).toEqual([{ type: 'solid', color: '#0000ff80' }]);
  });
});

describe('components', () => {
  it('each copy of a composition shows its own field values (or the title’s, or other fields)', () => {
    const p = newProject('Panel', 400, 200);
    const main = p.compositions[0]!;
    const tag = newComposition('Tag', 200, 200);
    const box = newShape(tag, 'rect', [0, 0], [200, 200], '{{tone}}');
    tag.layers = [box];
    p.compositions.push(tag);
    p.variables = [
      { key: 'tone', label: 'Tone', type: 'color', value: '#ff0000' },
      { key: 'second', label: 'Second', type: 'color', value: '#00ff00' },
    ];
    const a = newCompLayer(main, tag);
    const b = {
      ...newCompLayer(main, tag),
      values: { tone: '{{second}}' },
      transform: { ...newCompLayer(main, tag).transform, position: { v: [200, 0] as [number, number] } },
    };
    main.layers = [a, b];
    const c = draw(p, 400, 200);
    expect(px(c, 100, 100).slice(0, 3)).toEqual([255, 0, 0]);
    expect(px(c, 300, 100).slice(0, 3)).toEqual([0, 255, 0]);
    // Lottie gets one precomp for each copy that has its own values.
    const json = toLottie(p).json as { assets: { id: string }[] };
    expect(json.assets.filter((x) => x.id.startsWith('comp_')).length).toBe(2);
  });
});
