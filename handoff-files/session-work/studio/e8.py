root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/app/src/export/presets.ts', [
("""  dnxhr?: DnxhrProfile;
  hardware: HardwarePref;
}""","""  dnxhr?: DnxhrProfile;
  hardware: HardwarePref;
  /** HDR: made in the sequence's HDR space (PQ or HLG, Rec. 2020), 10-bit, with HDR tags (an HDR sequence only). */
  hdr?: boolean;
}"""),
("""  {
    id: 'prores-hq',""","""  {
    id: 'hdr-web',
    name: 'HDR for YouTube and Vimeo (H.265)',
    group: 'web',
    note: 'H.265 10-bit, Rec. 2020 with PQ (HDR10 details) or HLG, as the sequence is; −14 LUFS',
    container: 'mp4',
    video: web({ codec: 'hevc', height: null, bitDepth: 10, hdr: true, hardware: 'software', rate: { mode: 'quality', q: 88 } }),
    audio: AAC,
    loudness: -14,
    truePeak: -1,
  },
  {
    id: 'hdr-master',
    name: 'Master: HDR ProRes 422 HQ',
    group: 'master',
    note: 'ProRes 422 HQ 10-bit .mov tagged Rec. 2020 PQ or HLG, as the sequence is; 24-bit sound',
    container: 'mov',
    video: web({ codec: 'prores', height: null, prores: 'hq', bitDepth: 10, hdr: true, hardware: 'software', rate: { mode: 'quality', q: 100 } }),
    audio: PCM24,
    loudness: null,
    truePeak: -1,
  },
  {
    id: 'prores-hq',"""),
("""    if (v.rate.mode !== 'quality' && !(v.rate.mbps > 0)) out.push('The bit rate must be more than zero.');""","""    if (v.rate.mode !== 'quality' && !(v.rate.mbps > 0)) out.push('The bit rate must be more than zero.');
    if (v.hdr && (v.bitDepth !== 10 || !(v.codec === 'hevc' || v.codec === 'prores'))) out.push('HDR films are 10-bit H.265 or ProRes.');"""),
])

edit('editor/app/src/export/ffargs.ts', [
("""import { exactRate } from '../model/types';""","""import { exactRate } from '../model/types';
import { hdrTags, type ColorSpace } from '../render/hdr';"""),
("""export function encodeArgs(enc: string, v: VideoSpec, fps: number): string[] {
  const pix = pixelFormat(enc, v);
  const bt709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];""","""export function encodeArgs(enc: string, v: VideoSpec, fps: number, space: ColorSpace = 'rec709'): string[] {
  const pix = pixelFormat(enc, v);
  // HDR films carry Rec. 2020 and PQ or HLG (and, from x265, the HDR10 details); everything else Rec. 709.
  const bt709 = v.hdr && space !== 'rec709' ? hdrTags(space, enc) : ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];"""),
("""            : enc === 'libx265'
              ? ['-preset', 'medium', '-profile:v', ten ? 'main10' : 'main', '-x265-params', 'log-level=error']""","""            : enc === 'libx265'
              ? ['-preset', 'medium', '-profile:v', ten ? 'main10' : 'main', ...(v.hdr && space !== 'rec709' ? [] : ['-x265-params', 'log-level=error'])]"""),
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
