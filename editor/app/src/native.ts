import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Prepared } from './model/build';
import type { Job } from './export/audioplan';
import type { ChainLink, FoundPlugin, PluginParam } from './model/plugins';

/** Running as the installed program (not in a plain browser). */
export const inApp = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** A file on the computer, as something the page can play. */
export const mediaUrl = (path: string): string => (inApp() ? convertFileSrc(path) : path);

export interface Strip {
  path: string;
  every: number;
  count: number;
  cols: number;
  w: number;
  h: number;
}

export const native = {
  ffmpegFound: () => invoke<boolean>('ffmpeg_found'),
  initialFile: () => invoke<string | null>('initial_file'),
  readText: (path: string) => invoke<string>('read_text', { path }),
  writeText: (path: string, text: string) => invoke<void>('write_text', { path, text }),
  fileExists: (path: string) => invoke<boolean>('file_exists', { path }),
  /** A recording Lumora made (it may be given an index in place). */
  prepare: (path: string) => invoke<Prepared>('prepare_media', { path }),
  /** Any file (the original is never changed). */
  importMedia: (path: string) => invoke<Prepared>('import_media', { path }),
  /** What a file is and whether a copy will be made (quick: nothing is made yet). */
  probeMedia: (path: string) => invoke<Prepared>('probe_media', { path }),
  /** A lighter copy of a heavy file for smooth playback (made once, kept). */
  makeProxy: (path: string, threads?: number, hardware?: boolean) => invoke<string>('make_proxy', { path, threads, hardware }),
  /** Read an original's frames through FFmpeg (RGBA), for making the film from files the app can't decode. */
  framesOpen: (path: string, from: number, rate: number, width: number, height: number) => invoke<number>('frames_open', { path, from, rate, width, height }),
  framesNext: async (id: number): Promise<Uint8Array> => new Uint8Array(await invoke<ArrayBuffer>('frames_next', { id })),
  framesClose: (id: number) => invoke<void>('frames_close', { id }),
  /** Read an original's frames deep (16 bits a channel, HDR as it is), for HDR films. */
  framesOpenDeep: (path: string, from: number, rate: number, width: number, height: number) =>
    invoke<number>('frames_open', { path, from, rate, width, height, deep: true }),
  /** An HDR file's signal copy for watching it in an HDR sequence (made once). */
  hdrCopy: (path: string, seconds: number) => invoke<string>('hdr_copy', { path, seconds }),
  strip: (path: string, seconds: number) => invoke<Strip>('strip', { path, seconds }),
  peaks: async (path: string): Promise<Uint8Array> => new Uint8Array(await invoke<ArrayBuffer>('peaks', { path })),
  /** The folder of a speech model (downloaded the first time). */
  speechModel: (name: string) => invoke<string>('speech_model', { name }),
  /** `seconds` of a file's sound from `from`, at 16 kHz, one channel. */
  /** The VST3 effects on this computer (each plug-in file looked at once, in a helper process). */
  vstScan: (again = false) => invoke<{ effects: FoundPlugin[]; broken: { path: string; problem: string }[]; folders: string[] }>('vst_scan', { again }),
  /** A VST3 effect's parameters, its saved settings restored and values set; and its settings after. */
  vstSettings: (path: string, cid: string, state: string | null, set: [number, number][] = []) =>
    invoke<{ params: PluginParam[]; state: string }>('vst_settings', { path, cid, state, set }),
  /** A VST3 effect's own window (Windows), open until it is closed; then its parameters and settings. */
  vstEdit: (path: string, cid: string, state: string | null, title: string) =>
    invoke<{ params: PluginParam[]; state: string }>('vst_edit', { path, cid, state, title }),
  /** A stretch of a file's sound through VST3 effects, as a WAV file (made once). */
  vstRender: (path: string, from: number, seconds: number, chain: ChainLink[]) => invoke<string>('vst_render', { path, from, seconds, chain }),
  /** The voice isolation model's path on disk (for FFmpeg's arnndn). */
  voiceModel: () => invoke<string>('voice_model'),
  /** A file's sound cleaned by the voice isolation model at a strength (0–1), for playing while editing (made once). */
  voiceClean: (path: string, seconds: number, mix: number) => invoke<string>('voice_clean', { path, seconds, mix }),
  speechAudio: async (path: string, from: number, seconds: number): Promise<Float32Array> =>
    new Float32Array(await invoke<ArrayBuffer>('speech_audio', { path, from, seconds })),
  exportFolder: (out: string) => invoke<string>('export_folder', { out }),
  writeChunk: (path: string, position: number, data: Uint8Array) =>
    invoke<void>('write_chunk', data, { headers: { 'x-path': encodeURIComponent(path), 'x-position': String(position) } }),
  /** AI mask results kept for a media file ("person" or "object"; empty when there are none). */
  matteRead: async (media: string, kind: string): Promise<Uint8Array> => new Uint8Array(await invoke<ArrayBuffer>('matte_read', { media, kind })),
  matteWrite: (media: string, kind: string, data: Uint8Array) =>
    invoke<void>('matte_write', data, { headers: { 'x-media': encodeURIComponent(media), 'x-kind': encodeURIComponent(kind) } }),
  exportStart: (plan: { jobs: Job[]; files?: [string, string][] }, out: string, tmp: string) => invoke<void>('export_start', { plan, out, tmp }),
  exportCancel: () => invoke<void>('export_cancel'),
  exportAbandon: (tmp: string) => invoke<void>('export_abandon', { tmp }),
  findByName: (folder: string, name: string) => invoke<string | null>('find_by_name', { folder, name }),
  sendToLumora: (path: string, name: string, seconds: number) => invoke<void>('send_to_lumora', { path, name, seconds }),
  reveal: (path: string) => invoke<void>('reveal', { path }),
};

export interface ExportProgress {
  done: number;
  part: number;
  parts: number;
  finished: boolean;
  error: string | null;
  path: string | null;
}

function subscribe<T>(event: string, f: (p: T) => void): () => void {
  if (!inApp()) return () => {};
  let stop: (() => void) | null = null;
  let gone = false;
  void listen<T>(event, (e) => f(e.payload)).then((u) => {
    if (gone) u();
    else stop = u;
  });
  return () => {
    gone = true;
    stop?.();
  };
}

export const onExportProgress = (f: (p: ExportProgress) => void): (() => void) => subscribe('export-progress', f);
/** How far a file's playable copy is along: [path, 0–1]. */
export const onImportProgress = (f: (p: [string, number]) => void): (() => void) => subscribe('import-progress', f);

/** How far a playback proxy is along: [path, 0–1]. */
export const onProxyProgress = (f: (p: [string, number]) => void): (() => void) => subscribe('proxy-progress', f);

/** How far a speech model's download is along: [name, 0–1]. */
export const onSpeechProgress = (f: (p: [string, number]) => void): (() => void) => subscribe('speech-progress', f);

/** A file's folder, and its name without the extension. */
export function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.slice(0, i) : '';
}
export function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}
export function baseName(path: string): string {
  return fileName(path).replace(/\.[^.]+$/, '');
}
export const joinPath = (folder: string, name: string): string => (folder ? `${folder}${folder.includes('\\') ? '\\' : '/'}${name}` : name);
