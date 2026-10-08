import { expect, test } from 'vitest';
import type { EngineStats } from '../engine/unified';
import { engineRows, noteEngine } from './engineReport';

const stats = (over: Partial<EngineStats>): EngineStats => ({
  frames: 600,
  fps: 60,
  msPerFrame: 3,
  uploadMs: 1,
  renderMs: 1,
  presentMs: 0.5,
  readbackMs: 0.5,
  lateFrames: 2,
  uploadMbPerS: 100,
  adapter: { name: 'GPU', backend: 'Dx12', kind: 'discrete' },
  outputs: ['live'],
  feed: null,
  feeds: [],
  overlay: { framesPerS: 4, mbPerS: 1.5, latencyMs: 12, planes: 2, refused: 0 },
  notes: [],
  error: null,
  ...over,
});

test('the engine’s seconds add up; feeds are kept as last seen after they end', () => {
  const feed = { framesIn: 300, framesDropped: 1, bytesOut: 1, audioSamples: 480_000, audioSilence: 4800, error: null };
  let m = noteEngine(null, stats({ msPerFrame: 2, feeds: [{ id: 7, kind: 'screen', stats: feed, error: null }] }));
  m = noteEngine(m, stats({ msPerFrame: 4, fps: 55, overlay: { framesPerS: 30, mbPerS: 9, latencyMs: 20, planes: 3, refused: 0 } }));
  expect(m.msPerFrameAvg).toBe(3);
  expect(m.msPerFrameMax).toBe(4);
  expect(m.fpsMin).toBe(55);
  expect(m.overlayFpsMax).toBe(30);
  expect(m.overlayLatencyMs).toBe(20);
  expect(m.feeds).toEqual([
    { id: 7, kind: 'screen', framesIn: 300, framesDropped: 1, audioSeconds: 10, silenceSeconds: 0.1, error: null, route: null, zeroCopy: null },
  ]);
  const rows = engineRows(m);
  expect(rows[0]![1]).toBe('Unified (beta) on GPU (Dx12, discrete)');
  expect(rows.find((r) => r[0]!.startsWith('Engine feed'))![1]).toBe('300 frames, 1 late; sound 10 s (0.1 s filled with silence)');
  expect(engineRows(null)).toEqual([]);
});

test('the report says how the picture reached the encoder and which card showed each window', () => {
  const feed = { framesIn: 600, framesDropped: 0, bytesOut: 1, audioSamples: 480_000, audioSilence: 0, error: null };
  const path = 'zero-copy: NVIDIA NVENC H.264 on RTX 4070 (Media Foundation, NVIDIA H.264 Encoder MFT; Direct3D 12 → 11 shared texture)';
  const m = noteEngine(
    null,
    stats({
      adapter: { name: 'RTX 4070', backend: 'Dx12', kind: 'discrete', key: '10de-2786-Dx12-0', choice: 'the high-performance graphics card (automatic)' },
      feeds: [{ id: 1, kind: 'screen', stats: feed, error: null, route: { zeroCopy: true, path } }],
      outputCards: [{ output: 'live', displayCard: 'Intel Iris Xe', presentedBy: 'Intel Iris Xe', copied: true, color: 'HDR10 (PQ), SDR white at 203 nits' }],
    }),
  );
  expect(m.feeds[0]!.zeroCopy).toBe(true);
  const rows = engineRows(m);
  expect(rows[0]![1]).toBe('Unified (beta) on RTX 4070 (Dx12, discrete): the high-performance graphics card (automatic)');
  expect(rows.find((r) => r[0]!.startsWith('Engine feed'))![1]).toContain(`; ${path}`);
  expect(rows.find((r) => r[0] === 'Engine window: live')![1]).toBe(
    'HDR10 (PQ), SDR white at 203 nits, shown by Intel Iris Xe (copied across from the engine’s card)',
  );
});

test('the person finding the engine asked for is in the report', () => {
  let m = noteEngine(null, stats({}));
  expect(engineRows(m).some((r) => r[0]!.includes('person finding'))).toBe(false);
  m = noteEngine(m, stats({ vision: { inputs: 1, frames: 90, answers: 88, masks: 1 } }));
  m = noteEngine(m, stats({ vision: { inputs: 0, frames: 120, answers: 118, masks: 0 } }));
  expect(m.vision).toEqual({ frames: 120, answers: 118, masks: 1 });
  expect(engineRows(m).find((r) => r[0]!.includes('person finding'))![1]).toBe('120 frames to the models, 118 answers, up to 1 with a person mask');
});
