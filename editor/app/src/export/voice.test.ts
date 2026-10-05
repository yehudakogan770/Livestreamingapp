// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addMedia } from '../model/build';
import { updateClips, updateTrack } from '../model/edit';
import { newEffect } from '../model/effects';
import { current } from '../model/seq';
import { emptyProject, type MediaItem, type Project } from '../model/types';
import { audioParts, duckFilter, effectChain, effectFilters, finishJobs, humFrequencies } from './audioplan';

const media = (id: string, path: string): MediaItem => ({
  id,
  name: id,
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
});

/** Speech on A1 and music on A2, both 10 seconds from the start. */
function talkAndMusic(voice = '/voice.wav', music = '/music.wav'): Project {
  const p = { ...emptyProject('Mix'), media: [media('v', voice), media('m', music)] };
  const [a1, a2] = current(p).tracks.filter((t) => t.kind === 'audio');
  let q = addMedia(p, 'v', 0, 'overwrite', undefined, a1?.id, { in: 0, out: 10 });
  q = addMedia(q, 'm', 0, 'overwrite', undefined, a2?.id, { in: 0, out: 10 });
  q = updateTrack(q, a1?.id ?? '', { role: 'dialogue' });
  return updateTrack(q, a2?.id ?? '', { role: 'music' });
}

const onTrackN = (p: Project, n: number) => {
  const s = current(p);
  const t = s.tracks.filter((x) => x.kind === 'audio')[n];
  return s.clips.find((c) => c.track === t?.id)?.id ?? '';
};

describe('voice cleanup on export', () => {
  it('reduce noise is a low cut and FFmpeg noise reduction', () => {
    const f = effectFilters({ type: 'denoise', p: { amount: 50, floor: -45 } }, 'x');
    expect(f.filters).toEqual(['highpass=f=80', 'afftdn@x=nr=20:nf=-45']);
  });

  it('remove hum cuts the mains frequency and its harmonics', () => {
    expect(humFrequencies({ mains: 1, harmonics: 3 })).toEqual([60, 120, 180]);
    expect(humFrequencies({ mains: 0, harmonics: 2 })).toEqual([50, 100]);
    const f = effectFilters({ type: 'dehum', p: { mains: 0, harmonics: 2, depth: 30, q: 20 } }, 'h');
    expect(f.filters).toEqual(['equalizer@hh0=f=50:t=q:w=20:g=-30', 'equalizer@hh1=f=100:t=q:w=20:g=-30']);
  });

  it('voice isolation is a chain (no speech model is bundled)', () => {
    const f = effectFilters({ type: 'voiceiso', p: { amount: 100 } }, 'v').filters.join(',');
    expect(f).toContain('highpass=f=100');
    expect(f).toContain('afftdn=nr=30:nf=-40:tn=1');
    expect(f).toContain('acompressor=');
    expect(f).not.toContain('arnndn');
  });

  it('loudness normalize is EBU R128 loudnorm, back at 48 kHz', () => {
    expect(effectFilters({ type: 'loudnorm', p: { target: -23, peak: -2 } }, 'l').filters).toEqual(['loudnorm=I=-23:TP=-2:LRA=11', 'aresample=48000']);
  });

  it('de-ess uses FFmpeg’s de-esser', () => {
    expect(effectFilters({ type: 'deess', p: { amount: 40, freq: 6000 } }, 'd').filters).toEqual(['deesser=i=0.4:f=0.25']);
  });

  it('keyframed noise reduction follows the keyframes while it plays', () => {
    let p = talkAndMusic();
    const id = onTrackN(p, 0);
    const e = newEffect('denoise');
    e.p.amount = {
      k: [
        { t: 0, v: 0, e: 'linear' },
        { t: 30, v: 100, e: 'linear' },
      ],
    };
    p = updateClips(p, [id], (c) => ({ ...c, effects: [e] }));
    const part = audioParts(p, current(p), 0, 300).find((x) => x.path === '/voice.wav');
    expect(part?.effects[0]?.over?.length).toBeGreaterThan(3);
    const chain = effectChain(part?.effects ?? [], 0);
    expect(chain[0]).toMatch(/^asendcmd=c='0\.1 afftdn@p0e0 nr [\d.]+,afftdn@p0e0 nf -50;/);
    expect(chain.slice(1)).toEqual(['highpass=f=80', 'afftdn@p0e0=nr=1:nf=-50']);
  });

  it('music ducks under speech with a sidechain compressor', () => {
    const p = talkAndMusic();
    const parts = audioParts(p, current(p), 0, 300);
    expect(parts.find((x) => x.path === '/voice.wav')?.duck).toBeNull();
    expect(parts.find((x) => x.path === '/music.wav')?.duck).toEqual({ threshold: -32, ratio: 8, attack: 30, release: 500 });
    const jobs = finishJobs(p, current(p), { from: 0, to: 300 }, null, 'wav', false);
    // First the speech alone (what the ducking listens to), then everything.
    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.args.at(-1)).toBe('{tmp}/speech.wav');
    expect(jobs[0]?.args).not.toContain('/music.wav');
    const last = jobs[1]?.args ?? [];
    expect(last).toContain('{tmp}/speech.wav');
    const graph = last[last.indexOf('-filter_complex') + 1] ?? '';
    expect(graph).toContain(`[d1][k0]${duckFilter({ threshold: -32, ratio: 8, attack: 30, release: 500 })}[p1]`);
    expect(graph).toContain('[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[k0]');
    expect(duckFilter({ threshold: -20, ratio: 4, attack: 20, release: 300 })).toBe('sidechaincompress=threshold=0.1:ratio=4:attack=20:release=300');
  });

  it('a Duck effect ducks a clip on any track, with its own settings', () => {
    let p = talkAndMusic();
    const music = onTrackN(p, 1);
    const s = current(p);
    p = updateTrack(p, s.tracks.filter((t) => t.kind === 'audio')[1]?.id ?? '', { role: undefined });
    expect(audioParts(p, current(p), 0, 300).every((x) => x.duck === null)).toBe(true);
    const d = newEffect('duck');
    d.p.ratio = 4;
    p = updateClips(p, [music], (c) => ({ ...c, effects: [d] }));
    expect(audioParts(p, current(p), 0, 300).find((x) => x.path === '/music.wav')?.duck?.ratio).toBe(4);
  });

  it('nothing ducks without a speech track', () => {
    let p = talkAndMusic();
    p = updateTrack(p, current(p).tracks.filter((t) => t.kind === 'audio')[0]?.id ?? '', { role: undefined });
    const jobs = finishJobs(p, current(p), { from: 0, to: 300 }, null, 'wav', false);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.args.join(' ')).not.toContain('sidechaincompress');
  });
});

