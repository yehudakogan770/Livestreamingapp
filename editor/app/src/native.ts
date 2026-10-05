import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Prepared } from './model/project';

/** Running as the installed program (not in a plain browser). */
export const inApp = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** A file on the computer, as something the page can play. */
export const mediaUrl = (path: string): string => (inApp() ? convertFileSrc(path) : path);

export const native = {
  ffmpegFound: () => invoke<boolean>('ffmpeg_found'),
  initialFile: () => invoke<string | null>('initial_file'),
  readText: (path: string) => invoke<string>('read_text', { path }),
  writeText: (path: string, text: string) => invoke<void>('write_text', { path, text }),
  fileExists: (path: string) => invoke<boolean>('file_exists', { path }),
  prepare: (path: string) => invoke<Prepared>('prepare_media', { path }),
  peaks: async (path: string): Promise<Uint8Array> => new Uint8Array(await invoke<ArrayBuffer>('peaks', { path })),
  exportStart: (plan: unknown, out: string) => invoke<void>('export_start', { plan, out }),
  exportCancel: () => invoke<void>('export_cancel'),
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

export function onExportProgress(f: (p: ExportProgress) => void): () => void {
  if (!inApp()) return () => {};
  let stop: (() => void) | null = null;
  let gone = false;
  void listen<ExportProgress>('export-progress', (e) => f(e.payload)).then((u) => {
    if (gone) u();
    else stop = u;
  });
  return () => {
    gone = true;
    stop?.();
  };
}

/** A file's folder, and its name without the extension. */
export function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.slice(0, i) : '';
}
export function baseName(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  return name.replace(/\.[^.]+$/, '');
}
export const joinPath = (folder: string, name: string): string => (folder ? `${folder}${folder.includes('\\') ? '\\' : '/'}${name}` : name);
