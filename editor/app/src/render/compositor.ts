// Draws a frame on the GPU: every layer with its position, crop, effects and
// blend mode; transitions; adjustment layers. Used for the viewer and for
// making the film, so what you see is what you get.
import { curvesImage, flatCurve, hexToRgb, wheelColor, type Cube, type CurveSet } from './color';
import type { EffectNow, Layer, Op } from './frame';
import { drawText } from './text';
import { BLEND_MODES, COMPOSITE_FS, COPY_FS, EFFECT_FS, FINAL_FS, FULL_VS, GENERATOR_FS, LAYER_FS, LAYER_VS, TRANSITION_FS, TRANSITION_TYPES } from './shaders';

type Source = TexImageSource;

/** Gives the picture for a layer (a playing video, a decoded frame, a still), or nothing yet. */
export interface Pictures {
  picture(layer: Layer): Source | null;
  /** A LUT file's contents, once read (null until then). */
  cube?(path: string): Cube | null;
}

interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  busy: boolean;
}

interface Program {
  prog: WebGLProgram;
  loc: Map<string, WebGLUniformLocation | null>;
}

const sizeOf = (s: Source): [number, number] => {
  if (typeof HTMLVideoElement !== 'undefined' && s instanceof HTMLVideoElement) return [s.videoWidth, s.videoHeight];
  if (typeof VideoFrame !== 'undefined' && s instanceof VideoFrame) return [s.displayWidth, s.displayHeight];
  if (typeof HTMLImageElement !== 'undefined' && s instanceof HTMLImageElement) return [s.naturalWidth, s.naturalHeight];
  const x = s as { width: number; height: number };
  return [x.width, x.height];
};

