import { describe, expect, it, vi } from 'vitest';
import { emptyProject, newClip, type MediaItem } from '../model/types';
import { layerFor } from '../render/frame';

// FFmpeg reading a 60 fps file: each frame handed over says which frame of the file it is.
const FILE_FPS = 60;
const readers = new Map<number, { from: number; rate: number; n: number }>();
let opened = 0;
/** The file really ends here (its stated length can be longer). */
let lastFrame = Infinity;
vi.mock('../native', async (orig) => ({
  ...(await orig<typeof import('../native')>()),
  native: {
    framesOpen: async (_path: string, from: number, rate: number) => {
      opened += 1;
      readers.set(opened, { from, rate, n: 0 });
      return opened;
    },
    framesNext: async (id: number) => {
      const r = readers.get(id);
      // As the app: a reader that reached the end is closed.
      if (!r) throw new Error('That reader is closed.');
      const frame = Math.round((r.from + r.n / r.rate) * FILE_FPS);
      if (frame > lastFrame) {
        readers.delete(id);
        return new Uint8Array(0);
      }
      const bytes = new Uint8Array(2 * 2 * 4);
      bytes[0] = frame;
      r.n += 1;
      return bytes;
    },
    framesClose: async () => undefined,
  },
}));

const { FfmpegReader, readerStep } = await import('./exporter');

const media: MediaItem = {
  id: 'm',
  name: 'Slow motion',
  path: '/slow.mov',
  proxy: null,
  kind: 'video',
  duration: 10,
  width: 1920,
  height: 1080,
  fps: FILE_FPS,
  hasVideo: true,
  hasAudio: false,
  bin: null,
};

describe('originals read through FFmpeg', () => {
  it('a remapped clip gets the frame of the file the viewer shows (slow motion of a 60 fps file in a 30 fps film)', async () => {
    if (typeof ImageData === 'undefined')
      (globalThis as { ImageData?: unknown }).ImageData = class {
        constructor(readonly data: Uint8ClampedArray) {}
      };
    const p = { ...emptyProject('t'), media: [media] };
    for (const speed of [50, 100, 160]) {
      const clip = { ...newClip('v', 0, 40, { kind: 'media', media: 'm', in: 0 }, 'c'), remap: { speed, sampling: 'nearest' as const, pitch: true } };
      const reader = new FfmpegReader(media.path, 2, 2, readerStep(clip, 0, media, 30));
      opened = 0;
      for (let f = 0; f < 40; f++) {
        const l = layerFor(p, clip, f, 30);
        const time = l.source?.kind === 'video' ? l.source.time : 0;
        const img = await reader.at(time);
        expect(img?.data[0]).toBe(Math.round(time * FILE_FPS));
      }
      // Read on in order (FFmpeg started once), not started again for every frame.
      expect(opened).toBe(1);
    }
  });

  it('holds the last picture where the file ends sooner than it says', async () => {
    lastFrame = 10;
    const reader = new FfmpegReader(media.path, 2, 2, 1 / 30);
    for (let f = 0; f < 12; f++) {
      const img = await reader.at(Math.min(f * 2, 14) / FILE_FPS);
      expect(img?.data[0]).toBe(Math.min(f * 2, 10));
    }
    lastFrame = Infinity;
  });
});
