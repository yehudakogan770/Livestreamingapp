import { act, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { DemoClient, type CaptureRunning, type CaptureStatus } from '../engine/client';
import type { Show } from '../engine/types/Show';
import { BroadcastProvider, useBroadcast } from '../broadcast/BroadcastContext';
import { Broadcaster } from '../broadcast/recorder';
import { zmanimOn } from '../engine/zmanim';
import { ShabbosGuard } from './ShabbosGuard';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const running = (session: number): CaptureRunning => ({ session, startedAt: 0, path: null, destinations: [], bytes: 0, speed: 1 });

test('a stream that dropped just before candle lighting is not brought back after it', async () => {
  const place = {
    name: 'New York',
    latMicro: 40_712_800,
    lonMicro: -74_006_000,
    candleMinutes: 18,
    israel: false,
    stopBefore: true,
    stopMinutes: 5,
    warnMonitor: false,
  };
  const friday = new Date(2026, 8, 25, 12).getTime();
  const candles = zmanimOn(friday, place).candles!;
  const stopAt = candles - 5 * 60_000;
  vi.useFakeTimers({ now: stopAt - 1500 });
  // What the encoder was told, in order.
  const log: string[] = [];
  vi.spyOn(Broadcaster.prototype, 'start').mockImplementation((kind) => {
    log.push(`start:${kind}`);
    return Promise.resolve(running(1));
  });
  vi.spyOn(Broadcaster.prototype, 'startVertical').mockResolvedValue(null);
  vi.spyOn(Broadcaster.prototype, 'stop').mockImplementation((kind) => {
    log.push(`stop:${kind}`);
    return Promise.resolve();
  });

  const client = new DemoClient();
  const base = (await client.getShow()).show;
  const show: Show = { ...base, event: { ...base.event, place } };
  let ctx: ReturnType<typeof useBroadcast> = null;
  function Grab() {
    ctx = useBroadcast();
    return null;
  }
  render(
    <BroadcastProvider show={show} client={client}>
      <Grab />
      <ShabbosGuard show={show} />
    </BroadcastProvider>,
  );
  const app = client as unknown as { capture: CaptureStatus; captureWatchers: Set<(s: CaptureStatus) => void> };
  const emit = (patch: Partial<CaptureStatus>) =>
    act(() => {
      app.capture = { ...app.capture, ...patch };
      for (const w of app.captureWatchers) w(structuredClone(app.capture));
    });
  await act(async () => {
    await ctx!.start('stream');
  });
  emit({ streaming: running(7) });
  // The internet drops just before the stop time: Lumora starts reconnecting...
  const dropped = { kind: 'stream' as const, session: 7, message: 'dropped' };
  emit({ streaming: null, failure: dropped, failures: [dropped] });
  // ...and the stop time comes and goes (a retry may land in the same second).
  for (let s = 0; s < 120; s++) await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(log.filter((x) => x.endsWith(':stream')).at(-1)).toBe('stop:stream');
});
