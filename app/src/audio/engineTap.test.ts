import { expect, test } from 'vitest';
import { toPcm16, wallTimeOf } from './engineTap';

test('floats become interleaved 16-bit samples, clipped at full scale', () => {
  const pcm = toPcm16(new Float32Array([0, 1, -1, 2]), new Float32Array([0.5, -0.5, 0, -2]));
  const s = new Int16Array(pcm.buffer);
  expect([...s]).toEqual([0, 16384, 32767, -16384, -32768, 0, 32767, -32768]);
  expect(pcm.length).toBe(16);
});

test('a sample’s wall-clock time comes from where the sound clock is now', () => {
  // The clock is at 10 s now (wall 50 000 ms): sample 470 400 at 48 kHz was 0.2 s ago.
  expect(wallTimeOf(470_400, 48_000, 10, 50_000)).toBeCloseTo(49_800, 6);
  // At 44.1 kHz.
  expect(wallTimeOf(441_000, 44_100, 10, 50_000)).toBeCloseTo(50_000, 6);
});
