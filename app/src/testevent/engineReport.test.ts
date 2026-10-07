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
  expect(m.feeds).toEqual([{ id: 7, kind: 'screen', framesIn: 300, framesDropped: 1, audioSeconds: 10, silenceSeconds: 0.1, error: null }]);
  const rows = engineRows(m);
  expect(rows[0]![1]).toBe('Unified (beta) on GPU (Dx12, discrete)');
  expect(rows.find((r) => r[0]!.startsWith('Engine feed'))![1]).toBe('300 frames, 1 late; sound 10 s (0.1 s filled with silence)');
  expect(engineRows(null)).toEqual([]);
});
