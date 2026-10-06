// A benchmark of the playback draw path with synthetic sources: a long 4K
// timeline (cuts with dissolves, picture-in-picture, a graded clip, titles)
// drawn frame after frame through the real compositor on a counting WebGL 2
// stand-in. It measures the CPU time each frame takes (building the frame's
// layers and issuing the GPU work) and counts the GPU work itself: texture
// storage (re)allocated, pixels uploaded, full-frame passes and text drawn.
//
// Run it on its own (more frames, numbers printed):
//   LUMORA_BENCH=1 npx vitest run editor/app/src/render/compose.bench.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newEffect } from '../model/effects';
import { DEFAULT_TEXT, emptyProject, newClip, newTrack, type Clip, type MediaItem, type Project } from '../model/types';
import { Compositor, type Pictures } from './compositor';
import { frameOps } from './frame';

export interface GlCounts {
  /** Texture storage (re)allocated: texImage2D calls, and their bytes. */
  allocs: number;
  allocBytes: number;
  /** Pixels uploaded into existing storage (texSubImage2D). */
  subUploads: number;
  draws: number;
  /** Words drawn on the text canvas. */
  textDraws: number;
}

const counts: GlCounts = { allocs: 0, allocBytes: 0, subUploads: 0, draws: 0, textDraws: 0 };
const reset = () => Object.assign(counts, { allocs: 0, allocBytes: 0, subUploads: 0, draws: 0, textDraws: 0 });

const dims = (src: unknown): [number, number] => {
  const s = src as { width?: number; height?: number } | null;
  return [s?.width ?? 0, s?.height ?? 0];
};

/** A WebGL 2 context that does nothing but count. */
function countingGl(): WebGL2RenderingContext {
  let id = 0;
  const special: Record<string, unknown> = {
    getExtension: () => ({}),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: () => ({ id: ++id }),
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    checkFramebufferStatus: () => 0x8cd5,
    texImage2D: (...a: unknown[]) => {
      counts.allocs++;
      // (target, level, internal, w, h, border, format, type, data) or (target, level, internal, format, type, source)
      const [w, h] = a.length >= 9 ? [a[3] as number, a[4] as number] : dims(a[5]);
      counts.allocBytes += w * h * 4;
    },
    texSubImage2D: () => {
      counts.subUploads++;
    },
    drawArrays: () => {
      counts.draws++;
    },
  };
  return new Proxy({} as WebGL2RenderingContext, {
    get(_t, prop: string) {
      if (prop in special) return special[prop];
      if (/^[A-Z0-9_]+$/.test(prop)) return prop.length;
      return () => ({ id: ++id });
    },
  });
}

/** A 2D canvas context for words: measures, and counts what is drawn. */
function countingCtx(): CanvasRenderingContext2D {
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop: string) {
      if (prop === 'measureText') return (s: string) => ({ width: s.length * 20 });
      if (prop === 'fillText') return () => counts.textDraws++;
      return () => undefined;
    },
    set: () => true,
  });
}

class FakeCanvas {
  width = 300;
  height = 150;
  private gl = countingGl();
  private ctx = countingCtx();
  getContext(kind: string) {
    return kind === 'webgl2' ? this.gl : this.ctx;
  }
}

let saved: unknown;
beforeAll(() => {
  saved = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = FakeCanvas;
});
afterAll(() => {
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = saved;
});

const UHD = { w: 3840, h: 2160 };

