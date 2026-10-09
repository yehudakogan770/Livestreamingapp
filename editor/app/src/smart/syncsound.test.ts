import { describe, expect, it } from 'vitest';
import { current } from '../model/seq';
import { emptyProject, type MediaItem } from '../model/types';
import { groupsIn, micSources } from './autocam';
import { buildMulticam, correlate, defaultSound, findOffset, offsetsFrom, recordedAt, SURE, timecodeSeconds } from './syncsound';

/** A room's sound: bursts (words, claps) at random moments, as 100-a-second waveform peaks. */
function room(seconds: number, seed: number): Float32Array {
  let x = seed;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const n = seconds * 100;
  const amp = new Float32Array(n);
  for (let i = 0; i < n; i++) amp[i] = 0.01 + rnd() * 0.01;
  for (let t = 0; t < n; ) {
    const len = 5 + Math.floor(rnd() * 40);
    const level = 0.1 + rnd() * 0.8;
    for (let k = 0; k < len && t + k < n; k++) amp[t + k] = level * (1 - k / (len * 1.5));
    t += len + Math.floor(rnd() * 60);
  }
  return amp;
}

/** What one microphone heard of the room from `from` seconds, for `seconds`, at its own level, with its own hiss. */
function mic(roomAmp: Float32Array, from: number, seconds: number, gain: number, seed: number): Uint8Array {
  let x = seed;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = new Uint8Array(seconds * 100);
  for (let i = 0; i < out.length; i++) {
    const t = Math.round(from * 100) + i;
    const a = t >= 0 && t < roomAmp.length ? (roomAmp[t] as number) : 0;
    const v = Math.min(1, a * gain + rnd() * 0.02);
    out[i] = Math.round(Math.sqrt(v) * 255);
  }
  return out;
}

const media = (id: string, kind: MediaItem['kind'], duration: number, video: boolean, audio: boolean, w = 1920, h = 1080): MediaItem => ({
  id,
  name: `${id}.mp4`,
  path: `/x/${id}.mp4`,
  proxy: null,
  kind,
  duration,
  width: w,
  height: h,
  fps: 29.97,
  hasVideo: video,
  hasAudio: audio,
  bin: null,
});

describe('lining files up by their sound', () => {
  it('correlation finds a known shift in both directions', () => {
    const a = new Float32Array(64);
    a[10] = 1;
    a[30] = 1;
    const b = new Float32Array(40);
    b[3] = 1;
    b[23] = 1;
    const { lags, scores } = correlate(a, b);
    let best = 0;
    for (let i = 0; i < scores.length; i++) if ((scores[i] as number) > (scores[best] as number)) best = i;
    expect(lags[best]).toBe(7);
    const back = correlate(b, a);
    let best2 = 0;
    for (let i = 0; i < back.scores.length; i++) if ((back.scores[i] as number) > (back.scores[best2] as number)) best2 = i;
    expect(back.lags[best2]).toBe(-7);
  });

  it('a camera that started 12.34 seconds later, quieter and hissier, lines up within a frame', () => {
    const r = room(240, 7);
    const ref = mic(r, 0, 200, 1, 1);
    const late = mic(r, 12.34, 150, 0.4, 2);
    const o = findOffset(ref, late);
    expect(Math.abs(o.seconds - 12.34)).toBeLessThan(1 / 30);
    expect(o.confidence).toBeGreaterThan(SURE);
  });

  it('a recorder that started before the camera gets a negative offset', () => {
    const r = room(300, 11);
    const cam = mic(r, 40, 120, 0.7, 3);
    const recorder = mic(r, 0, 280, 1.2, 4);
    const o = findOffset(cam, recorder);
    expect(Math.abs(o.seconds + 40)).toBeLessThan(1 / 30);
  });

  it('two unrelated recordings are not sure', () => {
    const o = findOffset(mic(room(120, 5), 0, 120, 1, 1), mic(room(120, 99), 0, 120, 1, 2));
    expect(o.confidence).toBeLessThan(SURE);
  });
});

