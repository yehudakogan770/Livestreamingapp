// A delivery preset as FFmpeg arguments: the frames the editor draws come in
// raw (RGBA) and leave in the preset's codec, size, pixel format and rate
// control, with the right encoder options for software and hardware encoders.
import { exactRate } from '../model/types';
import type { AudioSpec, DeliveryPreset, RateControl, VideoCodec, VideoSpec } from './presets';

export interface FrameSize {
  width: number;
  height: number;
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);
const num = (n: number): string => Number(n.toFixed(4)).toString();

/** The finished frame's size. */
export function outputSize(seq: FrameSize, v: Pick<VideoSpec, 'width' | 'height' | 'codec'>): FrameSize {
  const round = v.codec === 'png' || v.codec === 'gif' ? (n: number) => Math.max(1, Math.round(n)) : even;
  if (v.width !== null && v.height !== null) return { width: round(v.width), height: round(v.height) };
  if (v.height !== null) return { width: round((v.height * seq.width) / seq.height), height: round(v.height) };
  if (v.width !== null) return { width: round(v.width), height: round((v.width * seq.height) / seq.width) };
  return { width: round(seq.width), height: round(seq.height) };
}

/** The size frames are drawn at (the sequence's shape) so they fit inside, or fill, the finished frame. */
export function renderSize(seq: FrameSize, out: FrameSize, fit: 'fit' | 'fill'): FrameSize {
  if (Math.abs(seq.width / seq.height - out.width / out.height) < 0.002) return { ...out, width: even(out.width), height: even(out.height) };
  const k = fit === 'fit' ? Math.min(out.width / seq.width, out.height / seq.height) : Math.max(out.width / seq.width, out.height / seq.height);
  return { width: even(seq.width * k), height: even(seq.height * k) };
}

/** A frame rate as FFmpeg likes it (29.97 is 30000/1001). */
export function rateText(fps: number): string {
  const r = exactRate(fps);
  if (Math.abs(r - 24000 / 1001) < 1e-6) return '24000/1001';
  if (Math.abs(r - 30000 / 1001) < 1e-6) return '30000/1001';
  if (Math.abs(r - 60000 / 1001) < 1e-6) return '60000/1001';
  return num(r);
}

/** A 0–100 quality as the encoder's constant-quality number (lower is better). */
export function crfFor(q: number, codec: VideoCodec): number {
  const crf = Math.round(51 - Math.max(0, Math.min(100, q)) * 0.4);
  return codec === 'hevc' ? Math.min(51, crf + 3) : crf;
}

/** The pixel format an encoder is given. */
export function pixelFormat(enc: string, v: Pick<VideoSpec, 'codec' | 'bitDepth' | 'alpha' | 'prores' | 'dnxhr'>): string {
  const ten = v.bitDepth === 10;
  switch (v.codec) {
    case 'prores':
      return v.prores === '4444' || v.prores === '4444xq' ? (v.alpha ? 'yuva444p10le' : 'yuv444p10le') : 'yuv422p10le';
    case 'dnxhr':
      return v.dnxhr === '444' ? 'yuv444p10le' : v.dnxhr === 'hqx' ? 'yuv422p10le' : 'yuv422p';
    case 'png':
      return v.alpha ? 'rgba' : 'rgb24';
    case 'gif':
      return 'pal8';
    default:
      if (enc.startsWith('lib') || enc.endsWith('_nvenc')) return ten ? (enc.startsWith('lib') ? 'yuv420p10le' : 'p010le') : 'yuv420p';
      return ten ? 'p010le' : 'nv12';
  }
}

const PRORES: Record<string, number> = { proxy: 0, lt: 1, standard: 2, hq: 3, '4444': 4, '4444xq': 5 };

