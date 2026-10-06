// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fallbackEncoder, pickVideoEncoder } from './encoders';
import { crfFor, encodeArgs, filterChain, loudnormFilter, needsFfmpegPicture, outputSize, pictureArgs, pixelFormat, rateText, renderSize } from './ffargs';
import { BUILT_IN, numbered, presetProblems, type DeliveryPreset } from './presets';

const preset = (id: string): DeliveryPreset => {
  const p = BUILT_IN.find((x) => x.id === id);
  if (!p) throw new Error(id);
  return p;
};
const HD = { width: 1920, height: 1080 };
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('delivery presets', () => {
  it('every built-in preset is sound', () => {
    for (const p of BUILT_IN) expect(presetProblems(p), p.id).toEqual([]);
    expect(new Set(BUILT_IN.map((p) => p.id)).size).toBe(BUILT_IN.length);
  });

  it('points out presets that cannot work', () => {
    const p = preset('yt1080');
    expect(presetProblems({ ...p, video: { ...p.video!, alpha: true } })).toContain('Only ProRes 4444 and PNG keep transparency.');
    expect(presetProblems({ ...preset('prores-hq'), container: 'mp4' })).toContain('ProRes and DNxHR go in a .mov file.');
    expect(presetProblems({ ...preset('mp3'), container: 'wav' })).toContain('A .wav file needs uncompressed sound.');
  });

  it('numbers image sequences', () => {
    expect(numbered('/films/Gala.png')).toBe('/films/Gala_%05d.png');
    expect(numbered('/films/Gala_%05d.png')).toBe('/films/Gala_%05d.png');
  });
});

describe('frame sizes', () => {
  it('follows the sequence shape when only the height is given', () => {
    expect(outputSize(HD, { width: null, height: 2160, codec: 'h264' })).toEqual({ width: 3840, height: 2160 });
    expect(outputSize({ width: 1080, height: 1920 }, { width: null, height: 1080, codec: 'h264' })).toEqual({ width: 608, height: 1080 });
    expect(outputSize(HD, { width: 640, height: null, codec: 'gif' })).toEqual({ width: 640, height: 360 });
    expect(outputSize(HD, { width: null, height: null, codec: 'prores' })).toEqual(HD);
  });

  it('draws a wide sequence big enough to fill a vertical frame, or small enough to fit it', () => {
    const out = { width: 1080, height: 1920 };
    expect(renderSize(HD, out, 'fill')).toEqual({ width: 3414, height: 1920 });
    expect(renderSize(HD, out, 'fit')).toEqual({ width: 1080, height: 608 });
    expect(renderSize(HD, HD, 'fill')).toEqual(HD);
  });
});

describe('encoders', () => {
  const all = ['libx264', 'libx265', 'h264_nvenc', 'hevc_nvenc', 'h264_qsv', 'prores_ks', 'dnxhd', 'png', 'gif'];
  it('uses the graphics card when it can, the software encoder otherwise', () => {
    expect(pickVideoEncoder('h264', 8, 'auto', all)).toEqual({ name: 'h264_nvenc', hardware: true });
    expect(pickVideoEncoder('h264', 8, 'auto', ['libx264', 'h264_amf'])).toEqual({ name: 'h264_amf', hardware: true });
    expect(pickVideoEncoder('h264', 8, 'software', all)).toEqual({ name: 'libx264', hardware: false });
    expect(pickVideoEncoder('hevc', 10, 'auto', ['libx265'])).toEqual({ name: 'libx265', hardware: false });
    expect(pickVideoEncoder('hevc', 8, 'hardware', ['libx265'])?.note).toMatch(/software encoder is used/);
    // 10-bit H.264 is software only.
    expect(pickVideoEncoder('h264', 10, 'auto', all)).toEqual({ name: 'libx264', hardware: false });
    expect(pickVideoEncoder('prores', 10, 'auto', all)).toEqual({ name: 'prores_ks', hardware: false });
    expect(pickVideoEncoder('hevc', 8, 'auto', ['libx264'])).toBeNull();
  });

  it('falls back to software when the hardware encoder fails', () => {
    expect(fallbackEncoder({ name: 'hevc_nvenc', hardware: true }, 'hevc', all)?.name).toBe('libx265');
    expect(fallbackEncoder({ name: 'libx265', hardware: false }, 'hevc', all)).toBeNull();
  });
});

