// The unified engine's own numbers in the test event's report: how long a
// frame took on the graphics card, late frames, how the graphics arrived
// from the overlay renderers, and each encoder feed (frames, late frames,
// sound written and silence filled in).

import type { EngineStats } from '../engine/unified';

export interface EngineMeasured {
  adapter: string | null;
  /** Frames drawn, and those that took longer than a frame's time (since the engine started). */
  frames: number;
  lateFrames: number;
  /** ms per frame: the worst and the average of the seconds sampled. */
  msPerFrameMax: number;
  msPerFrameAvg: number;
  /** The lowest frames-a-second seen. */
  fpsMin: number | null;
  samples: number;
  /** Graphics from the overlay renderers: most frames a second and MB a second, average delay. */
  overlayFpsMax: number;
  overlayMbPerSMax: number;
  overlayLatencyMs: number | null;
  overlayRefused: number;
  /** Background removal and auto-framing (the vision worker): frames sent, answers, most masks held at once. */
  vision: { frames: number; answers: number; masks: number };
  /** Each feed as last seen while it ran. */
  feeds: { id: number; kind: string; framesIn: number; framesDropped: number; audioSeconds: number; silenceSeconds: number; error: string | null }[];
}

/** Add one second's statistics (feeds are kept as last seen: they end before the report). */
export function noteEngine(prev: EngineMeasured | null, s: EngineStats, rate = 48_000): EngineMeasured {
  const m: EngineMeasured = prev
    ? { ...prev, feeds: [...prev.feeds] }
    : {
        adapter: null,
        frames: 0,
        lateFrames: 0,
        msPerFrameMax: 0,
        msPerFrameAvg: 0,
        fpsMin: null,
        samples: 0,
        overlayFpsMax: 0,
        overlayMbPerSMax: 0,
        overlayLatencyMs: null,
        overlayRefused: 0,
        vision: { frames: 0, answers: 0, masks: 0 },
        feeds: [],
      };
  m.adapter = s.adapter ? `${s.adapter.name} (${s.adapter.backend}, ${s.adapter.kind})` : m.adapter;
  m.frames = s.frames;
  m.lateFrames = s.lateFrames;
  m.msPerFrameMax = Math.max(m.msPerFrameMax, s.msPerFrame);
  m.msPerFrameAvg = (m.msPerFrameAvg * m.samples + s.msPerFrame) / (m.samples + 1);
  if (s.fps > 0) m.fpsMin = m.fpsMin === null ? s.fps : Math.min(m.fpsMin, s.fps);
  m.samples++;
  m.overlayFpsMax = Math.max(m.overlayFpsMax, s.overlay?.framesPerS ?? 0);
  m.overlayMbPerSMax = Math.max(m.overlayMbPerSMax, s.overlay?.mbPerS ?? 0);
  if (s.overlay && s.overlay.framesPerS > 0) m.overlayLatencyMs = s.overlay.latencyMs;
  m.overlayRefused = s.overlay?.refused ?? m.overlayRefused;
  if (s.vision)
    m.vision = {
      frames: Math.max(m.vision.frames, s.vision.frames),
      answers: Math.max(m.vision.answers, s.vision.answers),
      masks: Math.max(m.vision.masks, s.vision.masks),
    };
  for (const f of s.feeds ?? []) {
    if (!f.stats && !f.error) continue;
    const row = {
      id: f.id,
      kind: f.kind,
      framesIn: f.stats?.framesIn ?? 0,
      framesDropped: f.stats?.framesDropped ?? 0,
      audioSeconds: Math.round(((f.stats?.audioSamples ?? 0) / rate) * 10) / 10,
      silenceSeconds: Math.round(((f.stats?.audioSilence ?? 0) / rate) * 10) / 10,
      error: f.error ?? f.stats?.error ?? null,
    };
    const i = m.feeds.findIndex((x) => x.id === f.id);
    if (i >= 0) m.feeds[i] = row;
    else m.feeds.push(row);
  }
  return m;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const FEED_NAMES: Record<string, string> = { screen: 'Recording / stream', vertical: 'Vertical stream', input: 'Camera ISO' };

/** Rows for the report's at-a-glance table. */
export function engineRows(e: EngineMeasured | null | undefined): string[][] {
  if (!e) return [];
  const rows = [
    ['Engine', `Unified (beta) on ${e.adapter ?? 'an unknown graphics card'}`],
    ['Engine time per frame (avg / worst second)', `${r1(e.msPerFrameAvg)} / ${r1(e.msPerFrameMax)} ms`],
    ['Engine late frames', `${e.lateFrames} of ${e.frames}${e.fpsMin !== null ? ` (lowest ${r1(e.fpsMin)} fps)` : ''}`],
    [
      'Engine graphics (overlay renderers)',
      `up to ${r1(e.overlayFpsMax)} frames/s, ${r1(e.overlayMbPerSMax)} MB/s${e.overlayLatencyMs !== null ? `, ${Math.round(e.overlayLatencyMs)} ms behind` : ''}${e.overlayRefused ? `, ${e.overlayRefused} refused` : ''}`,
    ],
  ];
  if (e.vision.frames)
    rows.push([
      'Engine person finding (background, auto-framing)',
      `${e.vision.frames} frames to the models, ${e.vision.answers} answers${e.vision.masks ? `, up to ${e.vision.masks} with a person mask` : ', no person mask came'}`,
    ]);
  for (const f of e.feeds)
    rows.push([
      `Engine feed: ${FEED_NAMES[f.kind] ?? f.kind}`,
      `${f.framesIn} frames, ${f.framesDropped} late${f.kind !== 'input' ? `; sound ${f.audioSeconds} s (${f.silenceSeconds} s filled with silence)` : ''}${f.error ? `; ${f.error}` : ''}`,
    ]);
  return rows;
}