/** A long 4K timeline: 10-second shots with dissolves, a picture-in-picture, a graded clip, titles. */
export function benchProject(minutes = 10): Project {
  const p = emptyProject('Bench');
  const s0 = p.sequences[0];
  if (!s0) throw new Error('no sequence');
  const fps = 30;
  const tracks = [...s0.tracks.filter((t) => t.kind === 'video'), newTrack('video', 4), ...s0.tracks.filter((t) => t.kind === 'audio')];
  const media: MediaItem[] = [0, 1, 2, 3].map((i) => ({
    id: `m${i}`,
    name: `Cam ${i}`,
    path: `/cam${i}.mov`,
    proxy: null,
    kind: 'video',
    duration: minutes * 60,
    width: UHD.w,
    height: UHD.h,
    fps,
    hasVideo: true,
    hasAudio: false,
    bin: null,
  }));
  const [v1, v2, v3, v4] = tracks.filter((t) => t.kind === 'video');
  if (!v1 || !v2 || !v3 || !v4) throw new Error('no tracks');
  const clips: Clip[] = [];
  const shot = 10 * fps;
  const total = minutes * 60 * fps;
  for (let at = 0, i = 0; at < total; at += shot, i++) {
    const c = newClip(v1.id, at, shot, { kind: 'media', media: `m${i % 3}`, in: at / fps }, `Shot ${i}`);
    if (i > 0) c.tIn = { type: 'dissolve', length: 15 };
    if (i % 2 === 0) c.effects = [newEffect('basic')];
    clips.push(c);
  }
  // A picture-in-picture all the way through.
  const pip = newClip(v2.id, 0, total, { kind: 'media', media: 'm3', in: 0 }, 'PiP');
  pip.motion = { ...pip.motion, scale: 30, x: 1200, y: -600 };
  clips.push(pip);
  // A lower third every 30 seconds (on for 6 seconds) and a corner bug throughout.
  for (let at = 0; at < total; at += 30 * fps)
    clips.push(
      newClip(v3.id, at, 6 * fps, { kind: 'text', text: { ...DEFAULT_TEXT, text: 'Dana Levi\nDirector', px: 0.08, py: 0.82, box: true } }, 'Lower third'),
    );
  clips.push(newClip(v4.id, 0, total, { kind: 'text', text: { ...DEFAULT_TEXT, text: 'LIVE', size: 40, px: 0.95, py: 0.06 } }, 'Bug'));
  const seq = { ...s0, width: UHD.w, height: UHD.h, fps, tracks, clips };
  return { ...p, media, sequences: [seq] };
}

export interface BenchResult {
  frames: number;
  msPerFrame: number;
  p95: number;
  allocsPerFrame: number;
  allocMBPerFrame: number;
  subUploadsPerFrame: number;
  drawsPerFrame: number;
  textDrawsPerFrame: number;
}

/** Draw `frames` frames of playback at the viewer size and measure. */
export function runBench(p: Project, frames: number, viewH = 1080): BenchResult {
  const s = p.sequences[0];
  if (!s) throw new Error('no sequence');
  const canvas = new FakeCanvas() as unknown as OffscreenCanvas;
  const c = new Compositor(canvas);
  const w = Math.round((viewH * s.width) / s.height);
  c.resize(w, viewH, s.height);
  // Synthetic decoded frames: one 4K picture object per source, the way a decoder hands them over.
  const pics: Pictures = { picture: (l) => (l.source?.kind === 'video' ? ({ width: UHD.w, height: UHD.h } as unknown as TexImageSource) : null) };
  // Warm up (programs compiled, targets made).
  for (let f = 0; f < 30; f++) c.render(frameOps(p, s, f), pics, s.background);
  reset();
  const times: number[] = [];
  for (let f = 0; f < frames; f++) {
    const t0 = performance.now();
    c.render(frameOps(p, s, 30 + f), pics, s.background);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  return {
    frames,
    msPerFrame: sum / frames,
    p95: times[Math.floor(frames * 0.95)] ?? 0,
    allocsPerFrame: counts.allocs / frames,
    allocMBPerFrame: counts.allocBytes / frames / 1e6,
    subUploadsPerFrame: counts.subUploads / frames,
    drawsPerFrame: counts.draws / frames,
    textDrawsPerFrame: counts.textDraws / frames,
  };
}

const big = typeof process !== 'undefined' && !!process.env.LUMORA_BENCH;

describe('playback compose benchmark', () => {
  it('draws a long 4K timeline', () => {
    const p = benchProject(10);
    const r = runBench(p, big ? 3000 : 300);
    if (big) process.stdout.write(`compose bench ${JSON.stringify(r)}\n`);
    expect(r.frames).toBeGreaterThan(0);
    expect(r.msPerFrame).toBeGreaterThan(0);
  });
});
