// Rendering a composition to a film or to pictures: every frame drawn by the
// same renderer as the screen, at exact times (never a screen recording).
// WebM with alpha (VP9) and MP4 are made in the browser (WebCodecs); PNG
// sequences are zipped; ProRes 4444 with alpha goes through FFmpeg (desktop).

import { renderFrame, type RenderEnv } from '../core/render';
import { bestFrames, exactVideoEnv, type OpenFrames } from '../core/exactVideo';
import { zip } from '../core/zip';
import type { BrandTokens, TitleProject, Values } from '../core/types';
import { compOf } from './ops';
import type { FrameSink, Host, VideoTarget } from './host';
import { channelsOf, CUE_RATE, mixCueSound, toBase64, wavBytes } from './cueAudio';

export interface RenderJob {
  project: TitleProject;
  comp: string;
  /** Seconds of the composition, start and end. */
  from: number;
  to: number;
  width: number;
  height: number;
  fps: number;
  values?: Values;
  brand?: Partial<BrandTokens>;
  env: RenderEnv;
}

export const FORMAT_NAMES: Record<VideoTarget['format'], string> = {
  prores4444: 'ProRes 4444 with alpha (.mov)',
  'webm-alpha': 'WebM VP9 with alpha (.webm)',
  mp4: 'MP4 H.264, no alpha (.mp4)',
  'png-sequence': 'PNG sequence with alpha (.zip)',
};

/** The times of a job's frames. */
export function frameTimes(job: Pick<RenderJob, 'from' | 'to' | 'fps'>): number[] {
  const n = Math.max(1, Math.round((job.to - job.from) * job.fps));
  return Array.from({ length: n }, (_, i) => job.from + i / job.fps);
}

