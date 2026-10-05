import { describe, expect, it } from 'vitest';
import { frameFor, maxZoom, shotToView, stepShot, WIDE, worthMoving } from './vision';

const person = (x: number, y = 0.2, w = 0.1, h = 0.6) => ({ x, y, w, h });

describe('keep it sharp', () => {
  it('a 4K camera can zoom about 2× into a 1080p stream', () => {
    expect(maxZoom(3840, 1920, true)).toBeCloseTo(2.3, 1);
  });
  it('a 1080p camera barely zooms when it must stay sharp', () => {
    expect(maxZoom(1920, 1920, true)).toBeLessThan(1.2);
  });
  it('allows a closer shot when sharpness is not required', () => {
    expect(maxZoom(1920, 1920, false)).toBe(3);
  });
});

describe('auto-framing', () => {
  it('stays wide when nobody is there', () => {
    expect(frameFor([], { who: 'everyone', tightness: 0.5 }, 3)).toEqual(WIDE);
  });
  it('keeps everyone in the shot', () => {
    const s = frameFor([person(0.2), person(0.6)], { who: 'everyone', tightness: 0.5 }, 3);
    const half = 0.5 / s.zoom;
    expect(s.cx - half).toBeLessThanOrEqual(0.2);
    expect(s.cx + half).toBeGreaterThanOrEqual(0.7);
  });
  it('follows the main (biggest) person', () => {
    const s = frameFor([person(0.1, 0.4, 0.05, 0.2), person(0.7, 0.3, 0.15, 0.4)], { who: 'main', tightness: 0.5 }, 3);
    expect(s.cx).toBeGreaterThan(0.6);
  });
  it('never zooms past the limit, and never shows outside the picture', () => {
    const s = frameFor([person(0.95, 0.05, 0.02, 0.05)], { who: 'main', tightness: 1 }, 1.5);
    expect(s.zoom).toBeLessThanOrEqual(1.5);
    expect(s.cx + 0.5 / s.zoom).toBeLessThanOrEqual(1 + 1e-9);
  });
  it('moves calmly, not in one jump', () => {
    const target = { cx: 0.8, cy: 0.5, zoom: 2 };
    const next = stepShot(WIDE, target, 0.4, 33);
    expect(next.cx).toBeGreaterThan(0.5);
    expect(next.cx).toBeLessThan(0.6);
  });
  it('ignores small movements so the shot stays still', () => {
    const t = { cx: 0.5, cy: 0.5, zoom: 2 };
    expect(worthMoving(t, { cx: 0.51, cy: 0.5, zoom: 2.05 })).toBe(false);
    expect(worthMoving(t, { cx: 0.7, cy: 0.5, zoom: 2 })).toBe(true);
  });
  it('turns a shot into the picture processor’s zoom and pan', () => {
    expect(shotToView(WIDE)).toEqual({ zoom: 1, panX: 0, panY: 0 });
    const v = shotToView({ cx: 0.75, cy: 0.5, zoom: 2 });
    expect(v.zoom).toBe(2);
    expect(v.panX).toBeCloseTo(1);
  });
});

describe('the safety net', () => {
  it('pauses the picture smarts when the computer is too busy, then tries again', async () => {
    const { noteCost, visionPaused } = await import('./vision');
    for (let i = 0; i < 40; i++) noteCost(60, 1000);
    expect(visionPaused(1000)).toBe(true);
    expect(visionPaused(1000 + 31_000)).toBe(false);
  });
});
