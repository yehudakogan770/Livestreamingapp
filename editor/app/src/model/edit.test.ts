import { describe, expect, it } from 'vitest';
import { setKey, valueAt, toggleAnim } from './anim';
import { addMedia, buildEventProject, readProject, timecode, parseTimecode, type Prepared } from './build';
import {
  closeGap,
  extractRange,
  liftRange,
  moveClips,
  nest,
  paste,
  copyClips,
  razor,
  rippleDelete,
  setSpeed,
  slide,
  slip,
  switchAngle,
  trim,
  updateClips,
  withLinked,
} from './edit';
import type { EventFile } from './event';
import { current, end, handles, onTrack, sourceTime } from './seq';
import { emptyProject, newClip, type Clip, type MediaItem, type Project, type TrackPoint } from './types';

function project(): Project {
  const p = emptyProject('Test');
  const m: MediaItem = {
    id: 'm1',
    name: 'Clip',
    path: '/c.mp4',
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
  const q = { ...p, media: [m] };
  // Two 10-second clips side by side at 0 and 300, each with sound.
  const a = addMedia(q, 'm1', 0, 'overwrite', undefined, undefined, { in: 10, out: 20 });
  return addMedia(a, 'm1', 300, 'overwrite', undefined, undefined, { in: 50, out: 60 });
}
const seq = (p: Project) => current(p);
const v1 = (p: Project) => seq(p).tracks[0]?.id as string;
const a1 = (p: Project) => seq(p).tracks.find((t) => t.kind === 'audio')?.id as string;

describe('keyframes', () => {
  it('moves between keyframes', () => {
    let k = setKey(0, 0, 0);
    k = setKey(k, 10, 100);
    expect(valueAt(k, 5)).toBe(50);
    expect(valueAt(k, -3)).toBe(0);
    expect(valueAt(k, 30)).toBe(100);
    expect(valueAt(toggleAnim(k, 5, 0), 0)).toBe(50);
  });
});

describe('editing', () => {
  it('adds a clip with its sound, linked', () => {
    const p = project();
    const s = seq(p);
    expect(s.clips).toHaveLength(4);
    const v = onTrack(s, v1(p));
    expect(v.map((c) => [c.start, c.length])).toEqual([
      [0, 300],
      [300, 300],
    ]);
    expect(withLinked(s, [v[0]?.id as string])).toHaveLength(2);
  });

  it('razor cuts picture and sound, keeping the source in place', () => {
    const p = razor(project(), 150);
    const v = onTrack(seq(p), v1(p));
    expect(v).toHaveLength(3);
    expect(v[1]?.start).toBe(150);
    expect(sourceTime(v[1] as never, 0, 30)).toBeCloseTo(15);
    expect(onTrack(seq(p), a1(p))).toHaveLength(3);
  });

  it('ripple delete closes the gap on every track', () => {
    const p = project();
    const first = onTrack(seq(p), v1(p))[0];
    const q = rippleDelete(p, [first?.id as string]);
    const v = onTrack(seq(q), v1(q));
    expect(v).toHaveLength(1);
    expect(v[0]?.start).toBe(0);
    expect(onTrack(seq(q), a1(q))[0]?.start).toBe(0);
  });

  it('roll moves the cut between two clips', () => {
    const p = project();
    const first = onTrack(seq(p), v1(p))[0] as { id: string };
    const q = trim(p, first.id, 'end', 30, 'roll');
    const v = onTrack(seq(q), v1(q));
    expect(v.map((c) => [c.start, c.length])).toEqual([
      [0, 330],
      [330, 270],
    ]);
  });

  it('a normal trim stops at the neighbor; ripple pushes it along', () => {
    const p = project();
    const first = onTrack(seq(p), v1(p))[0] as { id: string };
    expect(onTrack(seq(trim(p, first.id, 'end', 30, 'normal')), v1(p))[0]?.length).toBe(300);
    const q = trim(p, first.id, 'end', 30, 'ripple');
    expect(onTrack(seq(q), v1(q)).map((c) => [c.start, c.length])).toEqual([
      [0, 330],
      [330, 300],
    ]);
    const r = trim(p, first.id, 'start', 60, 'ripple');
    expect(onTrack(seq(r), v1(r)).map((c) => [c.start, c.length])).toEqual([
      [0, 240],
      [240, 300],
    ]);
    expect(sourceTime(onTrack(seq(r), v1(r))[0] as never, 0, 30)).toBeCloseTo(12);
  });

  it('trims stop where the source runs out', () => {
    const p = project();
    const first = onTrack(seq(p), v1(p))[0];
    expect(handles(p, first as never, 30)).toEqual({ before: 300, after: 2400 });
    const q = trim(p, (first as { id: string }).id, 'start', -1000, 'ripple');
    expect(onTrack(seq(q), v1(q))[0]?.length).toBe(600);
  });

  it('a remapped clip has the handles its speed leaves it', () => {
    const p = project();
    // 10 seconds in at 200%: the 300 frames use 20 seconds of the 100-second file (10–30 s).
    const first = { ...(onTrack(seq(p), v1(p))[0] as Clip), remap: { speed: 200, sampling: 'nearest' as const, pitch: true } };
    expect(handles(p, first, 30)).toEqual({ before: 150, after: 1050 });
    // Played backwards, the end runs toward the file's start.
    const back = { ...first, remap: { speed: -100, sampling: 'nearest' as const, pitch: true }, source: { kind: 'media' as const, media: 'm1', in: 20 } };
    expect(handles(p, back, 30)).toEqual({ before: 2400, after: 300 });
  });

  it('slip and slide', () => {
    const p = project();
    const [a, b] = onTrack(seq(p), v1(p)) as unknown as [{ id: string }, { id: string }];
    const s = slip(p, b.id, 30);
    expect(sourceTime(onTrack(seq(s), v1(s))[1] as never, 0, 30)).toBeCloseTo(51);
    const r = slide(p, b.id, -30);
    expect(onTrack(seq(r), v1(r)).map((c) => [c.start, c.length])).toEqual([
      [0, 270],
      [270, 300],
    ]);
    expect(a.id).toBeTruthy();
  });

  it('slip keeps tracks on the picture they were tracked on', () => {
    const p = project();
    const b = onTrack(seq(p), v1(p))[1] as Clip;
    const tracked = updateClips(p, [b.id], (c) => ({
      ...c,
      paths: [{ id: 'P', name: 'Track', points: [[40, 0.2, 0.3] as TrackPoint, [100, 0.4, 0.5] as TrackPoint], manual: [40] }],
      stabilize: { path: 'P', smooth: 0, lock: true, at: 60, crop: false, rotate: false, scale: false },
    }));
    // Slipped 30 frames later into the file: what was at frame 40 of the clip is now at frame 10.
    const c = onTrack(seq(slip(tracked, b.id, 30)), v1(p))[1] as Clip;
    expect(c.paths?.[0]?.points.map((x) => x[0])).toEqual([10, 70]);
    expect(c.paths?.[0]?.manual).toEqual([10]);
    expect(c.stabilize?.at).toBe(30);
  });

  it('a clip following a track keeps its place when the tracked clip is moved', () => {
    const p = project();
    const [a, b] = onTrack(seq(p), v1(p)) as [Clip, Clip];
    const v2 = seq(p).tracks[1]?.id as string;
    const title = {
      ...newClip(v2, 320, 60, { kind: 'color', color: '#fff' }, 'Title'),
      follow: { clip: b.id, path: 'P', at: 330, scale: false, rotate: false },
    };
    const q = { ...p, sequences: p.sequences.map((s) => ({ ...s, clips: [...s.clips, title] })) };
    // Taking out the first clip pulls everything 300 frames earlier: the frame of the tracked clip it was attached at moves too.
    const r = rippleDelete(q, [a.id]);
    const moved = seq(r).clips.find((c) => c.id === title.id);
    expect(moved?.start).toBe(20);
    expect(moved?.follow?.at).toBe(30);
    // Trimming the tracked clip's start keeps the same picture at that frame: nothing to change.
    const t = trim(q, b.id, 'start', 15, 'normal');
    expect(seq(t).clips.find((c) => c.id === title.id)?.follow?.at).toBe(330);
    // Copied and pasted together, the title's copy follows the tracked clip's copy, at the same place on it.
    const board = copyClips(seq(q), [b.id, title.id]);
    const pasted = paste(q, board, 900, 'overwrite');
    const copyOfB = seq(pasted).clips.find((c) => c.start === 900 && c.track === v1(p));
    const copyOfTitle = seq(pasted).clips.find((c) => c.start === 920);
    expect(copyOfTitle?.follow?.clip).toBe(copyOfB?.id);
    expect(copyOfTitle?.follow?.at).toBe(930);
    // Nested together, it follows the tracked clip inside the nest, at the same place on it.
    const n = nest(q, [b.id, title.id]);
    const inner = n.project.sequences.find((x) => x.id === n.seq);
    const innerB = inner?.clips.find((c) => c.name === b.name && c.track === inner.tracks[0]?.id);
    const innerTitle = inner?.clips.find((c) => c.name === 'Title');
    expect(innerTitle?.follow?.clip).toBe(innerB?.id);
    expect(innerTitle?.follow?.at).toBe(30);
  });

  it('moves clips and covers what they land on', () => {
    const p = project();
    const b = onTrack(seq(p), v1(p))[1] as { id: string };
    const q = moveClips(p, withLinked(seq(p), [b.id]), { frames: -100, video: 0, audio: 0 });
    expect(onTrack(seq(q), v1(q)).map((c) => [c.start, c.length])).toEqual([
      [0, 200],
      [200, 300],
    ]);
  });

  it('lift and extract a marked part', () => {
    const p = project();
    const l = liftRange(p, 100, 400, [v1(p)]);
    expect(onTrack(seq(l), v1(l)).map((c) => [c.start, c.length])).toEqual([
      [0, 100],
      [400, 200],
    ]);
    const x = extractRange(p, 100, 400);
    expect(onTrack(seq(x), v1(x)).map((c) => [c.start, c.length])).toEqual([
      [0, 100],
      [100, 200],
    ]);
    const g = closeGap(l, v1(l), 200);
    expect(onTrack(seq(g), v1(g))[1]?.start).toBe(100);
  });

  it('speed changes the length', () => {
    const p = project();
    const a = onTrack(seq(p), v1(p))[0] as { id: string };
    const q = setSpeed(p, a.id, 2, true);
    expect(onTrack(seq(q), v1(q)).map((c) => [c.start, c.length])).toEqual([
      [0, 150],
      [150, 300],
    ]);
  });

  it('copy and paste keeps tracks and links', () => {
    const p = project();
    const a = onTrack(seq(p), v1(p))[0] as { id: string };
    const board = copyClips(seq(p), withLinked(seq(p), [a.id]));
    const q = paste(p, board, 600, 'overwrite');
    expect(seq(q).clips).toHaveLength(6);
    const added = seq(q).clips.filter((c) => c.start === 600);
    expect(added).toHaveLength(2);
    expect(added[0]?.link).toBe(added[1]?.link);
    expect(added[0]?.link).not.toBe(seq(p).clips[0]?.link);
  });
});

describe('a recorded event', () => {
  const event: EventFile = {
    app: 'Lumora',
    version: 1,
    name: 'Gala',
    startedAt: 0,
    durationMs: 60000,
    program: { path: '/e/live.mp4', mp4: null },
    files: [
      { kind: 'camera', sourceId: 'c1', name: 'Wide', path: '/e/wide.mp4', startMs: 0 },
      { kind: 'camera', sourceId: 'c2', name: 'Close', path: '/e/close.mp4', startMs: 2000 },
      { kind: 'microphone', sourceId: 'm1', name: 'Podium (sound)', path: '/e/pod.webm', startMs: 1000 },
    ],
    cuts: [
      { at: 0, id: 'c1', name: 'Wide' },
      { at: 20000, id: 'c2', name: 'Close' },
    ],
  };
  const prep = (path: string, video: boolean, ms = 60000): Prepared => ({ path, durationMs: ms, hasVideo: video, hasAudio: true, width: 1920, height: 1080 });
  const media = new Map<string, Prepared>([
    ['/e/live.mp4', prep('/e/live.mp4', true)],
    ['/e/wide.mp4', prep('/e/wide.mp4', true)],
    ['/e/close.mp4', prep('/e/close.mp4', true, 58000)],
    ['/e/pod.webm', prep('/e/pod.webm', false, 59000)],
  ]);

  it('becomes a multicam edit with the live cuts, sound linked', () => {
    const p = buildEventProject(event, '/e/Gala.lumora', media);
    const s = current(p);
    const v = onTrack(s, s.tracks[0]?.id as string);
    expect(v.map((c) => (c.source.kind === 'multicam' ? c.source.angle : ''))).toEqual(['cam1', 'cam2']);
    expect(v[1]?.start).toBe(600);
    expect(end(v[1] as never)).toBe(1800);
    const audio = s.tracks.filter((t) => t.kind === 'audio');
    expect(audio.map((t) => [t.name, t.off])).toEqual([
      ['Live sound', false],
      ['Podium', true],
    ]);
    // The podium microphone started a second in: its first clip starts there.
    const pod = onTrack(s, audio[1]?.id as string);
    expect(pod[0]?.start).toBe(30);
    expect(withLinked(s, [v[0]?.id as string])).toHaveLength(3);
  });

  it('switching cameras cuts at the playhead', () => {
    const p = buildEventProject(event, '/e/Gala.lumora', media);
    const q = switchAngle(p, 300, 'live');
    const s = current(q);
    const v = onTrack(s, s.tracks[0]?.id as string);
    expect(v.map((c) => (c.source.kind === 'multicam' ? [c.start, c.source.angle] : null))).toEqual([
      [0, 'cam1'],
      [300, 'live'],
      [600, 'cam2'],
    ]);
  });

  it('saves and opens again', () => {
    const p = buildEventProject(event, '/e/Gala.lumora', media);
    expect(readProject(JSON.stringify(p))).toEqual(p);
  });
});

describe('timecode', () => {
  it('reads and writes', () => {
    expect(timecode(30 * 3661 + 5, 30)).toBe('01:01:01:05');
    expect(parseTimecode('1:00', 30, 0)).toBe(1800);
    expect(parseTimecode('00:00:02:10', 30, 0)).toBe(70);
    expect(parseTimecode('+10', 30, 5)).toBe(15);
  });
});
