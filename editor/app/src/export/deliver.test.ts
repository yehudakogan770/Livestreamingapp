// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { addCaptionTrack } from '../model/captions';
import { addMedia } from '../model/build';
import { current } from '../model/seq';
import { emptyProject, newClip, type MediaItem, type Project } from '../model/types';
import { finishJobs } from './audioplan';
import { chaptersFrom, ffmetadata, youtubeChapters } from './chapters';
import { estimateMb, planDelivery, rangeFor, type DeliveryRequest } from './deliver';
import { BUILT_IN, type DeliveryPreset } from './presets';

const preset = (id: string): DeliveryPreset => BUILT_IN.find((x) => x.id === id) as DeliveryPreset;

function project(): Project {
  const p = emptyProject('Gala');
  const m: MediaItem = {
    id: 'm',
    name: 'Cam',
    path: '/media/cam.mp4',
    proxy: null,
    kind: 'video',
    duration: 60,
    width: 1920,
    height: 1080,
    fps: 30,
    hasVideo: true,
    hasAudio: true,
    bin: null,
  };
  const withMedia = addMedia({ ...p, media: [m] }, 'm', 0, 'overwrite', undefined, undefined, { in: 0, out: 20 });
  const s = current(withMedia);
  return {
    ...withMedia,
    sequences: [
      {
        ...s,
        markers: [
          { id: 'k1', at: 150, length: 0, name: 'Speeches', color: '#fff' },
          { id: 'k2', at: 450, length: 0, name: 'Dance', color: '#fff' },
        ],
      },
    ],
  };
}

const req = (p: Project, over: Partial<DeliveryRequest> = {}): DeliveryRequest => ({
  preset: preset('yt1080hevc'),
  seq: p.open,
  range: { from: 0, to: 600 },
  out: '/films/Gala.mp4',
  chapters: true,
  captions: { burn: true, embed: false, sidecar: false },
  encoders: ['libx264', 'libx265', 'hevc_nvenc', 'png', 'aac'],
  app: true,
  ...over,
});

describe('chapters from markers', () => {
  it('start at 0:00 and end where the next begins', () => {
    const p = project();
    const ch = chaptersFrom(current(p).markers, 30, { from: 0, to: 600 });
    expect(ch).toEqual([
      { start: 0, end: 5, title: 'Start' },
      { start: 5, end: 15, title: 'Speeches' },
      { start: 15, end: 20, title: 'Dance' },
    ]);
    expect(youtubeChapters(ch)).toBe('0:00 Start\n0:05 Speeches\n0:15 Dance');
    expect(ffmetadata(ch)).toContain('[CHAPTER]\nTIMEBASE=1/1000\nSTART=5000\nEND=15000\ntitle=Speeches');
    // Only markers inside the range, timed from where it starts.
    expect(chaptersFrom(current(p).markers, 30, { from: 150, to: 600 })).toEqual([
      { start: 0, end: 10, title: 'Speeches' },
      { start: 10, end: 15, title: 'Dance' },
    ]);
    expect(chaptersFrom([], 30, { from: 0, to: 600 })).toEqual([]);
  });

  it('escapes what FFmpeg reads specially', () => {
    expect(ffmetadata([{ start: 0, end: 1, title: 'A=B; #1' }])).toContain('title=A\\=B\\; \\#1');
  });
});

