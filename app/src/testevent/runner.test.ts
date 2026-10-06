import { describe, expect, test, vi } from 'vitest';
import { defaultCaptureSettings, emptyShow, type CaptureStatus, type EngineClient } from '../engine/client';
import type { Show } from '../engine/types/Show';
import { defaultOptions, planInputs, type TestEnv } from './plan';
import { cannotStart, neededMBps, newSource, runTestEvent, type BroadcastApi, type RunnerDeps } from './runner';
import { inspect } from './outputProbe';

vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));

const env: TestEnv = {
  cameras: [{ deviceId: 'cam', label: 'Webcam' }],
  mics: [{ deviceId: 'mic', label: 'Mic' }],
  ffmpeg: true,
  jewishTools: true,
  stingers: 0,
  captionsReady: false,
  vertical: false,
};

const idle: CaptureStatus = { ffmpeg: true, recording: null, streaming: null, lastRecording: null, finishing: false, failure: null };
const running = { session: 1, startedAt: 0, path: null, destinations: [], bytes: 0, speed: 1 };

describe('before the test', () => {
  test('refuses while recording or streaming for real', () => {
    expect(cannotStart(idle)).toBeNull();
    expect(cannotStart({ ...idle, recording: running })).toMatch(/recording/);
    expect(cannotStart({ ...idle, streaming: running })).toMatch(/streaming/);
    expect(cannotStart({ ...idle, vertical: running })).toMatch(/streaming/);
  });

  test('what the recording needs from the drive', () => {
    expect(neededMBps({ videoKbps: 6000, audioKbps: 160, iso: false }, 3)).toBeCloseTo(0.77, 2);
    expect(neededMBps({ videoKbps: 6000, audioKbps: 160, iso: true }, 2)).toBeCloseTo(0.77 * 2.6, 1);
  });

  test('every planned input becomes a real input (media ones only with media)', () => {
    const { inputs } = planInputs(defaultOptions(env), env);
    const media = { video: '/t/lumora-test-event-1/Test video.mp4', videoSeconds: 30, image: '/t/s1.png', slides: ['/t/s1.png', '/t/s2.png'], errors: [] };
    for (const i of inputs) {
      const s = newSource(i, media, inputs);
      expect(s, i.kind).not.toBeNull();
      expect(s!.id).toBe(i.id);
    }
    expect(newSource(inputs.find((i) => i.kind === 'video')!, null, inputs)).toBeNull();
    const split = newSource(inputs.find((i) => i.kind === 'split')!, media, inputs)!;
    expect(split.kind.type === 'split' && split.kind.boxes.map((b) => b.sourceId)).toEqual(['test-camera-1', 'test-pattern']);
    const mic = newSource(inputs.find((i) => i.kind === 'microphone')!, null, inputs)!;
    expect(mic.kind).toMatchObject({ type: 'microphone', deviceId: 'mic' });
  });
});

describe('stopping the test', () => {
  test('Stop right after the start: the event is put back, files removed, the console left as it was', async () => {
    const calls: string[] = [];
    const ctrl = new AbortController();
    let show: Show = { ...emptyShow(), event: { ...emptyShow().event, name: 'My gala' } };
    const consoleError = console.error;
    const call = vi.fn(async (cmd: string) => {
      calls.push(cmd);
      if (cmd === 'test_event_begin') {
        show = { ...show, event: { ...show.event, name: 'Lumora test event' } };
        ctrl.abort();
        return { folder: '/rec/lumora-test-event-1' };
      }
      if (cmd === 'test_event_end') {
        show = { ...show, event: { ...show.event, name: 'My gala' } };
        return true;
      }
      return null;
    });
    const broadcast: BroadcastApi = {
      status: idle,
      settings: defaultCaptureSettings(),
      saveSettings: vi.fn(async () => {}),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      rehearsal: false,
      setRehearsal: vi.fn(),
      replayOn: false,
      setReplay: vi.fn(),
      frameStats: () => null,
      makeReplay: vi.fn(async () => 'r'),
    };
    const client = {
      dispatch: vi.fn(async () => {}),
      captureSettings: vi.fn(async () => defaultCaptureSettings()),
      perfStats: vi.fn(async () => null),
    } as unknown as EngineClient;
    const deps: RunnerDeps = {
      client,
      broadcast: () => broadcast,
      show: () => show,
      levels: () => null,
      problems: () => [],
      onProgress: () => {},
      signal: ctrl.signal,
      call: call as RunnerDeps['call'],
    };
    const r = await runTestEvent({ ...defaultOptions(env), length: 'quick' }, env, deps);
    expect(calls[0]).toBe('test_event_begin');
    expect(calls).toContain('test_event_end');
    expect(calls.at(-1)).toBe('test_event_cleanup');
    expect(calls.indexOf('test_event_end')).toBeLessThan(calls.indexOf('test_event_cleanup'));
    expect(show.event.name).toBe('My gala');
    expect(r.measured.stopped).toBe(true);
    expect(r.measured.restored).toBe(true);
    expect(r.error).toBeNull();
    expect(broadcast.start).not.toHaveBeenCalled();
    expect(console.error).toBe(consoleError);
  });

  test('it never starts while Lumora is recording', async () => {
    const call = vi.fn();
    await expect(
      runTestEvent(defaultOptions(env), env, {
        client: {} as EngineClient,
        broadcast: () => ({ status: { ...idle, recording: running } }) as unknown as BroadcastApi,
        show: () => emptyShow(),
        levels: () => null,
        problems: () => [],
        onProgress: () => {},
        signal: new AbortController().signal,
        call,
      }),
    ).rejects.toThrow(/recording/);
    expect(call).not.toHaveBeenCalled();
  });
});

describe('an output window checks itself', () => {
  test('in step with Program, overlays and the stage monitor', () => {
    const show = emptyShow();
    show.screens.live.program = 'cam';
    document.body.innerHTML = '<div data-screen="live"><div data-layer="cam"></div></div><div data-overlay></div>';
    show.overlays = [{ ...(show.overlays[0] ?? ({} as Show['overlays'][number])), on: true, sourceId: 'name', screens: ['live'] }];
    expect(inspect('live', show)).toMatchObject({ inSync: true, overlays: true });
    document.body.innerHTML = '<div data-screen="live"><div data-layer="other"></div></div>';
    expect(inspect('live', show)).toMatchObject({ inSync: false, overlays: false });
    document.body.innerHTML = '<div data-monitor></div>';
    expect(inspect('monitor', show).inSync).toBe(true);
    document.body.innerHTML = '<div class="mv__box mv__box--pgm"></div>';
    expect(inspect('multiview', show).tally).toBe(true);
  });
});