export class Compositor {
  readonly gl: WebGL2RenderingContext;
  private w = 0;
  private h = 0;
  /** The size frames are made at (the sequence's), so effect sizes look the same at any viewer size. */
  private seqH = 1080;
  private full: WebGLBuffer;
  private quad: WebGLBuffer;
  private vaoFull: WebGLVertexArrayObject;
  private vaoQuad: WebGLVertexArrayObject;
  private programs = new Map<string, Program>();
  private targets: Target[] = [];
  private textures = new Map<string, { tex: WebGLTexture; stamp: string }>();
  private curveTex = new Map<string, { tex: WebGLTexture; stamp: string }>();
  private lutTex = new Map<string, { tex: WebGLTexture; size: number }>();
  private empty: WebGLTexture;
  private textCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private float: boolean;
  private seed = 0;

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', {
      premultipliedAlpha: true,
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('This computer could not start the graphics Lumora Edit needs (WebGL 2).');
    this.gl = gl;
    this.float = !!gl.getExtension('EXT_color_buffer_float');
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.full = gl.createBuffer() as WebGLBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.full);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.quad = gl.createBuffer() as WebGLBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, 24 * 4, gl.DYNAMIC_DRAW);
    this.vaoFull = gl.createVertexArray() as WebGLVertexArrayObject;
    this.vaoQuad = gl.createVertexArray() as WebGLVertexArrayObject;
    this.empty = this.makeTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  }

  // ---- set-up ----

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type) as WebGLShader;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Graphics program failed: ${gl.getShaderInfoLog(s) ?? ''}`);
    return s;
  }

  private program(name: string, vs: string, fs: string): Program {
    const have = this.programs.get(name);
    if (have) return have;
    const gl = this.gl;
    const prog = gl.createProgram() as WebGLProgram;
    gl.attachShader(prog, this.compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.bindAttribLocation(prog, 1, 'aUv');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Graphics program failed: ${gl.getProgramInfoLog(prog) ?? ''}`);
    const p = { prog, loc: new Map<string, WebGLUniformLocation | null>() };
    this.programs.set(name, p);
    return p;
  }

  private use(p: Program, uniforms: Record<string, number | number[] | [WebGLTexture, number, '3d'?]>) {
    const gl = this.gl;
    gl.useProgram(p.prog);
    for (const [k, v] of Object.entries(uniforms)) {
      let loc = p.loc.get(k);
      if (loc === undefined) {
        loc = gl.getUniformLocation(p.prog, k);
        p.loc.set(k, loc);
      }
      if (loc === null) continue;
      if (typeof v === 'number') {
        if (k === 'uMode' || k === 'uType' || k === 'uGen') gl.uniform1i(loc, v);
        else gl.uniform1f(loc, v);
      } else if (typeof v[0] !== 'number') {
        const [tex, unit, kind] = v as [WebGLTexture, number, '3d'?];
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(kind === '3d' ? gl.TEXTURE_3D : gl.TEXTURE_2D, tex);
        gl.uniform1i(loc, unit);
      } else {
        const n = v as number[];
        if (n.length === 2) gl.uniform2f(loc, n[0] as number, n[1] as number);
        else if (n.length === 3) gl.uniform3f(loc, n[0] as number, n[1] as number, n[2] as number);
        else if (n.length === 4) gl.uniform4f(loc, n[0] as number, n[1] as number, n[2] as number, n[3] as number);
        else if (n.length === 9) gl.uniformMatrix3fv(loc, false, n);
      }
    }
  }

  private makeTexture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** The size frames are drawn at; `seqHeight` is the sequence's own height. */
  resize(w: number, h: number, seqHeight: number) {
    this.seqH = seqHeight;
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.w = Math.max(2, Math.round(w));
    this.h = Math.max(2, Math.round(h));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    for (const t of this.targets) {
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
    }
    this.targets = [];
  }

  get width(): number {
    return this.w;
  }
  get height(): number {
    return this.h;
  }

  private take(): Target {
    const free = this.targets.find((t) => !t.busy);
    if (free) {
      free.busy = true;
      return free;
    }
    const gl = this.gl;
    const tex = this.makeTexture();
    if (this.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.w, this.h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer() as WebGLFramebuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const t = { fb, tex, busy: true };
    this.targets.push(t);
    return t;
  }
  private give(t: Target | null) {
    if (t) t.busy = false;
  }

  private bindTarget(t: Target | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
    gl.viewport(0, 0, this.w, this.h);
  }

  private clear(t: Target, rgba: [number, number, number, number] = [0, 0, 0, 0]) {
    const gl = this.gl;
    this.bindTarget(t);
    gl.clearColor(...rgba);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private drawFull() {
    const gl = this.gl;
    gl.bindVertexArray(this.vaoFull);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.full);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Run a full-frame program from one target into a new one. */
  private pass(
    name: string,
    fs: string,
    input: Target | WebGLTexture,
    uniforms: Record<string, number | number[] | [WebGLTexture, number, '3d'?]>,
    out?: Target,
  ): Target {
    const target = out ?? this.take();
    this.bindTarget(target);
    const p = this.program(name, FULL_VS, fs);
    const tex = 'fb' in (input as Target) ? (input as Target).tex : (input as WebGLTexture);
    this.use(p, { uTex: [tex, 0], uSize: [this.w, this.h], ...uniforms });
    this.drawFull();
    return target;
  }

  // ---- pictures ----

  private upload(key: string, src: Source, stamp: string): { tex: WebGLTexture; w: number; h: number } | null {
    const [w, h] = sizeOf(src);
    if (!w || !h) return null;
    const gl = this.gl;
    let t = this.textures.get(key);
    if (!t) {
      t = { tex: this.makeTexture(), stamp: '' };
      this.textures.set(key, t);
    }
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (t.stamp !== stamp || stamp === '') {
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      } catch {
        return null;
      }
      t.stamp = stamp;
    }
    return { tex: t.tex, w, h };
  }

  private textSource(layer: Layer): Source | null {
    if (layer.source?.kind !== 'text') return null;
    if (!this.textCanvas) this.textCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(this.w, this.h) : document.createElement('canvas');
    const c = this.textCanvas;
    if (c.width !== this.w || c.height !== this.h) {
      c.width = this.w;
      c.height = this.h;
    }
    const ctx = c.getContext('2d') as CanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.clearRect(0, 0, this.w, this.h);
    drawText(ctx, layer.source.text, this.w, this.h, layer.source.local, layer.source.length);
    return c;
  }

  /** Draw a layer's picture into a target with its position, size, turn and crop. */
  private drawLayer(layer: Layer, pics: Pictures, target: Target): boolean {
    const gl = this.gl;
    const src = layer.source;
    if (!src) return false;
    let tex: WebGLTexture;
    let sw: number;
    let sh: number;
    let nested: Target | null = null;
    const scale = this.h / this.seqH;
    if (src.kind === 'color') {
      const [r, g, b] = hexToRgb(src.color);
      this.clear(target, [r, g, b, 1]);
      // Moved, cropped or turned: drawn as a picture of that color.
      const m = layer.motion;
      if (m.x === 0 && m.y === 0 && m.scale === 100 && m.scaleX === 100 && m.rotation === 0 && !m.cropL && !m.cropR && !m.cropT && !m.cropB) return true;
      this.clear(target);
      const up = this.upload(`color:${src.color}`, colorPixel(src.color), src.color);
      if (!up) return false;
      tex = up.tex;
      sw = this.w;
      sh = this.h;
    } else if (src.kind === 'nested') {
      // The sequence inside is drawn first, then placed like a picture.
      const inner = this.compose(src.ops, pics);
      nested = inner;
      tex = inner.tex;
      sw = this.w;
      sh = this.h;
    } else if (src.kind === 'generator') {
      const made = this.take();
      this.generate(src, made);
      nested = made;
      tex = made.tex;
      sw = this.w;
      sh = this.h;
    } else if (src.kind === 'text') {
      const c = this.textSource(layer);
      if (!c) return false;
      const up = this.upload(`text:${layer.key}`, c, '');
      if (!up) return false;
      tex = up.tex;
      sw = this.w;
      sh = this.h;
    } else {
      const pic = pics.picture(layer);
      if (!pic) return false;
      const stamp = src.kind === 'image' ? src.media.path : '';
      const up = this.upload(src.kind === 'image' ? `img:${src.media.id}` : `vid:${layer.key}`, pic, stamp);
      if (!up) return false;
      tex = up.tex;
      sw = up.w;
      sh = up.h;
    }
    const m = layer.motion;
    const fit = m.fill ? Math.max(this.w / sw, this.h / sh) : Math.min(this.w / sw, this.h / sh);
    const dw = sw * fit * (m.scale / 100) * (m.scaleX / 100);
    const dh = sh * fit * (m.scale / 100);
    const cx = this.w / 2 + m.x * scale;
    const cy = this.h / 2 + m.y * scale;
    // Turned flat (rotation), then tilted (3D), seen through a lens from in front of the frame.
    const rz = (m.rotation * Math.PI) / 180;
    const rx = (m.rotX * Math.PI) / 180;
    const ry = (m.rotY * Math.PI) / 180;
    const focal = this.h * 1.25;
    const depth = m.z * scale;
    const corner = (u: number, v: number): [number, number, number] => {
      let x = (u - 0.5) * dw;
      let y = (v - 0.5) * dh;
      let z = 0;
      [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
      [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
      [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
      const px = cx + x - this.w / 2;
      const py = cy + y - this.h / 2;
      const w = Math.max(0.05, (focal + z + depth) / focal);
      // Divided by w on the GPU, so the picture is drawn in true perspective.
      return [((this.w / 2 + px / w) / this.w) * 2 - 1, 1 - ((this.h / 2 + py / w) / this.h) * 2, w];
    };
    const data = new Float32Array(24);
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].forEach(([u, v], i) => {
      const [x, y, w] = corner(u as number, v as number);
      data.set([x * w, y * w, 0, w, u as number, v as number], i * 6);
    });
    this.bindTarget(target);
    const p = this.program('layer', LAYER_VS, LAYER_FS);
    this.use(p, { uTex: [tex, 0], uSize: [this.w, this.h], uCrop: [m.cropL / 100, m.cropT / 100, 1 - m.cropR / 100, 1 - m.cropB / 100] });
    gl.bindVertexArray(this.vaoQuad);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.give(nested);
    return true;
  }

  // ---- effects ----

  private curveTexture(e: EffectNow): WebGLTexture | null {
    const set = e.d as unknown as CurveSet;
    if (!set?.master) return null;
    if (flatCurve(set.master) && flatCurve(set.r) && flatCurve(set.g) && flatCurve(set.b)) return null;
    const stamp = JSON.stringify(set);
    let t = this.curveTex.get(e.id);
    if (!t) {
      t = { tex: this.makeTexture(), stamp: '' };
      this.curveTex.set(e.id, t);
    }
    if (t.stamp !== stamp) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, curvesImage(set));
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      t.stamp = stamp;
    }
    return t.tex;
  }

  private lutTexture(path: string, pics: Pictures): { tex: WebGLTexture; size: number } | null {
    const have = this.lutTex.get(path);
    if (have) return have;
    const cube = pics.cube?.(path);
    if (!cube) return null;
    const gl = this.gl;
    const tex = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
    const bytes = new Uint8Array(cube.size ** 3 * 4);
    for (let i = 0; i < cube.size ** 3; i++) {
      bytes[i * 4] = Math.round(Math.max(0, Math.min(1, cube.data[i * 3] as number)) * 255);
      bytes[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, cube.data[i * 3 + 1] as number)) * 255);
      bytes[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, cube.data[i * 3 + 2] as number)) * 255);
      bytes[i * 4 + 3] = 255;
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, cube.size, cube.size, cube.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    const t = { tex, size: cube.size };
    this.lutTex.set(path, t);
    return t;
  }

  private blur(input: Target, radius: number): Target {
    const sigma = Math.max(0, radius * (this.h / this.seqH) * 0.5);
    const a = this.pass('blur', EFFECT_FS.blur as string, input, { uDir: [1, 0], uSigma: sigma });
    const b = this.pass('blur', EFFECT_FS.blur as string, a, { uDir: [0, 1], uSigma: sigma });
    this.give(a);
    return b;
  }

  /** Apply one effect; gives back the target holding the result (the input is given back if it was replaced). */
  private effect(e: EffectNow, input: Target, pics: Pictures, layer: Layer): Target {
    const time = layer.local / Math.max(1, layer.fps);
    const p = e.p;
    const n = (k: string, d = 0) => (Number.isFinite(p[k]) ? (p[k] as number) : d);
    const run = (name: string, u: Record<string, number | number[] | [WebGLTexture, number, '3d'?]>): Target => {
      const out = this.pass(name, EFFECT_FS[name] as string, input, u);
      this.give(input);
      return out;
    };
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
        const wheel = (x: string, y: string, level: string, k: number) => {
          const c = wheelColor(n(x), n(y));
          const l = n(level) / 100;
          return c.map((v) => v * k + l) as [number, number, number];
        };
        const lift = wheel('liftX', 'liftY', 'lift', 0.15).map((v) => v * 0.5);
        const gamma = wheel('gammaX', 'gammaY', 'gamma', 0.25).map((v) => 1 + v);
        const gain = wheel('gainX', 'gainY', 'gain', 0.3).map((v) => 1 + v);
        return run('wheels', { uLift: lift, uGamma: gamma, uGain: gain });
      }
      case 'curves': {
        const tex = this.curveTexture(e);
        if (!tex) return input;
        return run('curves', { uCurve: [tex, 1], uMix: n('mix', 100) / 100 });
      }
      case 'lut': {
        const path = typeof e.d.path === 'string' ? e.d.path : '';
        const lut = path ? this.lutTexture(path, pics) : null;
        if (!lut) return input;
        return run('lut', { uLut: [lut.tex, 1, '3d'], uLutSize: lut.size, uMix: n('mix', 100) / 100 });
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
        return run('mask', {
          uShape: n('shape'),
          uCx: n('cx') / 100,
          uCy: n('cy') / 100,
          uW: (n('w', 40) / 100) * (this.h / this.w),
          uH: n('h', 50) / 100,
          uFeather: n('feather', 10) / 200,
          uInvert: n('invert'),
        });
      case 'mosaic':
        return run('mosaic', { uBlock: n('size', 24) * (this.h / this.seqH) });
      case 'grain':
        this.seed = (this.seed + 7.13) % 1000;
        return run('grain', { uAmount: n('amount', 20) / 100, uGrain: n('size', 1.5) * (this.h / this.seqH), uSeed: this.seed });
      case 'flip':
        return run('flip', { uH: n('h'), uV: n('v') });
      case 'glow': {
        const bright = this.pass('bright', EFFECT_FS.bright as string, input, { uThreshold: n('threshold', 65) / 100 });
        const soft = this.blur(bright, n('radius', 25));
        this.give(bright);
        const out = this.pass('add', EFFECT_FS.add as string, input, { uOther: [soft.tex, 1], uAmount: n('amount', 80) / 100 });
        this.give(soft);
        this.give(input);
        return out;
      }
      case 'shadow': {
        const a = (n('angle', 135) * Math.PI) / 180;
        const dist = n('distance', 12) * (this.h / this.seqH);
        const made = this.pass('shadowmake', EFFECT_FS.shadowmake as string, input, {
          uOffset: [Math.sin(a) * dist, -Math.cos(a) * dist * -1],
          uOpacity: n('opacity', 60) / 100,
        });
        const soft = this.blur(made, n('softness', 20));
        this.give(made);
        const out = this.pass('over', EFFECT_FS.over as string, soft, { uOther: [input.tex, 1] });
        this.give(soft);
        this.give(input);
        return out;
      }
      case 'cornerpin': {
        const k = this.h / this.seqH;
        const W = this.w;
        const H = this.h;
        // Where each corner of the frame goes (pixels from where it was; down is positive).
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
        return run('chromatic', { uAmount: n('amount', 30) * (this.h / this.seqH) });
      case 'glitch':
        return run('glitch', { uAmount: n('amount', 40) / 100, uTime: time, uSeedRate: n('speed', 50) / 10 });
      case 'zoomblur':
        return run('zoomblur', { uAmount: n('amount', 30) / 100, uCenter: [0.5 + n('cx') / 200, 0.5 - n('cy') / 200] });
      case 'dirblur': {
        const a = (n('angle') * Math.PI) / 180;
        const len = n('length', 30) * (this.h / this.seqH);
        return run('dirblur', { uDir: [Math.cos(a) * len, Math.sin(a) * len] });
      }
      case 'displace':
        return run('displace', { uAmount: n('amount', 30) * (this.h / this.seqH), uFreq: n('size', 50) / 10, uTime: time * (n('speed', 50) / 50) });
      case 'posterize':
        return run('posterize', { uLevels: Math.max(2, n('levels', 6)) });
      case 'edges':
        return run('edges', { uAmount: n('amount', 100) / 100, uInvert: n('invert') });
      case 'wave':
        return run('wave', { uAmount: n('amount', 20) * (this.h / this.seqH), uFreq: n('size', 30) / 10, uTime: time * (n('speed', 50) / 25) });
      case 'vhs':
        return run('vhs', { uAmount: n('amount', 50) / 100, uTime: time });
      default:
        return input;
    }
  }

  /** A layer drawn and its effects applied, in a target of its own (null: nothing to show). */
  private renderLayer(layer: Layer | null, pics: Pictures): Target | null {
    if (!layer) return null;
    let t = this.take();
    this.clear(t);
    if (!this.drawLayer(layer, pics, t)) {
      this.give(t);
      return null;
    }
    for (const e of layer.effects) t = this.effect(e, t, pics, layer);
    return t;
  }

  private composite(base: Target, top: Target, opacity: number, blend: string): Target {
    const out = this.pass('composite', COMPOSITE_FS, top, { uBase: [base.tex, 1], uOpacity: opacity, uMode: Math.max(0, BLEND_MODES.indexOf(blend)) });
    this.give(base);
    return out;
  }

  /** Stack layers into a new target (it is the caller's to give back). */
  private compose(ops: Op[], pics: Pictures): Target {
    let acc = this.take();
    this.clear(acc);
    for (const op of ops) {
      if (op.kind === 'layer') {
        const t = this.renderLayer(op.layer, pics);
        if (!t) continue;
        acc = this.composite(acc, t, op.layer.motion.opacity / 100, op.layer.motion.blend);
        this.give(t);
      } else if (op.kind === 'transition') {
        const a = this.renderLayer(op.from, pics);
        const b = this.renderLayer(op.to, pics);
        const type = Math.max(0, TRANSITION_TYPES.indexOf(op.type));
        const out = this.pass('transition', TRANSITION_FS, a ?? this.empty, {
          uB: [b ? b.tex : this.empty, 1],
          uP: op.progress,
          uType: type,
          uOpA: (op.from?.motion.opacity ?? 100) / 100,
          uOpB: (op.to?.motion.opacity ?? 100) / 100,
        });
        this.give(a);
        this.give(b);
        acc = this.composite(acc, out, 1, op.to?.motion.blend ?? op.from?.motion.blend ?? 'normal');
        this.give(out);
      } else {
        // An adjustment layer changes everything under it.
        let t = this.pass('copy', COPY_FS, acc, { uOpacity: 1 });
        for (const e of op.layer.effects) t = this.effect(e, t, pics, op.layer);
        const mixed = this.composite(acc, t, op.layer.motion.opacity / 100, 'normal');
        this.give(t);
        acc = mixed;
      }
    }
    return acc;
  }

  /** Draw a whole frame. With `flip`, the result is the right way up for reading back pixels. */
  render(ops: Op[], pics: Pictures, background: string, flip = false): void {
    const gl = this.gl;
    for (const t of this.targets) t.busy = false;
    gl.disable(gl.BLEND);
    const acc = this.compose(ops, pics);
    this.bindTarget(null);
    const p = this.program('final', FULL_VS, FINAL_FS);
    this.use(p, { uTex: [acc.tex, 0], uSize: [this.w, this.h], uBack: hexToRgb(background), uFlip: flip ? 1 : 0 });
    this.drawFull();
    this.give(acc);
  }

  /** A made picture (gradient, noise, particles, light leak) drawn into a target. */
  private generate(src: Extract<NonNullable<Layer['source']>, { kind: 'generator' }>, out: Target) {
    const st = src.settings;
    const num = (k: string, d: number) => (typeof st[k] === 'number' ? (st[k] as number) : d);
    const col = (k: string, d: string) => hexToRgb(typeof st[k] === 'string' ? (st[k] as string) : d);
    const kinds = ['gradient', 'noise', 'particles', 'lightleak', 'bars'];
    this.pass(
      'generator',
      GENERATOR_FS,
      this.empty,
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

  /** The finished frame, small, for the scopes (rows from the top). */
  readSmall(w: number, h: number): Uint8Array {
    const gl = this.gl;
    const out = new Uint8Array(w * h * 4);
    const tex = this.makeTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer() as WebGLFramebuffer;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    // Rows come bottom first: turn them over.
    const row = w * 4;
    const flipped = new Uint8Array(out.length);
    for (let y = 0; y < h; y++) flipped.set(out.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
    return flipped;
  }

  /** Forget a clip's picture (it was taken off the timeline). */
  forget(keys: string[]) {
    for (const k of keys) {
      const t = this.textures.get(k);
      if (t) this.gl.deleteTexture(t.tex);
      this.textures.delete(k);
    }
  }
}

const pixels = new Map<string, ImageData>();
function colorPixel(color: string): ImageData {
  let d = pixels.get(color);
  if (!d) {
    const [r, g, b] = hexToRgb(color);
    d = new ImageData(new Uint8ClampedArray([r * 255, g * 255, b * 255, 255]), 1, 1);
    pixels.set(color, d);
  }
  return d;
}

/** The 3×3 map from the unit square to four corners (top-left, top-right, bottom-right, bottom-left). */
export function squareToQuad(q: [number, number][]): number[] | null {
  const [p0, p1, p2, p3] = q as [[number, number], [number, number], [number, number], [number, number]];
  const dx1 = p1[0] - p2[0];
  const dx2 = p3[0] - p2[0];
  const dy1 = p1[1] - p2[1];
  const dy2 = p3[1] - p2[1];
  const sx = p0[0] - p1[0] + p2[0] - p3[0];
  const sy = p0[1] - p1[1] + p2[1] - p3[1];
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-9) return null;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  const a = p1[0] - p0[0] + g * p1[0];
  const b = p3[0] - p0[0] + h * p3[0];
  const d = p1[1] - p0[1] + g * p1[1];
  const e = p3[1] - p0[1] + h * p3[1];
  // Column-major for the GPU: maps (u, v, 1) to (x·w, y·w, w).
  return [a, d, g, b, e, h, p0[0], p0[1], 1];
}

export function invert3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  // m is column-major: columns (a,b,c), (d,e,f), (g,h,i).
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  return inv.map((x) => x / det);
}
