import { describe, expect, it } from 'vitest';
import { newEffect } from '../model/effects';
import { changeSpeed, trimLeft } from '../model/seq';
import { newClip, type MediaItem } from '../model/types';
import { decodeBucket, encodeBucket, fileFrame, MatteStore, specFor } from './mattes';
import { pack } from './matte';

const media: MediaItem = {
  id: 'm',
  name: 'cam',
  path: '/cam.mp4',
  proxy: null,
  kind: 'video',
  duration: 10,
  width: 1920,
  height: 1080,
  fps: 25,
  hasVideo: true,
  hasAudio: false,
  bin: null,
};

describe('AI mask frames', () => {
  it('names a frame by the frame of the file showing then', () => {
    expect(fileFrame(media, 0)).toBe(0);
    expect(fileFrame(media, 0.039)).toBe(0);
    expect(fileFrame(media, 0.04)).toBe(1);
    expect(fileFrame(media, 1)).toBe(25);
    expect(fileFrame({ ...media, kind: 'image' }, 3)).toBe(0);
  });

  it('finds the object where its track is at each frame', () => {
    const c = newClip('v', 0, 50, { kind: 'media', media: 'm', in: 0 }, 'cam');
    c.paths = [
      {
        id: 'o',
        name: 'Object',
        points: [
          [0, 0.2, 0.5],
          [10, 0.4, 0.5],
        ],
      },
    ];
    const e = newEffect('objectmask');
    expect(specFor(c, e, 0)).toBeNull();
    e.d = { seed: [0.2, 0.5] };
    expect(specFor(c, e, 5)).toMatchObject({ kind: 'object', u: 0.2, v: 0.5 });
    e.d = { seed: [0.2, 0.5], track: 'o' };
    expect(specFor(c, e, 5)).toMatchObject({ kind: 'object', u: 0.30000000000000004 });
    expect(specFor(c, newEffect('personmask'), 5)).toEqual({ kind: 'person' });
  });

  it('keeps mattes on the disk and reads them back the same', () => {
    const m = { w: 4, h: 2, data: Uint8Array.from([0, 0, 255, 255, 0, 128, 255, 255]) };
    const frames = new Map([
      ['3', { w: 4, h: 2, bytes: pack(m), how: 'ai' as const }],
      ['4:0.250:0.500:25', { w: 4, h: 2, bytes: pack(m), how: 'color' as const }],
    ]);
    const back = decodeBucket(encodeBucket(frames));
    expect([...back.keys()]).toEqual(['3', '4:0.250:0.500:25']);
    expect(back.get('4:0.250:0.500:25')?.how).toBe('color');
    expect(back.get('3')?.bytes).toEqual(pack(m));
    expect(decodeBucket(new Uint8Array([1, 2, 3])).size).toBe(0);
  });

  it('gives the same finished matte for the same frame and settings (viewer and film alike)', () => {
    const store = new MatteStore();
    const raw = { w: 40, h: 30, data: new Uint8Array(1200).fill(255) };
    const a = store.finished(raw, { feather: 20, expand: -10, invert: false });
    const b = store.finished(raw, { feather: 20, expand: -10, invert: false });
    expect(b.data).toBe(a.data);
    expect(b.stamp).toBe(a.stamp);
    const c = store.finished(raw, { feather: 20, expand: -10, invert: true });
    expect(c.stamp).not.toBe(a.stamp);
  });
});

describe('tracks when a clip is trimmed or sped up', () => {
  const clip = () => {
    const c = newClip('v', 100, 60, { kind: 'media', media: 'm', in: 0 }, 'cam');
    c.paths = [
      {
        id: 'p',
        name: 'P',
        points: [
          [10, 0.1, 0.1],
          [20, 0.2, 0.2],
        ],
        manual: [20],
      },
    ];
    c.stabilize = { path: 'p', smooth: 50, lock: true, at: 15, crop: true, rotate: false, scale: false };
    const mask = newEffect('mask');
    mask.d = { track: 'p', trackAt: 12 };
    c.effects = [mask];
    return c;
  };

  it('keeps the tracked spots on the same picture when the start is trimmed', () => {
    const t = trimLeft(clip(), 5, 25);
    expect(t.paths?.[0]?.points.map((x) => x[0])).toEqual([5, 15]);
    expect(t.paths?.[0]?.manual).toEqual([15]);
    expect(t.stabilize?.at).toBe(10);
    expect(t.effects[0]?.d?.trackAt).toBe(7);
  });

  it('stretches them with a speed change', () => {
    const t = changeSpeed(clip(), 0.5);
    expect(t.length).toBe(120);
    expect(t.paths?.[0]?.points.map((x) => x[0])).toEqual([20, 40]);
  });
});
