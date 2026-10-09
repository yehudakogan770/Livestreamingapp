// A group repeated for each row of a list field: a table row designed once.

import { beforeAll, describe, expect, it } from 'vitest';
import { newGroup, newProject, newShape } from './build';
import { renderFrame } from './render';
import { fade } from './motion';
import { usedVariables } from './binding';
import { canvas, env, registerTestFont, TEST_FONT } from '../test/nodeCanvas';
import type { GroupLayer, TitleProject } from './types';

function table(stagger = 0) {
  const p = newProject('Table', 300, 300);
  const c = p.compositions[0]!;
  p.variables = [
    { key: 'names', label: 'Names', type: 'list', value: 'A\nB\nC' },
    { key: 'tones', label: 'Tones', type: 'list', value: '#ff0000\n#00ff00\n#0000ff' },
  ];
  const bar = newShape(c, 'rect', [0, 0], [300, 50], '{{tones}}');
  if (stagger) fade(bar, { at: 0, dur: 0.01 });
  const g: GroupLayer = { ...newGroup(c, [bar]), repeat: { field: 'names', dx: 0, dy: 100, stagger } };
  c.layers = [g];
  return p;
}

function draw(p: TitleProject, t = 1, values?: Record<string, string>) {
  const cv = canvas(300, 300);
  const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D;
  renderFrame(ctx, p, { time: t, env, brand: { font: TEST_FONT }, values, width: 300, height: 300 });
  return (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
}

beforeAll(() => registerTestFont());

describe('repeat for each row', () => {
  it('draws the group once a line, each copy with its own line of every list field', () => {
    const at = draw(table());
    expect(at(10, 25).slice(0, 3)).toEqual([255, 0, 0]);
    expect(at(10, 125).slice(0, 3)).toEqual([0, 255, 0]);
    expect(at(10, 225).slice(0, 3)).toEqual([0, 0, 255]);
    expect(at(10, 75)[3]).toBe(0);
  });

  it('follows the data: fewer lines, fewer rows', () => {
    const at = draw(table(), 1, { names: 'Only', tones: '#ffffff' });
    expect(at(10, 25)[3]).toBe(255);
    expect(at(10, 125)[3]).toBe(0);
  });

  it('each row comes in after the one before', () => {
    const at = draw(table(0.5), 0.6);
    expect(at(10, 25)[3]).toBe(255);
    expect(at(10, 125)[3]).toBe(255);
    expect(at(10, 225)[3]).toBe(0);
  });

  it('{{row}} is the row number, not a field to add', () => {
    const p = table();
    (p.compositions[0]!.layers[0] as GroupLayer).children.push({ ...newShape(null, 'rect', [0, 0], [1, 1], '{{row}}') });
    expect(usedVariables(p)).not.toContain('row');
  });
});
