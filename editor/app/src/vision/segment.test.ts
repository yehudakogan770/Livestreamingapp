import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canvasOf } from './segment';

// A canvas stand-in that only notes what is drawn on it.
const drawn: unknown[] = [];
const put: unknown[] = [];
class FakeCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext() {
    return {
      drawImage: (src: unknown) => {
        // As a browser: raw pixels are not something drawImage takes.
        if (src instanceof ImageData) throw new TypeError('ImageData is not a CanvasImageSource');
        drawn.push(src);
      },
      putImageData: (img: unknown) => put.push(img),
    };
  }
}

const g = globalThis as { OffscreenCanvas?: unknown; ImageData?: unknown };
const saved = { canvas: g.OffscreenCanvas, image: g.ImageData };
beforeAll(() => {
  g.OffscreenCanvas = FakeCanvas;
  if (!g.ImageData)
    g.ImageData = class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    };
});
afterAll(() => {
  g.OffscreenCanvas = saved.canvas;
  g.ImageData = saved.image;
});

describe('pictures for the AI models', () => {
  it('takes a frame FFmpeg read from the original (raw pixels), as the export hands it over', () => {
    const img = new ImageData(new Uint8ClampedArray(4 * 4 * 4), 4, 4);
    const c = canvasOf(img, 2, 2);
    expect(c.width).toBe(2);
    expect(put).toEqual([img]);
    expect(drawn).toHaveLength(1);
  });
});