function rateArgs(enc: string, codec: VideoCodec, r: RateControl): string[] {
  if (r.mode === 'quality') {
    const crf = crfFor(r.q, codec);
    if (enc.startsWith('lib')) return ['-crf', String(crf)];
    if (enc.endsWith('_nvenc')) return ['-rc', 'vbr', '-cq', String(crf), '-b:v', '0'];
    if (enc.endsWith('_qsv')) return ['-global_quality', String(crf)];
    if (enc.endsWith('_amf')) return ['-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf), '-qp_b', String(crf)];
    return ['-q:v', String(Math.round(Math.max(1, Math.min(100, r.q))))];
  }
  const k = Math.round(r.mbps * 1000);
  const kb = (n: number) => `${Math.round(n)}k`;
  if (r.mode === 'cbr') {
    if (enc === 'libx264') return ['-b:v', kb(k), '-minrate', kb(k), '-maxrate', kb(k), '-bufsize', kb(k), '-x264-params', 'nal-hrd=cbr'];
    if (enc.endsWith('_nvenc') || enc.endsWith('_amf')) return ['-rc', 'cbr', '-b:v', kb(k), '-maxrate', kb(k), '-bufsize', kb(k)];
    if (enc.endsWith('_videotoolbox')) return ['-b:v', kb(k)];
    return ['-b:v', kb(k), '-maxrate', kb(k), '-bufsize', kb(k)];
  }
  if (enc.endsWith('_nvenc')) return ['-rc', 'vbr', '-b:v', kb(k), '-maxrate', kb(k * 1.5), '-bufsize', kb(k * 2)];
  if (enc.endsWith('_amf')) return ['-rc', 'vbr_peak', '-b:v', kb(k), '-maxrate', kb(k * 1.5), '-bufsize', kb(k * 2)];
  if (enc.endsWith('_videotoolbox')) return ['-b:v', kb(k)];
  return ['-b:v', kb(k), '-maxrate', kb(k * 1.5), '-bufsize', kb(k * 2)];
}

/** The encoder's own options (codec, profile, speed, rate control, pixel format, color tags). */
export function encodeArgs(enc: string, v: VideoSpec, fps: number): string[] {
  const pix = pixelFormat(enc, v);
  const bt709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
  switch (v.codec) {
    case 'prores':
      return [
        '-c:v',
        'prores_ks',
        '-profile:v',
        String(PRORES[v.prores ?? 'hq'] ?? 3),
        '-vendor',
        'apl0',
        ...(v.alpha ? ['-alpha_bits', '16'] : []),
        '-pix_fmt',
        pix,
        ...bt709,
      ];
    case 'dnxhr':
      return ['-c:v', 'dnxhd', '-profile:v', `dnxhr_${v.dnxhr ?? 'hq'}`, '-pix_fmt', pix, ...bt709];
    case 'png':
      return ['-c:v', 'png', '-pix_fmt', pix];
    case 'gif':
      return ['-c:v', 'gif', '-loop', '0'];
    default: {
      const ten = v.bitDepth === 10;
      const hevc = v.codec === 'hevc';
      const speed =
        enc === 'libx264'
          ? ['-preset', 'medium', '-profile:v', ten ? 'high10' : 'high']
          : enc === 'libx265'
            ? ['-preset', 'medium', '-profile:v', ten ? 'main10' : 'main', '-x265-params', 'log-level=error']
            : enc.endsWith('_nvenc')
              ? ['-preset', 'p5', '-tune', 'hq', ...(hevc ? ['-profile:v', ten ? 'main10' : 'main'] : ['-profile:v', 'high'])]
              : enc.endsWith('_qsv')
                ? ['-preset', 'medium', ...(hevc && ten ? ['-profile:v', 'main10'] : [])]
                : enc.endsWith('_amf')
                  ? ['-quality', 'quality', ...(hevc && ten ? ['-profile:v', 'main10'] : [])]
                  : hevc && ten
                    ? ['-profile:v', 'main10']
                    : [];
      return [
        '-c:v',
        enc,
        ...speed,
        ...rateArgs(enc, v.codec, v.rate),
        '-g',
        String(Math.max(1, Math.round(exactRate(fps) * 2))),
        '-pix_fmt',
        pix,
        ...(hevc ? ['-tag:v', 'hvc1'] : []),
        ...bt709,
      ];
    }
  }
}

/** The picture filters: frame rate, scaling into the finished frame (bars or crop), and color matrix. */
export function filterChain(v: VideoSpec, render: FrameSize, out: FrameSize, seqFps: number): string {
  const steps: string[] = [];
  if (v.fps !== null && Math.abs(v.fps - seqFps) > 0.01) steps.push(`fps=${rateText(v.fps)}`);
  const W = out.width;
  const H = out.height;
  const same = render.width === W && render.height === H;
  const yuv = v.codec !== 'png' && v.codec !== 'gif';
  const color = yuv ? ':out_color_matrix=bt709:out_range=tv' : '';
  if (same) steps.push(`scale=${W}:${H}:flags=lanczos${color}`);
  else if (v.fit === 'fit')
    steps.push(
      `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos${color}`,
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${v.alpha ? 'black@0' : 'black'}`,
    );
  else steps.push(`scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos${color}`, `crop=${W}:${H}`);
  if (v.codec === 'gif') return `${steps.join(',')},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`;
  return steps.join(',');
}

/** Where the encoded picture goes: a work file joined with the sound later, or the finished file itself (images). */
export function pictureFile(p: DeliveryPreset): string {
  if (p.container === 'png' || p.container === 'gif') return '{out}';
  return '{tmp}/video.mov';
}

/** Everything FFmpeg is told to turn raw frames into the preset's picture. */
export function pictureArgs(p: DeliveryPreset, enc: string, seqFps: number, render: FrameSize, out: FrameSize): string[] {
  const v = p.video;
  if (!v) throw new Error('This preset makes no picture.');
  return [
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s',
    `${render.width}x${render.height}`,
    '-framerate',
    rateText(seqFps),
    '-i',
    'pipe:0',
    '-vf',
    filterChain(v, render, out, seqFps),
    ...encodeArgs(enc, v, v.fps ?? seqFps),
    ...(p.container === 'png' ? ['-start_number', '0'] : []),
    pictureFile(p),
  ];
}

/** The sound encoder's options. */
export function audioArgs(a: AudioSpec): string[] {
  switch (a.codec) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', `${a.kbps || 320}k`];
    case 'pcm16':
      return ['-c:a', 'pcm_s16le'];
    case 'pcm24':
      return ['-c:a', 'pcm_s24le'];
    default:
      return ['-c:a', 'aac', '-b:a', `${a.kbps || 256}k`];
  }
}

/** FFmpeg's loudness filter aiming at a target (LUFS) and a true-peak ceiling. */
export function loudnormFilter(lufs: number, truePeak: number): string {
  const i = Math.max(-70, Math.min(-5, lufs));
  const tp = Math.max(-9, Math.min(0, truePeak));
  return `loudnorm=I=${num(i)}:TP=${num(tp)}:LRA=${i <= -20 ? 18 : 11}`;
}

/** Does this preset need FFmpeg to encode the picture (rather than the computer's built-in H.264 encoder)? */
export function needsFfmpegPicture(p: DeliveryPreset, seq: FrameSize): boolean {
  const v = p.video;
  if (!v) return false;
  if (v.codec !== 'h264' || v.bitDepth !== 8 || v.alpha || v.fps !== null) return true;
  if (v.hardware === 'software') return true;
  if (v.rate.mode === 'cbr') return true;
  const out = outputSize(seq, v);
  return Math.abs(seq.width / seq.height - out.width / out.height) >= 0.002;
}
