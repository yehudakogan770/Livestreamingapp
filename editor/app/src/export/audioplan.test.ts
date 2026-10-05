// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addMedia } from '../model/build';
import { razor, setTransition, updateClips } from '../model/edit';
import { current, onTrack } from '../model/seq';
import { emptyProject, type MediaItem, type Project } from '../model/types';
import { newEffect } from '../model/effects';
import { audioParts, envelopeExpr, finishJobs } from './audioplan';

function project(path = '/a.webm'): Project {
  const p = emptyProject('Sound');
  const m: MediaItem = {
    id: 'm',
    name: 'Tone',
    path,
    proxy: null,
    kind: 'audio',
    duration: 20,
    width: 0,
    height: 0,
    fps: 30,
    hasVideo: false,
    hasAudio: true,
    bin: null,
  };
  return addMedia({ ...p, media: [m] }, 'm', 0, 'overwrite', undefined, undefined, { in: 0, out: 10 });
}

describe('the sound plan', () => {
  it('pieces of the same file that follow on become one', () => {
    const p = razor(razor(project(), 100), 200);
    const s = current(p);
    expect(s.clips).toHaveLength(3);
    const parts = audioParts(p, s, 0, 300);
    expect(parts).toHaveLength(1);
    expect([parts[0]?.from, parts[0]?.to]).toEqual([0, 300]);
  });

  it('a crossfade keeps both sides, overlapping', () => {
    let p = razor(project(), 150);
    const s = current(p);
    const second = onTrack(s, s.tracks.find((t) => t.kind === 'audio')?.id ?? '')[1] as { id: string };
    p = setTransition(p, second.id, 'in', { type: 'crossfade', length: 30 });
    const parts = audioParts(p, current(p), 0, 300);
    expect(parts.map((x) => [x.from, x.to])).toEqual([
      [0, 165],
      [135, 300],
    ]);
    expect(parts[0]?.envelope.at(-1)?.[1]).toBeLessThan(0.2);
  });

  it('volume lines become an expression', () => {
    expect(envelopeExpr([[0, 1]])).toBe('1');
    expect(
      envelopeExpr([
        [0, 0],
        [1, 1],
      ]),
    ).toBe('if(lt(t,0),0,if(lt(t,1),0+1*(t-0),1))');
  });
});

const run = process.env.LUMORA_FFMPEG_TEST === '1';
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { stdio: 'pipe' });
const probe = (file: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());

describe.skipIf(!run)('real sound', () => {
  it('makes the sound with fades, effects, speed and many pieces', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumora-edit-a-'));
    const tone = join(dir, 'tone.webm');
    ff(['-f', 'lavfi', '-i', 'sine=f=440:d=20', '-c:a', 'libopus', tone]);
    let p = razor(project(tone), 150);
    const s = current(p);
    const [a, b] = onTrack(s, s.tracks.find((t) => t.kind === 'audio')?.id ?? '') as unknown as [{ id: string }, { id: string }];
    p = setTransition(p, b.id, 'in', { type: 'crossfade', length: 30 });
    p = updateClips(p, [a.id], (c) => ({
      ...c,
      gain: {
        k: [
          { t: 0, v: -30, e: 'linear' },
          { t: 60, v: 0, e: 'linear' },
        ],
      },
      effects: [newEffect('eq'), newEffect('compressor'), newEffect('denoise')],
    }));
    p = updateClips(p, [b.id], (c) => ({ ...c, speed: 1.5, reverse: true }));
    // Lots of pieces (grouped mixing).
    for (let f = 160; f < 290; f += 1) p = razor(p, f);
    const t0 = Date.now();
    const jobs = finishJobs(p, current(p), { from: 0, to: 300 }, null, 'wav', true);
    console.log('plan ms', Date.now() - t0, 'jobs', jobs.length);
    expect(jobs.length).toBeGreaterThan(1);
    const out = join(dir, 'out.wav');
    for (const j of jobs) ff(j.args.map((x) => x.replace('{tmp}', dir).replace('{out}', out)));
    expect(Math.abs(probe(out) - 10)).toBeLessThan(0.05);
  }, 120_000);
});
