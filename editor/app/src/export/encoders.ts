// Which FFmpeg encoder makes a codec on this computer: the graphics card's
// (NVIDIA NVENC, Intel Quick Sync, AMD AMF, Apple VideoToolbox) when there
// is one that works, otherwise the software encoder.
import type { HardwarePref, VideoCodec } from './presets';

export interface EncoderChoice {
  name: string;
  hardware: boolean;
  /** Why it is not what was asked for (e.g. no graphics card encoder: software is used). */
  note?: string;
}

const HARDWARE: Record<'h264' | 'hevc', string[]> = {
  h264: ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox'],
  hevc: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'hevc_videotoolbox'],
};
const SOFTWARE: Record<VideoCodec, string> = { h264: 'libx264', hevc: 'libx265', prores: 'prores_ks', dnxhr: 'dnxhd', png: 'png', gif: 'gif' };

export const isHardware = (name: string): boolean => /_(nvenc|qsv|amf|videotoolbox)$/.test(name);

/** The graphics card's brand, for showing. */
export function hardwareName(name: string): string {
  if (name.endsWith('_nvenc')) return 'NVIDIA NVENC';
  if (name.endsWith('_qsv')) return 'Intel Quick Sync';
  if (name.endsWith('_amf')) return 'AMD AMF';
  if (name.endsWith('_videotoolbox')) return 'Apple VideoToolbox';
  return 'software';
}

/**
 * The encoder for a codec. `available` is what works here (the program
 * tries hardware encoders for real). Null when nothing here can make it.
 */
export function pickVideoEncoder(codec: VideoCodec, bitDepth: 8 | 10, pref: HardwarePref, available: readonly string[]): EncoderChoice | null {
  const has = (n: string) => available.includes(n);
  const soft = SOFTWARE[codec];
  if (codec !== 'h264' && codec !== 'hevc') return has(soft) ? { name: soft, hardware: false } : null;
  // H.264 at 10 bits: only the software encoder makes it.
  const hw = pref === 'software' || (codec === 'h264' && bitDepth === 10) ? [] : HARDWARE[codec].filter(has);
  if (hw[0]) return { name: hw[0], hardware: true };
  if (!has(soft)) return null;
  if (pref === 'hardware') return { name: soft, hardware: false, note: 'No graphics card encoder works here: the software encoder is used.' };
  return { name: soft, hardware: false };
}

/** After a hardware encoder failed: the software one instead (null when there is none). */
export function fallbackEncoder(failed: EncoderChoice, codec: VideoCodec, available: readonly string[]): EncoderChoice | null {
  if (!failed.hardware) return null;
  const soft = SOFTWARE[codec];
  return available.includes(soft) ? { name: soft, hardware: false, note: `${hardwareName(failed.name)} failed: made with the software encoder.` } : null;
}
