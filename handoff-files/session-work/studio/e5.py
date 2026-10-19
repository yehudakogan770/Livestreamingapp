root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/app/src/render/compositor.ts', [
("""import { OUT_FS } from './shaders';

type Source = TexImageSource;""","""import { OUT_FS } from './shaders';
import { READ_FS, SCREEN_FS, sdrToSpace, TO_SPACE_FS, TRANSFER_CODE, transferOf, type ColorSpace, type Transfer } from './hdr';

/** A picture with more than 8 bits a channel (HDR read through FFmpeg): RGBA, top row first, 0–1. */
export interface DeepPicture {
  deep: Float32Array;
  width: number;
  height: number;
  /** Changes when the pixels do. */
  stamp: string;
}
type Source = TexImageSource | DeepPicture;
const isDeep = (s: unknown): s is DeepPicture => typeof s === 'object' && s !== null && 'deep' in s;"""),
("""  /** An AI mask's matte at this frame""","""  /** How a layer's picture codes brightness (SDR unless said; HDR files read as they are say PQ or HLG). */
  transfer?(layer: Layer): Transfer;
  /** An AI mask's matte at this frame"""),
("""const sizeOf = (s: Source): [number, number] => {
  if (typeof HTMLVideoElement""","""const sizeOf = (s: Source): [number, number] => {
  if (isDeep(s)) return [s.width, s.height];
  if (typeof HTMLVideoElement"""),
("""export function pictureStamp(pic: Source): string {
  if (typeof HTMLVideoElement""","""export function pictureStamp(pic: Source): string {
  if (isDeep(pic)) return `d|${pic.stamp}`;
  if (typeof HTMLVideoElement"""),
("""  /** The layer being drawn is showing a matte (its later effects are skipped). */
  private matteShown = false;""","""  /** The layer being drawn is showing a matte (its later effects are skipped). */
  private matteShown = false;
  /** The sequence's color space: HDR sequences are made in PQ or HLG (see render/hdr.ts). */
  space: ColorSpace = 'rec709';
  /** Keep a small copy of each frame's HDR signal for the scopes (its size), or null. */
  signalSize: { w: number; h: number } | null = null;
  private signal: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;"""),
("""        if (k === 'uMode' || k === 'uType' || k === 'uGen') gl.uniform1i(loc, v);""","""        if (k === 'uMode' || k === 'uType' || k === 'uGen' || k === 'uFrom' || k === 'uTo' || k === 'uTf') gl.uniform1i(loc, v);"""),
# upload deep
("""    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (t.stamp !== stamp || stamp === '') {
      try {
        // The same size as last time""","""    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (isDeep(src)) {
      if (t.stamp !== stamp || stamp === '') {
        // HDR pixels as they are (half floats on the GPU), without the premultiplying meant for pictures.
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, this.float ? gl.RGBA16F : gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, src.deep);
        } catch {
          t.w = 0;
          return null;
        } finally {
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        }
        t.w = w;
        t.h = h;
        t.stamp = stamp;
      }
      return { tex: t.tex, w, h };
    }
    if (t.stamp !== stamp || stamp === '') {
      try {
        // The same size as last time"""),
("""        if (t.w === w && t.h === h) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);""","""        const pic = src as TexImageSource;
        // A deep picture was here before: its storage is made again as 8-bit.
        if (t.w === w && t.h === h && !t.stamp.startsWith('d|')) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, pic);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pic);"""),
# renderLayer conversion
("""    if (!this.drawLayer(layer, pics, t)) {
      this.give(t);
      return null;
    }
    this.matteShown = false;""","""    if (!this.drawLayer(layer, pics, t)) {
      this.give(t);
      return null;
    }
    // HDR sequences: the picture brought into the sequence's coding (nested sequences already are).
    if (this.space !== 'rec709' && layer.source?.kind !== 'nested') {
      const from = layer.source?.kind === 'video' || layer.source?.kind === 'image' ? (pics.transfer?.(layer) ?? 'sdr') : 'sdr';
      const to = transferOf(this.space);
      if (from !== to) {
        const out = this.pass('tospace', TO_SPACE_FS, t, { uFrom: TRANSFER_CODE[from], uTo: TRANSFER_CODE[to] });
        this.give(t);
        t = out;
      }
    }
    this.matteShown = false;"""),
