import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT, emptyProject, newClip, newSequence, type MediaItem, type Project } from '../model/types';
import { readEdl, writeEdl } from './edl';
import { fcpSeconds, fcpTime, readFcpxml, writeFcpxml } from './fcpxml';
import { detectFormat, FORMATS, readTimeline } from './formats';
import { readOtio, writeOtio } from './otio';
import { fileUrl, framesToTc, fromSequence, pathFromUrl, relink, tcToFrames, toSequence, type XTimeline } from './timeline';
import { readXmeml, writeXmeml } from './xmeml';
import finalCut from './fixtures/finalcut.fcpxml?raw';
import premiere from './fixtures/premiere.xml?raw';
import resolveEdl from './fixtures/resolve.edl?raw';
import resolveOtio from './fixtures/resolve.otio?raw';

const media = (id: string, path: string, over: Partial<MediaItem> = {}): MediaItem => ({
  id,
  name:
    path
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '') ?? id,
  path,
  proxy: null,
  kind: 'video',
  duration: 120,
  width: 1920,
  height: 1080,
  fps: 25,
  hasVideo: true,
  hasAudio: true,
  bin: null,
  ...over,
});

/** A 25 fps project: two linked interview clips on V1/A1, a 2× B-roll on V2, music on A2, a title, markers. */
function project(): Project {
  const p = emptyProject('Test');
  const s = newSequence('Promo', 1920, 1080, 25, 2, 2);
  const [v1, v2, a1, a2] = s.tracks;
  const m = [
    media('m1', 'C:/Shoot/Interview A.mov'),
    media('m2', 'C:/Shoot/B-Roll 07.mov'),
    media('m3', 'C:/Music/Theme.wav', { kind: 'audio', hasVideo: false, width: 0, height: 0, duration: 200 }),
  ];
  const c1 = newClip(v1!.id, 0, 100, { kind: 'media', media: 'm1', in: 10 }, 'Interview A');
  const c1a = newClip(a1!.id, 0, 100, { kind: 'media', media: 'm1', in: 10 }, 'Interview A');
  c1.link = c1a.link = 'L1';
  const c2 = newClip(v1!.id, 100, 50, { kind: 'media', media: 'm1', in: 30 }, 'Interview A 2');
  const c2a = newClip(a1!.id, 100, 50, { kind: 'media', media: 'm1', in: 30 }, 'Interview A 2');
  c2.link = c2a.link = 'L2';
  c2.tIn = { type: 'dissolve', length: 10 };
  const broll = newClip(v2!.id, 40, 30, { kind: 'media', media: 'm2', in: 2 }, 'B-Roll 07');
  broll.speed = 2;
  const music = newClip(a2!.id, 0, 150, { kind: 'media', media: 'm3', in: 0 }, 'Theme');
  music.gain = -12;
  const title = newClip(v2!.id, 110, 25, { kind: 'text', text: { ...DEFAULT_TEXT, text: 'Dana Levi' } }, 'Name');
  const seq = {
    ...s,
    clips: [c1, c1a, c2, c2a, broll, music, title],
    markers: [
      { id: 'k1', at: 25, length: 0, name: 'Good quote', color: '#3f8f5a' },
      { id: 'k2', at: 120, length: 5, name: 'Act two', color: '#4a6fb5' },
    ],
  };
  return { ...p, media: m, sequences: [seq], open: seq.id };
}

const summary = (t: XTimeline) =>
  t.tracks.map((tr) => ({
    kind: tr.kind,
    clips: tr.clips.map((c) => ({ file: c.file?.name ?? null, start: c.start, length: c.length, srcIn: Math.round(c.srcIn * 100) / 100, speed: c.speed })),
  }));

