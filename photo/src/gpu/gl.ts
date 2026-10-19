// Small WebGL2 helpers: programs with cached uniform locations, textures,
// render targets.

import { VS } from './shaders';

export class Program {
  readonly gl: WebGL2RenderingContext;
  readonly prog: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();
  private units = new Map<string, number>();

  constructor(gl: WebGL2RenderingContext, fs: string, vs = VS) {
    this.gl = gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(`Shader failed to compile: ${log}`);
      }
      return sh;
    };
    const v = compile(gl.VERTEX_SHADER, vs),
      f = compile(gl.FRAGMENT_SHADER, fs);
    const p = gl.createProgram()!;
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Shader failed to link: ${gl.getProgramInfoLog(p)}`);
    this.prog = p;
  }

  use(): this {
    this.gl.useProgram(this.prog);
    this.units.clear();
    return this;
  }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.prog, name);
      this.locs.set(name, l);
    }
    return l;
  }

  i(name: string, v: number): this {
    this.gl.uniform1i(this.loc(name), v);
    return this;
  }
  f(name: string, v: number): this {
    this.gl.uniform1f(this.loc(name), v);
    return this;
  }
  v2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this.loc(name), x, y);
    return this;
  }
  iv2(name: string, x: number, y: number): this {
    this.gl.uniform2i(this.loc(name), x, y);
    return this;
  }
  v3(name: string, x: number, y: number, z: number): this {
    this.gl.uniform3f(this.loc(name), x, y, z);
    return this;
  }
  v4(name: string, x: number, y: number, z: number, w: number): this {
    this.gl.uniform4f(this.loc(name), x, y, z, w);
    return this;
  }
  m3(name: string, m: Float32Array | number[]): this {
    this.gl.uniformMatrix3fv(this.loc(name), false, m);
    return this;
  }
  /** Has a texture been bound to this sampler since use()? */
  has(name: string): boolean {
    return this.units.has(name);
  }

  /** Bind a texture to the next free unit. */
  tex(name: string, t: WebGLTexture | null): this {
    let unit = this.units.get(name);
    if (unit === undefined) {
      unit = this.units.size;
      this.units.set(name, unit);
    }
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(this.loc(name), unit);
    return this;
  }

  dispose(): void {
    this.gl.deleteProgram(this.prog);
  }
}

export interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
  internal: number;
}

/**
 * Make and upload textures on a unit no program uses, so a draw's bindings
 * (set unit by unit while its uniforms are filled) are never replaced.
 */
export function scratchUnit(gl: WebGL2RenderingContext): void {
  gl.activeTexture(gl.TEXTURE15);
}

export function makeTexture(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  internal: number,
  format: number,
  type: number,
  filter: number = gl.NEAREST,
  data: ArrayBufferView | null = null,
): WebGLTexture {
  const t = gl.createTexture()!;
  scratchUnit(gl);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  return t;
}

export function makeTarget(gl: WebGL2RenderingContext, w: number, h: number, internal: number, filter: number = gl.NEAREST): Target {
  const format = gl.RGBA;
  const type = internal === gl.RGBA8 ? gl.UNSIGNED_BYTE : internal === gl.RGBA16F ? gl.HALF_FLOAT : gl.FLOAT;
  const tex = makeTexture(gl, w, h, internal, format, type, filter);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) {
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fbo);
    throw new Error('This graphics card cannot draw into that kind of texture.');
  }
  return { tex, fbo, w, h, internal };
}

export function freeTarget(gl: WebGL2RenderingContext, t: Target | null | undefined): void {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}

/** Draw the full-screen triangle into a target region. */
export function drawInto(gl: WebGL2RenderingContext, t: Target | null, x: number, y: number, w: number, h: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
  gl.viewport(x, y, w, h);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export function clearTarget(gl: WebGL2RenderingContext, t: Target, w = t.w, h = t.h): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  gl.viewport(0, 0, w, h);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.SCISSOR_TEST);
}
