// Frame-exact video layers in renders: a test film is made with FFmpeg
// (H.264 with B-frames, so decode order is not display order), its frames'
// real times are read by mediabunny's demuxer, and the render asks for the
// frame at each time of a composition running at another rate. Each answer
// must be the frame showing at that time, exactly.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExactVideo, exactVideoEnv, type DecodedFrame, type FrameStream, type OpenFrames } from './exactVideo';
import type { RenderEnv } from './render';
import type { Asset } from './types';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
let dir = '';
let times: number[] = [];

beforeAll(async () => {
  if (!hasFfmpeg) return;
  dir = mkdtempSync(join(tmpdir(), 'titler-exact-'));
  const file = join(dir, 'count.mp4');
  // 24 fps for 2 s, a frame counter burned in; B-frames reorder decoding.
  const r = spawnSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=96x54:rate=24',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-bf',
    '2',
    '-g',
    '12',
    '-pix_fmt',
    'yuv420p',
    file,
  ]);
  expect(r.status).toBe(0);
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BufferSource(readFileSync(file)), formats: mb.ALL_FORMATS });
  const track = (await input.getPrimaryVideoTrack())!;
  const first = await track.getFirstTimestamp();
  const sink = new mb.EncodedPacketSink(track);
  const pts: number[] = [];
  for await (const p of sink.packets()) pts.push(p.timestamp - first);
  times = pts.sort((a, b) => a - b);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** A decoder stand-in over the film's real frame times: frames in display order from the one showing at `start`. */
function framesOf(ts: number[], opened: number[]): OpenFrames {
  return async (_asset, start) => {
    opened.push(start);
    let i = Math.max(0, ts.filter((t) => t <= start + 1e-9).length - 1);
    const s: FrameStream = {
      next: async (): Promise<DecodedFrame | null> => {
        if (i >= ts.length) return null;
        const n = i++;
        return { timestamp: ts[n]!, duration: 1 / 24, image: { frame: n } as unknown as CanvasImageSource };
      },
      close: () => {},
    };
    return s;
  };
}

const asset: Asset = { id: 'v', name: 'Count', kind: 'video', src: 'count.mp4' };

describe.skipIf(!hasFfmpeg)('frame-exact video layers', () => {
  it('the test film has 48 frames, 1/24 s apart, in display order', () => {
    expect(times.length).toBe(48);
    times.forEach((t, i) => expect(t).toBeCloseTo(i / 24, 4));
  });

  it('each render time (30 fps) gets the frame showing then, decoding forward once', async () => {
    const opened: number[] = [];
    const v = new ExactVideo(framesOf(times, opened));
    for (let f = 0; f < 60; f++) {
      const t = f / 30;
      const want = Math.floor(t * 24 + 1e-6);
      expect(await v.timestampAt(asset, t)).toBeCloseTo(times[want]!, 6);
    }
    // Rendering forward never starts the decoder again.
    expect(opened).toEqual([0]);
  });

  it('going back (a loop) or jumping far starts again from there', async () => {
    const opened: number[] = [];
    const v = new ExactVideo(framesOf(times, opened));
    expect(await v.timestampAt(asset, 1.5)).toBeCloseTo(times[36]!, 6);
    expect(await v.timestampAt(asset, 0.2)).toBeCloseTo(times[4]!, 6);
    expect(opened).toEqual([1.5, 0.2]);
    // Past the end: the last frame stays.
    expect(await v.timestampAt(asset, 5)).toBeCloseTo(times[47]!, 6);
  });

  it('a render frame asks, the frames are decoded, then it is drawn with them', async () => {
    const base: RenderEnv = { createCanvas: () => null, image: () => null };
    const env = exactVideoEnv(base, framesOf(times, []));
    expect(env.video!(asset, 0.5)).toBeNull();
    expect(await env.settle()).toBe(true);
    expect((env.video!(asset, 0.5) as unknown as { frame: number }).frame).toBe(12);
    // Nothing missing: nothing to do again.
    expect(await env.settle()).toBe(false);
    env.close();
  });
});
