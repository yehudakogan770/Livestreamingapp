root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/app/src/export/ffargs.ts', [
("""import { exactRate } from '../model/types';""","""import { exactRate } from '../model/types';
import { hdrTags, type ColorSpace } from '../render/hdr';"""),
("""export function encodeArgs(enc: string, v: VideoSpec, fps: number): string[] {
  const pix = pixelFormat(enc, v);
  const bt709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];""","""export function encodeArgs(enc: string, v: VideoSpec, fps: number, space: ColorSpace = 'rec709'): string[] {
  const pix = pixelFormat(enc, v);
  // HDR films carry Rec. 2020 and PQ or HLG (and, from x265, the HDR10 details); everything else Rec. 709.
  const bt709 = v.hdr && space !== 'rec709' ? hdrTags(space, enc) : ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];"""),
("""['-preset', 'medium', '-profile:v', ten ? 'main10' : 'main', '-x265-params', 'log-level=error']""","""['-preset', 'medium', '-profile:v', ten ? 'main10' : 'main', ...(v.hdr && space !== 'rec709' ? [] : ['-x265-params', 'log-level=error'])]"""),
("""export function filterChain(v: VideoSpec, render: FrameSize, out: FrameSize, seqFps: number): string {""","""export function filterChain(v: VideoSpec, render: FrameSize, out: FrameSize, seqFps: number, space: ColorSpace = 'rec709'): string {"""),
("""  const color = yuv ? ':out_color_matrix=bt709:out_range=tv' : '';""","""  const color = yuv ? `:out_color_matrix=${v.hdr && space !== 'rec709' ? 'bt2020' : 'bt709'}:out_range=tv` : '';"""),
("""export function pictureArgs(p: DeliveryPreset, enc: string, seqFps: number, render: FrameSize, out: FrameSize): string[] {
  const v = p.video;
  if (!v) throw new Error('This preset makes no picture.');
  return [
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',""","""export function pictureArgs(p: DeliveryPreset, enc: string, seqFps: number, render: FrameSize, out: FrameSize, space: ColorSpace = 'rec709'): string[] {
  const v = p.video;
  if (!v) throw new Error('This preset makes no picture.');
  const hdr = !!v.hdr && space !== 'rec709';
  return [
    '-f',
    'rawvideo',
    '-pix_fmt',
    // HDR frames come 16 bits a channel.
    hdr ? 'rgba64le' : 'rgba',"""),
("""    '-vf',
    filterChain(v, render, out, seqFps),
    ...encodeArgs(enc, v, v.fps ?? seqFps),""","""    '-vf',
    filterChain(v, render, out, seqFps, space),
    ...encodeArgs(enc, v, v.fps ?? seqFps, space),"""),
("""  if (v.codec !== 'h264' || v.bitDepth !== 8 || v.alpha || v.fps !== null) return true;""","""  if (v.codec !== 'h264' || v.bitDepth !== 8 || v.alpha || v.fps !== null || v.hdr) return true;"""),
])

edit('editor/app/src/export/deliver.ts', [
("""      pipe: {
        args: pictureArgs(preset, enc.name, s.fps, render, out),
        render,
        alpha: v.alpha,
        file: pictureFile(preset),
        ...(fb ? { fallback: pictureArgs(preset, fb.name, s.fps, render, out) } : {}),
      },""","""      pipe: {
        args: pictureArgs(preset, enc.name, s.fps, render, out, spaceOf(s)),
        render,
        alpha: v.alpha,
        file: pictureFile(preset),
        ...(fb ? { fallback: pictureArgs(preset, fb.name, s.fps, render, out, spaceOf(s)) } : {}),
        ...(v.hdr && isHdr(s) ? { deep: true } : {}),
      },"""),
])
