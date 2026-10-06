// The native engine runs what the recorder writes down, so the recorder must
// write down exactly what the WebGL compositor does. These tests run the real
// compositor on a WebGL stand-in that notes every draw (its program, numbers
// and corners) and compare that with the recording, pass for pass.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newEffect } from '../../model/effects';
import { DEFAULT_TEXT, emptyProject, newClip, newTrack, type Clip, type MediaItem, type Project } from '../../model/types';
import { Compositor, type Pictures } from '../compositor';
import { frameOps, type Op } from '../frame';
import { nativePrograms } from './programs';
import { Recorder, Unsupported, type Resources } from './record';

interface Draw {
  name: string;
  u: Record<string, number[]>;
  q: number[] | null;
}

let draws: Draw[] = [];

/** A WebGL 2 stand-in that remembers which program each draw ran, with what. */
function notingGl(): WebGL2RenderingContext {
  let id = 0;
  const byFs = new Map(nativePrograms().map((p) => [p.fs, p.name]));
  const shaderSrc = new Map<object, string>();
  const progFs = new Map<object, string>();
  const locName = new Map<object, string>();
  let current: object | null = null;
  let pending: Record<string, number[]> = {};
  let quad: number[] | null = null;
  const set = (loc: object | null, v: number[]) => {
    const n = loc && locName.get(loc);
    if (n) pending[n] = v;
  };
  const special: Record<string, unknown> = {
    getExtension: () => ({}),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    shaderSource: (s: object, src: string) => shaderSrc.set(s, src),
    attachShader: (p: object, s: object) => {
      const src = shaderSrc.get(s) ?? '';
      if (src.includes('outColor')) progFs.set(p, src);
    },
    getUniformLocation: (p: object, name: string) => {
      const loc = { id: ++id };
      locName.set(loc, name);
      void p;
      return loc;
    },
    useProgram: (p: object) => {
      current = p;
      pending = {};
    },
    uniform1f: (l: object, a: number) => set(l, [a]),
    uniform1i: (l: object, a: number) => set(l, [a]),
    uniform2f: (l: object, a: number, b: number) => set(l, [a, b]),
    uniform3f: (l: object, a: number, b: number, c: number) => set(l, [a, b, c]),
    uniform4f: (l: object, a: number, b: number, c: number, d: number) => set(l, [a, b, c, d]),
    uniformMatrix3fv: (l: object, _t: boolean, m: number[]) => set(l, [...m]),
    bufferSubData: (_t: number, _o: number, d: Float32Array) => {
      quad = [...d];
    },
    clear: () => draws.push({ name: 'clear', u: {}, q: null }),
    drawArrays: () => {
      const fs = current ? (progFs.get(current) ?? '') : '';
      const name = byFs.get(fs) ?? '?';
      draws.push({ name, u: pending, q: name === 'layer' ? quad : null });
      pending = {};
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

function fakeCtx(): CanvasRenderingContext2D {
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop: string) {
      if (prop === 'measureText') return (s: string) => ({ width: s.length * 20 });
      return () => undefined;
    },
    set: () => true,
  });
}

class FakeCanvas {
  width = 300;
  height = 150;
  private gl = notingGl();
  getContext(kind: string) {
    return kind === 'webgl2' ? this.gl : fakeCtx();
  }
}

let saved: unknown;
beforeAll(() => {
  saved = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = FakeCanvas;
  // A color card moved around is a one-pixel picture.
  const g = globalThis as { ImageData?: unknown };
  g.ImageData ??= class {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number,
    ) {}
  };
});
afterAll(() => {
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = saved;
});

const UHD = { w: 3840, h: 2160 };

/** A timeline with most of what a frame can hold. */
function richProject(): Project {
  const p = emptyProject('Parity');
  const s0 = p.sequences[0];
  if (!s0) throw new Error('no sequence');
  const fps = 30;
  const tracks = [...s0.tracks.filter((t) => t.kind === 'video'), newTrack('video', 4), newTrack('video', 5), ...s0.tracks.filter((t) => t.kind === 'audio')];
  const media: MediaItem[] = [0, 1, 2].map((i) => ({
    id: `m${i}`,
    name: `Cam ${i}`,
    path: `/cam${i}.mov`,
    proxy: null,
    kind: 'video',
    duration: 600,
    width: UHD.w,
    height: UHD.h,
    fps,
    hasVideo: true,
    hasAudio: false,
    bin: null,
  }));
  const [v1, v2, v3, v4, v5] = tracks.filter((t) => t.kind === 'video');
  if (!v1 || !v2 || !v3 || !v4 || !v5) throw new Error('no tracks');
  const clips: Clip[] = [];
  // Shots with transitions of several kinds, each with effects.
  const kinds = ['dissolve', 'wipeleft', 'iris', 'blurdissolve', 'slideleft'];
  const looks = [['basic', 'vignette'], ['blur', 'sharpen'], ['glow'], ['shadow', 'chromakey'], ['wheels', 'mosaic', 'cornerpin']];
  for (let i = 0; i < 5; i++) {
    const c = newClip(v1.id, i * 60, 60, { kind: 'media', media: `m${i % 3}`, in: i * 2 }, `Shot ${i}`);
    if (i > 0) c.tIn = { type: kinds[i] as string, length: 12 };
    c.effects = (looks[i] as string[]).map((t) => newEffect(t));
    clips.push(c);
  }
  // A blur kept inside a shape mask, on a picture-in-picture turned in 3D.
  const pip = newClip(v2.id, 0, 300, { kind: 'media', media: 'm2', in: 0 }, 'PiP');
  const mask = newEffect('mask');
  const blur = { ...newEffect('blur'), p: { ...newEffect('blur').p, radius: 12 }, d: { limit: { mask: mask.id, outside: true } } };
  pip.effects = [mask, blur];
  pip.motion = { ...pip.motion, scale: 30, x: 1200, y: -600, rotY: 25, opacity: 80, blend: 'screen' };
  clips.push(pip);
  // Words, a moved color card, an adjustment layer.
  clips.push(newClip(v3.id, 0, 300, { kind: 'text', text: { ...DEFAULT_TEXT, text: 'Dana Levi', box: true } }, 'Title'));
  const card = newClip(v4.id, 100, 100, { kind: 'color', color: '#336699' }, 'Card');
  card.motion = { ...card.motion, scale: 40, rotation: 10 };
  clips.push(card);
  const adj = newClip(v5.id, 0, 300, { kind: 'adjustment' }, 'Look');
  adj.effects = [newEffect('bw'), newEffect('grain')];
  adj.motion = { ...adj.motion, opacity: 50, blend: 'overlay' };
  clips.push(adj);
  const seq = { ...s0, width: UHD.w, height: UHD.h, fps, tracks, clips };
  return { ...p, media, sequences: [seq] };
}