describe('preset to FFmpeg arguments', () => {
  it('YouTube 1080p on NVENC: variable bit rate, a key frame every 2 seconds, BT.709', () => {
    const p = preset('yt1080');
    const a = encodeArgs('h264_nvenc', p.video!, 30);
    expect(after(a, '-c:v')).toBe('h264_nvenc');
    expect(after(a, '-rc')).toBe('vbr');
    expect(after(a, '-b:v')).toBe('12000k');
    expect(after(a, '-maxrate')).toBe('18000k');
    expect(after(a, '-g')).toBe('60');
    expect(after(a, '-pix_fmt')).toBe('yuv420p');
    expect(after(a, '-colorspace')).toBe('bt709');
  });

  it('H.265 10-bit in software and on Quick Sync', () => {
    const v = preset('yt4khevc').video!;
    const sw = encodeArgs('libx265', v, 25);
    expect(after(sw, '-pix_fmt')).toBe('yuv420p10le');
    expect(after(sw, '-profile:v')).toBe('main10');
    expect(after(sw, '-tag:v')).toBe('hvc1');
    expect(pixelFormat('hevc_qsv', v)).toBe('p010le');
    expect(pixelFormat('hevc_nvenc', v)).toBe('p010le');
    expect(pixelFormat('h264_qsv', { ...v, codec: 'h264', bitDepth: 8 })).toBe('nv12');
  });

  it('constant bit rate and constant quality', () => {
    const v = preset('yt1080').video!;
    const cbr = encodeArgs('libx264', { ...v, rate: { mode: 'cbr', mbps: 8 } }, 30);
    expect(after(cbr, '-minrate')).toBe('8000k');
    expect(after(cbr, '-x264-params')).toBe('nal-hrd=cbr');
    const q = encodeArgs('libx264', { ...v, rate: { mode: 'quality', q: 80 } }, 30);
    expect(after(q, '-crf')).toBe('19');
    expect(crfFor(80, 'hevc')).toBe(22);
    const nv = encodeArgs('hevc_nvenc', { ...v, codec: 'hevc', rate: { mode: 'quality', q: 80 } }, 30);
    expect(after(nv, '-cq')).toBe('22');
    const amf = encodeArgs('h264_amf', { ...v, rate: { mode: 'cbr', mbps: 6 } }, 30);
    expect(after(amf, '-rc')).toBe('cbr');
  });

  it('ProRes 4444 keeps alpha; ProRes 422 HQ and DNxHR HQ for broadcast', () => {
    const m = encodeArgs('prores_ks', preset('master-4444').video!, 24);
    expect(after(m, '-profile:v')).toBe('4');
    expect(after(m, '-pix_fmt')).toBe('yuva444p10le');
    expect(after(m, '-alpha_bits')).toBe('16');
    const hq = encodeArgs('prores_ks', preset('prores-hq').video!, 25);
    expect(after(hq, '-profile:v')).toBe('3');
    expect(after(hq, '-pix_fmt')).toBe('yuv422p10le');
    const dn = encodeArgs('dnxhd', preset('dnxhr-hq').video!, 25);
    expect(after(dn, '-profile:v')).toBe('dnxhr_hq');
    expect(after(dn, '-pix_fmt')).toBe('yuv422p');
  });

  it('raw frames in, the picture out', () => {
    const p = preset('master-4444');
    const a = pictureArgs(p, 'prores_ks', 23.976, HD, HD);
    expect(a.slice(0, 10)).toEqual(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '1920x1080', '-framerate', '24000/1001', '-i', 'pipe:0']);
    expect(a[a.length - 1]).toBe('{tmp}/video.mov');
    const png = pictureArgs(preset('png'), 'png', 30, HD, HD);
    expect(png[png.length - 1]).toBe('{out}');
    expect(after(png, '-pix_fmt')).toBe('rgba');
    expect(after(png, '-start_number')).toBe('0');
  });

  it('a vertical preset crops a wide sequence to fill the frame', () => {
    const v = preset('reels').video!;
    const out = outputSize(HD, v);
    const f = filterChain(v, renderSize(HD, out, 'fill'), out, 30);
    expect(f).toBe('scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos:out_color_matrix=bt709:out_range=tv,crop=1080:1920');
    const fit = filterChain({ ...v, fit: 'fit' }, renderSize(HD, out, 'fit'), out, 30);
    expect(fit).toContain('pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black');
  });

  it('a GIF gets its own palette at its own frame rate', () => {
    const v = preset('gif').video!;
    const f = filterChain(v, { width: 640, height: 360 }, { width: 640, height: 360 }, 30);
    expect(f.startsWith('fps=15,scale=640:360:flags=lanczos,split[a][b]')).toBe(true);
    expect(f).toContain('palettegen=stats_mode=diff');
    expect(f).toContain('paletteuse');
  });

  it('loudness targets and frame rates', () => {
    expect(loudnormFilter(-14, -1)).toBe('loudnorm=I=-14:TP=-1:LRA=11');
    expect(loudnormFilter(-23, -1)).toBe('loudnorm=I=-23:TP=-1:LRA=18');
    expect(loudnormFilter(-100, 3)).toBe('loudnorm=I=-70:TP=0:LRA=18');
    expect(rateText(29.97)).toBe('30000/1001');
    expect(rateText(25)).toBe('25');
  });

  it('plain H.264 at the sequence shape can use the built-in encoder; the rest need FFmpeg', () => {
    expect(needsFfmpegPicture(preset('yt1080'), HD)).toBe(false);
    expect(needsFfmpegPicture(preset('yt1080hevc'), HD)).toBe(true);
    expect(needsFfmpegPicture(preset('reels'), HD)).toBe(true);
    expect(needsFfmpegPicture(preset('master-4444'), HD)).toBe(true);
    expect(needsFfmpegPicture(preset('wav'), HD)).toBe(false);
  });
});