# render final
("""    const acc = this.compose(ops, pics);
    this.sweep();
    this.bindTarget(null);
    const p = this.program('final', FULL_VS, FINAL_FS);
    this.use(p, { uTex: [acc.tex, 0], uSize: [this.w, this.h], uBack: hexToRgb(background), uFlip: flip ? 1 : 0 });
    this.drawFull();
    this.give(acc);
  }""","""    const acc = this.compose(ops, pics);
    this.sweep();
    if (this.space !== 'rec709') {
      if (this.signalSize) this.keepSignal(acc, background);
      this.bindTarget(null);
      // HDR: shown tone-mapped for this (SDR) screen.
      const p = this.program('screen', FULL_VS, SCREEN_FS);
      this.use(p, { uTex: [acc.tex, 0], uBack: this.back(background), uFlip: flip ? 1 : 0, uTf: TRANSFER_CODE[transferOf(this.space)] });
      this.drawFull();
      this.give(acc);
      return;
    }
    this.bindTarget(null);
    const p = this.program('final', FULL_VS, FINAL_FS);
    this.use(p, { uTex: [acc.tex, 0], uSize: [this.w, this.h], uBack: hexToRgb(background), uFlip: flip ? 1 : 0 });
    this.drawFull();
    this.give(acc);
  }

  /** The background color in the sequence's space. */
  private back(background: string): [number, number, number] {
    return sdrToSpace(hexToRgb(background) as [number, number, number], this.space);
  }

  /** A small copy of the frame's HDR signal (over the background), for the scopes. */
  private keepSignal(acc: Target, background: string) {
    const gl = this.gl;
    const size = this.signalSize;
    if (!size) return;
    let s = this.signal;
    if (!s || s.w !== size.w || s.h !== size.h) {
      if (s) {
        gl.deleteFramebuffer(s.fb);
        gl.deleteTexture(s.tex);
      }
      const tex = this.makeTexture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size.w, size.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer() as WebGLFramebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      s = { fb, tex, w: size.w, h: size.h };
      this.signal = s;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb);
    gl.viewport(0, 0, s.w, s.h);
    this.use(this.program('read', FULL_VS, READ_FS), { uTex: [acc.tex, 0], uBack: this.back(background), uAlpha: 0, uTf: -1 });
    this.drawFull();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** The last frame's HDR signal, small (rows from the top), when the scopes asked for it; else what the screen shows. */
  readSignal(w: number, h: number): Uint8Array {
    const s = this.signal;
    if (this.space === 'rec709' || !s || s.w !== w || s.h !== h) return this.readSmall(w, h);
    const gl = this.gl;
    const out = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // READ_FS already turned it the right way up.
    return out;
  }"""),
# readFrame
("""  readFrame(ops: Op[], pics: Pictures, background: string, alpha: boolean): Uint8Array {
    const gl = this.gl;
    for (const t of this.targets) t.busy = false;
    gl.disable(gl.BLEND);
    const acc = this.compose(ops, pics);
    this.sweep();
    let o = this.outTarget;""","""  readFrame(ops: Op[], pics: Pictures, background: string, alpha: boolean, deep = false): Uint8Array {
    const gl = this.gl;
    for (const t of this.targets) t.busy = false;
    gl.disable(gl.BLEND);
    const acc = this.compose(ops, pics);
    this.sweep();
    if (this.space !== 'rec709') return this.readHdr(acc, background, alpha, deep);
    let o = this.outTarget;"""),
("""  /** A made picture (gradient, noise, particles, light leak) drawn into a target. */""","""  private deepOut: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number; float: boolean } | null = null;

  /**
   * An HDR sequence's frame read back: with \\`deep\\`, its signal as 16-bit
   * RGBA (little-endian, for FFmpeg's rgba64le) for HDR films; otherwise
   * tone-mapped to SDR as 8-bit RGBA.
   */
  private readHdr(acc: Target, background: string, alpha: boolean, deep: boolean): Uint8Array {
    const gl = this.gl;
    const float = deep && this.float;
    let o = this.deepOut;
    if (!o || o.w !== this.w || o.h !== this.h || o.float !== float) {
      if (o) {
        gl.deleteFramebuffer(o.fb);
        gl.deleteTexture(o.tex);
      }
      const tex = this.makeTexture();
      if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.w, this.h, 0, gl.RGBA, gl.FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer() as WebGLFramebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      o = { fb, tex, w: this.w, h: this.h, float };
      this.deepOut = o;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, o.fb);
    gl.viewport(0, 0, this.w, this.h);
    this.use(this.program('read', FULL_VS, READ_FS), {
      uTex: [acc.tex, 0],
      uBack: this.back(background),
      uAlpha: alpha ? 1 : 0,
      uTf: deep ? -1 : TRANSFER_CODE[transferOf(this.space)],
    });
    this.drawFull();
    this.give(acc);
    const n = this.w * this.h * 4;
    if (!deep) {
      const px = new Uint8Array(n);
      gl.readPixels(0, 0, this.w, this.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return px;
    }
    const words = new Uint16Array(n);
    if (float) {
      const f = new Float32Array(n);
      gl.readPixels(0, 0, this.w, this.h, gl.RGBA, gl.FLOAT, f);
      for (let i = 0; i < n; i++) words[i] = Math.round(Math.max(0, Math.min(1, f[i] as number)) * 65535);
    } else {
      // No float targets on this computer: 8 bits stretched to 16.
      const px = new Uint8Array(n);
      gl.readPixels(0, 0, this.w, this.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < n; i++) words[i] = (px[i] as number) * 257;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return new Uint8Array(words.buffer);
  }

  /** A made picture (gradient, noise, particles, light leak) drawn into a target. */"""),
])
