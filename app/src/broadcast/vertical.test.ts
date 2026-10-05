import { describe, expect, it } from 'vitest';
import { fittedRect } from './vertical';

describe('vertical version', () => {
  it('keeps the whole wide picture, across the middle', () => {
    expect(fittedRect(1920, 1080, 1080, 1920)).toEqual({ x: 0, y: 656, w: 1080, h: 608 });
  });
  it('never cuts any of the picture off', () => {
    const r = fittedRect(1280, 720, 1080, 1920);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.w).toBeLessThanOrEqual(1080);
    expect(r.w / r.h).toBeCloseTo(16 / 9, 1);
  });
});