describe('time and paths', () => {
  it('writes and reads FCPXML times', () => {
    expect(fcpTime(0, 24)).toBe('0s');
    expect(fcpTime(1, 23.976)).toBe('1001/24000s');
    expect(fcpTime(30, 29.97)).toBe('1001/1000s');
    expect(fcpTime(50, 25)).toBe('2s');
    expect(fcpSeconds('1001/24000s')).toBeCloseTo(0.0417083, 6);
    expect(fcpSeconds('3600s')).toBe(3600);
  });

  it('counts drop-frame timecode', () => {
    expect(framesToTc(1800, 29.97, true)).toBe('00:01:00;02');
    expect(tcToFrames('00:01:00;02', 29.97)).toBe(1800);
    expect(tcToFrames('01:00:00;00', 29.97)).toBe(107892);
    for (const f of [0, 1799, 1800, 17982, 107892, 123456]) expect(tcToFrames(framesToTc(f, 29.97, true), 29.97)).toBe(f);
    expect(framesToTc(90000, 25)).toBe('01:00:00:00');
  });

  it('turns paths into file URLs and back', () => {
    expect(fileUrl('C:\\Clips\\A B.mov')).toBe('file:///C:/Clips/A%20B.mov');
    expect(fileUrl('/Users/x/A B.mov', true)).toBe('file://localhost/Users/x/A%20B.mov');
    expect(pathFromUrl('file:///C:/Clips/A%20B.mov')).toBe('C:/Clips/A B.mov');
    expect(pathFromUrl('file://localhost/D:/Brand/Logo%20(white).png')).toBe('D:/Brand/Logo (white).png');
    expect(pathFromUrl('file:///Volumes/Media/Theme.wav')).toBe('/Volumes/Media/Theme.wav');
  });
});

describe('a Lumora sequence in the shared form', () => {
  it('keeps clips, speed, volume, titles and markers, and says what stays behind', () => {
    const p = project();
    const t = fromSequence(p, p.sequences[0]!);
    expect(t.tracks.map((x) => x.kind)).toEqual(['video', 'video', 'audio', 'audio']);
    expect(t.tracks[1]!.clips.find((c) => c.text)?.text).toBe('Dana Levi');
    expect(t.tracks[3]!.clips[0]!.gain).toBe(-12);
    expect(t.notes.join(' ')).toMatch(/title/);
  });
});

describe('round trips', () => {
  const p = project();
  const t = fromSequence(p, p.sequences[0]!);
  const media = summary({ ...t, tracks: t.tracks.map((tr) => ({ ...tr, clips: tr.clips.filter((c) => c.file) })) });

  it('FCPXML', () => {
    const back = readFcpxml(writeFcpxml(t));
    expect(back.fps).toBe(25);
    expect(back.name).toBe('Promo');
    expect(summary({ ...back, tracks: back.tracks.map((tr) => ({ ...tr, clips: tr.clips.filter((c) => c.file) })) })).toEqual(media);
    expect(back.tracks[1]!.clips.find((c) => !c.file)?.text).toBe('Dana Levi');
    expect(back.tracks[3]!.clips[0]!.gain).toBe(-12);
    expect(back.markers.map((m) => [m.at, m.length, m.name])).toEqual([
      [25, 0, 'Good quote'],
      [120, 5, 'Act two'],
    ]);
  });

  it('Premiere / FCP7 XML', () => {
    const back = readXmeml(writeXmeml(t));
    expect(back.fps).toBe(25);
    expect(summary(back)).toEqual(media);
    expect(back.tracks[0]!.clips[1]!.dissolveIn).toBe(10);
    expect(back.tracks[3]!.clips[0]!.gain).toBeCloseTo(-12, 1);
    expect(back.markers.map((m) => m.name)).toEqual(['Good quote', 'Act two']);
  });

  it('OpenTimelineIO', () => {
    const back = readOtio(writeOtio(t));
    expect(summary({ ...back, tracks: back.tracks.map((tr) => ({ ...tr, clips: tr.clips.filter((c) => c.file) })) })).toEqual(media);
    expect(back.tracks[0]!.clips[1]!.dissolveIn).toBe(10);
    expect(back.markers.map((m) => [m.at, m.length, m.name, m.color])).toEqual([
      [25, 0, 'Good quote', '#3f8f5a'],
      [120, 5, 'Act two', '#4a6fb5'],
    ]);
  });

  it('EDL (V1 and the sound tracks)', () => {
    const text = writeEdl(t);
    expect(text).toMatch(/^TITLE: Promo/);
    expect(text).toMatch(/FCM: NON-DROP FRAME/);
    expect(text).toMatch(/\* FROM CLIP NAME: Interview A\.mov/);
    expect(text).toMatch(/\* NOTE: only V1/);
    const back = readEdl(text, 25);
    expect(summary(back)).toEqual([media[0], media[2], media[3]]);
    expect(back.tracks[0]!.clips[1]!.dissolveIn).toBe(10);
  });

  it('back into a sequence, linked to the same media', () => {
    for (const f of FORMATS) {
      const text = f.write(t);
      const read = readTimeline(text, `Promo.${f.extension}`, 25);
      const { project: next, report } = toSequence(p, read);
      expect(next.media).toHaveLength(3);
      expect(report.missing).toEqual([]);
      const s = next.sequences.find((x) => x.id === next.open)!;
      const first = s.clips.find(
        (c) => c.start === 0 && c.source.kind === 'media' && c.source.media === 'm1' && s.tracks.find((tr) => tr.id === c.track)?.kind === 'video',
      );
      expect(first, f.id).toBeTruthy();
      // Its sound on A1 is linked to it again.
      expect(s.clips.filter((c) => c.link && c.link === first!.link)).toHaveLength(2);
    }
  });
});

