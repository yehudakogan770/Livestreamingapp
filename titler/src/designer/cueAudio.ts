// A render's sound: the audio cues it passes, mixed at their times (the same
// times the preview and Lumora use), as an AudioBuffer for the browser's
// encoders or a WAV file for FFmpeg.

import { cueGain, straightCueEvents } from '../core/cues';
import type { RenderJob } from './renderVideo';
import { compOf } from './ops';
import { decodeSound } from './previewCues';

export const CUE_RATE = 48000;

/** The cues' sound over the job's time, or null when no cue with a sound is passed. */
export async function mixCueSound(job: RenderJob, urlFor: (s: string) => string): Promise<AudioBuffer | null> {
  const c = compOf(job.project, job.comp);
  const events = straightCueEvents(job.project, c, job.from, job.to);
  if (!events.length || typeof OfflineAudioContext === 'undefined') return null;
  const length = Math.max(1, Math.round((job.to - job.from) * CUE_RATE));
  const ctx = new OfflineAudioContext(2, length, CUE_RATE);
  let any = false;
  for (const e of events) {
    const buf = await decodeSound(ctx, e.sound, urlFor);
    if (!buf) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = cueGain(e.cue);
    src.connect(g).connect(ctx.destination);
    src.start(e.at);
    any = true;
  }
  return any ? ctx.startRendering() : null;
}

/** 16-bit PCM WAV bytes of a buffer (interleaved channels). */
export function wavBytes(channels: Float32Array[], rate: number): Uint8Array {
  const n = channels[0]?.length ?? 0;
  const ch = channels.length;
  const data = n * ch * 2;
  const out = new Uint8Array(44 + data);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((x, i) => v.setUint8(o + i, x.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]![i]!));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  return out;
}

/** Bytes as standard base64 (for sending a WAV to the desktop app). */
export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export const channelsOf = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i));
