// Formats: a 16:9 title re-made as 9:16, 1:1 and 4K by the layers'
// constraints, and the renderer picking the format for the picture's shape.

import { describe, expect, it } from 'vitest';
import { newProject, newShape } from './build';
import { adaptLayer, constraintsOf, formatsOf, makeFormat, pickFormat } from './formats';
import { fromTemplate, starterTemplates } from './templates';
import { renderFrame } from './render';
import { readProject } from './validate';
import type { Vec2 } from './types';
import { canvas, env, pixels } from '../test/nodeCanvas';

const pos = (l: { transform: { position: { v?: Vec2; k?: { v: Vec2 }[] } } }) => l.transform.position.v ?? l.transform.position.k![0]!.v;

describe('formats', () => {
  it('a lower third stays at the bottom left in 9:16; everything doubles in 4K', () => {
    const p = fromTemplate(starterTemplates().find((t) => t.name === 'Name and role')!);
    const main = p.compositions.find((c) => c.id === p.main)!;
    const box = main.layers.find((l) => l.name === 'Name box')!;
    const v = makeFormat(p, '9:16 vertical', 1080, 1920);
    const vert = v.project.compositions.find((c) => c.id === v.id)!;
    expect(vert).toMatchObject({ width: 1080, height: 1920, variantOf: main.id });
    const vbox = vert.layers.find((l) => l.name === 'Name box')!;
    expect(pos(vbox)[0]).toBe(pos(box)[0]);
    expect(pos(vbox)[1]).toBe(pos(box)[1] + 840);
    const k = makeFormat(p, '4K', 3840, 2160);
    const uhd = k.project.compositions.find((c) => c.id === k.id)!.layers.find((l) => l.name === 'Name box')!;
    expect(pos(uhd)).toEqual([pos(box)[0] * 2, pos(box)[1] * 2]);
    expect(uhd.transform.scale.v ?? uhd.transform.scale.k![0]!.v).toEqual([200, 200]);
    expect(formatsOf(k.project).map((c) => c.width)).toEqual([1920, 3840]);
  });

  it('constraints: nearest edge by default; set ones win; stretch grows the box', () => {
    const p = newProject();
    const c = p.compositions[0]!;
    const right = { ...newShape(c, 'rect', [1700, 100], [100, 50]) };
    right.transform.anchor = { v: [0, 0] };
    expect(constraintsOf(right, [1750, 125], 1920, 1080)).toEqual({ h: 'right', v: 'top' });
    const bar = { ...newShape(c, 'rect', [0, 1000], [1920, 80]), constraints: { h: 'stretch' as const, v: 'bottom' as const } };
    bar.transform.anchor = { v: [0, 0] };
    const square = adaptLayer(bar, 1920, 1080, 1080, 1080);
    expect(pos(square)).toEqual([0, 1000]);
    expect(square.type === 'shape' && square.size.v).toEqual([1080, 80]);
    const scaled = adaptLayer({ ...right, constraints: { h: 'scale' } }, 1920, 1080, 1080, 1080);
    expect(pos(scaled)[0]).toBeCloseTo((1700 * 1080) / 1920);
  });

  it('the renderer picks the format closest to the picture’s shape; formats survive saving', () => {
    const p = fromTemplate(starterTemplates().find((t) => t.name === 'Name and role')!);
    const { project, id } = makeFormat(p, '9:16 vertical', 1080, 1920);
    expect(pickFormat(project, 1920, 1080)!.id).toBe(p.main);
    expect(pickFormat(project, 720, 1280)!.id).toBe(id);
    expect(pickFormat(project, 1000, 1000)!.id).toBe(p.main);
    // Drawn into a vertical picture: the vertical format (its lower third near the bottom).
    const c = canvas(108, 192);
    renderFrame(c.getContext('2d') as unknown as CanvasRenderingContext2D, project, { time: 3, env, width: 108, height: 192 });
    const px = pixels(c);
    let top = 0;
    let bottom = 0;
    for (let y = 0; y < 192; y++) for (let x = 0; x < 108; x++) if (px[(y * 108 + x) * 4 + 3]! > 8) (y < 96 ? top++ : bottom++);
    expect(bottom).toBeGreaterThan(20);
    expect(top).toBe(0);
    const again = readProject(JSON.parse(JSON.stringify(project))).project!;
    expect(again.compositions.find((x) => x.id === id)!.variantOf).toBe(p.main);
  });
});
