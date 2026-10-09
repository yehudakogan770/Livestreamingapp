import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { DemoClient, type CaptureStatus } from '../engine/client';
import type { Show } from '../engine/types/Show';
import { BroadcastProvider } from './BroadcastContext';
import { MarkButton } from './BroadcastButtons';
import { Broadcaster } from './recorder';

afterEach(() => vi.restoreAllMocks());

test('Mark (button or M) marks the recording and counts; typing in a field does not', async () => {
  let n = 0;
  const mark = vi.spyOn(Broadcaster.prototype, 'mark').mockImplementation(() => ++n);
  const client = new DemoClient();
  const show: Show = (await client.getShow()).show;
  render(
    <BroadcastProvider show={show} client={client}>
      <MarkButton />
      <input aria-label="Notes" />
    </BroadcastProvider>,
  );
  const app = client as unknown as { capture: CaptureStatus; captureWatchers: Set<(s: CaptureStatus) => void> };
  act(() => {
    app.capture = { ...app.capture, recording: { session: 1, startedAt: 0, path: null, destinations: [], bytes: 0, speed: 1 } };
    for (const w of app.captureWatchers) w(structuredClone(app.capture));
  });
  fireEvent.click(screen.getByRole('button', { name: /Mark/ }));
  expect(mark).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: /Marked \(1\)/ })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'm' });
  expect(mark).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'm' });
  fireEvent.keyDown(window, { key: 'm', ctrlKey: true });
  expect(mark).toHaveBeenCalledTimes(2);
});

test('without a recording, Mark says what to do', async () => {
  vi.spyOn(Broadcaster.prototype, 'mark').mockReturnValue(null);
  const client = new DemoClient();
  const show: Show = (await client.getShow()).show;
  render(
    <BroadcastProvider show={show} client={client}>
      <MarkButton />
    </BroadcastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Mark/ }));
  expect(screen.getByRole('button', { name: /Start recording to mark moments/ })).toBeInTheDocument();
});
