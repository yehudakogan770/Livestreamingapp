import { describe, expect, test } from 'vitest';
import {
  BASE_TRANSITIONS,
  LENGTHS,
  MAX_DEVICES,
  defaultOptions,
  pictureInputs,
  planInputs,
  planShow,
  plannedSeconds,
  transitions,
  type TestEnv,
  type TestOptions,
} from './plan';

const env = (over: Partial<TestEnv> = {}): TestEnv => ({
  cameras: [{ deviceId: 'c1', label: 'Webcam' }],
  mics: [{ deviceId: 'm1', label: 'USB mic' }],
  ffmpeg: true,
  jewishTools: false,
  stingers: 0,
  captionsReady: false,
  vertical: false,
  ...over,
});
const opts = (over: Partial<TestOptions> = {}): TestOptions => ({ ...defaultOptions(env()), ...over });
const kinds = (o: TestOptions, e: TestEnv) => planInputs(o, e).inputs.map((i) => i.kind);

describe('which inputs the test adds', () => {
  test('every kind that runs offline, with the cameras and microphones found', () => {
    const k = kinds(opts(), env());
    for (const want of [
      'camera',
      'microphone',
      'pattern',
      'color',
      'video',
      'image',
      'slideshow',
      'name',
      'title',
      'scoreboard',
      'countdown',
      'visuals',
      'credits',
      'split',
      'lyrics',
    ])
      expect(k).toContain(want);
    expect(k).not.toContain('pesukim');
  });

  test('cameras are on by default only when some are found', () => {
    expect(defaultOptions(env()).devices).toBe(true);
    expect(defaultOptions(env({ cameras: [], mics: [] })).devices).toBe(false);
    expect(defaultOptions().outputs).toBe(true);
    expect(defaultOptions().realDestination).toBeNull();
  });

  test('no devices, or devices turned off: none added, and the report says why', () => {
    const none = planInputs(opts(), env({ cameras: [], mics: [] }));
    expect(none.inputs.some((i) => i.kind === 'camera' || i.kind === 'microphone')).toBe(false);
    expect(none.skipped.map((s) => s.what)).toEqual(['Cameras', 'Microphones']);
    const off = planInputs(opts({ devices: false }), env());
    expect(off.inputs.some((i) => i.kind === 'camera')).toBe(false);
    expect(off.skipped[0]!.why).toMatch(/chose/);
  });

  test('at most four cameras, each with its own device', () => {
    const cams = Array.from({ length: 6 }, (_, i) => ({ deviceId: `c${i}`, label: '' }));
    const p = planInputs(opts(), env({ cameras: cams }));
    const added = p.inputs.filter((i) => i.kind === 'camera');
    expect(added).toHaveLength(MAX_DEVICES);
    expect(added[1]).toMatchObject({ deviceId: 'c1', name: 'Camera 2', id: 'test-camera-2' });
    expect(p.skipped.some((s) => s.what === '2 more cameras')).toBe(true);
  });

  test('without FFmpeg there is no test media', () => {
    const p = planInputs(opts(), env({ ffmpeg: false }));
    expect(p.inputs.map((i) => i.kind)).not.toContain('video');
    expect(p.inputs.map((i) => i.kind)).not.toContain('slideshow');
    expect(p.skipped.some((s) => /FFmpeg/.test(s.why))).toBe(true);
  });

  test('12 Pesukim only with the Jewish event tools on', () => {
    expect(kinds(opts(), env({ jewishTools: true }))).toContain('pesukim');
  });

  test('picture inputs put cameras first and never sound', () => {
    const p = pictureInputs(planInputs(opts(), env()).inputs);
    expect(p[0]!.kind).toBe('camera');
    expect(p.some((i) => i.kind === 'microphone')).toBe(false);
  });

  test('ids are unique', () => {
    const ids = planInputs(
      opts(),
      env({
        jewishTools: true,
        cameras: [
          { deviceId: 'a', label: '' },
          { deviceId: 'b', label: '' },
        ],
      }),
    ).inputs.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the show the test runs', () => {
  test('every transition, and stingers only when set up', () => {
    expect(transitions(env())).toEqual(BASE_TRANSITIONS);
    expect(transitions(env({ stingers: 1 }))).toContain('stinger1');
    expect(transitions(env({ stingers: 1 }))).not.toContain('stinger2');
    expect(transitions(env({ stingers: 5 })).slice(-2)).toEqual(['stinger1', 'stinger2']);
  });

  test('outputs and the stream first, PANIC last; every part at least once', () => {
    const e = env({ captionsReady: true, jewishTools: true });
    const o = opts();
    const steps = planShow(o, e, planInputs(o, e).inputs).map((s) => s.kind);
    expect(steps[0]).toBe('outputs');
    expect(steps[1]).toBe('streamStart');
    expect(steps.at(-1)).toBe('panic');
    expect(steps.at(-2)).toBe('streamStop');
    for (const k of [
      'cuts',
      'transitions',
      'tbar',
      'names',
      'scoreboard',
      'countdown',
      'slideshow',
      'credits',
      'lyrics',
      'split',
      'visuals',
      'pesukim',
      'preset',
      'blank',
      'replay',
      'background',
      'autoframe',
      'captions',
    ])
      expect(steps).toContain(k);
  });

  test('no camera: no background removal or auto-framing; no stream when off', () => {
    const e = env({ cameras: [] });
    const o = opts({ stream: false, outputs: false });
    const steps = planShow(o, e, planInputs(o, e).inputs).map((s) => s.kind);
    expect(steps).not.toContain('background');
    expect(steps).not.toContain('autoframe');
    expect(steps).not.toContain('streamStart');
    expect(steps).not.toContain('outputs');
    expect(steps).not.toContain('captions');
  });

  test('the real destination test only with the stream test and a chosen destination', () => {
    const e = env();
    const withReal = planShow(opts({ realDestination: 'yt' }), e, planInputs(opts(), e).inputs).map((s) => s.kind);
    expect(withReal.indexOf('realDestination')).toBeLessThan(withReal.indexOf('streamStop'));
    const noStream = planShow(opts({ realDestination: 'yt', stream: false }), e, planInputs(opts(), e).inputs).map((s) => s.kind);
    expect(noStream).not.toContain('realDestination');
  });

  test('longer tests repeat the show to fill the time', () => {
    const e = env();
    for (const length of ['quick', 'standard', 'long'] as const) {
      const o = opts({ length });
      const steps = planShow(o, e, planInputs(o, e).inputs);
      const rounds = new Set(steps.map((s) => s.round)).size;
      const secs = plannedSeconds(steps);
      if (length === 'quick') expect(rounds).toBeLessThanOrEqual(2);
      else {
        expect(rounds).toBeGreaterThan(2);
        expect(secs).toBeGreaterThanOrEqual(LENGTHS[length].minutes * 60 * 0.95);
        expect(secs).toBeLessThanOrEqual(LENGTHS[length].minutes * 60 * 1.05);
      }
    }
  });
});