describe('planning a delivery', () => {
  it('ranges: whole, in to out, selected clips', () => {
    const p = project();
    const s = { ...current(p), inPoint: 30, outPoint: 90 };
    expect(rangeFor(s, 'all')).toEqual({ from: 0, to: 600 });
    expect(rangeFor(s, 'marked')).toEqual({ from: 30, to: 90 });
    const c = s.clips[0]!;
    expect(rangeFor(s, 'selected', [c.id])).toEqual({ from: c.start, to: c.start + c.length });
    expect(rangeFor({ ...s, inPoint: null, outPoint: null }, 'marked')).toEqual({ from: 0, to: 600 });
  });

  it('H.265 on the graphics card, with a software fallback, chapters, and -14 LUFS', () => {
    const p = project();
    const plan = planDelivery(p, req(p));
    expect(plan.engine).toBe('ffmpeg');
    expect(plan.encoder).toEqual({ name: 'hevc_nvenc', hardware: true });
    expect(plan.settings.pipe?.args).toContain('hevc_nvenc');
    expect(plan.settings.pipe?.fallback).toContain('libx265');
    expect(plan.settings.loudness).toBe('loudnorm=I=-14:TP=-1:LRA=11');
    expect(plan.settings.files?.map((f) => f[0])).toEqual(['chapters.txt']);
    // The last run: the picture copied in, chapters mapped from the input after the sound.
    const jobs = finishJobs(plan.project, current(plan.project), plan.settings.range, { file: '{tmp}/video.mov', copy: true, crf: 0 }, 'aac', plan.settings.loudness, plan.settings.finish);
    const last = jobs[jobs.length - 1]!.args;
    const inputs = last.filter((x) => x === '-i').length;
    expect(last[last.indexOf('-map_chapters') + 1]).toBe(String(inputs - 1));
    expect(last).toContain('-tag:v');
    expect(last.join(' ')).toContain('loudnorm=I=-14');
    expect(last).toContain('copy');
  });

  it('embedded captions become a subtitle track; burned ones can be left out of the picture', () => {
    let p = addCaptionTrack(project()).project;
    const s = current(p);
    const capTrack = s.tracks.find((t) => t.captions)!;
    p = { ...p, sequences: [{ ...s, clips: [...s.clips, newClip(capTrack.id, 0, 60, { kind: 'caption', text: 'Hello there' }, 'Hello')] }] };
    const plan = planDelivery(p, req(p, { chapters: false, captions: { burn: false, embed: true, sidecar: true } }));
    expect(plan.settings.files?.[0]?.[0]).toBe('captions.srt');
    expect(plan.settings.files?.[0]?.[1]).toContain('Hello there');
    expect(plan.sidecar.length).toBe(1);
    expect(current(plan.project).tracks.find((t) => t.captions)?.off).toBe(true);
    const extra = plan.settings.finish?.extra?.(2);
    expect(extra?.inputs).toEqual(['-i', '{tmp}/captions.srt']);
    expect(extra?.args.slice(0, 4)).toEqual(['-map', '2:s', '-c:s', 'mov_text']);
  });

  it('sound only, image sequences, and the built-in encoder for plain H.264', () => {
    const p = project();
    const wav = planDelivery(p, req(p, { preset: preset('wav'), out: '/films/Gala.wav' }));
    expect(wav.engine).toBe('none');
    expect(wav.settings.sound).toBe('wav');
    expect(wav.settings.finish?.audio).toEqual(['-c:a', 'pcm_s24le']);
    const png = planDelivery(p, req(p, { preset: preset('png'), out: '/films/Gala.png' }));
    expect(png.settings.out).toBe('/films/Gala_%05d.png');
    expect(png.settings.pictureOnly).toBe(true);
    expect(png.settings.pipe?.alpha).toBe(true);
    const web = planDelivery(p, req(p, { preset: preset('yt1080'), encoders: ['libx264'] }));
    expect(web.engine).toBe('webcodecs');
    expect(web.settings.mbps).toBe(12);
    // With NVENC there, FFmpeg encodes on the graphics card.
    expect(planDelivery(p, req(p, { preset: preset('yt1080'), encoders: ['libx264', 'h264_nvenc'] })).engine).toBe('ffmpeg');
    expect(() => planDelivery(p, req(p, { encoders: ['libx264'], preset: preset('yt1080hevc') }))).toThrow(/can't make HEVC/);
    expect(() => planDelivery(p, req(p, { app: false, preset: preset('prores-hq') }))).toThrow(/in the Lumora Studio program/);
  });

  it('guesses the file size', () => {
    const s = current(project());
    expect(Math.round(estimateMb(preset('yt1080'), s, 60))).toBe(92);
    expect(estimateMb(preset('master-4444'), s, 60)).toBeGreaterThan(1500);
    expect(Math.round(estimateMb(preset('wav'), s, 60))).toBe(17);
  });
});