function surface(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Draw frame i of a job into a canvas (cleared to see-through first). */
export function drawJobFrame(canvas: OffscreenCanvas | HTMLCanvasElement, job: RenderJob, t: number) {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderFrame(ctx, job.project, {
    comp: job.comp,
    time: t,
    clock: t,
    values: job.values,
    brand: job.brand,
    env: job.env,
    width: job.width,
    height: job.height,
  });
}

export interface Progress {
  (done: number, total: number): void;
}

/** Draw a job's frame with its videos frame-exact (decoding what the frame needs first). */
async function drawExact(canvas: OffscreenCanvas | HTMLCanvasElement, job: RenderJob, t: number) {
  drawJobFrame(canvas, job, t);
  const env = job.env as RenderJob['env'] & { settle?: () => Promise<boolean> };
  if (env.settle && (await env.settle())) drawJobFrame(canvas, job, t);
}

/** The job with its video layers decoded frame-exact (WebCodecs, or awaited seeks for files it can't read). */
export function exactJob(job: RenderJob, urlFor: (s: string) => string, open?: OpenFrames): { job: RenderJob; close: () => void } {
  if (!job.project.assets.some((a) => a.kind === 'video')) return { job, close: () => {} };
  const env = exactVideoEnv(job.env, open ?? bestFrames(urlFor));
  return { job: { ...job, env }, close: () => env.close() };
}

/**
 * Render a job. Returns a Blob for browser formats, or the file path the host
 * wrote (desktop FFmpeg). `signal` stops it.
 */
export async function renderVideo(given: RenderJob, target: VideoTarget, host: Host, progress: Progress, signal?: AbortSignal): Promise<Blob | string> {
  const { job, close } = exactJob(given, host.urlFor);
  try {
    return await renderFrames(job, target, host, progress, signal);
  } finally {
    close();
  }
}

async function renderFrames(job: RenderJob, target: VideoTarget, host: Host, progress: Progress, signal?: AbortSignal): Promise<Blob | string> {
  const times = frameTimes(job);
  const canvas = surface(job.width, job.height);
  if (target.format === 'png-sequence') {
    const entries = [];
    for (let i = 0; i < times.length; i++) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      await drawExact(canvas, job, times[i]!);
      const blob =
        'convertToBlob' in canvas
          ? await canvas.convertToBlob({ type: 'image/png' })
          : await new Promise<Blob>((r) => (canvas as HTMLCanvasElement).toBlob((b) => r(b!), 'image/png'));
      entries.push({ name: `${target.name}_${String(i).padStart(5, '0')}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
      progress(i + 1, times.length);
    }
    return new Blob([zip(entries) as BlobPart], { type: 'application/zip' });
  }
  if (target.format === 'prores4444' || (host.renderTo && host.kind === 'desktop' && target.format === 'mp4')) {
    const sound = await mixCueSound(job, host.urlFor).catch(() => null);
    const wav = sound ? toBase64(wavBytes(channelsOf(sound), CUE_RATE)) : null;
    const sink: FrameSink | null = host.renderTo ? await host.renderTo(target, job.width, job.height, job.fps, wav) : null;
    if (!sink) throw new Error('ProRes 4444 is made by the Lumora Titler desktop app (with FFmpeg). In the browser, choose WebM with alpha or a PNG sequence.');
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    try {
      for (let i = 0; i < times.length; i++) {
        if (signal?.aborted) {
          await sink.cancel();
          throw new DOMException('Stopped', 'AbortError');
        }
        await drawExact(canvas, job, times[i]!);
        await sink.frame(ctx.getImageData(0, 0, job.width, job.height).data, job.width, job.height);
        progress(i + 1, times.length);
      }
      return await sink.finish();
    } catch (e) {
      await sink.cancel().catch(() => {});
      throw e;
    }
  }
  // WebM (VP9 with alpha) or MP4 (H.264) in the browser.
  const mb = await import('mediabunny');
  const webm = target.format === 'webm-alpha';
  const codec = webm ? 'vp9' : 'avc';
  if (!(await mb.canEncodeVideo(codec, { width: job.width, height: job.height })))
    throw new Error(
      `This browser can’t make ${webm ? 'WebM (VP9)' : 'MP4 (H.264)'} films. Try a PNG sequence${host.kind === 'desktop' ? ' or ProRes 4444' : ''}.`,
    );
  const output = new mb.Output({
    format: webm ? new mb.WebMOutputFormat() : new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new mb.BufferTarget(),
  });
  const source = new mb.CanvasSource(canvas, { codec, quality: mb.QUALITY_HIGH, ...(webm ? { alpha: 'keep' as const } : {}) });
  output.addVideoTrack(source, { frameRate: job.fps });
  // The audio cues' sound (Opus in WebM, AAC in MP4), when the browser can make it.
  const sound = await mixCueSound(job, host.urlFor).catch(() => null);
  const audioCodec = webm ? 'opus' : 'aac';
  const audio = sound && (await mb.canEncodeAudio(audioCodec).catch(() => false)) ? new mb.AudioBufferSource({ codec: audioCodec, bitrate: mb.QUALITY_HIGH }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();
  if (audio && sound) await audio.add(sound);
  for (let i = 0; i < times.length; i++) {
    if (signal?.aborted) {
      await output.cancel();
      throw new DOMException('Stopped', 'AbortError');
    }
    await drawExact(canvas, job, times[i]!);
    await source.add(i / job.fps, 1 / job.fps);
    progress(i + 1, times.length);
  }
  await output.finalize();
  const buf = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
  if (!buf) throw new Error('The film could not be made.');
  return new Blob([buf], { type: webm ? 'video/webm' : 'video/mp4' });
}

/** A job for the whole of a composition (IN, HOLD once, OUT). */
export function wholeJob(project: TitleProject, compId: string, env: RenderEnv, values?: Values, brand?: Partial<BrandTokens>, scale = 1): RenderJob {
  const c = compOf(project, compId);
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return { project, comp: c.id, from: 0, to: c.duration, width: even(c.width * scale), height: even(c.height * scale), fps: c.fps, values, brand, env };
}
