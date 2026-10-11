// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addMedia } from '../model/build';
import { current, editSeq } from '../model/seq';
import { emptyProject, type MediaItem, type Project } from '../model/types';
import { pqEncode } from '../render/hdr';
import { planDelivery, type DeliveryRequest } from './deliver';
import { deepPicture } from './exporter';
import { pictureArgs } from './ffargs';
import { BUILT_IN, presetProblems, type DeliveryPreset } from './presets';

const preset = (id: string): DeliveryPreset => BUILT_IN.find((x) => x.id === id) as DeliveryPreset;
const media: MediaItem = {
  id: 'm',
  name: 'Sunset',
  path: '/media/sunset.mov',
  proxy: null,
  kind: 'video',
  duration: 10,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: false,
  bin: null,
  source: { codec: 'hevc', bitDepth: 10, hdr: true, transfer: 'pq', rotation: 0, vfr: false, bitrateKbps: 40000, heavy: true, exportVia: 'ffmpeg' },
};
function project(color?: 'pq' | 'hlg'): Project {
  const p = addMedia({ ...emptyProject('HDR'), media: [media] }, 'm', 0, 'overwrite', undefined, undefined, { in: 0, out: 2 });
  return color ? editSeq(p, (s) => ({ ...s, color })) : p;
}
const req = (p: Project, id: string): DeliveryRequest => ({
  preset: preset(id),
  seq: p.open,
  range: { from: 0, to: 60 },
  out: '/films/HDR.mp4',
  chapters: false,
  captions: { burn: true, embed: false, sidecar: false },
  encoders: ['libx264', 'libx265', 'hevc_nvenc', 'prores_ks', 'aac'],
  app: true,
});

describe('HDR films', () => {
  it('the HDR presets are sound, and need an HDR sequence', () => {
    for (const id of ['hdr-web', 'hdr-master']) expect(presetProblems(preset(id))).toEqual([]);
    const sdr = project();
    expect(() => planDelivery(sdr, req(sdr, 'hdr-web'))).toThrow(/HDR/);
  });

  it('a PQ sequence becomes H.265 10-bit with Rec. 2020, PQ and the HDR10 details, from 16-bit frames', () => {
    const p = project('pq');
    const plan = planDelivery(p, req(p, 'hdr-web'));
    const a = plan.settings.pipe?.args ?? [];
    expect(plan.settings.pipe?.deep).toBe(true);
    expect(a.slice(0, 4)).toEqual(['-f', 'rawvideo', '-pix_fmt', 'rgba64le']);
    expect(a).toContain('libx265');
    expect(a).toContain('yuv420p10le');
    expect(a.join(' ')).toContain('out_color_matrix=bt2020');
    expect(a).toContain('smpte2084');
    expect(a.join(' ')).toContain('hdr10=1');
  });

  it('an HLG sequence is tagged HLG; SDR presets of an HDR sequence stay Rec. 709 (tone-mapped)', () => {
    const p = project('hlg');
    const hlg = planDelivery(p, req(p, 'hdr-master')).settings.pipe?.args ?? [];
    expect(hlg).toContain('arib-std-b67');
    expect(hlg).toContain('prores_ks');
    const sdr = planDelivery(p, req(p, 'yt1080hevc')).settings.pipe;
    expect(sdr?.deep).toBeUndefined();
    expect(sdr?.args).toContain('bt709');
    expect(sdr?.args.slice(0, 4)).toEqual(['-f', 'rawvideo', '-pix_fmt', 'rgba']);
  });

  it('16-bit frames read deep become opaque 0–1 values', () => {
    const words = new Uint16Array([65535, 0, 32768, 0, 0, 65535, 0, 0]);
    const d = deepPicture(new Uint8Array(words.buffer), 2, 1, 'x');
    expect(d.deep[0]).toBe(1);
    expect(d.deep[2]).toBeCloseTo(0.5, 3);
    expect(d.deep[3]).toBe(1);
    expect(d.deep[5]).toBe(1);
    expect(d.deep[7]).toBe(1);
  });

  it('FFmpeg makes a real HDR10 file from the frames (when FFmpeg with x265 is on this computer)', () => {
    const ok = spawnSync('ffmpeg', ['-hide_banner', '-encoders']).stdout?.toString().includes('libx265');
    if (!ok) return;
    const dir = mkdtempSync(join(tmpdir(), 'lumora-hdr-'));
    try {
      const p = project('pq');
      const W = 64;
      const H = 36;
      const v = preset('hdr-web');
      const args = pictureArgs(v, 'libx265', 30, { width: W, height: H }, { width: W, height: H }, 'pq').map((x) => x.replace('{tmp}', dir));
      // Ten frames of 1000-nit white over 203-nit gray, as the compositor reads them back.
      const frame = new Uint16Array(W * H * 4);
      for (let i = 0; i < W * H; i++) {
        const v16 = Math.round((i % W < W / 2 ? pqEncode(1000) : pqEncode(203)) * 65535);
        frame.set([v16, v16, v16, 65535], i * 4);
      }
      const input = Buffer.concat(Array.from({ length: 10 }, () => Buffer.from(frame.buffer)));
      const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { input });
      expect(r.status, r.stderr?.toString()).toBe(0);
      const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_frames', '-read_intervals', '%+#1', join(dir, 'video.mov')]).stdout.toString();
      expect(probe).toContain('color_transfer=smpte2084');
      expect(probe).toContain('color_primaries=bt2020');
      expect(probe).toContain('pix_fmt=yuv420p10le');
      expect(probe).toMatch(/Mastering display metadata|max_luminance/);
      void readFileSync;
      void current(p);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
