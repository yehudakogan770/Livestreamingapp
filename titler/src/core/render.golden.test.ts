// Golden frames: templates drawn at set times compared with saved pictures.
// Update them after an intended change with UPDATE_GOLDEN=1 npx vitest run titler.
// TITLER_SHEET=<folder> also writes full-size pictures of every template there.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderFrame } from './render';
import { starterTemplates } from './templates';
import { canvas, decode, diff, env, pixels, png, preload, registerTestFont, save, TEST_FONT, ROOT } from '../test/nodeCanvas';
import type { TitleProject } from './types';
import { featureScene } from '../test/featureScene';

const GOLDEN = resolve(ROOT, 'titler/src/test/golden');
const UPDATE = !!process.env.UPDATE_GOLDEN;
const brand = { font: TEST_FONT, fontSub: TEST_FONT };

function draw(p: TitleProject, t: number, w = 960, h = 540, clock?: number) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D;
  // A mid-gray picture behind, as over a camera.
  ctx.fillStyle = '#6b7078';
  ctx.fillRect(0, 0, w, h);
  renderFrame(ctx, p, { time: t, clock, env, brand, width: w, height: h });
  return c;
}

const byName = (n: string) => {
  const p = starterTemplates().find((x) => x.name === n);
  if (!p) throw new Error(`no template ${n}`);
  return p;
};

beforeAll(async () => {
  registerTestFont();
  for (const p of starterTemplates()) await preload(p);
});

const CASES: [string, string, (p: TitleProject) => number][] = [
  ['Name and role', 'hold', (p) => p.compositions[0]!.markers.inEnd],
  ['Name and role', 'in-mid', () => 0.35],
  ['Name and role', 'out-mid', (p) => p.compositions[0]!.markers.outStart + 0.3],
  ['Two-line box', 'hold', (p) => p.compositions[0]!.markers.inEnd],
  ['Breaking banner', 'hold', (p) => p.compositions[0]!.markers.inEnd],
  ['Scoreboard bug', 'hold', (p) => p.compositions[0]!.markers.inEnd],
  ['Full-screen title', 'in-mid', () => 0.6],
  ['Quote card', 'hold', (p) => p.compositions[0]!.markers.inEnd],
];

describe('golden frames', () => {
  for (const [name, label, at] of CASES) {
    it(`${name} (${label})`, async () => {
      const p = byName(name);
      const c = draw(p, at(p));
      const file = resolve(GOLDEN, `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${label}.png`);
      if (UPDATE || !existsSync(file)) {
        save(file, png(c));
        if (!UPDATE) throw new Error(`Golden frame was missing and has been written: ${file}`);
        return;
      }
      const want = await decode(file);
      expect([want.w, want.h]).toEqual([c.width, c.height]);
      expect(diff(pixels(c), want.data)).toBeLessThan(0.004);
    });
  }

  it('masks, track mattes, groups, precomps, parenting, effects and gradients (golden)', async () => {
    const p = featureScene();
    const c = draw(p, 1);
    const file = resolve(GOLDEN, 'features.png');
    if (UPDATE || !existsSync(file)) {
      save(file, png(c));
      if (!UPDATE) throw new Error(`Golden frame was missing and has been written: ${file}`);
      return;
    }
    const want = await decode(file);
    expect(diff(pixels(c), want.data)).toBeLessThan(0.004);
  });

  it('the ticker crawls on with the clock, the same at the same time', () => {
    const p = byName('News ticker');
    const t = p.compositions[0]!.markers.inEnd;
    const a = pixels(draw(p, t, 480, 270, 3));
    const b = pixels(draw(p, t, 480, 270, 3));
    const later = pixels(draw(p, t, 480, 270, 5));
    expect(diff(a, b, 0)).toBe(0);
    expect(diff(a, later, 10)).toBeGreaterThan(0.001);
  });

  it('draws nothing before IN and after OUT (see-through)', () => {
    const p = byName('Name and role');
    const c = canvas(320, 180);
    const ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D;
    renderFrame(ctx, p, { time: 0, env, brand, width: 320, height: 180 });
    const start = pixels(c);
    expect(start.some((v, i) => i % 4 === 3 && v > 0)).toBe(false);
    renderFrame(ctx, p, { time: p.compositions[0]!.duration, env, brand, width: 320, height: 180 });
    expect(pixels(c).some((v, i) => i % 4 === 3 && v > 0)).toBe(false);
  });

  it.runIf(!!process.env.TITLER_SHEET)('writes a picture of every template', () => {
    for (const p of starterTemplates()) {
      const t = p.compositions[0]!.markers.inEnd + 0.5;
      save(resolve(process.env.TITLER_SHEET!, `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`), png(draw(p, t, 1920, 1080, 4)));
    }
  });
});
