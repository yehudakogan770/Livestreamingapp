// Library thumbnails: a small graphic is shown closer (the part of the frame
// around it), a full-frame one whole.

import { beforeAll, describe, expect, it } from 'vitest';
import { canvas, registerTestFont } from '../test/nodeCanvas';
import { starterTemplates } from '../core/templates';
import { thumbCrop } from './Panels';

beforeAll(() => registerTestFont());

describe('library thumbnails', () => {
  it('crop to small graphics and keep full-frame ones whole', () => {
    const all = starterTemplates();
    const crop = (name: string) => {
      const t = all.find((x) => x.name === name)!;
      const c = t.compositions.find((x) => x.id === t.main)!;
      const ctx = canvas(10, 10).getContext('2d') as unknown as CanvasRenderingContext2D;
      return { r: thumbCrop(t, c.markers.inEnd + 0.4, ctx), w: c.width };
    };
    const lower = crop('Name and role');
    expect(lower.r.w).toBeLessThan(lower.w * 0.8);
    const full = crop('Full-screen title');
    expect(full.r.w).toBe(full.w);
  });
});
