// Combined shapes (boolean), more than one fill, and components (a
// composition used several times, each copy with its own field values).

import { beforeAll, describe, expect, it } from 'vitest';
import { newComposition, newCompLayer, newGroup, newProject, newShape, newText } from './build';
import { overrideLayer, withOverrides } from './components';
import { parseProject } from './validate';
import { renderFrame } from './render';
import { toLottie } from './lottieExport';
import { fromLottie } from './lottie';
import { canvas, env, registerTestFont, TEST_FONT } from '../test/nodeCanvas';
import type { CompLayer, GroupLayer, ShapeLayer, TitleProject } from './types';

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

  it('each copy can change any layer inside: color, shown, moved, scaled, words; its animation still plays', () => {
    const p = newProject('Panel', 400, 200);
    const main = p.compositions[0]!;
    const tag = newComposition('Tag', 200, 200);
    const box = newShape(tag, 'rect', [0, 0], [200, 200], '#ff0000');
    const dot = newShape(tag, 'rect', [0, 0], [20, 20], '#ffffff');
    tag.layers = [dot, box];
    p.compositions.push(tag);
    const a = newCompLayer(main, tag);
    const b: CompLayer = {
      ...newCompLayer(main, tag),
      overrides: { [box.id]: { fill: '#0000ff' }, [dot.id]: { move: [150, 150] } },
      transform: { ...newCompLayer(main, tag).transform, position: { v: [200, 0] as [number, number] } },
    };
    main.layers = [a, b];
    let c = draw(p, 400, 200);
    expect(px(c, 100, 100).slice(0, 3)).toEqual([255, 0, 0]);
    expect(px(c, 300, 100).slice(0, 3)).toEqual([0, 0, 255]);
    // The first copy's dot is at its corner; the second's moved to the other corner.
    expect(px(c, 10, 10).slice(0, 3)).toEqual([255, 255, 255]);
    expect(px(c, 210, 10).slice(0, 3)).toEqual([0, 0, 255]);
    expect(px(c, 360, 160).slice(0, 3)).toEqual([255, 255, 255]);
    // Hidden in a copy.
    b.overrides = { [box.id]: { visible: false } };
    c = draw(p, 400, 200);
    expect(px(c, 300, 100)[3]).toBe(0);
    expect(px(c, 100, 100).slice(0, 3)).toEqual([255, 0, 0]);
    // Kept through a file, and in Lottie as the copy's own precomp.
    const back = parseProject(JSON.stringify(p)).project!.compositions[0]!.layers[1]!;
    expect(back.type === 'comp' && back.overrides).toEqual({ [box.id]: { visible: false } });
    const json = toLottie(p).json as { assets: { id: string }[] };
    expect(json.assets.filter((x) => x.id.startsWith('comp_')).length).toBe(2);
  });

  it('a change is added to the layer’s own keyframes, and changes nothing when empty', () => {
    const t = newText(null, 'Guest', [0, 0], [200, 60]);
    t.transform.position = { k: [{ t: 0, v: [0, 100] }, { t: 1, v: [0, 0] }] };
    t.transform.opacity = { v: 80 };
    const o = overrideLayer(t, { text: 'Host', move: [10, 0], opacity: 50, scale: 200, rotate: 15 });
    expect(o.type === 'text' && o.text).toBe('Host');
    expect(o.transform.position).toEqual({ k: [{ t: 0, v: [10, 100] }, { t: 1, v: [10, 0] }] });
    expect(o.transform.opacity).toEqual({ v: 40 });
    expect(o.transform.scale).toEqual({ v: [200, 200] });
    expect(o.transform.rotation).toEqual({ v: 15 });
    const c = newComposition('C', 100, 100);
    expect(withOverrides(c, {})).toBe(c);
    expect(withOverrides(c, undefined)).toBe(c);
    const ov = { x: { visible: false } };
    expect(withOverrides(c, ov)).toBe(withOverrides(c, ov));
  });
});
