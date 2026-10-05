// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makePlan } from './plan';
import { NEUTRAL, type Project } from './project';

// Makes a real film with FFmpeg (slow): LUMORA_FFMPEG_TEST=1 npx vitest run plan.ffmpeg
const run = process.env.LUMORA_FFMPEG_TEST === '1';

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { stdio: 'pipe' });
const duration = (file: string) => {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString();
  return Number(out.trim());
};

describe.skipIf(!run)('a real export', () => {
  it('makes the film from cameras that started at different times, with a dissolve and a title', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumora-edit-'));
    const f = (n: string) => join(dir, n);
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=20', '-c:v', 'libx264', '-preset', 'ultrafast', f('wide.mp4')]);
    ff(['-f', 'lavfi', '-i', 'smptebars=s=1920x1080:r=25:d=12', '-c:v', 'libvpx', '-deadline', 'realtime', f('close.webm')]);
    ff(['-f', 'lavfi', '-i', 'sine=f=660:d=20', '-c:a', 'libopus', f('mic.webm')]);
    const p: Project = {
      kind: 'lumora-edit',
      version: 1,
      name: 'Test',
      eventPath: f('Test.lumora'),
      startedAt: 0,
      durationMs: 20_000,
      angles: [
        {
          id: 'a',
          name: 'Wide',
          path: f('wide.mp4'),
          startMs: 0,
          durationMs: 20_000,
          offsetMs: 0,
          live: false,
          color: '',
          look: { ...NEUTRAL },
          width: 1280,
          height: 720,
        },
        {
          id: 'b',
          name: 'Close',
          path: f('close.webm'),
          startMs: 3000,
          durationMs: 12_000,
          offsetMs: 0,
          live: false,
          color: '',
          look: { ...NEUTRAL, warmth: 40, contrast: 20 },
          width: 1920,
          height: 1080,
        },
      ],
      tracks: [
        { id: 'm', name: 'Mic', path: f('mic.webm'), startMs: 1000, durationMs: 20_000, offsetMs: 0, gainDb: -3, muted: false, solo: false, live: false },
      ],
      clips: [
        { id: '1', angle: 'b', in: 1000, out: 5000, fade: 0 },
        { id: '2', angle: 'a', in: 5000, out: 9000, fade: 1000 },
        { id: '3', angle: 'b', in: 12_000, out: 18_000, fade: 0 },
      ],
      titles: [{ id: 't', at: 6000, length: 3000, text: 'Dana', sub: 'Host', style: 'lower' }],
      range: null,
    };
    const plan = makePlan(p, { width: 1280, height: 720, fps: 30, crf: 23, preset: 'veryfast', loudness: true, audio: null, rangeOnly: false });
    ff([
      '-filter_complex',
      'color=c=black@0.0:s=1280x720,format=rgba[bg];color=c=red:s=500x100,format=rgba[b];[bg][b]overlay=40:560',
      '-frames:v',
      '1',
      f('title-t.png'),
    ]);
    const fill = (a: string) => a.replaceAll('{tmp}', dir).replaceAll('{out}', f('film.mp4'));
    for (const job of plan.jobs) ff(job.args.map(fill));
    writeFileSync(f('list.txt'), plan.list);
    ff(plan.final.args.map(fill));
    expect(existsSync(f('film.mp4'))).toBe(true);
    if (process.env.LUMORA_KEEP) console.log('film:', f('film.mp4'));
    // 4 + 4 + 6 seconds of film.
    expect(duration(f('film.mp4'))).toBeCloseTo(14, 0);
    const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', f('film.mp4')]).toString();
    expect(streams).toContain('h264,1280,720');
    expect(streams).toContain('aac');
  }, 120_000);
});
