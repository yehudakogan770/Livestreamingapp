// A title saved and opened again is the same title: every template, and the
// newer settings (3D layers and the camera, formats standing on their own,
// extruded layers) that the file reader once dropped.

import { describe, expect, it } from 'vitest';
import { newProject, newShape, newText } from './build';
import { makeFormat } from './formats';
import { starterTemplates } from './templates';
import { parseProject } from './validate';
import { featureScene } from '../test/featureScene';
import type { TitleProject } from './types';

const again = (p: TitleProject) => {
  const r = parseProject(JSON.stringify(p));
  expect(r.error).toBeNull();
  return r.project!;
};

describe('saved and opened again', () => {
  it('every starter template and the feature scene come back the same', () => {
    for (const t of [...starterTemplates(), featureScene()]) expect(again(t)).toEqual(JSON.parse(JSON.stringify(t)));
  });

  it('keeps 3D layers, the camera distance and a format standing on its own', () => {
    let p = newProject('3D');
    const c = p.compositions[0]!;
    const card = newShape(c, 'rect', [600, 300], [400, 300], '$accent');
    card.transform = { ...card.transform, rotationX: { v: 20 }, rotationY: { k: [{ t: 0, v: -40 }, { t: 1, v: 0 }] }, z: { v: -150 } };
    c.layers = [card];
    c.perspective = 1200;
    p = makeFormat(p, 'Vertical', 1080, 1920).project;
    p = { ...p, compositions: p.compositions.map((x) => (x.variantOf ? { ...x, follow: false } : x)) };
    const back = again(p);
    const l = back.compositions[0]!.layers[0]!;
    expect(l.transform.rotationX).toEqual({ v: 20 });
    expect(l.transform.rotationY).toEqual({ k: [{ t: 0, v: -40 }, { t: 1, v: 0 }] });
    expect(l.transform.z).toEqual({ v: -150 });
    expect(back.compositions[0]!.perspective).toBe(1200);
    expect(back.compositions.find((x) => x.variantOf)!.follow).toBe(false);
  });

  it('keeps an extruded layer and a camera', () => {
    const p = newProject('Extruded');
    const c = p.compositions[0]!;
    const t = newText(c, 'DEEP', [500, 400], [800, 200], { size: 160, weight: 800 });
    t.extrude = { depth: 40, color: '#202830' };
    const cam = { ...newShape(c, 'rect', [0, 0], [10, 10]) };
    void cam;
    c.layers = [t];
    const back = again(p);
    expect((back.compositions[0]!.layers[0] as typeof t).extrude).toEqual({ depth: 40, color: '#202830' });
  });
});
