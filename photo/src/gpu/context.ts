// The app's one WebGL2 context: what the graphics card can do, the compiled
// programs (per document depth), and the scratch textures every document's
// compositor shares (only one draws at a time).

import { Program, makeTarget, freeTarget, type Target } from './gl';
import { layerFS, adjustFS, mixFS, COPY_FS, RESAMPLE_FS, BLUR_FS, JFA_INIT_FS, JFA_STEP_FS, FX_FS, VIEW_FS } from './shaders';
import type { Depth } from '../core/types';

export interface Caps {
  maxTexture: number;
  floatTargets: boolean;
  renderer: string;
}

export class GPU {
  readonly gl: WebGL2RenderingContext;
  readonly caps: Caps;
  private programs = new Map<string, Program>();
  private vao: WebGLVertexArrayObject;
  /** Scratch stacks for compositing: [level][a, b]. */
  private stacks = new Map<string, Target[][]>();
  private fx = new Map<string, Target>();
  lost = false;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.caps = {
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      floatTargets,
      renderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'WebGL2',
    };
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
  }

  program(key: string, depth: Depth | 0 = 0): Program {
    const k = `${key}:${depth}`;
    let p = this.programs.get(k);
    if (!p) {
      const d = (depth || 8) as Depth;
      const fs =
        key === 'layer'
          ? layerFS(d)
          : key === 'adjust'
            ? adjustFS(d)
            : key === 'mix'
              ? mixFS(d)
              : key === 'copy'
                ? COPY_FS
                : key === 'resample'
                  ? RESAMPLE_FS
                  : key === 'blur'
                    ? BLUR_FS
                    : key === 'jfaInit'
                      ? JFA_INIT_FS
                      : key === 'jfaStep'
                        ? JFA_STEP_FS
                        : key === 'fx'
                          ? FX_FS
                          : VIEW_FS;
      p = new Program(this.gl, fs);
      this.programs.set(k, p);
    }
    this.gl.bindVertexArray(this.vao);
    return p.use();
  }

  /** The scratch format for compositing at a document depth. */
  scratchFormat(depth: Depth): number {
    const gl = this.gl;
    if (!this.caps.floatTargets) return gl.RGBA8;
    return depth === 8 ? gl.RGBA16F : gl.RGBA32F;
  }

  /** The pair of scratch targets for a nesting level. */
  stack(depth: Depth, level: number, size: number): Target[] {
    const key = `${depth}:${size}`;
    let list = this.stacks.get(key);
    if (!list) {
      list = [];
      this.stacks.set(key, list);
    }
    while (list.length <= level) {
      const f = this.scratchFormat(depth);
      list.push([makeTarget(this.gl, size, size, f), makeTarget(this.gl, size, size, f)]);
    }
    return list[level]!;
  }

  /** A named effect target (RGBA16F, linear filtering), at least w × h. */
  fxTarget(name: string, w: number, h: number): Target {
    const gl = this.gl;
    let t = this.fx.get(name);
    if (t && (t.w < w || t.h < h)) {
      freeTarget(gl, t);
      t = undefined;
    }
    if (!t) {
      const f = this.caps.floatTargets ? gl.RGBA16F : gl.RGBA8;
      t = makeTarget(gl, Math.max(16, w), Math.max(16, h), f, gl.LINEAR);
      this.fx.set(name, t);
    }
    return t;
  }

  /** Let the scratch textures go (another document size next, or memory is low). */
  releaseScratch(): void {
    for (const list of this.stacks.values()) for (const pair of list) for (const t of pair) freeTarget(this.gl, t);
    this.stacks.clear();
    for (const t of this.fx.values()) freeTarget(this.gl, t);
    this.fx.clear();
  }
}
