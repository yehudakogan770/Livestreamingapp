// A frame's GPU passes, recorded instead of run, for the native engine. This
// walks the frame exactly as the WebGL compositor (../compositor.ts) does —
// same programs, same uniforms, same order, same intermediate pictures — and
// writes each step down. The engine runs the same GLSL (translated), so the
// picture is the same; anything it can't do yet makes the frame fall back to
// WebGL (`Unsupported`).
import { flatCurve, hexToRgb, type CurveSet } from '../color';
import { invert3, limitOf, placeCorner, squareToQuad } from '../compositor';
import { shifted, type EffectNow, type Layer, type MotionNow, type Op } from '../frame';
import { nodeUniforms, planGrade, wheelVectors } from '../grade';
import { BLEND_MODES, TRANSITION_TYPES } from '../shaders';
import { moreEffectUniforms } from '../fxlib';
import type { NodeNow } from '../../model/grade';

/** A texture a pass reads: `t3` (a target), `v0` (a video frame), `r:<id>` (a picture sent to the engine), `e` (nothing). */
export type TexRef = string;

type Uniform = number | number[] | { t: TexRef };

/** One recorded step: clear a target (k 0), or run a program into it (k 1). */
export interface PassRec {
  k: 0 | 1;
  t: number;
  c?: [number, number, number, number];
  p?: string;
  x?: Record<string, TexRef>;
  u?: Record<string, number[]>;
  q?: number[];
}

export interface VideoUse {
  key: string;
  path: string;
  time: number;
  fps: number;
  w: number;
  h: number;
  rate: number;
}

export interface Recorded {
  w: number;
  h: number;
  background: [number, number, number];
  out: number | null;
  passes: PassRec[];
  videos: VideoUse[];
}

/** Where the pictures come from (the client sends what is new). */
export interface Resources {
  /** A clip's file for the engine to decode, and the picture's size (null: can't be read natively). */
  videoSource(layer: Layer): { path: string; w: number; h: number } | null;
  /** A still's pixels, sent (null: not loaded yet, the layer isn't drawn, as in WebGL). */
  image(layer: Layer): { id: string; w: number; h: number } | null;
  /** Words or a shape drawn at the frame's size, sent. */
  text(layer: Layer, w: number, h: number): string | null;
  /** A one-pixel picture of a color. */
  color(hex: string): string;
  /** A curve's 256×1 table (null: flat, nothing to do). */
  curve(key: string, set: CurveSet | null | undefined): string | null;
  /** A LUT as a 3D picture (null: not read yet). */
  lut(path: string): { id: string; size: number } | null;
  /** An AI mask's matte at this frame (null: not ready). */
  matte(layer: Layer, effect: EffectNow): { id: string; w: number; h: number } | null;
}

/** Something this frame needs that the engine can't do yet: WebGL draws it. */
export class Unsupported extends Error {}

const EMPTY: TexRef = 'e';
const tref = (t: number): TexRef => `t${t}`;

export class Recorder {
  private passes: PassRec[] = [];
  private videos: VideoUse[] = [];
  private busy: boolean[] = [];
  private seed = 0;
  private matteShown = false;
  private white: TexRef | null = null;

  constructor(
    private readonly res: Resources,
    private readonly w: number,
    private readonly h: number,
    private readonly seqH: number,
    /** Show one grade node's matte (the Color page's "show matte"). */
    private readonly matte: { clip: string; node: string } | null = null,
  ) {}

  // ---- targets and passes ----

  private take(): number {
    const i = this.busy.indexOf(false);
    if (i >= 0) {
      this.busy[i] = true;
      return i;
    }
    if (this.busy.length >= 64) throw new Unsupported('too many layers at once');
    this.busy.push(true);
    return this.busy.length - 1;
  }
  private give(t: number | null) {
    if (t !== null) this.busy[t] = false;
  }

  private clear(t: number, rgba: [number, number, number, number] = [0, 0, 0, 0]) {
    this.passes.push({ k: 0, t, c: rgba });
  }

