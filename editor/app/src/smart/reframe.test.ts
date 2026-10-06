import { describe, expect, it } from 'vitest';
import { valueAt, isAnim } from '../model/anim';
import { addMedia } from '../model/build';
import { current } from '../model/seq';
import { emptyProject, type MediaItem } from '../model/types';
import {
  aspectSize,
  centerRange,
  deadZone,
  fillGaps,
  followTargets,
  framedClips,
  keyed,
  positionFor,
  REFRAME_DEFAULTS,
  reframedSequence,
  reframeMotion,
  sampleTimes,
  simplify,
  smoothBothWays,
  smoothPath,
  type Found,
  type Sample,
} from './reframe';

describe('the crop path', () => {
  it('a still target stays still', () => {
    expect(smoothBothWays([0.4, 0.4, 0.4, 0.4], 5)).toEqual([0.4, 0.4, 0.4, 0.4]);
  });

  it('a jump becomes a smooth move: no overshoot, no lag', () => {
    const step = Array.from({ length: 40 }, (_, i) => (i < 20 ? 0.3 : 0.7));
    const out = smoothBothWays(step, 4);
    for (let i = 1; i < out.length; i++) expect(out[i]!).toBeGreaterThanOrEqual(out[i - 1]! - 1e-12);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(Math.max(...out)).toBeLessThanOrEqual(0.7 + 1e-9);
    // Smoothed both ways: halfway at the jump (it starts moving before it, not after).
    expect((out[19]! + out[20]!) / 2).toBeCloseTo(0.5, 1);
    expect(out[0]).toBeCloseTo(0.3, 2);
    expect(out[39]).toBeCloseTo(0.7, 2);
  });

  it('small wobbles are held still (dead zone)', () => {
    expect(deadZone([0.5, 0.52, 0.48, 0.53, 0.5], 0.05)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(deadZone([0.5, 0.52, 0.6, 0.61], 0.05)).toEqual([0.5, 0.5, 0.6, 0.6]);
  });

  it('nobody seen: held from before (or after, at the start), or the middle', () => {
    expect(fillGaps([null, 0.3, null, 0.6, null])).toEqual([0.3, 0.3, 0.3, 0.6, 0.6]);
    expect(fillGaps([null, null])).toEqual([0.5, 0.5]);
  });

  it('keeps inside the picture', () => {
    const out = smoothPath([0.05, 0.05, 0.95, 0.95], { deadZone: 0, lag: 1 }, 0.2, 0.8);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(0.2);
    expect(Math.max(...out)).toBeLessThanOrEqual(0.8);
  });

  it('keeps only the keyframes it needs', () => {
    const t = [0, 1, 2, 3, 4, 5, 6];
    expect(simplify(t, [0, 1, 2, 3, 4, 5, 6], 0.1)).toEqual([0, 6]);
    expect(simplify(t, [0, 0, 0, 10, 10, 10, 10], 0.5)).toEqual([0, 2, 3, 6]);
    expect(keyed(t, [5, 5, 5, 5, 5, 5, 5], 1)).toBe(5);
    const k = keyed(t, [0, 0, 0, 10, 10, 10, 10], 0.5);
    expect(isAnim(k) && k.k.map((x) => x.t)).toEqual([0, 2, 3, 6]);
  });
});

describe('framing', () => {
  const src = { w: 1920, h: 1080 };
  const tall = { w: 1080, h: 1920 };

  it('a wide picture in a tall frame: the window slides across only', () => {
    const r = centerRange(src, tall);
    // The window is 1080 / (1920 × 16/9) wide in the picture.
    expect(r.x[0]).toBeCloseTo(0.5 * (1080 / ((1920 * 1920) / 1080)), 4);
    expect(r.y).toEqual([0.5, 0.5]);
  });

  it('centers what is followed, never showing past the edge', () => {
    expect(positionFor(0.5, 0.5, src, tall)).toEqual({ x: 0, y: 0 });
    const shown = (1920 * 1920) / 1080;
    // Something a quarter in from the left: the picture moves right.
    expect(positionFor(0.4, 0.5, src, tall).x).toBe(Math.round(0.1 * shown));
    // Right at the edge: only as far as the picture reaches.
    expect(positionFor(0, 0.5, src, tall).x).toBe(Math.round((shown - 1080) / 2));
    expect(positionFor(1, 0.5, src, tall).x).toBe(-Math.round((shown - 1080) / 2));
  });

  it('zoomed in, it can move up and down too', () => {
    expect(positionFor(0.5, 0.3, src, tall, 1.5).y).toBeGreaterThan(0);
  });

  it('new sequence sizes', () => {
    const s = { width: 1920, height: 1080 } as never;
    expect(aspectSize(s, '9:16')).toEqual({ width: 1080, height: 1920 });
    expect(aspectSize(s, '1:1')).toEqual({ width: 1080, height: 1080 });
    expect(aspectSize(s, '4:5')).toEqual({ width: 1080, height: 1350 });
  });
});

const face = (x: number, w: number, score = 0.9): Found => ({ x, y: 0.2, w, h: w * 1.5, score });

describe('who to follow', () => {
  it('stays with the person followed unless another is clearly bigger for a while', () => {
    const samples: Sample[] = [
      { t: 0, found: [face(0.1, 0.1), face(0.7, 0.09)] },
      { t: 1, found: [face(0.1, 0.1), face(0.7, 0.11)] },
      { t: 2, found: [face(0.1, 0.1), face(0.7, 0.2)] },
      { t: 3, found: [face(0.1, 0.1), face(0.7, 0.2)] },
      { t: 4, found: [face(0.1, 0.1), face(0.7, 0.2)] },
      { t: 5, found: [] },
    ];
    const t = followTargets(samples, 3);
    expect(t.slice(0, 4).map((p) => p && +p.x.toFixed(2))).toEqual([0.15, 0.15, 0.15, 0.15]);
    expect(t[4]?.x).toBeCloseTo(0.8);
    expect(t[5]).toBeNull();
  });
});

describe('a reframed sequence', () => {
  const m: MediaItem = {
    id: 'm1',
    name: 'Talk',
    path: '/t.mp4',
    proxy: null,
    kind: 'video',
    duration: 100,
    width: 1920,
    height: 1080,
    fps: 30,
    hasVideo: true,
    hasAudio: true,
    bin: null,
  };
  const p = addMedia({ ...emptyProject('T'), media: [m] }, 'm1', 0, 'overwrite', undefined, undefined, { in: 10, out: 20 });
  const s = current(p);

  it('looks at frames through each picture clip', () => {
    const list = framedClips(p, s);
    expect(list).toHaveLength(1);
    const { t, seconds } = sampleTimes(p, list[0]!.clip, s, 10);
    expect(t.slice(0, 3)).toEqual([0, 10, 20]);
    expect(t[t.length - 1]).toBe(299);
    expect(seconds[1]).toBeCloseTo(10 + 10 / 30);
  });

  it('writes the followed path as keyframed position', () => {
    const { clip } = framedClips(p, s)[0]!;
    // The person walks from the left third to the right third.
    const samples: Sample[] = Array.from({ length: 31 }, (_, i) => ({ t: i * 10, found: [face(0.2 + (i / 30) * 0.5, 0.08)] }));
    const motion = reframeMotion(clip, m, { w: 1080, h: 1920 }, samples, { ...REFRAME_DEFAULTS, deadZone: 0.02, lag: 2 });
    expect(motion.fill).toBe(true);
    expect(isAnim(motion.x)).toBe(true);
    // Starts with the picture moved right (person on the left), ends moved left.
    expect(valueAt(motion.x, 0)).toBeGreaterThan(0);
    expect(valueAt(motion.x, 300)).toBeLessThan(0);
    expect(motion.y).toBe(0);
    const out = reframedSequence(s, '9:16', new Map([[clip.id, motion]]));
    expect([out.width, out.height]).toEqual([1080, 1920]);
    expect(out.id).not.toBe(s.id);
    expect(out.clips).toHaveLength(s.clips.length);
    expect(out.clips.every((c) => !s.clips.some((x) => x.id === c.id))).toBe(true);
    // Picture and sound stay linked to each other (a new link).
    expect(out.clips[0]?.link).toBe(out.clips[1]?.link);
    expect(out.clips[0]?.link).not.toBe(s.clips[0]?.link);
    // A title following the clip's track follows the copy in the new sequence.
    const title = { ...clip, id: 'title', follow: { clip: clip.id, path: 'P', at: 12, scale: false, rotate: false } };
    const withTitle = reframedSequence({ ...s, clips: [...s.clips, title] }, '9:16', new Map());
    const copy = withTitle.clips[withTitle.clips.length - 1];
    expect(copy?.follow?.clip).toBe(withTitle.clips[0]?.id);
    expect(copy?.follow?.at).toBe(12);
  });
});