const run = process.env.LUMORA_FFMPEG_TEST === '1';
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { stdio: 'pipe' });
const probe = (file: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());

describe.skipIf(!run)('real voice cleanup', () => {
  it('runs every cleanup effect, keyframes and ducking through FFmpeg', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumora-edit-v-'));
    const voice = join(dir, 'voice.wav');
    const music = join(dir, 'music.wav');
    ff(['-f', 'lavfi', '-i', 'sine=f=300:d=20', '-f', 'lavfi', '-i', 'anoisesrc=d=20:a=0.05', '-filter_complex', 'amix=inputs=2', voice]);
    ff(['-f', 'lavfi', '-i', 'sine=f=60:d=20', music]);
    let p = talkAndMusic(voice, music);
    const dn = newEffect('denoise');
    dn.p.amount = {
      k: [
        { t: 0, v: 10, e: 'linear' },
        { t: 90, v: 90, e: 'linear' },
      ],
    };
    const hum = newEffect('dehum');
    hum.p.depth = {
      k: [
        { t: 0, v: 0, e: 'linear' },
        { t: 60, v: 30, e: 'linear' },
      ],
    };
    p = updateClips(p, [onTrackN(p, 0)], (c) => ({ ...c, effects: [dn, newEffect('voiceiso'), newEffect('deess'), newEffect('loudnorm')] }));
    p = updateClips(p, [onTrackN(p, 1)], (c) => ({ ...c, effects: [hum] }));
    const jobs = finishJobs(p, current(p), { from: 0, to: 300 }, null, 'wav', true);
    const out = join(dir, 'out.wav');
    for (const j of jobs) ff(j.args.map((x) => x.replace('{tmp}', dir).replace('{out}', out)));
    expect(Math.abs(probe(out) - 10)).toBeLessThan(0.05);
  }, 120_000);
});
