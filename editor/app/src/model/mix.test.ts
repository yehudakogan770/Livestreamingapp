// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { finishJobs } from '../export/audioplan';
import { addMedia } from './build';
import { updateTrack } from './edit';
import {
  activeFx,
  addBus,
  busOf,
  compressorGainReduction,
  eqResponse,
  MASTER,
  mixOf,
  removeBus,
  routeTrack,
  setFxParam,
  setMixVolume,
  staged,
  stripFx,
  toggleFx,
} from './mix';
import { current } from './seq';
import { emptyProject, type MediaItem, type Project } from './types';

function project(path = '/tone.wav'): Project {
  const m: MediaItem = {
    id: 'm',
    name: 'Tone',
    path,
    proxy: null,
    kind: 'audio',
    duration: 5,
    width: 0,
    height: 0,
    fps: 30,
    hasVideo: false,
    hasAudio: true,
    bin: null,
  };
  return addMedia({ ...emptyProject('Mix'), media: [m] }, 'm', 0, 'overwrite', undefined, undefined, { in: 0, out: 5 });
}
const audioTrack = (p: Project, i = 0) => current(p).tracks.filter((t) => t.kind === 'audio')[i]!.id;

describe('the mix model', () => {
  it('tracks go straight into the mix until something is set', () => {
    const p = project();
    expect(staged(current(p))).toBe(false);
    const a = audioTrack(p);
    const withEq = toggleFx(p, a, 'eq', true);
    expect(staged(current(withEq))).toBe(true);
    // Switched off again: nothing is processed, so the plain mix is used.
    expect(staged(current(toggleFx(withEq, a, 'eq', false)))).toBe(false);
    expect(staged(current(setMixVolume(p, -3)))).toBe(true);
  });

  it('buses: add, route, rename, remove (their tracks go back to the mix)', () => {
    const p0 = project();
    const a = audioTrack(p0);
    const { project: p1, id } = addBus(p0);
    expect(mixOf(current(p1)).buses.map((b) => b.name)).toEqual(['Bus 1']);
    const p2 = routeTrack(p1, a, id);
    const t = current(p2).tracks.find((x) => x.id === a)!;
    expect(busOf(current(p2), t)?.id).toBe(id);
    const p3 = removeBus(p2, id);
    expect(current(p3).tracks.find((x) => x.id === a)?.bus).toBeNull();
    expect(mixOf(current(p3)).buses).toHaveLength(0);
  });

  it('settings make the effect, and strips keep their own', () => {
    const p0 = project();
    const a = audioTrack(p0);
    const p1 = setFxParam(p0, a, 'compressor', 'threshold', -30);
    expect(stripFx(current(p1), a).map((e) => [e.type, e.p.threshold])).toEqual([['compressor', -30]]);
    const p2 = setFxParam(p1, MASTER, 'limiter', 'ceiling', -2);
    expect(stripFx(current(p2), MASTER).map((e) => e.type)).toEqual(['limiter']);
    expect(stripFx(current(p2), a)).toHaveLength(1);
    // Applied in a fixed order whatever order they were added in.
    const p3 = toggleFx(p2, a, 'eq', true);
    expect(activeFx(stripFx(current(p3), a)).map((e) => e.type)).toEqual(['eq', 'compressor']);
  });

  it('the curves follow the settings', () => {
    const low = stripFx(current(setFxParam(project(), MASTER, 'eq', 'low', 6)), MASTER)[0];
    expect(eqResponse(low, 1000)).toBeCloseTo(0, 0);
    expect(eqResponse(low, 40)).toBeGreaterThan(4);
    expect(eqResponse(low, 100)).toBeCloseTo(3, 0);
    const cut = stripFx(current(setFxParam(project(), MASTER, 'eq', 'lowCut', 100)), MASTER)[0];
    expect(eqResponse(cut, 20)).toBeLessThan(-20);
    expect(eqResponse(cut, 1000)).toBeCloseTo(0, 0);
    const comp = stripFx(current(setFxParam(project(), MASTER, 'compressor', 'ratio', 4)), MASTER)[0];
    expect(compressorGainReduction(comp, -30)).toBe(0);
    expect(compressorGainReduction(comp, 0)).toBeCloseTo(15, 5);
  });
});

describe('the film is mixed through the stages', () => {
  it('pieces go into their track, tracks into their bus, buses into the mix', () => {
    let p = project('/tone.wav');
    const a = audioTrack(p);
    const made = addBus(p, 'Dialogue');
    p = routeTrack(made.project, a, made.id);
    p = setFxParam(p, a, 'eq', 'high', 3);
    p = setFxParam(p, made.id, 'compressor', 'threshold', -24);
    p = setFxParam(p, MASTER, 'limiter', 'ceiling', -1);
    p = updateTrack(p, a, { volume: -6 });
    const jobs = finishJobs(p, current(p), { from: 0, to: 150 }, null, 'wav', false);
    const graph = jobs.at(-1)!.args[jobs.at(-1)!.args.indexOf('-filter_complex') + 1]!;
    // The track's fader is after its processing, not in the piece's volume line.
    expect(graph).toMatch(/volume='1\*1':eval=frame/);
    expect(graph).toMatch(/treble=g=3.*volume=0\.50119/);
    expect(graph).toMatch(/\[tr0\]anull,acompressor=threshold=0\.0631:/);
    expect(graph).toMatch(/alimiter=limit=0\.89125.*\[aout\]$/);
  });

  it('without any setting the graph is the plain one', () => {
    const p = project();
    const jobs = finishJobs(p, current(p), { from: 0, to: 150 }, null, 'wav', false);
    expect(jobs.at(-1)!.args.join(' ')).not.toMatch(/\[tr0\]/);
  });
});

const run = process.env.LUMORA_FFMPEG_TEST === '1';
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { stdio: 'pipe' });

describe.skipIf(!run)('real sound through the stages', () => {
  it('a bus limiter and the mix level set the film level', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumora-mix-'));
    const tone = join(dir, 'tone.wav');
    ff(['-f', 'lavfi', '-i', 'sine=f=440:d=5,volume=7.5', '-c:a', 'pcm_s16le', tone]);
    let p = project(tone);
    const a = audioTrack(p);
    const made = addBus(p, 'Music');
    p = routeTrack(made.project, a, made.id);
    p = setFxParam(p, made.id, 'limiter', 'ceiling', -12);
    p = setMixVolume(p, -6);
    const out = join(dir, 'out.wav');
    for (const j of finishJobs(p, current(p), { from: 0, to: 150 }, null, 'wav', false)) ff(j.args.map((x) => x.replace('{tmp}', dir).replace('{out}', out)));
    // volumedetect reports on stderr.
    const report = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostdin -i "${out}" -af volumedetect -f null - 2>&1`]).toString();
    const max = Number(/max_volume: (-?[\d.]+) dB/.exec(report)?.[1]);
    expect(max).toBeGreaterThan(-19.5);
    expect(max).toBeLessThan(-16.5);
  }, 60_000);
});
