import { describe, expect, it } from 'vitest';
import { cutNear, extendEdit, trimCut } from './edit';
import { current, end } from './seq';
import { emptyProject, newClip, type MediaItem, type Project } from './types';

/** Two shots of a long file back to back on V1 (frames 0–100 and 100–200), with room to roll. */
function twoShots(): Project {
  const m: MediaItem = {
    id: 'm',
    name: 'Cam',
    path: '/cam.mp4',
    proxy: null,
    kind: 'video',
    duration: 60,
    width: 1920,
    height: 1080,
    fps: 30,
    hasVideo: true,
    hasAudio: false,
    bin: null,
  };
  const p = { ...emptyProject('t'), media: [m] };
  const s = current(p);
  const v = s.tracks[0]!.id;
  return {
    ...p,
    sequences: [
      {
        ...s,
        clips: [newClip(v, 0, 100, { kind: 'media', media: 'm', in: 5 }, 'A'), newClip(v, 100, 100, { kind: 'media', media: 'm', in: 20 }, 'B')],
      },
    ],
  };
}
const v1 = (p: Project) => current(p).tracks[0]!.id;
const shots = (p: Project) =>
  current(p)
    .clips.sort((a, b) => a.start - b.start)
    .map((c) => [c.name, c.start, end(c)]);

describe('trimming from the keyboard', () => {
  it('finds the cut nearest the playhead', () => {
    const p = twoShots();
    const c = cutNear(current(p), 90, v1(p))!;
    expect(c.at).toBe(100);
    expect([c.left?.name, c.right?.name]).toEqual(['A', 'B']);
    expect(cutNear(current(p), 190, v1(p))?.at).toBe(200);
  });

  it('extend edit rolls the nearest cut to the playhead', () => {
    const p0 = twoShots();
    const p = extendEdit(p0, 110, v1(p0));
    expect(shots(p)).toEqual([
      ['A', 0, 110],
      ['B', 110, 200],
    ]);
  });

  it('rolls or ripples the nearest cut a frame at a time', () => {
    const p0 = twoShots();
    expect(shots(trimCut(p0, 98, v1(p0), -1, 'roll'))).toEqual([
      ['A', 0, 99],
      ['B', 99, 200],
    ]);
    // Ripple: the first shot gets longer, and everything after moves along.
    expect(shots(trimCut(p0, 98, v1(p0), 2, 'ripple'))).toEqual([
      ['A', 0, 102],
      ['B', 102, 202],
    ]);
  });
});
