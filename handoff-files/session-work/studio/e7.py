root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/app/src/export/exporter.ts', [
("""import { Compositor, type Pictures } from '../render/compositor';""","""import { Compositor, type DeepPicture, type Pictures } from '../render/compositor';
import { isHdr, spaceOf, type Transfer } from '../render/hdr';
import { mediaTransfer } from '../player/hdrcopy';"""),
("""  /** Where the picture is (for joining with the sound). */
  file: string;
}""","""  /** Where the picture is (for joining with the sound). */
  file: string;
  /** HDR: frames go to FFmpeg as 16-bit RGBA (rgba64le) in the sequence's PQ or HLG coding. */
  deep?: boolean;
}"""),
("""export class FfmpegReader {
  private id: number | null = null;
  /** The file time of the next frame FFmpeg will hand over. */
  private expect = -Infinity;
  private cur: ImageData | null = null;
  used = 0;
  constructor(
    private path: string,
    private width: number,
    private height: number,
    /** File seconds per frame of the film. */
    private step: number,
  ) {}""","""export class FfmpegReader {
  private id: number | null = null;
  /** The file time of the next frame FFmpeg will hand over. */
  private expect = -Infinity;
  private cur: ImageData | DeepPicture | null = null;
  private count = 0;
  used = 0;
  constructor(
    private path: string,
    private width: number,
    private height: number,
    /** File seconds per frame of the film. */
    private step: number,
    /** HDR films: the signal as it is, 16 bits a channel. */
    private deep = false,
  ) {}"""),
("""  async at(t: number): Promise<ImageData | null> {""","""  async at(t: number): Promise<ImageData | DeepPicture | null> {"""),
("""      id = await native.framesOpen(this.path, Math.max(0, t), 1 / Math.abs(this.step || 1 / 30), this.width, this.height);""","""      const open = this.deep ? native.framesOpenDeep : native.framesOpen;
      id = await open(this.path, Math.max(0, t), 1 / Math.abs(this.step || 1 / 30), this.width, this.height);"""),
("""    if (bytes.length !== this.width * this.height * 4) {""","""    if (bytes.length !== this.width * this.height * (this.deep ? 8 : 4)) {"""),
("""    this.cur = new ImageData(new Uint8ClampedArray(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.length), this.width, this.height);
    return this.cur;""","""    this.cur = this.deep ? deepPicture(bytes, this.width, this.height, `${this.path}|${++this.count}`) : new ImageData(new Uint8ClampedArray(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.length), this.width, this.height);
    return this.cur;"""),
("""/** Frames a reader passes over rather than starting FFmpeg again. */""","""/** 16-bit RGBA (little-endian) as a deep picture (0–1, fully opaque). */
export function deepPicture(bytes: Uint8Array, width: number, height: number, stamp: string): DeepPicture {
  const n = width * height * 4;
  const deep = new Float32Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) deep[i] = (i & 3) === 3 ? 1 : view.getUint16(i * 2, true) / 65535;
  return { deep, width, height, stamp };
}

/** Frames a reader passes over rather than starting FFmpeg again. */"""),
("""  /** Decoded frames for the frame being drawn, by clip. */
  frames = new Map<string, TexImageSource>();

  constructor(
    /** The film's size (frames read through FFmpeg are made no bigger). */
    private size: { width: number; height: number },
    private fps: number,
  ) {}""","""  /** Decoded frames for the frame being drawn, by clip. */
  frames = new Map<string, TexImageSource | DeepPicture>();
  /** How each frame codes brightness (HDR files read deep keep theirs). */
  private transfers = new Map<string, Transfer>();

  constructor(
    /** The film's size (frames read through FFmpeg are made no bigger). */
    private size: { width: number; height: number },
    private fps: number,
    /** An HDR film: files read through FFmpeg keep their signal (16 bits a channel). */
    private deep = false,
  ) {}"""),
("""    for (const f of this.frames.values()) if (typeof VideoFrame !== 'undefined' && f instanceof VideoFrame) f.close();
    this.frames.clear();
    // Every layer, including the ones inside nested sequences.""","""    for (const f of this.frames.values()) if (typeof VideoFrame !== 'undefined' && f instanceof VideoFrame) f.close();
    this.frames.clear();
    this.transfers.clear();
    // Every layer, including the ones inside nested sequences."""),
("""        f = new FfmpegReader(route.path, w, h, readerStep(l.clip, l.local, m, this.fps));
        this.ffReaders.set(key, f);
      }
      f.used = frame;
      const img = await f.at(time);
      if (img) this.frames.set(key, img);
      return;""","""        f = new FfmpegReader(route.path, w, h, readerStep(l.clip, l.local, m, this.fps), this.deep);
        this.ffReaders.set(key, f);
      }
      f.used = frame;
      const img = await f.at(time);
      if (img) {
        this.frames.set(key, img);
        if (this.deep) this.transfers.set(key, mediaTransfer(l.source.media));
      }
      return;"""),
("""    next: (layer: Layer) => this.frames.get(`${layer.key}#next`) ?? null,
    cube: (path: string) => this.cubes.get(path) ?? null,""","""    next: (layer: Layer) => this.frames.get(`${layer.key}#next`) ?? null,
    transfer: (layer: Layer) => this.transfers.get(layer.key) ?? 'sdr',
    cube: (path: string) => this.cubes.get(path) ?? null,"""),
# picture(): set space
("""    const gl = new Compositor(canvas);
    gl.resize(width, height, s.height);
    const file = codec === 'avc' ? 'video.mp4' : 'video.webm';""","""    const gl = new Compositor(canvas);
    gl.resize(width, height, s.height);
    // An HDR sequence made as an SDR film: tone-mapped to Rec. 709.
    gl.space = spaceOf(s);
    const file = codec === 'avc' ? 'video.mp4' : 'video.webm';"""),
("""    const gl = new Compositor(canvas);
    gl.resize(width, height, s.height);
    const readText = (p: string) => native.readText(p);
    const share = this.o.pictureOnly ? 1 : 0.86;
    const encode = async (args: string[]): Promise<{ sent: number; error: Error | null }> => {
      const id = await manageNative.encodeOpen(args, tmp, this.o.out, width * height * 4);
      const sources = new Sources({ width, height }, fps);""","""    const gl = new Compositor(canvas);
    gl.resize(width, height, s.height);
    gl.space = spaceOf(s);
    // HDR films get the signal itself, 16 bits a channel; SDR films of an HDR sequence get it tone-mapped.
    const deep = !!pipe.deep && isHdr(s);
    const readText = (p: string) => native.readText(p);
    const share = this.o.pictureOnly ? 1 : 0.86;
    const encode = async (args: string[]): Promise<{ sent: number; error: Error | null }> => {
      const id = await manageNative.encodeOpen(args, tmp, this.o.out, width * height * (deep ? 8 : 4));
      const sources = new Sources({ width, height }, fps, deep);"""),
("""          await manageNative.encodeFrame(id, gl.readFrame(ops, sources.pictures, s.background, pipe.alpha));""","""          await manageNative.encodeFrame(id, gl.readFrame(ops, sources.pictures, s.background, pipe.alpha, deep));"""),
])
