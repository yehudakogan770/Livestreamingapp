// Recording and streaming with the unified engine: the engine encodes its own
// picture; this window sends only the sound, and never opens a camera or
// draws the picture again (the double camera open of the Standard recorder).

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { CaptureSettings } from '../engine/client';
import { DemoClient } from '../engine/client';

const calls: { name: string; args: unknown }[] = [];
let lost: ((kind: string, session: number, message: string) => void) | null = null;

vi.mock('../engine/unified', () => ({
  unifiedOn: () => true,
  engineCaptureStart: (request: { kind: string }) => {
    calls.push({ name: 'start', args: request });
    return Promise.resolve({
      running: { session: request.kind === 'record' ? 7 : 8, startedAt: 1000, path: 'Gala.mkv', destinations: [], bytes: 0, speed: null },
      isos: request.kind === 'record' ? [{ id: 3, sourceId: 'cam', name: 'Camera', path: 'Gala — event files/Camera.mkv' }] : [],
    });
  },
  engineCaptureStop: (session: number) => {
    calls.push({ name: 'stop', args: session });
    return Promise.resolve();
  },
  sendEngineSound: () => Promise.resolve(),
  refreshEngineInfo: () => Promise.resolve(null),
  onEngineFeedLost: (cb: typeof lost) => {
    lost = cb;
    return () => {};
  },
  engineReplayStart: (rate: number) => {
    calls.push({ name: 'replayStart', args: rate });
    return Promise.resolve();
  },
  engineReplayStop: () => {
    calls.push({ name: 'replayStop', args: null });
    return Promise.resolve();
  },
  engineReplayTake: (seconds: number, name: string) => {
    calls.push({ name: 'replayTake', args: [seconds, name] });
    return Promise.resolve([{ path: `replays/${name}-1.mkv`, durationS: 3 }]);
  },
  onEngineReplayLost: (cb: typeof replayLost) => {
    replayLost = cb;
    return () => {};
  },
}));
let replayLost: ((message: string) => void) | null = null;

const taps: string[] = [];
vi.mock('../audio/engineTap', () => ({
  EngineTap: class {
    constructor(_ctx: unknown, connect: (into: unknown) => () => void) {
      taps.push('on');
      connect({});
    }
    stop() {
      taps.push('off');
    }
  },
}));

const settings: CaptureSettings = {
  folder: null,
  quality: '720p',
  videoKbps: 4000,
  audioKbps: 160,
  recordMix: 'recording',
  iso: true,
  chapters: true,
  destinations: [],
};

let gum: ReturnType<typeof vi.fn>;
beforeEach(() => {
  calls.length = 0;
  taps.length = 0;
  gum = vi.fn(() => Promise.reject(new Error('no')));
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: gum }, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

function sound() {
  const mixes: string[] = [];
  return {
    mixes,
    engine: {
      context: { sampleRate: 44100 },
      tapMix: (mix: string) => {
        mixes.push(mix);
        return () => {};
      },
      mixStream: () => {
        throw new Error('the WebView encoder is not used');
      },
    },
  };
}

test('a recording is the engine’s: sound only from here, no camera, no picture drawn', async () => {
  const { Broadcaster } = await import('./recorder');
  const client = new DemoClient();
  const iso = vi.spyOn(client, 'isoStart');
  const s = sound();
  const b = new Broadcaster(client, s.engine as never);
  const running = await b.start('record', settings, 'Gala');
  expect(running.session).toBe(7);
  expect(calls[0]).toEqual({
    name: 'start',
    args: expect.objectContaining({ kind: 'record', width: 1280, height: 720, fps: 30, vertical: false, mix: 'b', sampleRate: 44100, iso: true }),
  });
  // The Recording mix is tapped for the engine; nothing else.
  expect(s.mixes).toEqual(['b']);
  expect(taps).toEqual(['on']);
  expect(gum).not.toHaveBeenCalled();
  expect(iso).not.toHaveBeenCalled();
  // The engine's encoder is what is measured (no picture drawn here).
  expect(b.frameStats()).toMatchObject({ target: 30 });
  // A stream at the same time shares nothing but the engine: its own mix.
  await b.start('stream', settings, 'Gala');
  expect(calls[1]!.args).toMatchObject({ kind: 'stream', mix: 'master' });
  await b.stop('record');
  expect(calls[2]).toEqual({ name: 'stop', args: 7 });
  expect(taps).toEqual(['on', 'on', 'off']);
  await b.stop('stream');
  expect(taps).toEqual(['on', 'on', 'off', 'off']);
  expect(gum).not.toHaveBeenCalled();
});

test('the vertical version and NDI come from the engine too', async () => {
  const { Broadcaster } = await import('./recorder');
  const b = new Broadcaster(new DemoClient(), sound().engine as never);
  await b.start(
    'stream',
    { ...settings, destinations: [{ id: 'v', name: 'TikTok', url: 'rtmp://x', key: 'k', enabled: true, vertical: true }] as never },
    'Gala',
  );
  await b.startVertical(
    { ...settings, destinations: [{ id: 'v', name: 'TikTok', url: 'rtmp://x', key: 'k', enabled: true, vertical: true }] as never },
    'Gala',
  );
  expect(calls.map((c) => (c.args as { kind: string; vertical: boolean; width: number }) ?? null).map((a) => [a.kind, a.vertical, a.width])).toEqual([
    ['stream', false, 1280],
    ['vertical', true, 1080],
  ]);
  await b.startNdi(settings);
  expect((calls[2]!.args as { kind: string }).kind).toBe('ndi');
});

test('the engine’s encoder stopping is reported like the WebView’s', async () => {
  const { Broadcaster } = await import('./recorder');
  const b = new Broadcaster(new DemoClient(), sound().engine as never);
  const seen: unknown[] = [];
  b.onLost = (kind, session, message) => seen.push([kind, session, message]);
  await b.start('record', settings, 'Gala');
  lost?.('record', 7, 'NVENC stopped');
  lost?.('record', 99, 'another session');
  expect(seen).toEqual([['record', 7, 'NVENC stopped']]);
});

test('instant replay is kept by the engine: the Stream mix is sent, no camera is opened, nothing drawn here', async () => {
  const { Broadcaster } = await import('./recorder');
  const b = new Broadcaster(new DemoClient(), sound().engine as never);
  const started = b.startReplay();
  expect(b.replaying).toBe(true);
  expect(b.replayInEngine).toBe(true);
  await started;
  expect(calls.map((c) => c.name)).toEqual(['replayStart']);
  expect(taps).toEqual(['on']);
  // A replay: the engine's pieces, already in the replays folder.
  expect(await b.takeReplayFiles(8, 'replay-x')).toEqual([{ path: 'replays/replay-x-1.mkv', durationS: 3 }]);
  expect(await b.takeReplay(8)).toEqual([]);
  b.stopReplay();
  expect(b.replaying).toBe(false);
  expect(calls.map((c) => c.name)).toEqual(['replayStart', 'replayTake', 'replayStop']);
  expect(taps).toEqual(['on', 'off']);
  // The engine's replay encoder stopping turns it off, and says so.
  const lostMessages: string[] = [];
  b.onReplayLost = (m) => lostMessages.push(m);
  await b.startReplay();
  replayLost?.('Instant replay stopped (NVENC failed).');
  expect(b.replaying).toBe(false);
  expect(lostMessages).toEqual(['Instant replay stopped (NVENC failed).']);
  expect(gum).not.toHaveBeenCalled();
});
