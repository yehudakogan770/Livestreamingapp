import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { relayCaptions, type CaptionsInPicture } from './engineCaptions';
import type { Captions } from './types/Captions';

const look: Captions = { on: true, listen: null, inPicture: true, place: 'bottom', size: 1, lines: 2, language: 'en', best: false };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('sends the lines when they change, nothing while they stay, and again now and then', () => {
  let now: CaptionsInPicture | null = null;
  const sent: (CaptionsInPicture | null)[] = [];
  const stop = relayCaptions(
    () => now,
    (c) => sent.push(c),
    100,
    10,
  );
  expect(sent).toEqual([null]);
  now = { lines: ['Hello there'], look };
  vi.advanceTimersByTime(100);
  expect(sent).toEqual([null, now]);
  vi.advanceTimersByTime(500);
  expect(sent).toHaveLength(2);
  // No lines is the same as none.
  now = { lines: [], look };
  vi.advanceTimersByTime(100);
  expect(sent[2]).toBeNull();
  // A renderer that started since gets them too.
  vi.advanceTimersByTime(1000);
  expect(sent.length).toBeGreaterThan(3);
  stop();
  const n = sent.length;
  vi.advanceTimersByTime(1000);
  expect(sent).toHaveLength(n);
});
