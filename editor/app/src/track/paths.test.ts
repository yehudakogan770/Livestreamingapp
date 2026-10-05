import { describe, expect, it } from 'vitest';
import { newEffect } from '../model/effects';
import { DEFAULT_TEXT, emptyProject, newClip, type Clip, type MediaItem, type Project, type Stabilize, type TrackPath } from '../model/types';
import { placeCorner } from '../render/compositor';
import { frameOps, motionAt, type Layer, type MotionNow } from '../render/frame';
import {
  carried,
  cropZoom,
  frameToPlaced,
  pictureToPlaced,
  placedSize,
  placedToFrame,
  poseAt,
  setPoint,
  smoothList,
  steadied,
  steadyFor,
  trackInFrame,
} from './paths';

const motion = (change: Partial<MotionNow> = {}): MotionNow => ({ ...motionAt(newClip('t', 0, 10, { kind: 'color', color: '#000' }, 'x'), 0), ...change });

/** Where the compositor puts a spot of the picture, in sequence pixels from the middle of the frame. */
function compositorSpot(m: MotionNow, sw: number, sh: number, W: number, H: number, u: number, v: number): [number, number] {
  const [nx, ny, w] = placeCorner(m, sw, sh, W, H, H)(u, v);
  // The GPU divides by w; with no 3D tilt, w is 1.
  return [((nx * w + 1) / 2) * W - W / 2, ((1 - ny * w) / 2) * H - H / 2];
}

describe('track paths', () => {
  const path: TrackPath = {
    id: 'p',
    name: 'Track 1',
    kind: 'region',
    points: [
      [10, 0.2, 0.4, 1, 0],
      [20, 0.4, 0.2, 2, 30],
    ],
  };

  it('gives the place between points, and holds it before and after', () => {
    expect(poseAt(path, 15)).toEqual({ u: 0.30000000000000004, v: 0.30000000000000004, scale: 1.5, angle: 15 });
    expect(poseAt(path, 0)?.u).toBe(0.2);
    expect(poseAt(path, 99)?.angle).toBe(30);
    expect(poseAt(undefined, 3)).toBeNull();
  });

  it('keeps points in frame order and remembers the ones set by hand', () => {
    const p = setPoint(setPoint(path, [15, 0.5, 0.5], true), [5, 0.1, 0.1]);
    expect(p.points.map((x) => x[0])).toEqual([5, 10, 15, 20]);
    expect(p.manual).toEqual([15]);
    expect(setPoint(p, [15, 0.6, 0.6]).points.filter((x) => x[0] === 15)).toHaveLength(1);
  });

  it('places a picture spot in the frame exactly where the compositor draws it', () => {
    const W = 1920;
    const H = 1080;
    const sw = 1280;
    const sh = 960;
    for (const m of [motion(), motion({ x: 120, y: -40, scale: 140, scaleX: 80, rotation: 25 }), motion({ fill: true, rotation: -70, scale: 60 })]) {
      const [pw, ph] = placedSize(sw, sh, m.fill, W, H);
      for (const [u, v] of [
        [0, 0],
        [1, 1],
        [0.3, 0.8],
        [0.71, 0.12],
      ] as [number, number][]) {
        const ours = placedToFrame(m, ...pictureToPlaced(u, v, pw, ph));
        const gpu = compositorSpot(m, sw, sh, W, H, u, v);
        expect(ours[0]).toBeCloseTo(gpu[0], 6);
        expect(ours[1]).toBeCloseTo(gpu[1], 6);
        // And back again (dragging a tracker point in the viewer).
        const back = frameToPlaced(m, ...ours);
        const [x, y] = pictureToPlaced(u, v, pw, ph);
        expect(back[0]).toBeCloseTo(x, 6);
        expect(back[1]).toBeCloseTo(y, 6);
      }
    }
  });

  it('carries an attached thing along with the track (keeping its offset, growing and turning with a region)', () => {
    const then = { x: 0, y: 0, scale: 1, angle: 0 };
    const now = { x: 100, y: 50, scale: 2, angle: 90 };
    const c = carried(now, then, 10, 0, true, true);
    expect(c.x).toBeCloseTo(100);
    expect(c.y).toBeCloseTo(70);
    expect(c.k).toBe(2);
    expect(c.turn).toBe(90);
    const plain = carried(now, then, 10, 0, false, false);
    expect([plain.x, plain.y]).toEqual([110, 50]);
  });
});