/** Pictures for both sides: every video a 4K frame, every still missing. */
const pics: Pictures = { picture: (l) => (l.source?.kind === 'video' ? ({ width: UHD.w, height: UHD.h } as unknown as TexImageSource) : null) };

const res: Resources = {
  videoSource: (l) => (l.source?.kind === 'video' ? { path: l.source.media.path, w: l.source.media.width, h: l.source.media.height } : null),
  image: () => null,
  text: (l) => `text:${l.key}`,
  color: (hex) => `color:${hex}`,
  curve: () => null,
  lut: () => null,
  matte: () => null,
};

function compare(ops: Op[], w: number, h: number, seqH: number) {
  const c = new Compositor(new FakeCanvas() as unknown as OffscreenCanvas);
  c.resize(w, h, seqH);
  draws = [];
  c.render(ops, pics, '#000000');
  // The compositor ends with the frame over the background on screen; the engine adds that itself.
  const gl = draws.slice(0, -1);
  expect(draws.at(-1)?.name).toBe('final');
  const rec = new Recorder(res, w, h, seqH).frame(ops, '#000000');
  const mine = rec.passes.map((p) => (p.k === 0 ? 'clear' : (p.p as string)));
  expect(mine).toEqual(gl.map((d) => d.name));
  rec.passes.forEach((p, i) => {
    const d = gl[i] as Draw;
    if (p.k === 0) return;
    for (const [k, v] of Object.entries(d.u)) {
      if (p.x && k in p.x) continue; // a texture's unit
      const got = p.u?.[k];
      expect(got, `${p.p}.${k}`).toBeDefined();
      (got as number[]).forEach((x, j) => expect(x).toBeCloseTo(v[j] as number, 4));
    }
    if (p.p === 'layer') (p.q as number[]).forEach((x, j) => expect(x).toBeCloseTo((d.q as number[])[j] as number, 4));
  });
  return rec;
}

describe('native frame recording', () => {
  const p = richProject();
  const s = p.sequences[0] as NonNullable<Project['sequences'][0]>;

  it('records what the WebGL compositor draws, pass for pass', () => {
    for (const f of [0, 10, 58, 62, 118, 125, 150, 178, 182, 240, 245, 299]) {
      const rec = compare(frameOps(p, s, f), 1280, 720, s.height);
      expect(rec.passes.length).toBeGreaterThan(0);
      expect(rec.out).not.toBeNull();
    }
  });

  it('names each video frame it reads, with the file and the time', () => {
    const rec = new Recorder(res, 1280, 720, s.height).frame(frameOps(p, s, 62), '#000000');
    // Inside the second shot's wipe: both shots and the picture-in-picture.
    expect(rec.videos.map((v) => v.path).sort()).toEqual(['/cam0.mov', '/cam1.mov', '/cam2.mov']);
    for (const v of rec.videos) expect(v.fps).toBe(30);
    const reads = rec.passes.flatMap((x) => Object.values(x.x ?? {}));
    for (let i = 0; i < rec.videos.length; i++) expect(reads).toContain(`v${i}`);
    // Every target read was written before.
    const written = new Set<string>();
    for (const x of rec.passes) {
      for (const t of Object.values(x.x ?? {})) if (t.startsWith('t')) expect(written.has(t), `${x.p} reads ${t}`).toBe(true);
      written.add(`t${x.t}`);
    }
  });

  it('leaves optical-flow interpolation to WebGL', () => {
    const ops = frameOps(p, s, 0);
    const first = ops[0];
    if (first?.kind !== 'layer' || first.layer.source?.kind !== 'video') throw new Error('expected a video layer');
    first.layer.source = { ...first.layer.source, next: { time: 0.04, mix: 0.5, mode: 'flow' } };
    expect(() => new Recorder(res, 640, 360, s.height).frame(ops, '#000000')).toThrow(Unsupported);
    first.layer.source = { ...first.layer.source, next: { time: 0.04, mix: 0.5, mode: 'blend' } };
    const rec = new Recorder(res, 640, 360, s.height).frame(ops, '#000000');
    expect(rec.passes.some((x) => x.p === 'framemix')).toBe(true);
    expect(rec.videos.map((v) => v.key)).toContain(`${first.layer.key}#2`);
  });
});
