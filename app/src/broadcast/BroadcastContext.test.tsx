import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DemoClient, defaultCaptureSettings, type CaptureFailure, type CaptureRunning, type CaptureStatus } from '../engine/client';
import type { Show } from '../engine/types/Show';
import { BroadcastProvider, useBroadcast } from './BroadcastContext';
import { Broadcaster } from './recorder';
import { accountDestination, accounts } from './accounts';

const running = (session: number, bytes = 0): CaptureRunning => ({ session, startedAt: 0, path: null, destinations: [], bytes, speed: 1 });

let starts: string[];
beforeEach(() => {
  vi.useFakeTimers();
  starts = [];
  vi.spyOn(Broadcaster.prototype, 'start').mockImplementation((kind) => {
    starts.push(kind);
    return Promise.resolve(running(1));
  });
  vi.spyOn(Broadcaster.prototype, 'startVertical').mockImplementation(() => {
    starts.push('vertical');
    return Promise.resolve(null);
  });
  vi.spyOn(Broadcaster.prototype, 'stop').mockResolvedValue();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function setUp() {
  const client = new DemoClient();
  const show: Show = (await client.getShow()).show;
  let ctx: ReturnType<typeof useBroadcast> = null;
  function Grab() {
    ctx = useBroadcast();
    return null;
  }
  render(
    <BroadcastProvider show={show} client={client}>
      <Grab />
    </BroadcastProvider>,
  );
  // As the app sends it: every status is a fresh copy.
  const app = client as unknown as { capture: CaptureStatus; captureWatchers: Set<(s: CaptureStatus) => void> };
  const emit = (patch: Partial<CaptureStatus>) =>
    act(() => {
      app.capture = { ...app.capture, ...patch };
      for (const w of app.captureWatchers) w(structuredClone(app.capture));
    });
  await act(async () => {
    await ctx!.start('stream');
    await ctx!.start('record');
  });
  emit({ streaming: running(7), recording: running(8) });
  starts.length = 0;
  return { emit, ctx: () => ctx! };
}

test('a dropped stream comes back even while the recording keeps updating the status', async () => {
  const { emit } = await setUp();
  const dropped: CaptureFailure = { kind: 'stream', session: 7, message: 'The connection dropped.' };
  emit({ streaming: null, failure: dropped, failures: [dropped] });
  // The recording reports its size every second (a new status each time).
  for (let i = 1; i <= 4; i++) {
    emit({ recording: running(8, i * 1000) });
    await act(() => vi.advanceTimersByTimeAsync(1000));
  }
  expect(starts).toContain('stream');
});

test('a recording that failed is restarted while the stream keeps updating the status', async () => {
  const { emit } = await setUp();
  const full: CaptureFailure = { kind: 'record', session: 8, message: 'The disk can’t keep up.' };
  emit({ recording: null, failure: full, failures: [full] });
  for (let i = 1; i <= 4; i++) {
    emit({ streaming: { ...running(7), speed: 1 + i / 100 } });
    await act(() => vi.advanceTimersByTimeAsync(1000));
  }
  expect(starts).toEqual(['record']);
});

test('the stream and its vertical version failing together are both brought back', async () => {
  const { emit } = await setUp();
  const wide: CaptureFailure = { kind: 'stream', session: 7, message: 'dropped' };
  const tall: CaptureFailure = { kind: 'vertical', session: 9, message: 'dropped' };
  // Both arrive before the window has seen either.
  emit({ streaming: null, failure: tall, failures: [wide, tall] });
  await act(() => vi.advanceTimersByTimeAsync(6000));
  expect(starts).toContain('stream');
  expect(starts).toContain('vertical');
});

test('a failure is acted on once, however often the status repeats it', async () => {
  const { emit } = await setUp();
  const dropped: CaptureFailure = { kind: 'stream', session: 7, message: 'dropped' };
  emit({ streaming: null, failure: dropped, failures: [dropped] });
  for (let i = 0; i < 40; i++) {
    emit({ recording: running(8, i) });
    await act(() => vi.advanceTimersByTimeAsync(1000));
  }
  expect(starts.filter((k) => k === 'stream')).toHaveLength(1);
});

test('connected YouTube and Facebook destinations are set up at GO LIVE (not on a reconnect) and ended at stop', async () => {
  const prepare = vi.spyOn(accounts, 'prepare').mockResolvedValue({ ready: 1, failed: [] });
  const finish = vi.spyOn(accounts, 'finish').mockResolvedValue([]);
  const client = new DemoClient();
  await client.setCaptureSettings({ ...defaultCaptureSettings(), destinations: [accountDestination('youtube', 'Concert', 'yt')] });
  const show: Show = (await client.getShow()).show;
  let ctx: ReturnType<typeof useBroadcast> = null;
  function Grab() {
    ctx = useBroadcast();
    return null;
  }
  render(
    <BroadcastProvider show={show} client={client}>
      <Grab />
    </BroadcastProvider>,
  );
  await act(() => vi.advanceTimersByTimeAsync(10));
  await act(async () => {
    await ctx!.start('stream');
  });
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(starts).toEqual(['stream', 'vertical']);
  // A drop: Lumora reconnects with the same broadcast (nothing new is made).
  const app = client as unknown as { capture: CaptureStatus; captureWatchers: Set<(s: CaptureStatus) => void> };
  const dropped: CaptureFailure = { kind: 'stream', session: 7, message: 'dropped' };
  act(() => {
    app.capture = { ...app.capture, streaming: null, failure: dropped, failures: [dropped] };
    for (const w of app.captureWatchers) w(structuredClone(app.capture));
  });
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(starts.filter((k) => k === 'stream')).toHaveLength(2);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(finish).not.toHaveBeenCalled();
  await act(async () => {
    await ctx!.stop('stream');
  });
  expect(finish).toHaveBeenCalledTimes(1);
});