describe('stabilizing', () => {
  const W = 1920;
  const H = 1080;
  // A shaky camera: the tracked spot wobbles around, drifting slowly to the right.
  const n = 60;
  const shaky: TrackPath = {
    id: 's',
    name: 'Shake',
    kind: 'region',
    points: Array.from({ length: n }, (_, t) => [
      t,
      0.5 + t * 0.001 + Math.sin(t * 1.7) * 0.01,
      0.5 + Math.cos(t * 2.3) * 0.012,
      1 + Math.sin(t) * 0.02,
      Math.sin(t * 1.3) * 2,
    ]),
  };
  const st = (change: Partial<Stabilize> = {}): Stabilize => ({ path: 's', smooth: 50, lock: false, at: 0, crop: false, rotate: true, scale: true, ...change });

  it('holds a locked shot still: the tracked spot stays put in the frame, unturned and unsized', () => {
    const [pw, ph] = placedSize(1920, 1080, false, W, H);
    const s = steadyFor(shaky, st({ lock: true, at: 0 }), n, pw, ph, W, H);
    const base = motion();
    const at0 = placedToFrame(steadied(base, s, 0), ...pictureToPlaced(shaky.points[0]![1], shaky.points[0]![2], pw, ph));
    for (let t = 1; t < n; t++) {
      const pose = poseAt(shaky, t)!;
      const m = steadied(base, s, t);
      const spot = placedToFrame(m, ...pictureToPlaced(pose.u, pose.v, pw, ph));
      expect(spot[0]).toBeCloseTo(at0[0], 6);
      expect(spot[1]).toBeCloseTo(at0[1], 6);
      // Its turn and size are taken away too.
      expect(m.rotation + pose.angle).toBeCloseTo(poseAt(shaky, 0)!.angle, 6);
      expect((m.scale / 100) * pose.scale).toBeCloseTo(poseAt(shaky, 0)!.scale, 6);
    }
  });

  it('smooths the shake but keeps the slow drift', () => {
    const [pw, ph] = placedSize(1920, 1080, false, W, H);
    const s = steadyFor(shaky, st({ smooth: 60 }), n, pw, ph, W, H);
    const xs = Array.from({ length: n }, (_, t) => {
      const pose = poseAt(shaky, t)!;
      return placedToFrame(steadied(motion(), s, t), ...pictureToPlaced(pose.u, pose.v, pw, ph))[0];
    });
    const jitter = (v: number[]) => v.slice(2).reduce((a, x, i) => a + Math.abs(x - 2 * (v[i + 1] as number) + (v[i] as number)), 0);
    const before = shaky.points.map((p) => (p[1] - 0.5) * pw);
    expect(jitter(xs)).toBeLessThan(jitter(before) * 0.1);
    // It still drifts right, as the camera did.
    expect((xs[n - 10] as number) - (xs[10] as number)).toBeGreaterThan(20);
  });

  it('zooms just enough that no edge shows', () => {
    // A picture moved 96 px right (and back) needs 1920 / (1920 − 2 × 96) = 1.111× to hide its edges.
    const st0 = {
      px: Float64Array.from([0, 96]),
      py: Float64Array.from([0, 0]),
      qx: Float64Array.from([0, 0]),
      qy: Float64Array.from([0, 0]),
      k: Float64Array.from([1, 1]),
      turn: Float64Array.from([0, 0]),
    };
    expect(cropZoom(st0, 1920, 1080, 1920, 1080)).toBeCloseTo(1920 / (1920 - 192), 6);
    // Nothing moved: no zoom.
    expect(cropZoom({ ...st0, px: Float64Array.from([0, 0]) }, 1920, 1080, 1920, 1080)).toBe(1);
    // Crop to fit on the shaky clip: every frame's corners land inside the picture.
    const [pw, ph] = placedSize(1920, 1080, false, W, H);
    const s = steadyFor(shaky, st({ smooth: 80, crop: true }), n, pw, ph, W, H);
    expect(s.zoom).toBeGreaterThan(1);
    for (let t = 0; t < n; t++) {
      const m = steadied(motion(), s, t);
      for (const [X, Y] of [
        [-W / 2, -H / 2],
        [W / 2, H / 2],
        [W / 2, -H / 2],
        [-W / 2, H / 2],
      ] as [number, number][]) {
        const [x, y] = frameToPlaced(m, X, Y);
        expect(Math.abs(x)).toBeLessThanOrEqual(pw / 2 + 1e-6);
        expect(Math.abs(y)).toBeLessThanOrEqual(ph / 2 + 1e-6);
      }
    }
  });

  it('smooths a list without moving a straight line', () => {
    const line = Array.from({ length: 30 }, (_, i) => i * 2);
    const s = smoothList(line, 4);
    expect(s[15]).toBeCloseTo(30, 6);
  });
});

