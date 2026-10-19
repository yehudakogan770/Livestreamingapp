p = 'render/compositor.ts'
s = open(p).read()


def rep(a, b):
    global s
    assert a in s, a
    s = s.replace(a, b, 1)


rep("""import type { EffectNow, Layer, MotionNow, Op } from './frame';
""", """import { flowSize, opticalFlow, toGray, type Gray } from './flow';
import { shifted, type EffectNow, type Layer, type MotionNow, type Op } from './frame';
import { ACCUM_FS, FLOW_WARP_FS, FRAME_MIX_FS } from './motionfx';
import { drawShape, shapeStamp } from './shape';
""")
rep("""  picture(layer: Layer): Source | null;
""", """  picture(layer: Layer): Source | null;
  /** The second frame of a remapped clip between two of its file's frames (blended or interpolated), if ready. */
  next?(layer: Layer): Source | null;
""")
rep("""  private textCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
""", """  private textCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  /** Optical flow between a clip's two frames, kept while the same two are shown. */
  private flows = new Map<string, { tex: WebGLTexture; stamp: string; w: number; h: number }>();
  /** A small target pictures are read back from (for optical flow). */
  private small: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;
""")
# generic canvas for text and shapes
rep("""  private textSource(layer: Layer): Source | null {
    if (layer.source?.kind !== 'text') return null;
    if (!this.textCanvas)""", """  private textSource(layer: Layer): Source | null {
    const src = layer.source;
    if (src?.kind !== 'text' && src?.kind !== 'shape') return null;
    if (!this.textCanvas)""")
rep("""    drawText(ctx, layer.source.text, this.w, this.h, layer.source.local, layer.source.length, layer.fps);
    return c;""", """    if (src.kind === 'shape') drawShape(ctx, src.shape, this.w, this.h, src.local);
    else drawText(ctx, src.text, this.w, this.h, src.local, src.length, layer.fps);
    return c;""")
rep("""    } else if (src.kind === 'text') {
      // Words are drawn again only when they look different (while they come on or go off, or are changed).
      const key = `text:${layer.key}`;
      const stamp = `${this.w}x${this.h}|${textStamp(src.text, src.local, src.length, layer.fps)}`;""", """    } else if (src.kind === 'text' || src.kind === 'shape') {
      // Words and shapes are drawn again only when they look different (while they animate, or are changed).
      const key = `text:${layer.key}`;
      const look = src.kind === 'shape' ? shapeStamp(src.shape, src.local) : textStamp(src.text, src.local, src.length, layer.fps);
      const stamp = `${this.w}x${this.h}|${look}`;""")
rep("""      const up = this.upload(src.kind === 'image' ? `img:${src.media.id}` : `vid:${layer.key}`, pic, stamp);
      if (!up) return false;
      tex = up.tex;
      sw = up.w;
      sh = up.h;
    }
    this.place(tex, sw, sh, layer.motion, target);
    this.give(nested);
    return true;
  }
""", """      const up = this.upload(src.kind === 'image' ? `img:${src.media.id}` : `vid:${layer.key}`, pic, stamp);
      if (!up) return false;
      tex = up.tex;
      sw = up.w;
      sh = up.h;
      // Time remapping between two of the file's frames: blended, or interpolated along the optical flow.
      const between = src.kind === 'video' && src.next ? this.between(layer, up.tex, up.w, up.h, pics) : null;
      if (between) {
        nested = between;
        tex = between.tex;
      }
    }
    if (layer.motionBlur) this.placeBlurred(tex, sw, sh, layer, target);
    else this.place(tex, sw, sh, layer.motion, target);
    this.give(nested);
    return true;
  }

  /** Motion blur: the picture drawn where it is at each moment the shutter is open, averaged. */
  private placeBlurred(tex: WebGLTexture, sw: number, sh: number, layer: Layer, target: Target) {
    const mb = layer.motionBlur as NonNullable<Layer['motionBlur']>;
    const n = mb.samples.length;
    let acc: Target | null = null;
    const one = this.take();
    for (const m of mb.samples) {
      this.clear(one);
      this.place(tex, sw, sh, shifted(m, mb.base, layer.motion), one);
      const next: Target = acc ? this.pass('accum', ACCUM_FS, one, { uBase: [acc.tex, 1], uW: 1 / n }) : this.pass('copy', COPY_FS, one, { uOpacity: 1 / n });
      this.give(acc);
      acc = next;
    }
    this.give(one);
    if (acc) this.pass('copy', COPY_FS, acc, { uOpacity: 1 }, target);
    this.give(acc);
  }

  /** A remapped clip's picture between two frames of its file (null: the second frame isn't ready, the first is shown). */
  private between(layer: Layer, texA: WebGLTexture, sw: number, sh: number, pics: Pictures): Target | null {
    const src = layer.source;
    if (src?.kind !== 'video' || !src.next || !pics.next) return null;
    const picB = pics.next(layer);
    if (!picB) return null;
    const upB = this.upload(`vid2:${layer.key}`, picB, '');
    if (!upB) return null;
    if (src.next.mode === 'blend') return this.pass('framemix', FRAME_MIX_FS, texA, { uB: [upB.tex, 1], uMix: src.next.mix });
    const flow = this.flowBetween(layer.key, `${src.media.id}|${src.time}|${src.next.time}`, texA, upB.tex, sw, sh);
    if (!flow) return this.pass('framemix', FRAME_MIX_FS, texA, { uB: [upB.tex, 1], uMix: src.next.mix });
    return this.pass('flowwarp', FLOW_WARP_FS, texA, { uB: [upB.tex, 1], uFlow: [flow.tex, 2], uFlowSize: [flow.w, flow.h], uMix: src.next.mix });
  }

  /** A picture made small and gray, read back for working out optical flow. */
  private grayOf(tex: WebGLTexture, w: number, h: number): Gray {
    const gl = this.gl;
    if (!this.small || this.small.w !== w || this.small.h !== h) {
      if (this.small) {
        gl.deleteFramebuffer(this.small.fb);
        gl.deleteTexture(this.small.tex);
      }
      const t = this.makeTexture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer() as WebGLFramebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      this.small = { fb, tex: t, w, h };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.small.fb);
    gl.viewport(0, 0, w, h);
    this.use(this.program('copy', FULL_VS, COPY_FS), { uTex: [tex, 0], uSize: [w, h], uOpacity: 1 });
    this.drawFull();
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return toGray(px, w, h);
  }

  /** The optical flow from one frame to the next (worked out once for each pair). */
  private flowBetween(key: string, stamp: string, a: WebGLTexture, b: WebGLTexture, sw: number, sh: number): { tex: WebGLTexture; w: number; h: number } | null {
    const have = this.flows.get(key);
    if (have && have.stamp === stamp) return have;
    const gl = this.gl;
    const [w, h] = flowSize(sw, sh);
    try {
      const flow = opticalFlow(this.grayOf(a, w, h), this.grayOf(b, w, h));
      const f = have ?? { tex: this.makeTexture(), stamp: '', w: 0, h: 0 };
      gl.bindTexture(gl.TEXTURE_2D, f.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, w, h, 0, gl.RG, gl.FLOAT, flow.data);
      Object.assign(f, { stamp, w, h });
      this.flows.set(key, f);
      return f;
    } catch {
      return null;
    }
  }
""")
rep("""        const mixed = this.composite(acc, t, op.layer.motion.opacity / 100, 'normal');""",
    """        const mixed = this.composite(acc, t, op.layer.motion.opacity / 100, op.layer.motion.blend ?? 'normal');""")
open(p, 'w').write(s)
