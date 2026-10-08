// A Lumora Titler graphic as a title clip in Lumora Studio: placed at the
// playhead, found in the frame being made (exactly as a render asks for it),
// drawn by the Titler renderer: IN from the clip's start, OUT to its end.

import { beforeAll, describe, expect, it } from 'vitest';
import { fromTemplate, starterTemplates } from '../../../../titler/src/core/templates';
import { canvas, pixels, preload, registerTestFont, TEST_FONT } from '../../../../titler/src/test/nodeCanvas';
import { frameOps, type Layer } from '../render/frame';
import { current } from '../model/seq';
import { emptyProject } from '../model/types';
import { addTitlerClip, drawTitler, titlerMarks, titlerStamp, titlerTime, type TitlerLayerSource } from './titlerClip';

const tpl = () => {
  const p = fromTemplate(starterTemplates().find((t) => t.name === 'Name and role')!);
  p.tokens = { ...p.tokens, font: TEST_FONT, fontSub: TEST_FONT };
  return p;
};

beforeAll(async () => {
  registerTestFont();
  await preload(tpl());
});

function titleLayer(p: ReturnType<typeof emptyProject>, frame: number): Layer | null {
  const s = current(p);
  for (const op of frameOps(p, s, frame)) if (op.kind === 'layer' && op.layer.source?.kind === 'titler') return op.layer;
  return null;
}

function coverage(l: Layer): number {
  const c = canvas(384, 216);
  const ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D;
  drawTitler(ctx, l.source as TitlerLayerSource, 384, 216);
  const px = pixels(c);
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i]! > 8) n++;
  return n / (px.length / 4);
}

describe('title clips', () => {
  it('are placed above the pictures, as long as the title', () => {
    const r = addTitlerClip(emptyProject('Edit'), 30, 30, tpl(), { name: 'Casey Brooks' });
    const clip = current(r.project).clips.find((c) => c.id === r.id)!;
    expect(clip.source.kind).toBe('titler');
    expect(clip.length).toBe(240);
    expect(clip.start).toBe(30);
    expect(titlerMarks(tpl(), clip.length, 30)).toEqual({ inEnd: 30, outStart: 222 });
  });

  it('render frame by frame: nothing at the start, the IN, the hold, the OUT, nothing after', () => {
    const r = addTitlerClip(emptyProject('Edit'), 0, 30, tpl(), { name: 'Casey Brooks' });
    const p = r.project;
    const at = (f: number) => titleLayer(p, f);
    expect(at(240)).toBeNull();
    const first = coverage(at(0)!);
    const inMid = coverage(at(10)!);
    const hold = coverage(at(120)!);
    const outMid = coverage(at(230)!);
    const last = coverage(at(239)!);
    expect(first).toBeLessThan(0.002);
    expect(inMid).toBeGreaterThan(first);
    expect(hold).toBeGreaterThan(0.02);
    expect(outMid).toBeLessThan(hold);
    expect(last).toBeLessThan(outMid);
    // The clip's own field value is drawn (not the template sample).
    expect((at(120)!.source as TitlerLayerSource).values.name).toBe('Casey Brooks');
  });

  it('a held title is not drawn again every frame (same stamp), an animating one is', () => {
    const r = addTitlerClip(emptyProject('Edit'), 0, 30, tpl());
    const s = (f: number) => titlerStamp(titleLayer(r.project, f)!.source as TitlerLayerSource);
    expect(s(100)).toBe(s(150));
    expect(s(5)).not.toBe(s(6));
    expect(titlerTime(titleLayer(r.project, 235)!.source as TitlerLayerSource).t).toBeGreaterThan(7.4);
  });
});