describe('files from other editors', () => {
  it('Final Cut Pro FCPXML: storyline, lanes, title, dissolve, retime, marker', () => {
    const t = readFcpxml(finalCut);
    expect(t.name).toBe('Promo Cut');
    expect(t.fps).toBe(23.976);
    const [v1, v2, a1, a2] = t.tracks;
    expect(t.tracks.map((x) => x.kind)).toEqual(['video', 'video', 'audio', 'audio']);
    // Interview A starts 3.6 s into a file whose timecode starts at one hour.
    expect(v1!.clips[0]).toMatchObject({ name: 'Interview A', start: 0, length: 120 });
    expect(v1!.clips[0]!.srcIn).toBeCloseTo(3.6, 3);
    expect(v1!.clips[0]!.file?.path).toBe('/Volumes/Media/Shoot Day 1/Interview A.mov');
    expect(v1!.clips[1]).toMatchObject({ name: 'B-Roll 07', start: 120, length: 120, speed: 2, dissolveIn: 24 });
    expect(v2!.clips[0]).toMatchObject({ text: 'Dana Levi, Director', start: 24, length: 72 });
    expect(a1!.clips).toHaveLength(2);
    expect(a2!.clips[0]).toMatchObject({ name: 'Theme', start: 0, length: 240, gain: -12 });
    expect(t.markers).toEqual([{ at: 48, length: 0, name: 'Good quote' }]);
  });

  it('Premiere XML: dissolve cut points, speed, disabled clip, levels, generator, marker', () => {
    const t = readXmeml(premiere);
    expect(t).toMatchObject({ name: 'Wedding Highlights', width: 3840, height: 2160, fps: 29.97 });
    const [v1, v2, a1, a2] = t.tracks;
    expect(v1!.clips.map((c) => [c.start, c.length, c.speed])).toEqual([
      [0, 300, 1],
      [300, 300, 2],
    ]);
    expect(v1!.clips[1]!.dissolveIn).toBe(30);
    expect(v1!.clips[0]!.srcIn).toBeCloseTo(150 / (30000 / 1001), 4);
    expect(v1!.clips[0]!.file?.path).toBe('D:/Weddings/Cohen/C0012.MP4');
    expect(v2!.clips[0]).toMatchObject({ enabled: false, start: 60 });
    expect(v2!.clips[0]!.file?.name).toBe('Logo (white).png');
    expect(a1!.clips[0]!.gain).toBeCloseTo(-6, 1);
    expect(a1!.clips[0]!.file?.name).toBe('C0012.MP4');
    expect(a2!.clips[0]!.file).toMatchObject({ name: 'First Dance.mp3', hasVideo: false });
    expect(t.markers).toEqual([{ at: 120, length: 0, name: 'Ceremony' }]);
    expect(t.notes).toEqual(['1 × generator (left as a gap)']);
  });

  it('DaVinci Resolve EDL: one-hour start, AA channel, dissolve, black, M2 speed', () => {
    const t = readEdl(resolveEdl, 24);
    expect(t.name).toBe('Timeline 1');
    const [v1, a1, a2] = t.tracks;
    expect(v1!.clips.map((c) => [c.file?.name, c.start, c.length, c.speed])).toEqual([
      ['A001_C003.mov', 0, 132, 1],
      ['A002_C001.mov', 132, 84, 1],
      ['A003_C010.mov', 240, 48, 2],
    ]);
    expect(v1!.clips[0]!.file?.path).toBe('/Users/colorist/Footage/A001_C003.mov');
    expect(v1!.clips[1]!.dissolveIn).toBe(24);
    expect(v1!.clips[1]!.srcIn).toBeCloseTo(60.5, 3);
    expect(a1!.clips[0]).toMatchObject({ start: 0, length: 120 });
    expect(a2!.clips).toHaveLength(1);
  });

  it('DaVinci Resolve OTIO: timeline start, gap, time warp, marker', () => {
    const t = readOtio(resolveOtio);
    expect(t).toMatchObject({ name: 'Doc Assembly', fps: 25 });
    const [v1, a1] = t.tracks;
    expect(v1!.clips.map((c) => [c.file?.name, c.start, c.length, c.srcIn, c.speed])).toEqual([
      ['Archive_1987.mxf', 0, 100, 2, 1],
      ['Interview_02.mov', 150, 75, 10, 0.5],
    ]);
    expect(a1!.clips[0]!.file?.name).toBe('Narration.wav');
    expect(t.markers).toEqual([{ at: 100, length: 1, name: 'Act two', color: '#4a6fb5' }]);
  });

  it('tells the formats apart', () => {
    expect(detectFormat(finalCut)).toBe('fcpxml');
    expect(detectFormat(premiere)).toBe('xml');
    expect(detectFormat(resolveEdl)).toBe('edl');
    expect(detectFormat(resolveOtio)).toBe('otio');
    expect(detectFormat('hello')).toBeNull();
    expect(() => readTimeline('hello', 'notes.txt')).toThrow(/not a timeline/);
  });
});