describe('the multicam group and its sequence', () => {
  const camA = media('camA', 'video', 600, true, true, 3840, 2160);
  const camB = media('camB', 'video', 500, true, true);
  const rec = media('rec', 'audio', 700, false, true);

  it('sound recorders are the sound unless chosen; otherwise the first camera', () => {
    expect(defaultSound([camA, camB, rec])).toEqual(['rec']);
    expect(defaultSound([camA, camB])).toEqual(['camA']);
  });

  it('places every camera at its offset, the earliest file at 0, the sound linked on its own track', () => {
    const p = { ...emptyProject('t'), media: [camA, camB, rec] };
    const out = buildMulticam(p, {
      name: 'Concert',
      files: [
        { media: camA, offset: 0 },
        { media: camB, offset: 20 },
        { media: rec, offset: -5 },
      ],
      sound: ['rec'],
    });
    const g = out.project.groups.find((x) => x.id === out.group);
    expect(g?.angles.map((a) => [a.name, a.offset])).toEqual([
      ['camA', 5],
      ['camB', 25],
    ]);
    expect(g?.duration).toBe(700);
    const s = current(out.project);
    expect(s.id).toBe(out.sequence);
    // The biggest camera sets the sequence: 4K at 29.97.
    expect([s.width, s.height, s.fps]).toEqual([3840, 2160, 29.97]);
    const v = s.clips.find((c) => c.source.kind === 'multicam');
    const a = s.clips.find((c) => c.source.kind === 'media');
    expect(v?.length).toBe(Math.round(700 * 29.97));
    expect(a?.start).toBe(0);
    expect(a?.link).toBe(v?.link);
    // The tools that need a group in the sequence find it, with the recorder as a microphone.
    expect(groupsIn(out.project, s).map((x) => x.id)).toEqual([out.group]);
    const mics = micSources(out.project, s, g!);
    expect(mics[0]?.media.id).toBe('rec');
    expect(mics[0]?.offset).toBeCloseTo(0, 5);
  });

  it('needs a camera', () => {
    expect(() => buildMulticam(emptyProject('t'), { name: 'x', files: [{ media: rec, offset: 0 }], sound: ['rec'] })).toThrow(/camera/);
  });
});

describe('lining files up by timecode and recording time', () => {
  it('reads timecode, including drop-frame', () => {
    expect(timecodeSeconds('01:00:10:12', 25)).toBeCloseTo(3610.48, 6);
    // Non-drop 29.97: the numbers run at 30 a second, the clock a little slower.
    expect(timecodeSeconds('00:01:00:00', 29.97)).toBeCloseTo((1800 * 1001) / 30000, 6);
    // Drop-frame: the first frame of minute 1 is frame 1800; ten minutes of numbers are ten real minutes.
    expect(timecodeSeconds('00:01:00;02', 29.97)).toBeCloseTo(60.06, 2);
    expect(timecodeSeconds('00:10:00;00', 29.97)).toBeCloseTo(600, 1);
    expect(timecodeSeconds('nonsense', 25)).toBeNull();
    expect(timecodeSeconds('00:00:00:30', 25)).toBeNull();
  });

  it('gives offsets from the earliest, only when every file says', () => {
    expect(recordedAt('2026-05-01T18:03:22.000000Z')).toBe(Date.UTC(2026, 4, 1, 18, 3, 22) / 1000);
    expect(recordedAt('1970-01-01T00:00:00Z')).toBeNull();
    const a = { ...media('a', 'video', 10, true, true), source: { timecode: '10:00:05:00' } } as MediaItem;
    const b = { ...media('b', 'video', 10, true, true), source: { timecode: '10:00:00:00' } } as MediaItem;
    const tc = (m: MediaItem) => (m.source?.timecode ? timecodeSeconds(m.source.timecode, 25) : null);
    expect([...(offsetsFrom([a, b], tc) ?? new Map())]).toEqual([
      ['a', 5],
      ['b', 0],
    ]);
    expect(offsetsFrom([a, media('c', 'audio', 10, false, true)], tc)).toBeNull();
  });
});
