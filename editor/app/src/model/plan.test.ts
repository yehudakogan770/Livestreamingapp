import { describe, expect, it } from 'vitest';
import { lookMatrix, ffmpegLook, svgMatrix } from './color';
import { makePlan, pieces, type ExportOptions } from './plan';
import { NEUTRAL, type Project } from './project';

const project = (): Project => ({
  kind: 'lumora-edit',
  version: 1,
  name: 'Gala',
  eventPath: 'C:/rec/Gala.lumora',
  startedAt: 0,
  durationMs: 30_000,
  angles: [
    {
      id: 'a',
      name: 'Wide',
      path: 'C:/a.mp4',
      startMs: 0,
      durationMs: 30_000,
      offsetMs: 0,
      live: false,
      color: '#000',
      look: { ...NEUTRAL },
      width: 1920,
      height: 1080,
    },
    {
      id: 'b',
      name: 'Close',
      path: 'C:/b.mp4',
      startMs: 2000,
      durationMs: 20_000,
      offsetMs: 0,
      live: false,
      color: '#000',
      look: { ...NEUTRAL, warmth: 50 },
      width: 1920,
      height: 1080,
    },
  ],
  tracks: [{ id: 'm', name: 'Mic', path: 'C:/m.webm', startMs: 0, durationMs: 30_000, offsetMs: 0, gainDb: 3, muted: false, solo: false, live: false }],
  clips: [
    { id: '1', angle: 'a', in: 0, out: 10_000, fade: 0 },
    { id: '2', angle: 'b', in: 10_000, out: 20_000, fade: 1000 },
    { id: '3', angle: 'a', in: 25_000, out: 30_000, fade: 0 },
  ],
  titles: [{ id: 't', at: 11_000, length: 3000, text: 'Dana', sub: 'Host', style: 'lower' }],
  range: { from: 9800, to: 12_000 },
});

const options: ExportOptions = { width: 1920, height: 1080, fps: 30, crf: 20, preset: 'veryfast', loudness: true, audio: null, rangeOnly: false };

describe('the film as parts', () => {
  it('puts a dissolve across the cut and keeps the length', () => {
    const list = pieces(project(), 30, null);
    expect(list.map((x) => [Math.round(x.at), Math.round(x.length), x.a.angle, x.b?.angle ?? null])).toEqual([
      [0, 9500, 'a', null],
      [9500, 1000, 'a', 'b'],
      [10_500, 9500, 'b', null],
      [20_000, 5000, 'a', null],
    ]);
    expect(list[1]?.a.from).toBeCloseTo(9500, 0);
    expect(list[1]?.b?.from).toBeCloseTo(9500, 0);
    expect(list[3]?.a.from).toBe(25_000);
    expect(list.reduce((s, x) => s + x.length, 0)).toBeCloseTo(25_000, 0);
  });

  it('cuts to the marked part, even through a dissolve', () => {
    const list = pieces(project(), 30, { from: 9800, to: 12_000 });
    expect(list.map((x) => [Math.round(x.at), Math.round(x.length), Math.round(x.skip)])).toEqual([
      [9800, 700, 300],
      [10_500, 1500, 0],
    ]);
    expect(list[1]?.a.from).toBeCloseTo(10_500, 0);
  });
});

describe('the FFmpeg plan', () => {
  it('makes each part with the right camera, color, sound and titles', () => {
    const plan = makePlan(project(), options);
    expect(plan.jobs).toHaveLength(4);
    expect(plan.titles).toEqual(['t']);
    const dissolve = plan.jobs[1]!.args;
    const graph = dissolve[dissolve.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('xfade=transition=fade:duration=1.000');
    expect(graph).toContain('acrossfade=d=1.000');
    expect(graph).toContain('colorchannelmixer');
    expect(graph).toContain('volume=3.0dB');
    expect(plan.jobs[2]!.args).toContain('{tmp}/title-t.png');
    // Camera b starts 2 s into the event, so 9.5 s is 7.5 s into its file.
    expect(dissolve.slice(dissolve.indexOf('C:/b.mp4') - 5, dissolve.indexOf('C:/b.mp4'))).toEqual(['-ss', '7.500', '-t', '1.500', '-i']);
    expect(plan.final.args).toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
    expect(plan.list.split('\n')[0]).toBe("file 'part-0001.mkv'");
  });

  it('shows black where a camera was not recording', () => {
    const p = project();
    p.clips = [{ id: '1', angle: 'b', in: 0, out: 3000, fade: 0 }];
    const args = makePlan(p, options).jobs[0]!.args;
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('tpad=start_duration=2.000');
    p.clips = [{ id: '1', angle: 'b', in: 25_000, out: 28_000, fade: 0 }];
    const none = makePlan(p, options).jobs[0]!.args;
    expect(none.join(' ')).toContain('color=c=black:s=1920x1080');
    expect(none).not.toContain('C:/b.mp4');
  });

  it('can make sound only', () => {
    const plan = makePlan(project(), { ...options, audio: 'mp3', loudness: false });
    expect(plan.jobs[0]!.args).not.toContain('libx264');
    expect(plan.final.args).toContain('libmp3lame');
    expect(plan.final.args).toContain('-vn');
  });
});

describe('color', () => {
  it('as recorded changes nothing', () => {
    const { m, offset } = lookMatrix(NEUTRAL);
    m.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 6)));
    offset.forEach((v) => expect(v).toBeCloseTo(0, 6));
    expect(ffmpegLook(NEUTRAL)).toBe('');
    expect(svgMatrix(NEUTRAL)).toBe('1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0');
  });

  it('no color leaves only grey', () => {
    const { m } = lookMatrix({ ...NEUTRAL, saturation: -100 });
    expect(m[0]).toEqual(m[1]);
    expect(m[1]).toEqual(m[2]);
  });
});
