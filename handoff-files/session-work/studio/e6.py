root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/app/src/native.ts', [
("""  framesClose: (id: number) => invoke<void>('frames_close', { id }),""","""  framesClose: (id: number) => invoke<void>('frames_close', { id }),
  /** Read an original's frames deep (16 bits a channel, HDR as it is), for HDR films. */
  framesOpenDeep: (path: string, from: number, rate: number, width: number, height: number) =>
    invoke<number>('frames_open', { path, from, rate, width, height, deep: true }),
  /** An HDR file's signal copy for watching it in an HDR sequence (made once). */
  hdrCopy: (path: string, seconds: number) => invoke<string>('hdr_copy', { path, seconds }),"""),
])

edit('editor/app/src/player/engine.ts', [
("""import { cleanedSound } from './cleanvoice';""","""import { cleanedSound } from './cleanvoice';
import { mediaTransfer, onSignalCopy, signalCopy } from './hdrcopy';
import { isHdr, spaceOf } from '../render/hdr';"""),
("""  constructor() {
    this.cache.onReady = () => (this.dirty = true);
  }""","""  constructor() {
    this.cache.onReady = () => (this.dirty = true);
    onSignalCopy(() => (this.dirty = true));
  }

  /** An HDR sequence plays HDR files from their signal copies once made (null: the usual file). */
  private hdrFile(m: MediaItem): string | null {
    return isHdr(this.seq) && m.source?.hdr ? signalCopy(m) : null;
  }"""),
("""  private videoFile(m: MediaItem): string {
    return mediaUrl(playbackFile(m, this.proxies));
  }""","""  private videoFile(m: MediaItem): string {
    return mediaUrl(this.hdrFile(m) ?? playbackFile(m, this.proxies));
  }"""),
("""    const n = this.native;
    if (!n || !this.p) return false;""","""    const n = this.native;
    // HDR sequences are drawn by the WebGL path (it carries the HDR signal).
    if (!n || !this.p || isHdr(s)) return false;"""),
("""    c.resize(w, h, s.height);
    c.matte = this.matte;""","""    c.resize(w, h, s.height);
    c.matte = this.matte;
    c.space = spaceOf(s);"""),
("""    // Time remapping between two frames of a file: the second, once decoded (until then the first is shown alone).
    next: (layer: Layer) => {""","""    // HDR files in an HDR sequence: their own coding once their signal copy plays (the tone-mapped copy is SDR).
    transfer: (layer: Layer) => {
      const src = layer.source;
      if (src?.kind !== 'video' || !this.hdrFile(src.media)) return 'sdr';
      return mediaTransfer(src.media);
    },
    // Time remapping between two frames of a file: the second, once decoded (until then the first is shown alone).
    next: (layer: Layer) => {"""),
])

edit('editor/app/src/cache/manager.ts', [
("""  plan(p: Project, s: Sequence = current(p), proxies = this.focus().proxies): Segment[] {
    const m = this.memo;""","""  plan(p: Project, s: Sequence = current(p), proxies = this.focus().proxies): Segment[] {
    // HDR sequences aren't cached (the cache holds SDR pictures).
    if (isHdr(s)) return [];
    const m = this.memo;"""),
("""import { cachedOps } from './ops';""","""import { cachedOps } from './ops';
import { isHdr } from '../render/hdr';"""),
])