describe('relinking by file name', () => {
  it('finds media by path, then by name, then by a path found on disk; the rest are missing', () => {
    const p = project();
    const t = readXmeml(premiere);
    const named = { ...p, media: [...p.media, media('m9', 'E:/Copies/c0012.mp4')] };
    const found = new Map([['first dance.mp3', 'E:/Music/First Dance.mp3']]);
    const { project: next, report } = toSequence(named, t, found);
    expect(report.linked.sort()).toEqual(['C0012.MP4', 'First Dance.mp3']);
    expect(report.missing.sort()).toEqual(['C0019.MP4', 'Logo (white).png']);
    const s = next.sequences.find((x) => x.id === next.open)!;
    expect(s).toMatchObject({ name: 'Wedding Highlights', width: 3840, height: 2160, fps: 29.97 });
    const added = next.media.filter((m) => !named.media.some((x) => x.id === m.id));
    expect(added.map((m) => [m.name, m.kind, !!m.missing])).toEqual(
      expect.arrayContaining([
        ['C0019', 'video', true],
        ['Logo (white)', 'image', true],
        ['First Dance', 'audio', false],
      ]),
    );
    expect(added.find((m) => m.name === 'First Dance')?.path).toBe('E:/Music/First Dance.mp3');
    // The first clip is linked to the media already in the project (by name, whatever the case).
    expect(s.clips.filter((c) => c.source.kind === 'media' && c.source.media === 'm9')).toHaveLength(2);
    expect(s.markers[0]).toMatchObject({ at: 120, name: 'Ceremony' });
    expect(
      relink(p.media, { name: 'theme.WAV', path: '/x/theme.WAV', duration: 0, width: 0, height: 0, fps: 0, hasVideo: false, hasAudio: true }),
    ).toMatchObject({ id: 'm3' });
  });
});