describe('tracking when frames are drawn (viewer and film alike)', () => {
  function project(): { p: Project; clip: Clip; title: Clip } {
    const p = emptyProject('t');
    const s = p.sequences[0]!;
    const media: MediaItem = {
      id: 'm1',
      name: 'cam',
      path: '/cam.mp4',
      proxy: null,
      kind: 'video',
      duration: 10,
      width: 1920,
      height: 1080,
      fps: 30,
      hasVideo: true,
      hasAudio: false,
      bin: null,
    };
    p.media.push(media);
    const v1 = s.tracks[0]!.id;
    const v2 = s.tracks[1]!.id;
    const clip = newClip(v1, 0, 100, { kind: 'media', media: 'm1', in: 0 }, 'cam');
    clip.paths = [
      {
        id: 'face',
        name: 'Face',
        kind: 'point',
        points: Array.from({ length: 100 }, (_, t) => [t, 0.25 + t * 0.005, 0.5]),
      },
    ];
    const mask = newEffect('mask');
    mask.p.cx = -50;
    mask.d = { track: 'face', trackAt: 0 };
    clip.effects = [mask];
    const title = newClip(v2, 0, 100, { kind: 'text', text: DEFAULT_TEXT }, 'name');
    title.motion = { ...title.motion, x: -480, y: -100 };
    title.follow = { clip: clip.id, path: 'face', at: 0, scale: false, rotate: false };
    s.clips.push(clip, title);
    return { p, clip, title };
  }
  const layerOf = (p: Project, frame: number, id: string): Layer => {
    const ops = frameOps(p, p.sequences[0]!, frame);
    for (const op of ops) if (op.kind === 'layer' && op.layer.clip.id === id) return op.layer;
    throw new Error('not drawn');
  };

  it('moves a mask with its track', () => {
    const { p, clip } = project();
    // The tracked spot starts at −480 px (a quarter across) and moves 9.6 px a frame.
    const at = (f: number) => layerOf(p, f, clip.id).effects[0]!.p;
    expect(at(0).cx).toBeCloseTo(-50, 6);
    expect(at(50).cx).toBeCloseTo(-50 + ((50 * 9.6) / 960) * 100, 6);
    // Moving the clip moves the mask along.
    clip.motion = { ...clip.motion, x: 100 };
    expect(at(50).cx).toBeCloseTo(-50 + ((50 * 9.6) / 960) * 100, 6);
    expect(at(0).cx).toBeCloseTo(-50, 6);
  });

  it('moves a title attached to the track, and where it is matches the tracked spot', () => {
    const { p, clip, title } = project();
    const s = p.sequences[0]!;
    for (const f of [0, 30, 99]) {
      const m = layerOf(p, f, title.id).motion;
      const spot = trackInFrame(p, { W: s.width, H: s.height }, clip, 'face', f)!;
      expect(m.x - spot.x).toBeCloseTo(-480 - -480, 6);
      expect(m.y - spot.y).toBeCloseTo(-100, 6);
    }
  });

  it('steadies a clip the same way for every frame drawn', () => {
    const { p, clip } = project();
    clip.stabilize = { path: 'face', smooth: 0, lock: true, at: 0, crop: false, rotate: false, scale: false };
    const s = p.sequences[0]!;
    for (const f of [0, 20, 80]) {
      const layer = layerOf(p, f, clip.id);
      // The tracked spot is held where it was at frame 0 (−480 px), as the compositor will draw it.
      const pose = poseAt(clip.paths![0], f)!;
      const [x, y] = compositorSpot(layer.motion, 1920, 1080, s.width, s.height, pose.u, pose.v);
      expect(x).toBeCloseTo(-480, 4);
      expect(y).toBeCloseTo(0, 4);
    }
  });
});
