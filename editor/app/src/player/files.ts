// Which file is read for what: playback can use a lighter proxy; the film is
// always made from the original (decoded in the app when the computer's video
// decoder reads it, otherwise through FFmpeg), and only falls back to the
// edit-friendly copy when the original can't be read at all.
import type { MediaItem } from '../model/types';

/** The file played while editing. */
export function playbackFile(m: MediaItem, useProxies: boolean): string {
  if (useProxies && m.playbackProxy) return m.playbackProxy;
  return m.proxy ?? m.path;
}

/** A way to read a file's pictures when making the film. */
export interface ExportSource {
  /** `decoder`: the computer's video decoder (WebCodecs) in the app; `ffmpeg`: FFmpeg reads it and hands over frames. */
  via: 'decoder' | 'ffmpeg';
  path: string;
}

/** The ways to read a file for the film, best first (a playback proxy is never one of them). */
export function exportSources(m: MediaItem, ffmpeg: boolean): ExportSource[] {
  const out: ExportSource[] = [];
  const viaFfmpeg = m.source?.exportVia === 'ffmpeg';
  if (!m.missing) {
    if (!viaFfmpeg) out.push({ via: 'decoder', path: m.path });
    if (ffmpeg) out.push({ via: 'ffmpeg', path: m.path });
  }
  if (m.proxy && m.proxy !== m.path) out.push({ via: 'decoder', path: m.proxy });
  return out;
}

/** Media heavy enough to want a playback proxy that doesn't have one yet. */
export const wantsProxy = (m: MediaItem): boolean => m.kind === 'video' && !!m.source?.heavy && !m.playbackProxy && !m.missing;
