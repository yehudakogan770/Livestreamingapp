import { describe, expect, it } from 'vitest';
import { parseEvent, type EventFile } from './event';
import {
  addTitle,
  buildProject,
  filmTime,
  FRAME,
  heardTracks,
  layout,
  locate,
  maxFade,
  placedTitles,
  remove,
  setFade,
  split,
  switchFrom,
  timecode,
  trim,
  updateTrack,
  type Prepared,
  type Project,
} from './project';

const event: EventFile = {
  app: 'Lumora',
  version: 1,
  name: 'Gala',
  startedAt: Date.UTC(2026, 9, 5, 23, 0, 0),
  durationMs: 60_000,
  program: { path: 'C:/rec/Gala.mkv', mp4: 'C:/rec/Gala.mp4' },
  files: [
    { kind: 'camera', sourceId: 's1', name: 'Wide', path: 'C:/rec/ev/Wide.mkv', startMs: 0 },
    { kind: 'camera', sourceId: 's2', name: 'Close', path: 'C:/rec/ev/Close.mkv', startMs: 1000 },
    { kind: 'microphone', sourceId: 'm1', name: 'Podium (sound)', path: 'C:/rec/ev/Podium (sound).webm', startMs: 0 },
  ],
  cuts: [
    { at: 0, id: 's1', name: 'Wide' },
    { at: 10_000, id: 's2', name: 'Close' },
    { at: 20_000, id: 'slides', name: 'Slides' },
    { at: 30_000, id: 's1', name: 'Wide' },
  ],
};

const prepared = (path: string, video: boolean, audio: boolean, durationMs = 60_000): [string, Prepared] => [
  path,
  { path: path.replace(/\.mkv$/, '.mp4'), durationMs, hasVideo: video, hasAudio: audio, width: 1920, height: 1080 },
];

const media = new Map<string, Prepared>([
  prepared('C:/rec/Gala.mp4', true, true),
  prepared('C:/rec/ev/Wide.mkv', true, false),
  prepared('C:/rec/ev/Close.mkv', true, false, 59_000),
  prepared('C:/rec/ev/Podium (sound).webm', false, true),
]);

const build = (): Project => buildProject(event, 'C:/rec/Gala.lumora', media);

describe('opening an event', () => {
  it('reads the event file and refuses other files', () => {
    expect(parseEvent(JSON.stringify(event)).cuts).toHaveLength(4);
    expect(() => parseEvent('{"app":"Other"}')).toThrow(/not a Lumora event file/);
    expect(() => parseEvent('nope')).toThrow(/not a Lumora event file/);
    expect(parseEvent('{"app":"Lumora","files":[{"path":"a.webm","kind":"camera"}]}').files[0]?.name).toBe('Camera');
  });

  it('lays out every camera, the sound, and the live cuts as the first edit', () => {
    const p = build();
    expect(p.angles.map((a) => a.name)).toEqual(['Live Screen', 'Wide', 'Close']);
    expect(p.tracks.map((t) => [t.name, t.muted])).toEqual([
      ['Live sound', false],
      ['Podium', true],
    ]);
    // The slides were not a camera: the Live Screen recording shows them.
    expect(p.clips.map((c) => [c.angle, c.in, c.out])).toEqual([
      ['cam1', 0, 10_000],
      ['cam2', 10_000, 20_000],
      ['live', 20_000, 30_000],
      ['cam1', 30_000, 60_000],
    ]);
    expect(layout(p.clips).total).toBe(60_000);
    expect(p.angles[2]?.startMs).toBe(1000);
  });

  it('needs at least one video', () => {
    expect(() => buildProject(event, 'x', new Map())).toThrow(/No video/);
  });
});

describe('editing', () => {
  it('splits, and removing closes the gap (picture and sound together)', () => {
    let p = split(build(), 5000);
    expect(p.clips).toHaveLength(5);
    expect(p.clips[1]?.in).toBeCloseTo(5000, 0);
    p = remove(p, [p.clips[1]!.id]);
    expect(layout(p.clips).total).toBeCloseTo(55_000, 0);
    // What came after now starts 5 seconds earlier.
    expect(locate(p.clips, 5000)?.event).toBe(10_000);
    expect(filmTime(p.clips, 7000)).toBeNull();
  });

  it('switches cameras from the playhead on', () => {
    const p = switchFrom(build(), 35_000, 'cam2');
    expect(p.clips.slice(3).map((c) => [c.angle, Math.round(c.in), c.out])).toEqual([
      ['cam1', 30_000, 35_000],
      ['cam2', 35_000, 60_000],
    ]);
    // At the start of a clip it changes the whole clip.
    const q = switchFrom(build(), 10_000, 'cam1');
    expect(q.clips[1]).toMatchObject({ angle: 'cam1', in: 10_000, out: 20_000 });
  });

  it('rolls a cut between clips that follow on, and ripples otherwise', () => {
    const p = build();
    const rolled = trim(p, p.clips[0]!.id, 'end', 2000);
    expect(rolled.clips[0]?.out).toBeCloseTo(12_000, 0);
    expect(rolled.clips[1]?.in).toBeCloseTo(12_000, 0);
    expect(layout(rolled.clips).total).toBeCloseTo(60_000, 0);
    const rippled = trim(p, p.clips[0]!.id, 'end', -2000, true);
    expect(layout(rippled.clips).total).toBeCloseTo(58_000, 0);
    // A cut-out part can be brought back, but never past the next clip.
    const back = trim(rippled, rippled.clips[0]!.id, 'end', 9000);
    expect(back.clips[0]?.out).toBe(10_000);
    // Never shorter than a few frames.
    const tiny = trim(p, p.clips[0]!.id, 'end', -50_000, true);
    expect(tiny.clips[0]!.out - tiny.clips[0]!.in).toBeCloseTo(FRAME * 3, 5);
  });

  it('keeps dissolves shorter than the clips', () => {
    const p = build();
    const id = p.clips[1]!.id;
    expect(maxFade(p, id)).toBeCloseTo(8000, -2);
    expect(setFade(p, id, 999_999).clips[1]!.fade).toBeCloseTo(8000, -2);
    expect(setFade(p, p.clips[0]!.id, 1000).clips[0]!.fade).toBe(0);
  });

  it('titles stay with their moment, and go when it is cut out', () => {
    const { project, id } = addTitle(build(), 12_000);
    expect(placedTitles(project)[0]?.start).toBeCloseTo(12_000, 0);
    const cut = split(project, 5000);
    const shorter = remove(cut, [cut.clips[0]!.id]);
    expect(placedTitles(shorter)[0]?.start).toBeCloseTo(7000, 0);
    const gone = remove(shorter, [shorter.clips[1]!.id]);
    expect(placedTitles(gone).find((x) => x.title.id === id)).toBeUndefined();
  });

  it('solo wins over mute', () => {
    const p = build();
    expect(heardTracks(p).map((t) => t.id)).toEqual(['live-sound']);
    expect(heardTracks(updateTrack(p, 'mic1', { solo: true })).map((t) => t.id)).toEqual(['mic1']);
  });

  it('writes times', () => {
    expect(timecode(3_723_000)).toBe('1:02:03');
    expect(timecode(65_000)).toBe('1:05');
    expect(timecode(1500, true)).toBe('0:01.15');
  });
});
