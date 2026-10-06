// Measurements for the test event's tests (a run that went well).

import type { Measured, Sample } from './verdict';

export function sample(t: number, over: Partial<Sample> = {}): Sample {
  return {
    t,
    step: 'cuts',
    fps: 30,
    target: 30,
    dropped: 0,
    recSpeed: 1,
    streamSpeed: 1,
    recBytes: t * 1000,
    streamBytes: t * 1000,
    cpu: 40,
    memUsedMb: 8000,
    appMemMb: 300,
    jsHeapMb: 100,
    mics: { 'test-mic-1': 0.2 },
    ...over,
  };
}

/** A test that went well: 2 minutes, smooth, a good recording, outputs and stream fine. */
export function goodRun(over: Partial<Measured> = {}): Measured {
  const samples = Array.from({ length: 120 }, (_, i) => sample(i * 1000));
  const probe = { frames: 3600, seconds: 120, video: true, audioStreams: 1, ok: true, text: 'ok' };
  return {
    ms: 120_000,
    samples,
    steps: [{ kind: 'cuts', label: 'Cuts between inputs', round: 0, at: 1000, ms: 9000, ok: true, notes: [] }],
    outputsTested: true,
    outputs: (['live', 'back', 'monitor', 'multiview'] as const).map((o) => ({
      output: o,
      opened: true,
      ownDisplay: false,
      fps: 60,
      inSync: true,
      black: false,
      overlays: o === 'live' ? true : null,
      tally: o === 'multiview' ? true : null,
    })),
    extraDisplays: 1,
    fullscreenOk: true,
    streamTested: true,
    streams: [{ name: 'Test receiver', vertical: false, local: true, started: true, seconds: 100, avgKbps: 6000, minSpeed: 1, reconnects: 0, probe }],
    preflight: [],
    recording: { file: 'Lumora test event.mkv', probe, seconds: 120 },
    diskMBps: 400,
    neededMBps: 1,
    userDrive: true,
    mics: [{ id: 'test-mic-1', name: 'USB mic' }],
    problems: [],
    console: [],
    captureFailures: [],
    restored: true,
    stopped: false,
    ...over,
  };
}
