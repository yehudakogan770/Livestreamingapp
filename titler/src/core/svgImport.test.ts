// SVG in as editable shapes (Figma's "Copy as SVG", Illustrator, icons).

import { beforeAll, describe, expect, it } from 'vitest';
import { fromSvg, parsePathD } from './svgImport';
import { svgProject } from '../designer/importing';
import { renderFrame } from './render';
import { canvas, env, registerTestFont, TEST_FONT } from '../test/nodeCanvas';
import type { GroupLayer, ShapeLayer } from './types';

const FIGMA = `<svg width="200" height="100" viewBox="0 0 200 100" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="200" height="100" rx="12" fill="url(#paint0_linear)"/>
<g id="Badge" transform="translate(120 20)">
  <circle cx="30" cy="30" r="30" fill="#FFFFFF"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M10 30a20 20 0 1 0 40 0a20 20 0 1 0 -40 0Z M20 30a10 10 0 1 0 20 0a10 10 0 1 0 -20 0Z" fill="#E11D48"/>
</g>
<path d="M10 80 L60 80" stroke="#000" stroke-width="4" stroke-linecap="round"/>
<text x="10" y="40" font-family="Inter" font-size="24" font-weight="700" fill="#fff">Live</text>
<defs><linearGradient id="paint0_linear" x1="0" y1="50" x2="200" y2="50" gradientUnits="userSpaceOnUse"><stop stop-color="#1E293B"/><stop offset="1" stop-color="#0F172A"/></linearGradient></defs>
</svg>`;

beforeAll(() => registerTestFont());

describe('SVG in', () => {
  it('reads path data: lines, curves, arcs, relative moves, closes', () => {
    const [sq] = parsePathD('M0 0h10v10H0z');
    expect(sq!.closed).toBe(true);
    expect(sq!.v.map((v) => v.p)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const arc = parsePathD('M0 0A10 10 0 0 1 20 0')[0]!;
    // A half circle above: its middle point is about 10 up.
    const mid = arc.v.find((v) => Math.abs(v.p[0] - 10) < 0.5);
    expect(mid?.p[1]).toBeCloseTo(-10, 0);
    expect(parsePathD('M0 0 Q5 10 10 0 T20 0').length).toBe(1);
    expect(parsePathD('m5 5 l5 0 l0 5 z m10 0 l5 0 l0 5 z').length).toBe(2);
  });

  it('makes layers from a Figma SVG: gradient box, a group with a ring (holes kept), a line, text', () => {
    const r = fromSvg(FIGMA);
    expect([r.width, r.height]).toEqual([200, 100]);
    expect(r.layers.map((l) => l.type)).toEqual(['text', 'shape', 'group', 'shape']);
    const bg = r.layers[3] as ShapeLayer;
    expect(bg.fill?.type).toBe('linear');
    const badge = r.layers[2] as GroupLayer;
    expect(badge.name).toBe('Badge');
    const ring = badge.children[0] as ShapeLayer;
    expect(ring.fillRule).toBe('evenodd');
    expect(ring.subpaths?.length).toBe(1);
    const line = r.layers[1] as ShapeLayer;
    expect(line.fill).toBeNull();
    expect(line.stroke).toMatchObject({ width: 4, cap: 'round' });
  });

  it('draws as the SVG does', () => {
    const { project } = svgProject(FIGMA, 'Badge');
    const c = canvas(200, 100);
    const ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D;
    renderFrame(ctx, project, { time: 1, env, brand: { font: TEST_FONT }, width: 200, height: 100 });
    const at = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
    // The ring is red, its hole shows the white circle under it, the corners are cut round.
    expect(at(120 + 30 + 15, 20 + 30).slice(0, 3)).toEqual([0xe1, 0x1d, 0x48]);
    expect(at(150, 50).slice(0, 3)).toEqual([255, 255, 255]);
    expect(at(1, 1)[3]).toBe(0);
    expect(at(100, 95)[3]).toBe(255);
  });

  it('refuses what is not SVG', () => {
    expect(() => fromSvg('<html></html>')).toThrow(/not an SVG/);
  });
});