  private record(name: string, target: number, uniforms: Record<string, Uniform>, q?: number[]) {
    const x: Record<string, TexRef> = {};
    const u: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(uniforms)) {
      if (typeof v === 'number') u[k] = [v];
      else if (Array.isArray(v)) u[k] = v;
      else x[k] = v.t;
    }
    if (Object.values(x).includes(tref(target))) throw new Unsupported(`${name} reads what it writes`);
    this.passes.push({ k: 1, t: target, p: name, x, u, ...(q ? { q } : {}) });
  }

  /** Run a full-frame program from a target (or picture) into a new one. */
  private pass(name: string, input: number | TexRef, uniforms: Record<string, Uniform>, out?: number): number {
    const target = out ?? this.take();
    this.record(name, target, { uTex: { t: typeof input === 'number' ? tref(input) : input }, uSize: [this.w, this.h], ...uniforms });
    return target;
  }

  /** A picture (sw × sh) drawn where Motion puts it. */
  private place(tex: TexRef, sw: number, sh: number, m: MotionNow, target: number) {
    const corner = placeCorner(m, sw, sh, this.w, this.h, this.seqH);
    const q: number[] = [];
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as [number, number][]) {
      const [x, y, w] = corner(u, v);
      q.push(x * w, y * w, 0, w, u, v);
    }
    this.record('layer', target, { uTex: { t: tex }, uSize: [this.w, this.h], uCrop: [m.cropL / 100, m.cropT / 100, 1 - m.cropR / 100, 1 - m.cropB / 100] }, q);
  }

  // ---- layers ----

  private videoRef(layer: Layer, time: number, second: boolean): { tex: TexRef; w: number; h: number } {
    const src = this.res.videoSource(layer);
    if (!src || !src.w || !src.h) throw new Unsupported('a video whose size is not known');
    const mfps = layer.source?.kind === 'video' ? layer.source.media.fps || 30 : 30;
    const key = second ? `${layer.key}#2` : layer.key;
    let i = this.videos.findIndex((v) => v.key === key);
    if (i < 0) {
      this.videos.push({ key, path: src.path, time, fps: mfps, w: src.w, h: src.h, rate: 1 });
      i = this.videos.length - 1;
    }
    return { tex: `v${i}`, w: src.w, h: src.h };
  }

  private drawLayer(layer: Layer, target: number): boolean {
    const src = layer.source;
    if (!src) return false;
    let tex: TexRef;
    let sw: number;
    let sh: number;
    let nested: number | null = null;
    if (src.kind === 'color') {
      this.clear(target, [...hexToRgb(src.color), 1]);
      const m = layer.motion;
      if (m.x === 0 && m.y === 0 && m.scale === 100 && m.scaleX === 100 && m.rotation === 0 && !m.cropL && !m.cropR && !m.cropT && !m.cropB) return true;
      this.clear(target);
      tex = `r:${this.res.color(src.color)}`;
      sw = this.w;
      sh = this.h;
    } else if (src.kind === 'nested') {
      const inner = this.compose(src.ops);
      nested = inner;
      tex = tref(inner);
      sw = this.w;
      sh = this.h;
    } else if (src.kind === 'generator') {
      const made = this.take();
      this.generate(src, made);
      nested = made;
      tex = tref(made);
      sw = this.w;
      sh = this.h;
    } else if (src.kind === 'text' || src.kind === 'shape' || src.kind === 'titler') {
      const id = this.res.text(layer, this.w, this.h);
      if (!id) return false;
      tex = `r:${id}`;
      sw = this.w;
      sh = this.h;
    } else if (src.kind === 'image') {
      const img = this.res.image(layer);
      if (!img) return false;
      tex = `r:${img.id}`;
      sw = img.w;
      sh = img.h;
    } else {
      const v = this.videoRef(layer, src.time, false);
      tex = v.tex;
      sw = v.w;
      sh = v.h;
      if (src.next) {
        // Time remapping between two of the file's frames: blended here; optical flow is WebGL's for now.
        if (src.next.mode === 'flow') throw new Unsupported('optical-flow frame interpolation');
        const b = this.videoRef(layer, src.next.time, true);
        const mixed = this.pass('framemix', tex, { uB: { t: b.tex }, uMix: src.next.mix });
        nested = mixed;
        tex = tref(mixed);
      }
    }
    if (layer.motionBlur) this.placeBlurred(tex, sw, sh, layer, target);
    else this.place(tex, sw, sh, layer.motion, target);
    this.give(nested);
    return true;
  }

  private placeBlurred(tex: TexRef, sw: number, sh: number, layer: Layer, target: number) {
    const mb = layer.motionBlur as NonNullable<Layer['motionBlur']>;
    const n = mb.samples.length;
    let acc: number | null = null;
    const one = this.take();
    for (const m of mb.samples) {
      this.clear(one);
      this.place(tex, sw, sh, shifted(m, mb.base, layer.motion), one);
      const next: number = acc !== null ? this.pass('accum', one, { uBase: { t: tref(acc) }, uW: 1 / n }) : this.pass('copy', one, { uOpacity: 1 / n });
      this.give(acc);
      acc = next;
    }
    this.give(one);
    if (acc !== null) this.pass('copy', acc, { uOpacity: 1 }, target);
    this.give(acc);
  }

  // ---- effects ----

  private blur(input: number, radius: number): number {
    const sigma = Math.max(0, radius * (this.h / this.seqH) * 0.5);
    const a = this.pass('blur', input, { uDir: [1, 0], uSigma: sigma });
    const b = this.pass('blur', a, { uDir: [0, 1], uSigma: sigma });
    this.give(a);
    return b;
  }

  private effect(e: EffectNow, input: number, layer: Layer): number {
    const time = layer.local / Math.max(1, layer.fps);
    const p = e.p;
    const n = (k: string, d = 0) => (Number.isFinite(p[k]) ? (p[k] as number) : d);
    const run = (name: string, u: Record<string, Uniform>): number => {
      const out = this.pass(name, input, u);
      this.give(input);
      return out;
    };
    const k = this.h / this.seqH;
    switch (e.type) {
      case 'basic':
        return run('basic', {
          uExposure: n('exposure'),
          uContrast: n('contrast') / 100,
          uHighlights: n('highlights') / 100,
          uShadows: n('shadows') / 100,
          uWhites: n('whites') / 100,
          uBlacks: n('blacks') / 100,
          uTemp: n('temperature') / 100,
          uTint: n('tint') / 100,
          uSat: n('saturation', 100) / 100,
          uVib: n('vibrance') / 100,
        });
      case 'wheels': {
        const w = wheelVectors({ id: e.id, p, curves: null, qualifier: null, window: null });
        return run('wheels', { uLift: w.lift, uGamma: w.gamma, uGain: w.gain });
      }
      case 'grade':
        return this.grade(e, input, layer);
      case 'curves': {
        const id = this.res.curve(e.id, e.d as unknown as CurveSet);
        if (!id) return input;
        return run('curves', { uCurve: { t: `r:${id}` }, uMix: n('mix', 100) / 100 });
      }
      case 'lut': {
        const path = typeof e.d.path === 'string' ? e.d.path : '';
        const lut = path ? this.res.lut(path) : null;
        if (!lut) return input;
        return run('lut', { uLut: { t: `r:${lut.id}` }, uLutSize: lut.size, uMix: n('mix', 100) / 100 });
      }
      case 'hsl':
        return run('hsl', { uHue: n('hue') / 360, uRange: n('range', 30) / 360, uShift: n('shift') / 360, uSatS: n('sat') / 100, uLight: n('light') / 100 });
      case 'vignette':
        return run('vignette', { uAmount: n('amount') / 100, uVSize: n('size', 60) / 100, uFeather: n('feather', 50) / 100 });
      case 'bw':
        return run('bw', { uMix: n('mix', 100) / 100 });
      case 'invert':
        return run('invert', { uMix: n('mix', 100) / 100 });
      case 'blur': {
        if (n('radius') <= 0.2) return input;
        const out = this.blur(input, n('radius'));
        this.give(input);
        return out;
      }
      case 'sharpen':
        return run('sharpen', { uAmount: n('amount', 60) / 50 });
      case 'chromakey':
        return run('chromakey', {
          uKey: hexToRgb(typeof e.d.color === 'string' ? e.d.color : '#00b140'),
          uTol: n('tolerance', 30) / 100,
          uSoft: n('softness', 15) / 100,
          uSpill: n('spill', 50) / 100,
        });
      case 'lumakey':
        return run('lumakey', { uThreshold: n('threshold') / 100, uSoftness: n('softness') / 100, uInvert: n('invert') });
      case 'mask':
        if (n('use') >= 0.5) return input;
        return run('mask', shapeMask(n));
      case 'mosaic':
        return run('mosaic', { uBlock: n('size', 24) * k });
      case 'grain':
        this.seed = (this.seed + 7.13) % 1000;
        return run('grain', { uAmount: n('amount', 20) / 100, uGrain: n('size', 1.5) * k, uSeed: this.seed });
      case 'flip':
        return run('flip', { uH: n('h'), uV: n('v') });
      case 'glow': {
        const bright = this.pass('bright', input, { uThreshold: n('threshold', 65) / 100 });
        const soft = this.blur(bright, n('radius', 25));
        this.give(bright);
        const out = this.pass('add', input, { uOther: { t: tref(soft) }, uAmount: n('amount', 80) / 100 });
        this.give(soft);
        this.give(input);
        return out;
      }
      case 'shadow': {
        const a = (n('angle', 135) * Math.PI) / 180;
        const dist = n('distance', 12) * k;
        const made = this.pass('shadowmake', input, { uOffset: [Math.sin(a) * dist, -Math.cos(a) * dist * -1], uOpacity: n('opacity', 60) / 100 });
        const soft = this.blur(made, n('softness', 20));
        this.give(made);
        const out = this.pass('over', soft, { uOther: { t: tref(input) } });
        this.give(soft);
        this.give(input);
        return out;
      }
      case 'cornerpin': {
        const W = this.w;
        const H = this.h;
        const quad: [number, number][] = [
          [n('tlx') * k, n('tly') * k],
          [W + n('trx') * k, n('try') * k],
          [W + n('brx') * k, H + n('bry') * k],
          [n('blx') * k, H + n('bly') * k],
        ];
        const m = squareToQuad(quad);
        if (!m) return input;
        const inv = invert3(m);
        if (!inv) return input;
        return run('cornerpin', { uH: inv });
      }
      case 'chromatic':
        return run('chromatic', { uAmount: n('amount', 30) * k });
      case 'glitch':
        return run('glitch', { uAmount: n('amount', 40) / 100, uTime: time, uSeedRate: n('speed', 50) / 10 });
      case 'zoomblur':
        return run('zoomblur', { uAmount: n('amount', 30) / 100, uCenter: [0.5 + n('cx') / 200, 0.5 - n('cy') / 200] });
      case 'dirblur': {
        const a = (n('angle') * Math.PI) / 180;
        const len = n('length', 30) * k;
        return run('dirblur', { uDir: [Math.cos(a) * len, Math.sin(a) * len] });
      }
      case 'displace':
        return run('displace', { uAmount: n('amount', 30) * k, uFreq: n('size', 50) / 10, uTime: time * (n('speed', 50) / 50) });
      case 'posterize':
        return run('posterize', { uLevels: Math.max(2, n('levels', 6)) });
      case 'edges':
        return run('edges', { uAmount: n('amount', 100) / 100, uInvert: n('invert') });
      case 'wave':
        return run('wave', { uAmount: n('amount', 20) * k, uFreq: n('size', 30) / 10, uTime: time * (n('speed', 50) / 25) });
      case 'vhs':
        return run('vhs', { uAmount: n('amount', 50) / 100, uTime: time });
      default: {
        const u = moreEffectUniforms(e.type, n, { k, time, d: e.d });
        return u && u !== 'skip' ? run(e.type, u) : input;
      }
    }
  }

  private gradeNode(fx: string, node: NodeNow, input: number, base: number, matte = false): number {
    const curve = this.res.curve(`${fx}/${node.id}`, node.curves);
    return this.pass('grade', input, {
      ...nodeUniforms(node),
      uUseCurves: curve ? 1 : 0,
      uCurve: { t: curve ? `r:${curve}` : EMPTY },
      uBase: { t: tref(base) },
      uShowMatte: matte ? 1 : 0,
    });
  }

  private grade(e: EffectNow, input: number, layer: Layer): number {
    if (!e.grade) return input;
    const matteNode = this.matte && this.matte.clip === layer.clip.id ? this.matte.node : null;
    const plan = planGrade(e.grade, matteNode);
    let cur = input;
    for (const s of plan.steps) {
      let out: number;
      if (s.kind === 'serial') out = this.gradeNode(e.id, s.node, cur, cur);
      else if (s.kind === 'parallel') {
        out = cur;
        for (const node of s.nodes) {
          const o = this.gradeNode(e.id, node, cur, cur);
          const sum = this.pass('gradeadd', out, { uOther: { t: tref(o) }, uBase: { t: tref(cur) } });
          this.give(o);
          if (out !== cur) this.give(out);
          out = sum;
        }
      } else {
        out = this.gradeNode(e.id, s.nodes[0] as NodeNow, cur, cur);
        for (const node of s.nodes.slice(1)) {
          const next = this.gradeNode(e.id, node, cur, out);
          this.give(out);
          out = next;
        }
      }
      this.give(cur);
      cur = out;
    }
    if (plan.matte) {
      const out = this.gradeNode(e.id, plan.matte, cur, cur, true);
      this.give(cur);
      this.matteShown = true;
      return out;
    }
    return cur;
  }

  private renderLayer(layer: Layer | null): number | null {
    if (!layer) return null;
    let t = this.take();
    this.clear(t);
    if (!this.drawLayer(layer, t)) {
      this.give(t);
      return null;
    }
    this.matteShown = false;
    for (const e of layer.effects) {
      t = this.applyEffect(e, t, layer);
      if (this.matteShown) break;
    }
    return t;
  }

  private composite(base: number, top: number, opacity: number, blend: string): number {
    const out = this.pass('composite', top, { uBase: { t: tref(base) }, uOpacity: opacity, uMode: Math.max(0, BLEND_MODES.indexOf(blend)) });
    this.give(base);
    return out;
  }

  private compose(ops: Op[]): number {
    let acc = this.take();
    this.clear(acc);
    let empty = true;
    for (const op of ops) {
      if (op.kind === 'layer') {
        const t = this.renderLayer(op.layer);
        if (t === null) continue;
        if (empty && op.layer.motion.opacity >= 100) {
          this.give(acc);
          acc = t;
          empty = false;
          continue;
        }
        acc = this.composite(acc, t, op.layer.motion.opacity / 100, op.layer.motion.blend);
        this.give(t);
        empty = false;
      } else if (op.kind === 'transition') {
        const a = this.renderLayer(op.from);
        const b = this.renderLayer(op.to);
        const type = Math.max(0, TRANSITION_TYPES.indexOf(op.type));
        const out = this.pass('transition', a ?? EMPTY, {
          uB: { t: b !== null ? tref(b) : EMPTY },
          uP: op.progress,
          uType: type,
          uOpA: (op.from?.motion.opacity ?? 100) / 100,
          uOpB: (op.to?.motion.opacity ?? 100) / 100,
        });
        this.give(a);
        this.give(b);
        if (empty) {
          this.give(acc);
          acc = out;
          empty = false;
          continue;
        }
        acc = this.composite(acc, out, 1, op.to?.motion.blend ?? op.from?.motion.blend ?? 'normal');
        this.give(out);
      } else {
        let t = this.pass('copy', acc, { uOpacity: 1 });
        this.matteShown = false;
        for (const e of op.layer.effects) {
          t = this.applyEffect(e, t, op.layer);
          if (this.matteShown) break;
        }
        const mixed = this.composite(acc, t, op.layer.motion.opacity / 100, op.layer.motion.blend ?? 'normal');
        this.give(t);
        acc = mixed;
        empty = false;
      }
    }
    return acc;
  }

  private generate(src: Extract<NonNullable<Layer['source']>, { kind: 'generator' }>, out: number) {
    const st = src.settings;
    const num = (k: string, d: number) => (typeof st[k] === 'number' ? (st[k] as number) : d);
    const col = (k: string, d: string) => hexToRgb(typeof st[k] === 'string' ? (st[k] as string) : d);
    const kinds = ['gradient', 'noise', 'particles', 'lightleak', 'bars'];
    this.pass(
      'generator',
      EMPTY,
      {
        uGen: Math.max(0, kinds.indexOf(src.gen)),
        uTime: src.local / Math.max(1, src.fps),
        uC1: col('color1', '#1e3a5f'),
        uC2: col('color2', '#d08a48'),
        uA: num('a', 50) / 100,
        uB: num('b', 50) / 100,
        uC: num('c', 50) / 100,
        uKind: num('kind', 0),
        uScale: this.h / this.seqH,
      },
      out,
    );
  }

  // ---- masks ----

  private maskTarget(layer: Layer, mask: EffectNow): number | null {
    if (mask.type === 'mask') {
      if (!this.white) this.white = `r:${this.res.color('#ffffff')}`;
      const p = mask.p;
      return this.pass(
        'mask',
        this.white,
        shapeMask((k, d = 0) => (Number.isFinite(p[k]) ? (p[k] as number) : d)),
      );
    }
    const matte = this.res.matte(layer, mask);
    if (!matte || !matte.w || !matte.h) return null;
    const out = this.take();
    this.clear(out);
    this.place(`r:${matte.id}`, matte.w, matte.h, layer.motion, out);
    return out;
  }

  private applyEffect(e: EffectNow, input: number, layer: Layer): number {
    if (e.type === 'personmask' || e.type === 'objectmask') {
      if ((e.p.use ?? 0) >= 0.5) return input;
      const m = this.maskTarget(layer, e);
      if (m === null) return input;
      const out = this.pass('cutout', input, { uMask: { t: tref(m) } });
      this.give(m);
      this.give(input);
      return out;
    }
    const lim = limitOf(e);
    const mask = lim ? layer.effects.find((x) => x.id === lim.mask) : undefined;
    if (!lim || !mask) return this.effect(e, input, layer);
    const m = this.maskTarget(layer, mask);
    if (m === null) return input;
    const orig = this.pass('copy', input, { uOpacity: 1 });
    const done = this.effect(e, input, layer);
    const out = this.pass('limit', done, { uOrig: { t: tref(orig) }, uMask: { t: tref(m) }, uOutside: lim.outside ? 1 : 0 });
    this.give(orig);
    this.give(done);
    this.give(m);
    return out;
  }

  /** Record a whole frame. */
  frame(ops: Op[], background: string): Recorded {
    const acc = this.compose(ops);
    return { w: this.w, h: this.h, background: hexToRgb(background), out: acc, passes: this.passes, videos: this.videos };
  }
}

/** A shape mask's numbers for the GPU (as the compositor's). */
function shapeMask(n: (k: string, d?: number) => number): Record<string, number> {
  return {
    uShape: n('shape'),
    uCx: n('cx') / 100,
    uCy: n('cy') / 100,
    uW: n('w', 40) / 100,
    uH: n('h', 50) / 100,
    uAngle: (n('angle') * Math.PI) / 180,
    uFeather: n('feather', 10) / 200,
    uInvert: n('invert'),
    uRound: n('corner', 20) / 100,
  };
}

/** Whether a curve set changes anything (as the compositor decides). */
export const curveUsed = (set: CurveSet | null | undefined): set is CurveSet =>
  !!set?.master && !(flatCurve(set.master) && flatCurve(set.r) && flatCurve(set.g) && flatCurve(set.b));
